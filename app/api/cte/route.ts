// Lê os CT-e (fretes) de uma empresa no Ambiente Nacional do CT-e (supabase/cte.sql, lib/cte).
// Chamada pelo banco (cte_pedir, via pg_net) com o segredo das notas no cabeçalho x-segredo.
// Corpo: { "execucao": "<id>" }. Responde na hora e trabalha em segundo plano; cada lote de até 50 documentos
// é gravado na hora (cte_worker_gravar). Perto do limite de tempo para e o banco encadeia a continuação.
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { partesPem } from "@/lib/esocial/certificado";
import { consultarNSU, distribuir, type RodadaCte } from "@/lib/cte/distribuicao";
import { ErroConexao } from "@/lib/notas/sefaz";

export const runtime = "nodejs";
export const maxDuration = 60;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Lacuna = { de: string; ate: string };
type Pego = {
  execucao: { id: string; origem: string };
  empresa: { cnpj: string; nome: string; ult_nsu: string; lacunas?: Lacuna[] };
  cert_cnpj: string | null;
  certificado: string | null;
};

// Regra de 1 hora da SEFAZ, com 5 min de folga (como nas NF-e)
const UMA_HORA = 65 * 60 * 1000;
const LIMITE_MS = 45000;
const LACUNA_POR_LEITURA = 15;
const nsu15 = (n: bigint) => n.toString().padStart(15, "0");
const faltam = (ls: Lacuna[]) => ls.reduce((s, l) => s + Number(BigInt(l.ate) - BigInt(l.de) + BigInt(1)), 0);

