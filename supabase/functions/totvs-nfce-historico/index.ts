// Histórico das NFC-e pela data de integração (22/11/2026; supabase/nfce_historico_integracao.sql).
// A CapaVenda por data de movimento (totvs-extrair) só responde os últimos ~16 dias: os dias mais antigos voltam 403.
// ListPorDataIntegracaoChefweb (as vendas pelo dia em que chegaram à nuvem da TOTVS) abre o histórico inteiro.
// Chamada pelo banco (nfce_integracao_passo → nfce_integracao_pedir, via pg_net) com o segredo x-segredo.
// Corpo: { "execucao": "<id em totvs_execucoes, origem nfce_int>" }; ex.dia = dia de integração.
// Cada venda é gravada no seu dia de movimento por nfce_gravar (mesma conversão de totvs-extrair: chave, protocolo,
// impostos por item, sem CPF, nome nem contato do cliente). Só leitura na TOTVS.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://chefweb.chef.totvs.com.br/chefwebAPI";
const PRAZO_MS = 138000;
const TENTATIVAS = 3;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Credenciais = { usuario: string; senha: string; serial: string; chave: string; loja: number };
type Registro = { endpoint: string; tentativas: number; ms: number; ok: boolean; erro?: string };
// deno-lint-ignore no-explicit-any
type J = any;
class ErroTotvs extends Error {}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const txt = (v: unknown) => String(v ?? "").trim();
const digitos = (v: unknown) => txt(v).replace(/\D/g, "");
const comFuso = (v: unknown) => {
  const s = txt(v);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? (/[+-]\d\d:\d\d$|Z$/.test(s) ? s : `${s.slice(0, 19)}-03:00`) : null;
};
const nulo = (v: unknown) => (txt(v) === "" ? null : txt(v));
const imposto = (x: J) => (x && typeof x === "object"
  ? { aliquota: x.Aliquota ?? null, base: x.BaseCalculo ?? null, valor: x.Valor ?? null, ...(x.Cst ? { cst: txt(x.Cst) } : {}) }
  : null);
const parte = (g: J, aliq: string, valor: string) => (g ? { aliquota: g[aliq] ?? null, valor: g[valor] ?? null, reducao: g.gRed?.pRedAliq ?? 0 } : null);
const cancelada = (v: J) => v?.StatusVenda !== 2 || !!(v?.DadosCancelamento && (v.DadosCancelamento.Data || v.DadosCancelamento.Motivo));

function errosDe(p: J) {
  const lista = Array.isArray(p?.Erros) ? p.Erros : [];
  return lista.map((e: J) => [e?.CodigoErro != null ? `código ${e.CodigoErro}` : "", txt(e?.Mensagem ?? e?.DescricaoErro).split(/\r?\n/)[0]].filter(Boolean).join(": "))
    .filter(Boolean).join("; ") || "resposta sem sucesso";
}

async function pedir(caminho: string, init: RequestInit, esperaMs: number) {
  if (esperaMs < 3000) throw new ErroTotvs("sem tempo para esperar a TOTVS");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), esperaMs);
  try {
    const r = await fetch(`${API}${caminho}`, { ...init, signal: ctl.signal });
    const corpo = await r.text();
    if (!r.ok) throw new ErroTotvs(`HTTP ${r.status}`);
    try { return JSON.parse(corpo); } catch { throw new ErroTotvs("resposta que não é JSON"); }
  } catch (e) {
    if (e instanceof ErroTotvs) throw e;
    throw new ErroTotvs(ctl.signal.aborted ? `tempo esgotado (${Math.round(esperaMs / 1000)} s)` : "falha de conexão");
  } finally {
    clearTimeout(t);
  }
}

