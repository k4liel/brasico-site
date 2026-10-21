// Puxa um dia de vendas de uma unidade na TOTVS Chef Web API e grava o resumo em totvs_dias.
// Chamada pelo banco (totvs_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em totvs_execucoes>" }. Responde na hora e trabalha em segundo plano.
// Usuário, senha e seriais ficam no Vault (totvs_usuario, totvs_senha, totvs_serial_<unidade>).
// Regras (documento técnico da integração): token novo a cada chamada e a cada tentativa,
// data de movimento define o dia, HTTP 200 com Sucesso=false é falha, nada de segredo nos logs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://chefweb.chef.totvs.com.br/chefwebAPI";
const TIMEOUT_MS = 60000;
const TENTATIVAS = 3;
const TOLERANCIA = 1; // R$ de diferença aceita nas conferências

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Credenciais = { usuario: string; senha: string; serial: string; chave: string; loja: number };
// deno-lint-ignore no-explicit-any
type J = any;

class ErroTotvs extends Error {}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const txt = (v: unknown) => String(v ?? "").trim();

// Mensagem de erro da TOTVS sem dados sensíveis
function errosDe(p: J) {
  const lista = Array.isArray(p?.Erros) ? p.Erros : [];
  const msg = lista
    .map((e: J) => [e?.CodigoErro != null ? `código ${e.CodigoErro}` : "", txt(e?.Mensagem ?? e?.MensagemErro ?? e?.Descricao)].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  return msg || "resposta sem sucesso";
}

async function pedir(caminho: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}${caminho}`, { ...init, signal: ctl.signal });
    const corpo = await r.text();
    if (!r.ok) throw new ErroTotvs(`HTTP ${r.status}`);
    try {
      return JSON.parse(corpo);
    } catch {
      throw new ErroTotvs("resposta que não é JSON");
    }
  } catch (e) {
    if (e instanceof ErroTotvs) throw e;
    throw new ErroTotvs(ctl.signal.aborted ? "tempo esgotado" : "falha de conexão");
  } finally {
    clearTimeout(t);
  }
}

async function gerarToken(c: Credenciais) {
  const p = await pedir("/api/Token/GerarToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Usuario: c.usuario, Senha: c.senha, NumeroSerialLoja: c.serial, Chave: c.chave }),
  });
  if (!p?.Sucesso || !p?.Token) throw new ErroTotvs(`token recusado (${errosDe(p)})`);
  return String(p.Token);
}

const sucesso = (p: J) => p && p.Sucesso !== false && p.Success !== false;

type Registro = { endpoint: string; tentativas: number; ms: number; ok: boolean; erro?: string };

// Gera token novo, chama e descarta; repete com outro token em caso de erro
async function chamar(c: Credenciais, endpoint: string, montar: (token: string) => [string, RequestInit], log: Registro[]) {
  const comeco = Date.now();
  let ultimo = "";
  for (let i = 1; i <= TENTATIVAS; i++) {
    try {
      const token = await gerarToken(c);
      const [caminho, init] = montar(token);
      const p = await pedir(caminho, init);
      if (!sucesso(p)) throw new ErroTotvs(errosDe(p));
      log.push({ endpoint, tentativas: i, ms: Date.now() - comeco, ok: true });
      return p;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : "erro";
      if (i < TENTATIVAS) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  log.push({ endpoint, tentativas: TENTATIVAS, ms: Date.now() - comeco, ok: false, erro: ultimo });
  throw new ErroTotvs(`${endpoint}: ${ultimo}`);
}

const json = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

// ---------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------
const TAXA_SERVICO = /TAXA\s*(DE\s*)?SERV|^SERVI[CÇ]O\b|GORJETA|COUVERT ART/i;

function categoria(grupo: string) {
  const g = grupo.toUpperCase();
  if (g.includes("BEBIDA")) return "bebida";
  if (g.includes("COMIDA")) return "comida";
  return "outros";
}

function tipoPagamento(descricao: string) {
  const d = descricao.toUpperCase();
  if (d.includes("ASSINAD")) return "assinada";
  if (d.includes("CORTESIA")) return "cortesia";
  return "caixa";
}

const cancelada = (v: J) => v?.StatusVenda !== 2 || !!(v?.DadosCancelamento && (v.DadosCancelamento.Data || v.DadosCancelamento.Motivo));

function normalizar(vendasResp: J, sangriasResp: J, fechResp: J) {
  const todas: J[] = Array.isArray(vendasResp?.Vendas) ? vendasResp.Vendas : [];
  const ativas = todas.filter((v) => !cancelada(v));
  const canceladas = todas.filter(cancelada);

  const produtos = new Map<string, J>();
  const pagamentos = new Map<string, J>();
  const garcons = new Map<string, J>();
  const s = {
    vendas_recebidas: todas.length, vendas_ativas: ativas.length, vendas_canceladas: canceladas.length,
    pessoas: 0, subtotal: 0, servico: 0, acrescimos: 0, descontos: 0, taxa_entrega: 0, total: 0, troco: 0,
    valor_produtos: 0, comida: 0, bebida: 0, outros: 0, itens_taxa_servico: 0,
    pagamentos_caixa: 0, assinadas: 0, cortesias: 0, pagamentos_total: 0,
    itens_cancelados: 0, sangrias: 0, fechamento_sistema: 0, fechamento_recebido: 0,
  };

  for (const v of ativas) {
    const t = v.TotalizadorVenda ?? {};
    s.pessoas += n(v.QuantidadePessoas);
    s.subtotal += n(t.ValorSubTotal);
    s.servico += n(t.ValorTotalServico);
    s.acrescimos += n(t.ValorTotalAcrescimo);
    s.descontos += n(t.ValorTotalDescontoFiscal) + n(t.ValorTotalDescontoSistema);
    s.taxa_entrega += n(t.ValorTotalTaxaEntrega);
    s.total += n(t.ValorTotal);
    s.troco += n(t.ValorTroco);

    const atendentesDaVenda = new Set<string>();
    for (const it of Array.isArray(v.Itens) ? v.Itens : []) {
      if (it?.Status !== 1) continue;
      const p = it.Produto ?? {};
      const nome = txt(p.Nome);
      const grupo = txt(p.Grupo);
      const valor = n(it.ValorTotal);
      if (TAXA_SERVICO.test(nome) || TAXA_SERVICO.test(grupo)) {
        s.itens_taxa_servico += valor;
        continue;
      }
      const cat = categoria(grupo);
      s.valor_produtos += valor;
      s[cat] += valor;
      const chave = p.Codigo != null ? String(p.Codigo) : nome;
      const atual = produtos.get(chave) ?? {
        codigo: p.Codigo ?? null, nome, grupo, subgrupo: txt(p.SubGrupo), unidade: txt(p.Unidade), categoria: cat, quantidade: 0, valor: 0,
      };
      atual.quantidade += n(it.Quantidade);
      atual.valor += valor;
      produtos.set(chave, atual);

      const codAt = it.CodigoAtendenteVenda ?? it.CodigoAgenteVenda;
      const nomeAt = txt(it.AtendenteVenda || it.NomeAgenteVenda) || "Sem atendente";
      const chaveAt = codAt != null && codAt !== 0 ? String(codAt) : nomeAt;
      const g = garcons.get(chaveAt) ?? { codigo: codAt ?? null, nome: nomeAt, itens: 0, valor: 0, vendas: 0 };
      g.itens += n(it.Quantidade);
      g.valor += valor;
      garcons.set(chaveAt, g);
      atendentesDaVenda.add(chaveAt);
    }
    for (const a of atendentesDaVenda) garcons.get(a)!.vendas += 1;

    for (const pg of Array.isArray(v.Pagamentos) ? v.Pagamentos : []) {
      const descricao = txt(pg.Descricao) || "Não identificado";
      const tipo = tipoPagamento(descricao);
      const valor = pg.ValorEfetivo != null ? n(pg.ValorEfetivo) : n(pg.ValorRecebido);
      const p = pagamentos.get(descricao) ?? { forma: descricao, tipo, codigo_tipo: pg.TipoFormaPagamento ?? null, vezes: 0, valor: 0 };
      p.vezes += 1;
      p.valor += valor;
      pagamentos.set(descricao, p);
      s.pagamentos_total += valor;
      if (tipo === "assinada") s.assinadas += valor;
      else if (tipo === "cortesia") s.cortesias += valor;
      else s.pagamentos_caixa += valor;
    }
  }

  const cancelados = [
    ...canceladas.map((v) => ({
      tipo: "venda", cupom: v.NumeroCupom ?? null, total: r2(n(v.TotalizadorVenda?.ValorTotal)),
      operador: txt(v.DadosCancelamento?.Operador?.Nome), motivo: txt(v.DadosCancelamento?.Motivo),
    })),
    ...todas.flatMap((v) =>
      (Array.isArray(v.ItemCancelado) ? v.ItemCancelado : []).map((c: J) => ({
        tipo: "item", cupom: v.NumeroCupom ?? null, produto: txt(c.NomeProduto),
        operador: txt(c.NomeOperadorCancelamento), motivo: txt(c.Motivo), quando: txt(c.DataHora),
      }))
    ),
  ];
  s.itens_cancelados = cancelados.filter((c) => c.tipo === "item").length;

  const sangrias = (Array.isArray(sangriasResp?.Sangrias) ? sangriasResp.Sangrias : []).map((x: J) => {
    const valor = n(x.FormasPagamentos?.Valor);
    s.sangrias += valor;
    return {
      caixa: x.NumeroCaixa ?? null, quando: txt(x.DataSangria), operador: txt(x.NomeOperador), motivo: txt(x.Motivo),
      forma: txt(x.FormasPagamentos?.TipoFormaPagamento), valor: r2(valor),
    };
  });

  const fechamentos = (Array.isArray(fechResp?.Fechamentos) ? fechResp.Fechamentos : []).map((f: J) => {
    s.fechamento_sistema += n(f.ValorTotalSistema);
    s.fechamento_recebido += n(f.ValorTotalRecebido);
    return {
      caixa: f.Caixa ?? null, fechamento: f.IdFechamento ?? null, abertura: txt(f.DataAbertura), encerramento: txt(f.DataFechamento),
      operador: txt(f.OperadorCaixaFechamento || f.OperadorCaixa), sistema: r2(n(f.ValorTotalSistema)),
      recebido: r2(n(f.ValorTotalRecebido)), bordero: r2(n(f.ValorTotalBordero)),
      formas: (Array.isArray(f.Itens) ? f.Itens : []).map((i: J) => ({
        forma: txt(i.DescricaoFormaPagamento), sistema: r2(n(i.ValorSistema)), recebido: r2(n(i.ValorRecebido)), bordero: r2(n(i.ValorBordero)),
      })),
    };
  });

  for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = r2(s[k]);

  // Conferências mínimas: divergência vira "revisar", nunca é ajustada em silêncio
  const divergencias: J[] = [];
  const conferir = (nome: string, a: number, b: number) => {
    const dif = r2(a - b);
    if (Math.abs(dif) > TOLERANCIA) divergencias.push({ conferencia: nome, a: r2(a), b: r2(b), diferenca: dif });
  };
  conferir("Total das vendas × soma dos pagamentos", s.total, s.pagamentos_total);
  conferir("Produtos + serviço + acréscimos + entrega − descontos × total das vendas",
    s.valor_produtos + Math.max(s.itens_taxa_servico, s.servico) + s.acrescimos + s.taxa_entrega - s.descontos, s.total);
  if (fechamentos.length) conferir("Fechamento de caixa (sistema) × pagamentos do caixa", s.fechamento_sistema, s.pagamentos_caixa);
  const semAtendente = [...garcons.values()].find((g) => g.nome === "Sem atendente");
  if (semAtendente) divergencias.push({ conferencia: "Itens sem atendente no ranking", valor: r2(semAtendente.valor) });

  const ordenar = (m: Map<string, J>) =>
    [...m.values()].map((x) => ({ ...x, valor: r2(x.valor), ...(x.quantidade != null ? { quantidade: r2(x.quantidade) } : {}) }))
      .sort((a, b) => b.valor - a.valor);

  return {
    resumo: s,
    produtos: ordenar(produtos),
    pagamentos: ordenar(pagamentos),
    garcons: ordenar(garcons).map((g) => ({ ...g, itens: r2(g.itens) })),
    sangrias,
    fechamentos,
    cancelados,
    divergencias,
  };
}

// ---------------------------------------------------------------------
// Uma extração (unidade + dia)
// ---------------------------------------------------------------------
async function processar(execucaoId: string) {
  const { data: ex } = await supabase.from("totvs_execucoes").select("id,unidade_id,dia,status").eq("id", execucaoId).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("totvs_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);

  const log: Registro[] = [];
  const fim = (status: string, erro = "") =>
    supabase.from("totvs_execucoes").update({
      status, erro: erro.slice(0, 500), fim: new Date().toISOString(), endpoints: log,
      tentativas: log.reduce((m, r) => Math.max(m, r.tentativas), 0),
    }).eq("id", ex.id);

  try {
    const { data: c } = await supabase.rpc("totvs_credenciais", { p_unidade: ex.unidade_id }).maybeSingle<Credenciais>();
    if (!c?.loja || !c?.chave) throw new ErroTotvs("unidade sem loja ou chave TOTVS configurada");
    if (!c.usuario || !c.senha || !c.serial) throw new ErroTotvs("faltam credenciais no Vault (usuário, senha ou serial desta unidade)");

    const ini = `${ex.dia}T00:00:00`;
    const fimDia = `${ex.dia}T23:59:59`;
    const vendas = await chamar(c, "CapaVenda/ListPorDataMovimento", (token) => ["/api/CapaVenda/ListPorDataMovimento", json({
      Token: token, CodigoLoja: c.loja, DataMovimentoInicial: ini, DataMovimentoFinal: fimDia, Online: false, Composicoes: true,
      NotasInutilizadas: false, ValidaSaltoNota: false, EnviofaturamentoCaixaFechado: false,
    })], log);
    if (!Array.isArray(vendas?.Vendas)) throw new ErroTotvs("resposta de vendas sem a lista Vendas");
    const sangrias = await chamar(c, "sangria/Listar", (token) => ["/api/sangria/Listar", json({
      Token: token, CodigoLoja: c.loja, DataInicial: ini, DataFinal: fimDia,
    })], log);
    const fechamentos = await chamar(c, "FechamentoCaixa/ObterFechamentoCaixa", (token) => ["/api/FechamentoCaixa/ObterFechamentoCaixa", json({
      Token: token, Lojas: [c.loja], DataInicial: ini, DataFinal: fimDia, Chave: null, Valor: null,
    })], log);

    const d = normalizar(vendas, sangrias, fechamentos);
    const status = d.resumo.vendas_recebidas === 0 ? "sem_movimento" : d.divergencias.length ? "revisar" : "ok";
    const { error } = await supabase.from("totvs_dias").upsert({
      unidade_id: ex.unidade_id, dia: ex.dia, status,
      vendas: d.resumo.vendas_ativas, pessoas: d.resumo.pessoas, total: d.resumo.total,
      resumo: d.resumo, produtos: d.produtos, pagamentos: d.pagamentos, garcons: d.garcons,
      sangrias: d.sangrias, fechamentos: d.fechamentos, cancelados: d.cancelados, divergencias: d.divergencias,
      execucao_id: ex.id, atualizado_em: new Date().toISOString(),
    }, { onConflict: "unidade_id,dia" });
    if (error) throw new Error(`gravação: ${error.message}`);
    await fim(status);
    console.log(JSON.stringify({ integracao: "totvs-chef", unidade_id: ex.unidade_id, dia: ex.dia, status, correlation_id: ex.id,
      vendas_recebidas: d.resumo.vendas_recebidas, vendas_ativas: d.resumo.vendas_ativas, divergencias: d.divergencias.length }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await fim("falha", msg);
    console.log(JSON.stringify({ integracao: "totvs-chef", unidade_id: ex.unidade_id, dia: ex.dia, status: "falha", correlation_id: ex.id, erro: msg }));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const { data: ok } = await supabase.rpc("totvs_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!ok) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  EdgeRuntime.waitUntil(processar(id));
  return new Response(JSON.stringify({ recebido: id }), { headers: { "Content-Type": "application/json" } });
});