async function processar(segredo: string, id: string) {
  const supabase = db();
  const { data, error } = await supabase.rpc("cte_worker_pegar", { p_segredo: segredo, p_execucao: id });
  if (error || !data) return;
  const { execucao, empresa, cert_cnpj, certificado } = data as Pego;
  const inicio = Date.now();

  let status: "ok" | "sem_dados" | "falha" = "ok";
  let cstat: number | null = null;
  let erro = "";
  let bloquear: string | null = null;
  const resultado: Record<string, unknown> = {};
  let ult = empresa.ult_nsu || "000000000000000";
  let chamadas = 0, ctes = 0, eventos = 0, ilegiveis = 0;

  // Grava um lote: CT-e, eventos e o que não deu para ler (fica como evento "ilegivel" com o original)
  const gravar = async (r: RodadaCte, ultNSU: string | null, maxNSU: string | null) => {
    const evs = [
      ...r.eventos,
      ...r.ilegiveis.map((x) => ({ chave: "?", tipo: "ilegivel", descricao: `${x.esquema || "documento"} que o Brasico não conseguiu ler`, quando: null, protocolo: null, nsu: x.nsu, xml: x.xml })),
    ];
    const g = await supabase.rpc("cte_worker_gravar", {
      p_segredo: segredo, p_execucao: execucao.id, p_ctes: r.ctes, p_eventos: evs, p_ult_nsu: ultNSU, p_max_nsu: maxNSU,
    });
    if (g.error) throw new Error(`gravação: ${g.error.message}`);
    ctes += r.ctes.length; eventos += r.eventos.length; ilegiveis += r.ilegiveis.length;
  };

  try {
    if (!certificado) throw new Error("Não há certificado válido desta empresa. Envie o .pfx em Certificados digitais.");
    const { cadeia, chave } = partesPem(certificado);
    let parar = false;

    // 1) Trecho que outro sistema levou na sequência: um documento por vez, pelo NSU exato
    const lacunas = (empresa.lacunas ?? []).map((l) => ({ ...l }));
    let buscadas = 0;
    while (lacunas.length && buscadas < LACUNA_POR_LEITURA && Date.now() - inicio < LIMITE_MS / 2) {
      const l = lacunas[0];
      const r = await consultarNSU(cadeia, chave, empresa.cnpj, l.de);
      chamadas++; buscadas++;
      cstat = r.cstat;
      if (r.cstat === 656) {
        status = "falha";
        erro = `SEFAZ: consumo indevido (656) ao buscar o NSU ${Number(l.de)}. ${r.motivo ?? ""} A consulta fica bloqueada por 1 hora.`.trim();
        bloquear = new Date(Date.now() + UMA_HORA).toISOString();
        parar = true;
        break;
      }
      if (r.cstat === 138) await gravar(r, null, null);
      l.de = nsu15(BigInt(l.de) + BigInt(1));
      if (l.de > l.ate) lacunas.shift();
    }
    if (buscadas) {
      await supabase.rpc("cte_worker_lacunas", { p_segredo: segredo, p_execucao: execucao.id, p_lacunas: lacunas });
      Object.assign(resultado, { lacuna_buscadas: buscadas, lacuna_falta: faltam(lacunas) });
    }

    // 2) Distribuição normal, a partir do último NSU
    for (; !parar;) {
      const r = await distribuir(cadeia, chave, empresa.cnpj, ult);
      chamadas++;
      cstat = r.cstat;
      if (chamadas === 1) resultado.primeira = { cstat: r.cstat, motivo: r.motivo, ult_nsu: r.ultNSU, max_nsu: r.maxNSU };
      if (r.cstat === 138) {
        await gravar(r, r.ultNSU, r.maxNSU);
        ult = r.ultNSU ?? ult;
        if (!r.maxNSU || ult >= r.maxNSU) { bloquear = new Date(Date.now() + UMA_HORA).toISOString(); break; }
        if (Date.now() - inicio > LIMITE_MS) { resultado.continua = true; break; }
        continue;
      }
      if (r.cstat === 137) {
        // Nada novo: guarda o NSU da SEFAZ (pode ter andado sem documento para este CNPJ) e espera 1 hora
        if (r.ultNSU && /^\d{15}$/.test(r.ultNSU) && r.ultNSU > ult) {
          await supabase.rpc("cte_worker_gravar", { p_segredo: segredo, p_execucao: execucao.id, p_ctes: [], p_eventos: [], p_ult_nsu: r.ultNSU, p_max_nsu: r.maxNSU });
          ult = r.ultNSU;
        }
        if (!ctes && !eventos) status = "sem_dados";
        bloquear = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }
      if (r.cstat === 656) {
        bloquear = new Date(Date.now() + UMA_HORA).toISOString();
        const daSefaz = r.ultNSU && /^\d{15}$/.test(r.ultNSU) ? r.ultNSU : null;
        if (daSefaz && daSefaz > ult) {
          // Outro sistema consultou este CNPJ: segue dali e busca o trecho do meio aos poucos
          lacunas.push({ de: nsu15(BigInt(ult) + BigInt(1)), ate: daSefaz });
          await supabase.rpc("cte_worker_lacunas", { p_segredo: segredo, p_execucao: execucao.id, p_lacunas: lacunas });
          await supabase.rpc("cte_worker_gravar", { p_segredo: segredo, p_execucao: execucao.id, p_ctes: [], p_eventos: [], p_ult_nsu: daSefaz, p_max_nsu: null });
          resultado.retomada = `Outro sistema consultou este CNPJ e levou a sequência até o NSU ${Number(daSefaz)}. O Brasico seguiu dali e vai buscar as ${faltam(lacunas)} posições do meio aos poucos.`;
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
  } catch (e) {
    status = "falha";
    erro = e instanceof ErroConexao ? e.message : e instanceof Error ? e.message : "erro desconhecido";
  }

  Object.assign(resultado, { chamadas, ctes, eventos, ilegiveis, ult_nsu: ult, certificado: cert_cnpj === empresa.cnpj ? "próprio" : "matriz" });
  const { error: erroGravar } = await supabase.rpc("cte_worker_concluir", {
    p_segredo: segredo, p_execucao: execucao.id, p_status: status, p_cstat: cstat, p_erro: erro,
    p_resultado: resultado, p_bloquear_ate: bloquear,
  });
  // Sem certificado, XML ou dados de documento nos logs
  console.log(JSON.stringify({
    integracao: "cte", execucao: execucao.id, status, cstat, chamadas, ctes, eventos, ult_nsu: ult,
    ...(erroGravar ? { erro_gravacao: erroGravar.message } : {}), ...(status === "falha" ? { erro: erro.slice(0, 200) } : {}),
  }));
}

export async function POST(req: Request) {
  const segredo = req.headers.get("x-segredo") ?? "";
  if (!segredo) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  // O segredo é conferido pelo banco em cte_worker_pegar
  after(() => processar(segredo, id));
  return Response.json({ recebido: id });
}
