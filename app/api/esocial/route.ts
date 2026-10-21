// Executa um pedido ao eSocial registrado em esocial_execucoes (supabase/esocial.sql).
// Chamada pelo banco (esocial_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id>" }. Responde na hora e trabalha em segundo plano.
// O site não guarda nenhum segredo: o certificado vem do Vault pela função esocial_worker_pegar,
// que confere o mesmo segredo. Nada de certificado, chave ou CPF nos logs.
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { partesPem } from "@/lib/esocial/certificado";
import { baixar, consultarLote, idsEmpregador, idsTabela, idsTrabalhador, type Credencial, type Empregador } from "@/lib/esocial/mensagens";
import { lerEvento, lerRecibo } from "@/lib/esocial/eventos";
import { ErroConexao, type Ambiente } from "@/lib/esocial/soap";

export const runtime = "nodejs";
export const maxDuration = 60;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Execucao = { id: string; empresa_id: string; ambiente: Ambiente; tipo: string; parametros: Record<string, unknown> };
type Conclusao = {
  status: "ok" | "sem_dados" | "falha";
  cd: number | null;
  desc: string;
  resultado?: Record<string, unknown>;
  erro?: string;
  eventos?: Record<string, unknown>[];
};

// Códigos do download/identificadores: 201 ok, 203 há mais de 50, 406 nada encontrado; o resto é falha
const okIds = (cd: number | null) => cd === 201 || cd === 203;

async function executar(x: Execucao, empresa: { id: string; cnpj: string | null }, cred: Credencial): Promise<Conclusao> {
  const emp: Empregador = { tpInsc: 1, nrInsc: empresa.id };
  const p = x.parametros as Record<string, string>;
  switch (x.tipo) {
    case "teste_conexao": {
      // Protocolo inexistente: se o eSocial responder com um código dele, conexão, certificado e SOAP funcionam
      const r = await consultarLote(x.ambiente, cred, "1.0.000000000000000000");
      return { status: "ok", cd: r.cdResposta, desc: r.descResposta, resultado: { conectou: true, ocorrencias: r.ocorrencias } };
    }
    case "consulta_lote": {
      const r = await consultarLote(x.ambiente, cred, String(p.protocolo ?? ""));
      return { status: r.cdResposta && r.cdResposta < 300 ? "ok" : "falha", cd: r.cdResposta, desc: r.descResposta,
        resultado: { tempoEstimado: r.tempoEstimado, ocorrencias: r.ocorrencias, eventos: r.eventos } };
    }
    case "identificadores_empregador":
    case "identificadores_tabela":
    case "identificadores_trabalhador": {
      const r = x.tipo === "identificadores_empregador"
        ? await idsEmpregador(x.ambiente, cred, emp, p.tpEvt, p.perApur)
        : x.tipo === "identificadores_tabela"
          ? await idsTabela(x.ambiente, cred, emp, p.tpEvt, p.chEvt || undefined, p.dtIni || undefined, p.dtFim || undefined)
          : await idsTrabalhador(x.ambiente, cred, emp, p.cpf, p.dtIni, p.dtFim);
      if (r.cdResposta === 406) return { status: "sem_dados", cd: 406, desc: r.descResposta, resultado: { total: 0 } };
      if (!okIds(r.cdResposta)) return { status: "falha", cd: r.cdResposta, desc: r.descResposta, erro: r.descResposta };
      const tipo = x.tipo === "identificadores_trabalhador" ? null : p.tpEvt;
      const cpf = x.tipo === "identificadores_trabalhador" ? p.cpf : null;
      const perApur = x.tipo === "identificadores_empregador" ? p.perApur : null;
      // Mais de 50: a próxima consulta começa no último evento devolvido
      const cursor = r.total > r.ids.length && r.ultimo ? `${r.ultimo.slice(0, 19)}-03:00` : null;
      return {
        status: "ok", cd: r.cdResposta, desc: r.descResposta,
        resultado: { total: r.total, devolvidos: r.ids.length, ultimo: r.ultimo, ...(cursor ? { cursor } : {}) },
        eventos: r.ids.map((i) => ({ id_evento: i.id, nr_recibo: i.nrRec, tipo, cpf_trab: cpf, per_apur: perApur, situacao: "pendente" })),
      };
    }
    case "download_id":
    case "download_recibo": {
      const chaves = (Array.isArray(x.parametros.ids) ? x.parametros.ids : x.parametros.recibos) as string[] | undefined;
      const r = await baixar(x.ambiente, cred, emp, x.tipo === "download_id" ? "id" : "recibo", (chaves ?? []).map(String));
      if (r.cdResposta !== 201) return { status: "falha", cd: r.cdResposta, desc: r.descResposta, erro: r.descResposta };
      const eventos: Record<string, unknown>[] = [];
      let indisponiveis = 0;
      for (const a of r.arquivos) {
        if (!a.id || !a.xmlEvento) {
          indisponiveis++;
          continue;
        }
        const ev = lerEvento(a.xmlEvento);
        const rec = lerRecibo(a.xmlRecibo);
        eventos.push({
          id_evento: a.id, nr_recibo: rec.nrRecibo, tipo: ev.tipo, cpf_trab: ev.cpf_trab, per_apur: ev.per_apur,
          situacao: "baixado", resumo: { ...ev.resumo, ...(rec.dhRecepcao ? { recebido_em: rec.dhRecepcao } : {}) },
          xml_evento: a.xmlEvento, xml_recibo: a.xmlRecibo,
        });
      }
      // Pedidos por id que não voltaram (202: não encontrado ou sem perfil) deixam de ser pendentes
      if (x.tipo === "download_id") {
        const vieram = new Set(eventos.map((e) => e.id_evento));
        for (const id of (chaves ?? []).map(String)) if (!vieram.has(id)) eventos.push({ id_evento: id, situacao: "indisponivel" });
      }
      return { status: eventos.some((e) => e.situacao === "baixado") ? "ok" : "sem_dados", cd: r.cdResposta, desc: r.descResposta,
        resultado: { pedidos: chaves?.length ?? 0, baixados: r.arquivos.length - indisponiveis, indisponiveis }, eventos };
    }
    default:
      return { status: "falha", cd: null, desc: "", erro: `Tipo de pedido ainda não feito pelo site: ${x.tipo}` };
  }
}

