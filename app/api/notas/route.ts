// Executa um pedido à SEFAZ registrado em notas_execucoes (supabase/notas.sql).
// Chamada pelo banco (notas_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id>" }. Responde na hora e trabalha em segundo plano.
// O certificado vem do Vault por notas_worker_pegar, que confere o mesmo segredo.
// Cada lote de 50 documentos é gravado na hora (notas_worker_gravar): se a rota cair, nada se perde.
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { partesPem } from "@/lib/esocial/certificado";
import { consultarNSU, darCiencia, distribuir, type Credencial } from "@/lib/notas/servicos";
import { ErroConexao } from "@/lib/notas/sefaz";

export const runtime = "nodejs";
export const maxDuration = 60;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Execucao = { id: string; empresa_cnpj: string; tipo: "distribuicao" | "ciencia" };
type Pego = { execucao: Execucao; empresa: { cnpj: string; nome: string; ult_nsu: string; lacunas?: Lacuna[] }; chaves: string[]; certificado: string | null };

// Regra de 1 hora da SEFAZ, com 5 min de folga: no dia 28/10 uma consulta 12 s depois da hora exata levou 656.
const UMA_HORA = 65 * 60 * 1000;
const LIMITE_MS = 45000; // deixa folga para gravar antes dos 60 s da Vercel
const LACUNA_POR_LEITURA = 30; // documentos buscados um a um (consNSU) por leitura
type Lacuna = { de: string; ate: string };
const nsu15 = (n: bigint) => n.toString().padStart(15, "0");
const faltam = (ls: Lacuna[]) => ls.reduce((s, l) => s + Number(BigInt(l.ate) - BigInt(l.de) + BigInt(1)), 0);

