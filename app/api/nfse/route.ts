// Lê as NFS-e de uma empresa no Ambiente de Dados Nacional (supabase/nfse.sql, lib/nfse).
// Chamada pelo banco (nfse_pedir, via pg_net) com o segredo das notas no cabeçalho x-segredo.
// Corpo: { "execucao": "<id>" }. Responde na hora e trabalha em segundo plano; cada lote é gravado
// na hora (nfse_worker_gravar). Perto do limite de tempo para e o banco encadeia a continuação.
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { partesPem } from "@/lib/esocial/certificado";
import { distribuir, ErroConexao, sondar } from "@/lib/nfse/adn";
import { lerDocumento, type EventoServico, type NotaServico } from "@/lib/nfse/documentos";

export const runtime = "nodejs";
export const maxDuration = 60;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Pego = {
  execucao: { id: string; origem: string; teste?: { caminho: string; restrita?: boolean; limite?: number }[] };
  empresa: { cnpj: string; nome: string; ult_nsu: number };
  cert_cnpj: string | null;
  certificado: string | null;
};

const UMA_HORA = 60 * 60 * 1000;
const LIMITE_MS = 45000; // folga para gravar antes dos 60 s da Vercel

async function processar(segredo: string, id: string) {
  const supabase = db();
  const { data, error } = await supabase.rpc("nfse_worker_pegar", { p_segredo: segredo, p_execucao: id });
  if (error || !data) return;
  const { execucao, empresa, cert_cnpj, certificado } = data as Pego;
  const inicio = Date.now();

  let status: "ok" | "sem_dados" | "falha" = "ok";
  let erro = "";
  let bloquear: string | null = null;
  const resultado: Record<string, unknown> = {};
  let nsu = Number(empresa.ult_nsu) || 0;
  let chamadas = 0, notas = 0, eventos = 0, ignorados = 0;

  try {
    if (!certificado) throw new Error("Não há certificado válido desta raiz. Envie o .pfx em Certificados digitais.");
    const { cadeia, chave } = partesPem(certificado);

    // Execução de teste (só o banco cria, com o segredo): caminhos crus no ADN, sem gravar notas
    if (Array.isArray(execucao.teste) && execucao.teste.length) {
      const sondas = [];
      for (const t of execucao.teste.slice(0, 8)) {
        if (typeof t?.caminho !== "string" || !t.caminho.startsWith("/")) continue;
        sondas.push(await sondar(t.caminho, !!t.restrita, cadeia, chave, Number(t.limite) || 800).catch((e) => ({ caminho: t.caminho, erro: String(e?.message ?? e) })));
      }
      resultado.sondas = sondas;
      throw new Error("teste");
    }

    for (;;) {
      const r = await distribuir(nsu, empresa.cnpj, cadeia, chave);
      chamadas++;
      if (chamadas === 1) resultado.primeira = { http: r.http, status: r.status, erros: r.erros.slice(0, 5) };
      if (r.status && /REJEI|ERRO/i.test(r.status)) resultado.resposta = r.bruto;

      if (r.status === "LIMITE" || r.http === 429) {
        status = "falha";
        erro = "O Portal Nacional pediu para esperar (muitas consultas). Tenta de novo em 1 hora.";
        bloquear = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }
      if (!r.documentos.length) {
        if (r.status && /REJEI|ERRO/i.test(r.status)) {
          status = "falha";
          erro = `Portal Nacional: ${r.erros.join("; ") || r.status}`;
        } else if (!notas && !eventos) status = "sem_dados";
        // Fim da fila: espera 1 hora antes de perguntar de novo
        bloquear = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }

      const lidasNotas: NotaServico[] = [];
      const lidosEventos: EventoServico[] = [];
      for (const d of r.documentos) {
        try {
          const l = lerDocumento(d.xml, d.nsu, empresa.cnpj);
          if (l.nota?.chave) lidasNotas.push(l.nota);
          else if (l.evento) lidosEventos.push(l.evento);
          else ignorados++;
        } catch {
          ignorados++;
        }
      }
      const maior = Math.max(...r.documentos.map((d) => d.nsu).filter(Number.isFinite));
      const g = await supabase.rpc("nfse_worker_gravar", {
        p_segredo: segredo, p_execucao: execucao.id, p_notas: lidasNotas, p_eventos: lidosEventos,
        p_ult_nsu: Number.isFinite(maior) ? maior : null,
      });
      if (g.error) throw new Error(`gravação: ${g.error.message}`);
      notas += lidasNotas.length;
      eventos += lidosEventos.length;

      // O lote não andou (só repetiu o último NSU): chegou ao fim
      if (!Number.isFinite(maior) || maior <= nsu) { bloquear = new Date(Date.now() + UMA_HORA).toISOString(); break; }
      nsu = maior;
      if (Date.now() - inicio > LIMITE_MS) { resultado.continua = true; break; }
    }
  } catch (e) {
    status = "falha";
    erro = e instanceof ErroConexao ? e.message : e instanceof Error ? e.message : "erro desconhecido";
  }

  Object.assign(resultado, { chamadas, notas, eventos, ignorados, ult_nsu: nsu, certificado: cert_cnpj === empresa.cnpj ? "próprio" : "matriz" });
  const { error: erroGravar } = await supabase.rpc("nfse_worker_concluir", {
    p_segredo: segredo, p_execucao: execucao.id, p_status: status, p_erro: erro,
    p_resultado: resultado, p_bloquear_ate: bloquear,
  });
  // Sem certificado, XML ou dados de nota nos logs
  console.log(JSON.stringify({
    integracao: "nfse", execucao: execucao.id, status, chamadas, notas, eventos, ult_nsu: nsu,
    ...(erroGravar ? { erro_gravacao: erroGravar.message } : {}), ...(status === "falha" ? { erro: erro.slice(0, 200) } : {}),
  }));
}

export async function POST(req: Request) {
  const segredo = req.headers.get("x-segredo") ?? "";
  if (!segredo) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  // O segredo é conferido pelo banco em nfse_worker_pegar
  after(() => processar(segredo, id));
  return Response.json({ recebido: id });
}