async function processar(segredo: string, id: string) {
  const supabase = db();
  const { data, error } = await supabase.rpc("esocial_worker_pegar", { p_segredo: segredo, p_execucao: id });
  if (error || !data) return;
  const { execucao, empresa, certificado } = data as {
    execucao: Execucao; empresa: { id: string; nome: string; cnpj: string | null }; certificado: string | null;
  };

  let c: Conclusao;
  try {
    if (!certificado) throw new Error("A empresa não tem certificado guardado. Envie o .pfx pela tela do eSocial.");
    const { certificado: cert, cadeia, chave } = partesPem(certificado);
    c = await executar(execucao, empresa, { certificado: cert, cadeia, chave });
  } catch (e) {
    // Erros de conexão começam com "conexão:" e não contam no limite diário do download
    const msg = e instanceof ErroConexao ? e.message : e instanceof Error ? e.message.replace(/^conexão:\s*/, "") : "erro desconhecido";
    c = { status: "falha", cd: null, desc: "", erro: msg };
  }

  const { error: erroGravar } = await supabase.rpc("esocial_worker_concluir", {
    p_segredo: segredo, p_execucao: execucao.id, p_status: c.status, p_cd: c.cd, p_desc: c.desc,
    p_resultado: c.resultado ?? {}, p_erro: c.erro ?? "", p_eventos: c.eventos ?? [],
  });
  console.log(JSON.stringify({
    integracao: "esocial", execucao: execucao.id, empresa: execucao.empresa_id, ambiente: execucao.ambiente, tipo: execucao.tipo,
    status: c.status, codigo: c.cd, eventos: c.eventos?.length ?? 0, ...(erroGravar ? { erro_gravacao: erroGravar.message } : {}),
    ...(c.status === "falha" ? { erro: (c.erro ?? "").slice(0, 200) } : {}),
  }));
}

export async function POST(req: Request) {
  const segredo = req.headers.get("x-segredo") ?? "";
  if (!segredo) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  // O segredo é conferido pelo banco em esocial_worker_pegar
  after(() => processar(segredo, id));
  return Response.json({ recebido: id });
}