const json = (corpo: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function chamar(c: Credenciais, endpoint: string, corpo: (token: string) => J, log: Registro[], prazo: number) {
  const comeco = Date.now();
  let ultimo = "";
  let i = 0;
  while (i < TENTATIVAS) {
    i++;
    try {
      const tk = await pedir("/api/Token/GerarToken", json({ Usuario: c.usuario, Senha: c.senha, NumeroSerialLoja: c.serial, Chave: c.chave }),
        Math.min(25000, prazo - Date.now()));
      if (!tk?.Sucesso || !tk?.Token) throw new ErroTotvs(`token recusado (${errosDe(tk)})`);
      const p = await pedir(`/api/${endpoint}`, json(corpo(String(tk.Token))), prazo - Date.now());
      if (!p || p.Sucesso === false) throw new ErroTotvs(errosDe(p));
      log.push({ endpoint, tentativas: i, ms: Date.now() - comeco, ok: true });
      return p;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : "erro";
      const espera = 1500 * i;
      if (i >= TENTATIVAS || prazo - Date.now() - espera < 20000) break;
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  log.push({ endpoint, tentativas: i, ms: Date.now() - comeco, ok: false, erro: ultimo });
  throw new ErroTotvs(`${endpoint}: ${ultimo}`);
}

// Mesma conversão de notasFiscais() em totvs-extrair (manter as duas iguais)
function notasFiscais(vendasResp: J) {
  const todas: J[] = Array.isArray(vendasResp?.Vendas) ? vendasResp.Vendas : [];
  const vendas = todas.filter((v) => txt(v.ChaveVenda)).map((v) => {
    const t = v.TotalizadorVenda ?? {};
    const chave = digitos(v.ChaveSefaz).length === 44 ? digitos(v.ChaveSefaz) : null;
    const protocolo = nulo(v.ProtocoloAutorizacaoSefaz);
    const canc = cancelada(v);
    const situacao = chave ? (canc ? "cancelada" : protocolo ? "autorizada" : "pendente")
      : canc ? "venda_cancelada" : v.ModeloFiscal === 2 ? "pendente" : "sem_nota";
    const d = v.DadosCancelamento;
    return {
      chave_venda: txt(v.ChaveVenda),
      emissao: comFuso(v.DataRecebimento) ?? comFuso(v.DataMovimento),
      chave,
      emitente_cnpj: chave ? chave.slice(6, 20) : digitos(v.Loja?.CNPJ) || null,
      numero: v.NumeroNota ?? null,
      serie: nulo(v.SerieNota),
      modelo: v.ModeloFiscal ?? null,
      status_nfce: v.StatusNotaNFCe ?? null,
      situacao,
      protocolo,
      cupom: v.NumeroCupom ?? null,
      caixa: v.Caixa?.Numero ?? null,
      pessoas: v.QuantidadePessoas ?? null,
      consumidor_identificado: !!digitos(v.CPFFidelidadeIntegracao) || !!digitos(v.Cliente?.Documento),
      valor: r2(n(t.ValorTotal)), subtotal: r2(n(t.ValorSubTotal)), servico: r2(n(t.ValorTotalServico)),
      desconto: r2(Math.max(n(t.ValorTotalDescontoFiscal), n(t.ValorTotalDescontoSistema))),
      acrescimo: r2(n(t.ValorTotalAcrescimo)), taxa_entrega: r2(n(t.ValorTotalTaxaEntrega)), troco: r2(n(t.ValorTroco)),
      base_icms: r2(n(t.ValorTotalBaseCalculoICMS)), icms: r2(n(t.ValorTotalICMS)),
      base_pis: r2(n(t.ValorTotalBaseCalculoPIS)), pis: r2(n(t.ValorTotalPIS)),
      base_cofins: r2(n(t.ValorTotalBaseCalculoCOFINS)), cofins: r2(n(t.ValorTotalCOFINS)),
      cbs: r2(n(t.ValorCBS)), ibs: r2(n(t.ValorIBS)),
      itens: (Array.isArray(v.Itens) ? v.Itens : []).map((it: J, k: number) => {
        const p = it.Produto ?? {};
        const g = it.IBSCBS?.gIBSCBS;
        return {
          n: k + 1, codigo: p.Codigo ?? null, nome: txt(p.Nome), grupo: nulo(p.Grupo), ncm: nulo(p.NCM), unidade: nulo(p.Unidade),
          cfop: nulo(it.Cfop), cst: nulo(it.Cst), csosn: nulo(it.Csosn), cest: nulo(it.CEST),
          quantidade: n(it.Quantidade), valor_unitario: n(it.ValorUnitario), desconto: n(it.ValorDesconto),
          acrescimo: n(it.ValorAcrescimo), valor_total: n(it.ValorTotal), cancelado: it.Status !== 1,
          icms: imposto(it.Icms), pis: imposto(it.Pis), cofins: imposto(it.Cofins),
          ibscbs: it.IBSCBS ? {
            cst: nulo(it.IBSCBS.CST), cclasstrib: nulo(it.IBSCBS.CClasstrib), base: g?.vBC ?? null,
            cbs: parte(g?.gCBS, "pCBS", "vCBS"), ibs_uf: parte(g?.gIBSUF, "pIBSUF", "vIBSUF"), ibs_mun: parte(g?.gIBSMun, "pIBSMun", "vIBSMun"),
          } : null,
        };
      }),
      pagamentos: (Array.isArray(v.Pagamentos) ? v.Pagamentos : []).map((pg: J) => ({
        descricao: txt(pg.Descricao) || "Não identificado", tipo: pg.TipoFormaPagamento ?? null,
        valor: r2(pg.ValorEfetivo != null ? n(pg.ValorEfetivo) : n(pg.ValorRecebido)), recebido: r2(n(pg.ValorRecebido)),
      })),
      cancelamento: canc && d ? { quando: comFuso(d.Data), motivo: nulo(d.Motivo), protocolo: nulo(d.ProtocoloCancelamentoSefaz), operador: nulo(d.Operador?.Nome) } : null,
      operador: nulo(v.Caixa?.Operador?.Nome),
      atendentes: [...new Set((Array.isArray(v.Itens) ? v.Itens : []).map((it: J) => txt(it.AtendenteVenda || it.NomeAgenteVenda)).filter(Boolean))],
      cliente_codigo: v.Cliente?.Codigo ?? null,
      cliente_nome: nulo(v.Cliente?.Nome),
    };
  });
  const inutilizadas = (Array.isArray(vendasResp?.NotasInutilizadas) ? vendasResp.NotasInutilizadas : []).map((x: J) => ({
    serie: txt(x.SerieNota), numero_ini: x.NumeroNotaIni ?? null, numero_fim: x.NumeroNotaFim ?? x.NumeroNotaIni ?? null,
    motivo: nulo(x.Motivo), protocolo: nulo(x.NumeroRecibo), caixa: x.NumeroCaixa ?? null, quando: comFuso(x.DataRecibo) ?? comFuso(x.DataCriacao),
  })).filter((x: J) => x.numero_ini != null);
  const canceladas = (Array.isArray(vendasResp?.NotasCanceladas) ? vendasResp.NotasCanceladas : []).map((x: J) => ({
    chave_venda: nulo(x.ChaveVenda), chave: digitos(x.ChaveSefaz).length === 44 ? digitos(x.ChaveSefaz) : null,
    numero: x.NumeroNota ?? null, serie: nulo(x.SerieNota), motivo: nulo(x.Motivo), protocolo: nulo(x.NumeroRecibo),
    caixa: x.NumeroCaixa ?? null, valor: x.Valor ?? null, quando: comFuso(x.DataRecibo) ?? comFuso(x.DataCriacao),
  }));
  return { vendas, inutilizadas, canceladas };
}

async function processar(id: string) {
  const comeco = Date.now();
  const prazo = comeco + PRAZO_MS;
  const { data: ex } = await supabase.from("totvs_execucoes").select("id,unidade_id,dia,status,origem").eq("id", id).maybeSingle();
  if (!ex || ex.status !== "na_fila" || ex.origem !== "nfce_int") return;
  await supabase.from("totvs_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);
  const log: Registro[] = [];
  let encerrada = false;
  const fim = async (status: string, erro = "") => {
    if (encerrada) return;
    encerrada = true;
    await supabase.from("totvs_execucoes").update({
      status, erro: erro.slice(0, 500), fim: new Date().toISOString(), endpoints: log, tentativas: log.reduce((m, r) => Math.max(m, r.tentativas), 0),
    }).eq("id", ex.id);
  };
  const guarda = setTimeout(() => { fim("falha", "a TOTVS não respondeu a tempo").catch(() => {}); }, PRAZO_MS + 4000);
  try {
    const { data: c } = await supabase.rpc("totvs_credenciais", { p_unidade: ex.unidade_id }).maybeSingle<Credenciais>();
    if (!c?.loja || !c?.chave || !c.usuario || !c.senha || !c.serial) throw new ErroTotvs("faltam credenciais da unidade");
    const resp = await chamar(c, "CapaVenda/ListPorDataIntegracaoChefweb", (token) => ({
      Token: token, CodigoLoja: c.loja, DataInicialIntegracaoChefweb: `${ex.dia}T00:00:00`, DataFinalIntegracaoChefweb: `${ex.dia}T23:59:59`,
      Composicoes: true, NotasInutilizadas: true, ValidaSaltoNota: false,
    }), log, prazo - 10000);
    if (!Array.isArray(resp?.Vendas)) throw new ErroTotvs("resposta de vendas sem a lista Vendas");
    const porDia = new Map<string, J[]>();
    for (const v of resp.Vendas) {
      const d = txt(v?.DataMovimento).slice(0, 10) || ex.dia;
      if (!porDia.has(d)) porDia.set(d, []);
      porDia.get(d)!.push(v);
    }
    let primeiro = true;
    let notas = 0;
    for (const [d, vendasDia] of [...porDia.entries()].sort()) {
      const nf = notasFiscais({ ...resp, Vendas: vendasDia,
        NotasInutilizadas: primeiro ? resp.NotasInutilizadas : [], NotasCanceladas: primeiro ? resp.NotasCanceladas : [] });
      const t0 = Date.now();
      const { error } = await supabase.rpc("nfce_gravar", {
        p_unidade: ex.unidade_id, p_dia: d, p_vendas: nf.vendas, p_inutilizadas: nf.inutilizadas, p_canceladas: nf.canceladas,
      });
      log.push({ endpoint: `nfce_gravar ${d}`, tentativas: 1, ms: Date.now() - t0, ok: !error, ...(error ? { erro: error.message.slice(0, 200) } : {}) });
      if (error) throw new Error(`gravação das NFC-e: ${error.message}`);
      notas += nf.vendas.filter((v) => v.chave).length;
      primeiro = false;
    }
    await fim(resp.Vendas.length ? "ok" : "sem_movimento");
    console.log(JSON.stringify({ integracao: "totvs-nfce-int", unidade_id: ex.unidade_id, dia_integracao: ex.dia, vendas: resp.Vendas.length,
      dias_movimento: [...porDia.keys()], notas, ms: Date.now() - comeco }));
  } catch (e) {
    await fim("falha", e instanceof Error ? e.message : "erro");
  } finally {
    clearTimeout(guarda);
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
