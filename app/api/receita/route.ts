// Executa um pedido à Receita (Integra Contador do SERPRO) registrado em receita_execucoes (supabase/receita.sql).
// Chamada pelo banco (receita_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id>" }. Responde na hora e trabalha em segundo plano.
// O site não guarda nenhum segredo: certificado e chaves do SERPRO vêm do Vault pela função
// receita_worker_pegar (só em produção), que confere o mesmo segredo. Nada disso vai para os logs.
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { partesPem } from "@/lib/esocial/certificado";
import { Cliente, ErroSerpro, type Ambiente, type Credenciais } from "@/lib/receita/serpro";
import { Receita, type Conclusao } from "@/lib/receita/servicos";

export const runtime = "nodejs";
export const maxDuration = 60;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Execucao = { id: string; empresa_id: string; ambiente: Ambiente; tipo: string; parametros: Record<string, unknown> };

async function processar(segredo: string, id: string) {
  const supabase = db();
  const { data, error } = await supabase.rpc("receita_worker_pegar", { p_segredo: segredo, p_execucao: id });
  if (error || !data) return;
  const { execucao: x, empresa, certificado, serpro, mensagens_detalhadas } = data as {
    execucao: Execucao;
    empresa: { id: string; nome: string; cnpj: string | null };
    certificado: string | null;
    serpro: { key?: string; secret?: string } | null;
    mensagens_detalhadas: string[];
  };

  let cli: Cliente | null = null;
  let c: Conclusao;
  try {
    let cred: Credenciais | null = null;
    if (x.ambiente === "producao") {
      if (!empresa.cnpj) throw new Error("A empresa não tem CNPJ cadastrado.");
      if (!certificado) throw new Error("A empresa não tem certificado guardado. Envie o .pfx pela tela do eSocial.");
      if (!serpro?.key || !serpro?.secret) throw new Error("Faltam as chaves do contrato do SERPRO.");
      const { cadeia, chave } = partesPem(certificado);
      cred = { key: serpro.key, secret: serpro.secret, certificado: cadeia, chave };
    }
    cli = new Cliente(x.ambiente, cred);
    const receita = new Receita(cli, empresa.cnpj ?? "");
    const p = x.parametros ?? {};
    switch (x.tipo) {
      case "caixa_postal":
        c = await receita.caixaPostal(
          { forcar: p.forcar === true, maxDetalhes: typeof p.maxDetalhes === "number" ? p.maxDetalhes : undefined },
          new Set(mensagens_detalhadas ?? []),
        );
        break;
      case "situacao_fiscal":
        c = await receita.situacaoFiscal();
        break;
      case "pagamentos":
        c = await receita.pagamentos({
          dataInicial: typeof p.dataInicial === "string" ? p.dataInicial : undefined,
          dataFinal: typeof p.dataFinal === "string" ? p.dataFinal : undefined,
        });
        break;
      case "servico":
        c = await receita.lote(Array.isArray(p.itens) ? (p.itens as { servico: string; dados?: unknown }[]) : []);
        break;
      case "eventos":
        c = await receita.eventos({
          pendentes: Array.isArray(p.pendentes) ? (p.pendentes as { evento: string; protocolo: string }[]) : undefined,
        });
        break;
      default:
        c = { status: "falha", resultado: {}, erro: `Tipo de pedido ainda não feito pelo site: ${x.tipo}` };
    }
  } catch (e) {
    const msg = e instanceof ErroSerpro || e instanceof Error ? e.message : "erro desconhecido";
    c = { status: "falha", resultado: {}, erro: msg };
  }

  const { error: erroGravar } = await supabase.rpc("receita_worker_concluir", {
    p_segredo: segredo, p_execucao: x.id, p_status: c.status, p_resultado: c.resultado ?? {}, p_erro: c.erro ?? "",
    p_chamadas: cli?.chamadas ?? [], p_mensagens: c.mensagens ?? [], p_relatorios: c.relatorios ?? [],
    p_pagamentos: c.pagamentos ?? [],
  });
  console.log(JSON.stringify({
    integracao: "receita", execucao: x.id, empresa: x.empresa_id, ambiente: x.ambiente, tipo: x.tipo, status: c.status,
    chamadas: cli?.chamadas.length ?? 0, ...(erroGravar ? { erro_gravacao: erroGravar.message } : {}),
    ...(c.status === "falha" ? { erro: (c.erro ?? "").slice(0, 200) } : {}),
  }));
}

export async function POST(req: Request) {
  const segredo = req.headers.get("x-segredo") ?? "";
  if (!segredo) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  // O segredo é conferido pelo banco em receita_worker_pegar
  after(() => processar(segredo, id));
  return Response.json({ recebido: id });
}