async function processar(segredo: string, id: string) {
  const supabase = db();
  const { data, error } = await supabase.rpc("notas_worker_pegar", { p_segredo: segredo, p_execucao: id });
  if (error || !data) return;
  const { execucao, empresa, chaves, certificado } = data as Pego;
  const inicio = Date.now();

  let status: "ok" | "sem_dados" | "falha" = "ok";
  let cstat: number | null = null;
  let erro = "";
  let bloquear: string | null = null;
  const resultado: Record<string, unknown> = {};

  try {
    if (!certificado) throw new Error("A empresa não tem certificado guardado. Envie o .pfx em Certificados digitais.");
    const { certificado: cert, cadeia, chave } = partesPem(certificado);
    const cred: Credencial = { certificado: cert, cadeia, chave };

    if (execucao.tipo === "distribuicao") {
      let ult = empresa.ult_nsu;
      let chamadas = 0;
      let documentos = 0;
      let parar = false;

      // 1) Trecho que outro sistema levou na sequência (lacunas): um documento por vez, pelo NSU exato
      const lacunas = (empresa.lacunas ?? []).map((l) => ({ ...l }));
      let buscadas = 0, vazias = 0;
      while (lacunas.length && buscadas < LACUNA_POR_LEITURA && Date.now() - inicio < LIMITE_MS / 2) {
        const l = lacunas[0];
        const r = await consultarNSU(cred, empresa.cnpj, l.de);
        chamadas++; buscadas++;
        cstat = r.cstat;
        if (r.cstat === 656) {
          status = "falha";
          erro = `SEFAZ: consumo indevido (656) ao buscar o NSU ${Number(l.de)}. ${r.motivo ?? ""} A consulta fica bloqueada por 1 hora.`.trim();
          bloquear = new Date(Date.now() + UMA_HORA).toISOString();
          parar = true;
          break;
        }
        if (r.cstat === 138 && (r.notas.length || r.eventos.length)) {
          documentos += r.notas.length + r.eventos.length;
          const g = await supabase.rpc("notas_worker_gravar", {
            p_segredo: segredo, p_execucao: execucao.id, p_notas: r.notas, p_eventos: r.eventos, p_ult_nsu: null, p_max_nsu: null,
          });
          if (g.error) throw new Error(`gravação: ${g.error.message}`);
        } else vazias++; // NSU que não é de nota (ou já fora dos 90 dias): segue para o próximo
        l.de = nsu15(BigInt(l.de) + BigInt(1));
        if (l.de > l.ate) lacunas.shift();
      }
      if (buscadas) {
        await supabase.rpc("notas_worker_lacunas", { p_segredo: segredo, p_execucao: execucao.id, p_lacunas: lacunas });
        Object.assign(resultado, { lacuna_buscadas: buscadas, lacuna_sem_documento: vazias, lacuna_falta: faltam(lacunas) });
      }

      for (; !parar;) {
        const r = await distribuir(cred, empresa.cnpj, ult);
        chamadas++;
        cstat = r.cstat;
        if (r.cstat === 138) {
          documentos += r.notas.length + r.eventos.length;
          const g = await supabase.rpc("notas_worker_gravar", {
            p_segredo: segredo, p_execucao: execucao.id, p_notas: r.notas, p_eventos: r.eventos,
            p_ult_nsu: r.ultNSU, p_max_nsu: r.maxNSU,
          });
          if (g.error) throw new Error(`gravação: ${g.error.message}`);
          ult = r.ultNSU ?? ult;
          // Chegou ao fim da fila: a SEFAZ pede 1 hora até a próxima consulta
          if (!r.maxNSU || ult >= r.maxNSU) { bloquear = new Date(Date.now() + UMA_HORA).toISOString(); break; }
          if (Date.now() - inicio > LIMITE_MS) { resultado.continua = true; break; }
          continue;
        }
        if (r.cstat === 137) {
          if (!documentos) status = "sem_dados";
          bloquear = new Date(Date.now() + UMA_HORA).toISOString();
          break;
        }
        if (r.cstat === 656) {
          bloquear = new Date(Date.now() + UMA_HORA).toISOString();
          // A rejeição traz o último NSU entregue a este CNPJ (NT 2014.002 v1.14). Se for maior que o nosso,
          // outro sistema consultou o mesmo CNPJ: o Brasico segue dali e busca o trecho do meio aos poucos.
          const daSefaz = r.ultNSU && /^\d{15}$/.test(r.ultNSU) ? r.ultNSU : null;
          resultado.sefaz_ult_nsu = daSefaz;
          if (daSefaz && daSefaz > ult) {
            lacunas.push({ de: nsu15(BigInt(ult) + BigInt(1)), ate: daSefaz });
            await supabase.rpc("notas_worker_lacunas", { p_segredo: segredo, p_execucao: execucao.id, p_lacunas: lacunas });
            const g = await supabase.rpc("notas_worker_gravar", {
              p_segredo: segredo, p_execucao: execucao.id, p_notas: [], p_eventos: [], p_ult_nsu: daSefaz, p_max_nsu: r.maxNSU,
            });
            if (g.error) throw new Error(`gravação: ${g.error.message}`);
            status = "ok";
            erro = "";
            resultado.retomada = `Outro sistema consultou este CNPJ na SEFAZ e levou a sequência até o NSU ${Number(daSefaz)}. ` +
              `O Brasico seguiu dali e vai buscar uma a uma as ${faltam(lacunas)} posições do meio (até ${LACUNA_POR_LEITURA} por leitura).`;
            ult = daSefaz;
          } else {
            status = "falha";
            erro = `SEFAZ: consumo indevido (656). ${r.motivo ?? ""} A consulta fica bloqueada por 1 hora.`.trim();
          }
          break;
        }
        status = "falha";
        erro = `SEFAZ ${r.cstat ?? "?"}: ${r.motivo ?? "resposta sem código"}`;
        break;
      }
      Object.assign(resultado, { chamadas, documentos, ult_nsu: ult });
    } else {
      const r = await darCiencia(cred, empresa.cnpj, chaves);
      cstat = r.cstat;
      const registradas = r.eventos.filter((e) => e.cstat === 135 || e.cstat === 136 || e.cstat === 573).length;
      Object.assign(resultado, { pedidas: chaves.length, registradas, recusadas: r.eventos.length - registradas });
      if (!chaves.length) status = "sem_dados";
      else if (r.cstat !== 128) { status = "falha"; erro = `SEFAZ ${r.cstat ?? "?"}: ${r.motivo ?? "lote não processado"}`; }
      const g = await supabase.rpc("notas_worker_gravar", {
        p_segredo: segredo, p_execucao: execucao.id, p_notas: [], p_eventos: r.eventos, p_ult_nsu: null, p_max_nsu: null,
      });
      if (g.error) throw new Error(`gravação: ${g.error.message}`);
    }
  } catch (e) {
    status = "falha";
    erro = e instanceof ErroConexao ? e.message : e instanceof Error ? e.message : "erro desconhecido";
  }

  const { error: erroGravar } = await supabase.rpc("notas_worker_concluir", {
    p_segredo: segredo, p_execucao: execucao.id, p_status: status, p_cstat: cstat, p_erro: erro,
    p_resultado: resultado, p_notas: [], p_eventos: [], p_ult_nsu: null, p_max_nsu: null, p_bloquear_ate: bloquear,
  });
  // Sem certificado, chave, XML ou dados de nota nos logs
  console.log(JSON.stringify({
    integracao: "notas", execucao: execucao.id, tipo: execucao.tipo, status, cstat, ...resultado,
    ...(erroGravar ? { erro_gravacao: erroGravar.message } : {}), ...(status === "falha" ? { erro: erro.slice(0, 200) } : {}),
  }));
}

export async function POST(req: Request) {
  const segredo = req.headers.get("x-segredo") ?? "";
  if (!segredo) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  // O segredo é conferido pelo banco em notas_worker_pegar
  after(() => processar(segredo, id));
  return Response.json({ recebido: id });
}
