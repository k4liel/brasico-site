// Lê o cadastro de produtos e as regras fiscais de uma unidade na TOTVS Chef Web API (só leitura).
// Chamada pelo banco (totvs_produtos_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em totvs_produtos_execucoes>" }. Responde na hora e trabalha em segundo plano.
// Endpoints (swagger da Chef Web): GET /api/produto/listarProdutos?request.token&request.codigoLoja&request.completa
// e GET /api/RegraFiscal/ConsultarRegras?request.token&request.codigoLoja. Nunca chama os "salvar" (escrita).
// Modo "sondar": guarda só a forma da resposta (chaves e 3 exemplos) para conferir o formato.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://chefweb.chef.totvs.com.br/chefwebAPI";
const PRAZO_MS = 138000;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Credenciais = { usuario: string; senha: string; serial: string; chave: string; loja: number };
// deno-lint-ignore no-explicit-any
type J = any;

async function pedir(caminho: string, init: RequestInit, esperaMs: number): Promise<{ status: number; corpo: J; texto: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), esperaMs);
  try {
    const r = await fetch(API + caminho, { ...init, signal: ctl.signal });
    const texto = await r.text();
    let corpo: J = null;
    try { corpo = JSON.parse(texto); } catch { /* não é JSON */ }
    return { status: r.status, corpo, texto: corpo ? "" : texto.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

async function token(c: Credenciais) {
  const p = await pedir("/api/Token/GerarToken", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Usuario: c.usuario, Senha: c.senha, NumeroSerialLoja: c.serial, Chave: c.chave }),
  }, 25000);
  if (!p.corpo?.Sucesso || !p.corpo?.Token) throw new Error("token recusado");
  return String(p.corpo.Token);
}

// Forma de um valor: chaves e alguns exemplos, sem despejar tudo
function forma(v: J, nivel = 0): J {
  if (Array.isArray(v)) return { lista: v.length, exemplos: v.slice(0, 3).map((x) => (nivel < 2 ? forma(x, nivel + 1) : x)) };
  if (v && typeof v === "object") {
    const o: J = {};
    for (const [k, x] of Object.entries(v)) o[k] = Array.isArray(x) || (x && typeof x === "object") ? forma(x, nivel + 1) : x;
    return o;
  }
  return v;
}

async function processar(id: string) {
  const comeco = Date.now();
  const { data: ex } = await supabase.from("totvs_produtos_execucoes").select("id,unidade_id,modo,status").eq("id", id).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("totvs_produtos_execucoes").update({ status: "rodando" }).eq("id", id);
  const fim = (status: string, resultado: J, erro = "") =>
    supabase.from("totvs_produtos_execucoes").update({ status, resultado, erro: erro.slice(0, 500), fim: new Date().toISOString() }).eq("id", id);
  try {
    const { data: c } = await supabase.rpc("totvs_credenciais", { p_unidade: ex.unidade_id }).maybeSingle<Credenciais>();
    if (!c?.loja || !c?.usuario) throw new Error("sem credenciais da unidade");
    const resultado: J = {};
    const L = c.loja;
    const q = (o: Record<string, string | number | boolean>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const post = (corpo: J): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const GET: RequestInit = { method: "GET" };
    // Sondagem: cada variante de chamada, para achar a que a TOTVS aceita
    const variantes: [string, (tk: string) => [string, RequestInit]][] = ex.modo === "sondar" ? [
      ["estoque", (tk) => [`/api/Estoque/ListarEstoque?${q({ "requisicao.token": tk, "requisicao.codigoLoja": L, "requisicao.completa": true })}`, GET]],
      ["conferencia_out", (tk) => [`/api/ConferenciaVendas/ListConferenciaVenda?${q({ "requisicao.token": tk, "requisicao.codigoLoja": L, "requisicao.dataInicial": "2026-10-01", "requisicao.dataFinal": "2026-10-01" })}`, GET]],
      ["conferencia_nov", (tk) => [`/api/ConferenciaVendas/ListConferenciaVenda?${q({ "requisicao.token": tk, "requisicao.codigoLoja": L, "requisicao.dataInicial": "2026-11-20", "requisicao.dataFinal": "2026-11-20" })}`, GET]],
      ["nf_venda_out", (tk) => [`/api/Fiscal/ListNotasFiscaisVenda?${q({ page: 1, pageSize: 5, "requisicao.token": tk, "requisicao.codigoLoja": L, "requisicao.dataInicial": "2026-10-01", "requisicao.dataFinal": "2026-10-01" })}`, GET]],
      ["capa_integracao_out", (tk) => ["/api/CapaVenda/ListPorDataIntegracaoChefweb", post({ Token: tk, CodigoLoja: L, DataInicialIntegracaoChefweb: "2026-10-01T00:00:00", DataFinalIntegracaoChefweb: "2026-10-01T23:59:59", Composicoes: false, NotasInutilizadas: false, ValidaSaltoNota: false })]],
      ["cliente", (tk) => [`/api/CadastroCliente/Listar?${q({ "requisicao.token": tk, "requisicao.codigoLoja": L, "requisicao.completa": false })}`, GET]],
    ] : [
      ["produtos", (tk) => [`/api/produto/listarProdutos?${q({ "request.token": tk, "request.codigoLoja": L, "request.completa": true })}`, GET]],
    ];
    for (const [nome, montar] of variantes) {
      const restante = comeco + PRAZO_MS - Date.now();
      if (restante < 15000) { resultado[nome] = { pulado: "sem tempo" }; continue; }
      try {
        const tk = await token(c);
        const t0 = Date.now();
        const [caminho, init] = montar(tk);
        const r = await pedir(caminho, init, Math.min(60000, restante - 5000));
        resultado[nome] = { http: r.status, ms: Date.now() - t0, texto: r.texto || undefined, forma: forma(r.corpo) };
        if (ex.modo !== "sondar") resultado[nome].corpo = r.corpo;
      } catch (e) {
        resultado[nome] = { erro: e instanceof Error ? e.message : "erro" };
      }
    }
    await fim("ok", resultado);
  } catch (e) {
    await fim("falha", null, e instanceof Error ? e.message : "erro");
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
