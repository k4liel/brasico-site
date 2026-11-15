"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Faisca, GraficoBarras, GraficoLinhas, GraficoPrecos } from "./Graficos";

// Índice de preços (página /precos, em Operação). Versão de 15/11/2026, escolhida pelo dono entre 3 prévias:
// a "A" (painel: filtros, números, inflação, onde economizar e curva ABC) com a "B" na aba Produtos (lista à esquerda,
// ficha do produto à direita). Filtros valem para tudo: período, casa, categoria, fornecedor e "só insumos".
// Funções: precos_analise, precos_produtos, precos_ficha (supabase/precos_analise.sql) e precos_painel (índice e alertas).
type Ponto = { serie: string; mes: string; valor: number; variacao: number; itens: number; tem: boolean };
type Sinal = { produto: string; unidade: string; fornecedor: string; categoria: string; data: string; preco: number; media: number; compras: number; pct: number; faisca: number[] | null };
type Painel = { indice: Ponto[] | null; altas: Sinal[] | null; quedas: Sinal[] | null; atualizado_em: string };
type Eco = { produto: string; unidade: string; fornecedor: string; preco: number; melhor: string; melhor_preco: number; economia: number };
type Abc = { produto: string; unidade: string; categoria: string; gasto: number; pct: number; classe: string; compras: number; fornecedores: number; principal: string; ultimo: number; ultima: string; variacao: number | null; faisca: number[] | null };
type Cards = { dias: number; gasto: number; gasto_ant: number; produtos: number; produtos_ant: number; fornecedores: number; fornecedores_ant: number;
  compras: number; compras_ant: number; inflacao: number | null; inflacao_itens: number; altas: number; quedas: number; top5_pct: number | null };
type Analise = {
  cards: Cards;
  resumo: { itens: number; produtos: number; fornecedores: number; gasto: number; de: string | null; ate: string | null };
  meses: { mes: string; gasto: number }[] | null; economia_total: number; economia: Eco[] | null; abc: Abc[] | null;
  pareto: { produtos_80: number; total: number };
  fornecedores: { fornecedor: string; gasto: number; compras: number; produtos: number; ultima: string; pct: number }[] | null;
  categorias: { categoria: string; gasto: number; produtos: number; pct: number }[] | null;
  opcoes: { locais: string[] | null; categorias: string[] | null; fornecedores: string[] | null };
};
type ProdutoLinha = { produto: string; unidade: string; categoria: string; gasto: number; compras: number; fornecedores: number; ultimo: number; ultima: string; variacao: number | null };
type Ficha = {
  produto: string; unidade: string; categoria: string | null;
  resumo: { ultimo: number; ultima: string; medio: number; menor: number; maior: number; gasto: number; compras: number; consumo_mes: number } | null;
  compras: { data: string; fornecedor: string; preco: number; quantidade: number; gasto: number; local: string; fonte: string }[] | null;
  fornecedores: { fornecedor: string; compras: number; medio: number; menor: number; ultimo: number; ultima: string; qtd: number; gasto: number }[] | null;
  locais: { local: string; compras: number; medio: number; ultimo: number; qtd: number }[] | null;
  economia: { de: string; preco_de: number; para: string; preco_para: number; por_mes: number } | null;
};
type Filtros = { dias: number; local: string; categoria: string; fornecedor: string; insumos: boolean };

const CATEGORIAS_INDICE = ["Comida", "Bebida", "Descartáveis", "Limpeza"];
const PERIODOS = [[30, "30 dias"], [90, "90 dias"], [180, "6 meses"], [365, "12 meses"]] as const;
// "local" vem do Cicchetti Management (código da unidade) ou da nota da SEFAZ (CNPJ de quem comprou)
const CASAS: Record<string, string> = {
  pipa_centro: "Cicchetti Pipa", pipa_producao: "Produção", midway: "Cicchetti Midway (encerrado)",
  "24021962000276": "Brasico77 filial 0002 · notas (Cicchetti e Produção)", "24021962000195": "Filha da Lua · notas (Brasico77 matriz)",
  "50639716000101": "Sempre Vivo · notas (LAIF)", "36528542000189": "Genesis · notas",
};
const casa = (l: string) => CASAS[l] ?? l;
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const reais = (v: number) => (Math.abs(v) >= 10000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) >= 100000 ? 0 : 1 })} mil` : brl(v));
const inteiro = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pctTxt = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const mesCurto = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", " ").replace(".", "");
const mesLongo = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });
const dia = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const unid = (u: string) => (u || "un").toLowerCase();

function baixarPlanilha(nome: string, cabecalho: string[], linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => { const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [cabecalho, ...linhas].map((l) => l.map(esc).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function IndicePrecos() {
  const supabase = useMemo(() => createClient(), []);
  const [aba, setAba] = useState<"geral" | "produtos" | "alertas">("geral");
  const [f, setF] = useState<Filtros>({ dias: 90, local: "", categoria: "", fornecedor: "", insumos: true });
  const [painel, setPainel] = useState<Painel | null>(null);
  const [a, setA] = useState<Analise | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [escolhido, setEscolhido] = useState<{ produto: string; unidade: string } | null>(null);
  const [inicioProdutos, setInicioProdutos] = useState<{ soAltas: boolean; ordem: "gasto" | "variacao" | "recente"; n: number }>({ soAltas: false, ordem: "gasto", n: 0 });

  const args = useCallback((x: Filtros) => ({ p_dias: x.dias, p_local: x.local || null, p_categoria: x.categoria || null, p_fornecedor: x.fornecedor || null, p_insumos: x.insumos }), []);

  const lerPainel = useCallback(async () => {
    const { data, error } = await supabase.rpc("precos_painel");
    if (error) return setErro(error.message);
    setPainel(data as Painel);
  }, [supabase]);
  const lerAnalise = useCallback(async (x: Filtros) => {
    setCarregando(true);
    const { data, error } = await supabase.rpc("precos_analise", args(x));
    setCarregando(false);
    if (error) return setErro(error.message);
    setA(data as Analise);
  }, [supabase, args]);
  useEffect(() => { lerPainel(); }, [lerPainel]);
  useEffect(() => { lerAnalise(f); }, [lerAnalise, f]);

  const abrirProduto = (produto: string, unidade: string) => { setEscolhido({ produto, unidade }); setAba("produtos"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const mudar = (p: Partial<Filtros>) => setF((x) => ({ ...x, ...p }));

  if (erro) return <p className="es-aviso tv-alerta">{erro}</p>;
  if (!a || !painel) return <div className="ip-carregando"><span /><span /><span /><span /></div>;
  const r = a.resumo;
  const nAltas = painel.altas?.length ?? 0;

  return (
    <div className="ip">
      <div className="ip-cabeca">
        <div>
          <span className="es-sobre">Operação · compras</span>
          <h1>Índice de preços</h1>
          <p className="muted">{r.itens.toLocaleString("pt-BR")} itens de notas · {r.produtos.toLocaleString("pt-BR")} produtos · {r.fornecedores} fornecedores no período · atualizado {new Date(painel.atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div className="ip-acoes">
          <button className="ghost small" onClick={() => baixarPlanilha(`indice-precos-${new Date().toISOString().slice(0, 10)}`,
            ["Classe", "Produto", "Unidade", "Categoria", "Fornecedor principal", "Gasto", "Participação %", "Compras", "Último preço", "Variação %"],
            (a.abc ?? []).map((x) => [x.classe, x.produto, x.unidade, x.categoria, x.principal, x.gasto, x.pct, x.compras, x.ultimo, x.variacao]))}>Planilha</button>
          <button className="ghost small" disabled={carregando} onClick={() => { lerPainel(); lerAnalise(f); }}>{carregando ? "Calculando…" : "Atualizar"}</button>
        </div>
      </div>

      <div className="ip-abas" role="tablist" aria-label="Seções">
        {([["geral", "Visão geral"], ["produtos", "Produtos"], ["alertas", "Alertas"]] as const).map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} className={aba === id ? "on" : ""} onClick={() => setAba(id)}>
            {nome}{id === "alertas" && nAltas > 0 && <span className="ip-abas-n">{nAltas}</span>}
          </button>
        ))}
      </div>

      {aba !== "alertas" && (
        <div className="ip-filtros">
          <span className="es-segmentos" role="radiogroup" aria-label="Período">
            {PERIODOS.map(([d, nome]) => <button key={d} role="radio" aria-checked={f.dias === d} className={f.dias === d ? "on" : ""} onClick={() => mudar({ dias: d })}>{nome}</button>)}
          </span>
          <select value={f.local} onChange={(e) => mudar({ local: e.target.value })} aria-label="Casa">
            <option value="">Todas as casas</option>
            {(a.opcoes.locais ?? []).map((l) => <option key={l} value={l}>{casa(l)}</option>)}
          </select>
          <select value={f.categoria} onChange={(e) => mudar({ categoria: e.target.value })} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {(a.opcoes.categorias ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={f.fornecedor} onChange={(e) => mudar({ fornecedor: e.target.value })} aria-label="Fornecedor">
            <option value="">Todos os fornecedores</option>
            {(a.opcoes.fornecedores ?? []).map((x) => <option key={x} value={x}>{titulo(x)}</option>)}
          </select>
          <label className="ip-chave">
            <input type="checkbox" checked={f.insumos} onChange={(e) => mudar({ insumos: e.target.checked })} />
            <i aria-hidden="true" />Só insumos <span className="muted">(sem equipamentos e serviços)</span>
          </label>
          {carregando && <span className="ip-calculando" aria-live="polite">Calculando…</span>}
        </div>
      )}

      {aba === "geral" && <VisaoGeral a={a} painel={painel} abrir={abrirProduto}
        verAltas={() => { setEscolhido(null); setInicioProdutos((x) => ({ soAltas: true, ordem: "variacao", n: x.n + 1 })); setAba("produtos"); }} />}
      {aba === "produtos" && <Produtos key={inicioProdutos.n} inicio={inicioProdutos} f={f} args={args} escolhido={escolhido} escolher={(p, u) => setEscolhido({ produto: p, unidade: u })} />}
      {aba === "alertas" && <Alertas painel={painel} abrir={abrirProduto} />}
    </div>
  );
}

/* ---------- Visão geral (prévia A) ---------- */
// Variação contra o período anterior do mesmo tamanho. Os dados começam em abril de 2026: se o período anterior tiver
// menos de 40% das compras do atual, ele não está completo e o card não compara (seria uma diferença enganosa).
function Comparacao({ atual, antes, valida, inverter, sufixo }: { atual: number; antes: number; valida: boolean; inverter?: boolean; sufixo: string }) {
  if (!valida || !antes) return <span className="ip-var">sem período anterior completo para comparar</span>;
  const v = (atual / antes - 1) * 100;
  const ruim = inverter ? v < 0 : v > 0;
  return <span className={`ip-var ${Math.abs(v) < 0.05 ? "" : ruim ? "sobe" : "desce"}`}>{v > 0 ? "▲" : v < 0 ? "▼" : "="} {pctTxt(v)} {sufixo}</span>;
}

function VisaoGeral({ a, painel, abrir, verAltas }: { a: Analise; painel: Painel; abrir: (p: string, u: string) => void; verAltas: () => void }) {
  const [cats, setCats] = useState<string[]>(["Comida"]);
  const [abc, setAbc] = useState<"produtos" | "fornecedores" | "categorias">("produtos");
  const [mais, setMais] = useState(false);

  // índice mensal (gráfico): começa no mês anterior ao primeiro com cesta de pelo menos 30 itens comparados (esse mês vale 100)
  const ind = painel.indice ?? [];
  const todosMeses = [...new Set(ind.map((x) => x.mes))].sort();
  const primeiroBom = todosMeses.findIndex((m) => (ind.find((x) => x.serie === "Geral" && x.mes === m)?.itens ?? 0) >= 30);
  const meses = todosMeses.slice(Math.max(0, primeiroBom - 1));
  const serie = (nome: string) => {
    const bruto = meses.map((m) => ind.find((x) => x.serie === nome && x.mes === m)?.valor ?? null);
    const base = bruto[0];
    return bruto.map((v) => (v == null || !base ? v : Math.round((v / base) * 1000) / 10));
  };
  const geral = serie("Geral");

  const c = a.cards;
  const valida = c.compras_ant >= c.compras * 0.4;
  const periodo = PERIODOS.find(([d]) => d === c.dias)?.[1] ?? `${c.dias} dias`;
  const contra = `sobre os ${periodo} anteriores`;
  // gasto por dia: pelos dias desde a primeira compra do período (os dados começam em abril de 2026)
  const diasReais = a.resumo.de ? Math.max(1, Math.min(c.dias, Math.round((Date.now() - Date.parse(`${a.resumo.de}T12:00:00`)) / 86400000) + 1)) : c.dias;
  const porDia = c.gasto / diasReais, porDiaAnt = c.gasto_ant / c.dias;
  const gastosMes = (a.meses ?? []).map((g) => g.gasto);
  const pctPareto = a.pareto.total ? Math.round((a.pareto.produtos_80 / a.pareto.total) * 100) : 0;
  const lista = (a.abc ?? []).slice(0, mais ? 60 : 12);

  return (
    <>
      <div className="ip-numeros ip-numeros-8">
        <div className="ip-numero">
          <span className="ip-rotulo">Gasto · {periodo}</span>
          <span className="ip-valor">{reais(c.gasto)}</span>
          <Comparacao atual={c.gasto} antes={c.gasto_ant} valida={valida} sufixo={contra} />
          {gastosMes.length > 1 && <Faisca valores={gastosMes} alta={c.gasto > c.gasto_ant} />}
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Inflação das compras · {periodo}</span>
          <span className={`ip-valor ${c.inflacao == null || !valida ? "" : c.inflacao > 0 ? "ip-vermelho" : "ip-verde"}`}>{c.inflacao == null || !valida ? "—" : pctTxt(c.inflacao)}</span>
          <span className="ip-var">{c.inflacao == null || !valida ? "sem período anterior completo para comparar" : `mesma cesta de ${c.inflacao_itens} produtos, ${contra}`}</span>
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Economia possível · {periodo}</span>
          <span className="ip-valor ip-verde">{reais(a.economia_total)}</span>
          <span className="ip-var">comprando cada produto do fornecedor mais barato</span>
        </div>
        <button className="ip-numero ip-numero-botao" onClick={verAltas}>
          <span className="ip-rotulo">Preços que mudaram · {periodo}</span>
          <span className="ip-valor"><span className="ip-vermelho">{c.altas}</span> <small>subiram</small> · <span className="ip-verde">{c.quedas}</span> <small>caíram</small></span>
          <span className="ip-var">10% ou mais na última compra · ver os que subiram →</span>
        </button>
        <div className="ip-numero">
          <span className="ip-rotulo">Gasto médio por dia</span>
          <span className="ip-valor">{reais(porDia)}</span>
          <Comparacao atual={porDia} antes={porDiaAnt} valida={valida} sufixo={contra} />
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Produtos comprados</span>
          <span className="ip-valor">{c.produtos.toLocaleString("pt-BR")}</span>
          <Comparacao atual={c.produtos} antes={c.produtos_ant} valida={valida} sufixo={contra} />
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Fornecedores ativos</span>
          <span className="ip-valor">{c.fornecedores}</span>
          <Comparacao atual={c.fornecedores} antes={c.fornecedores_ant} valida={valida} sufixo={contra} />
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Concentração</span>
          <span className="ip-valor">{c.top5_pct == null ? "—" : `${c.top5_pct.toLocaleString("pt-BR")}%`}</span>
          <span className="ip-var">do gasto com os 5 maiores fornecedores · {c.compras.toLocaleString("pt-BR")} itens comprados</span>
        </div>
      </div>

      <div className="ip-grade">
        <section className="ip-cartao">
          <header className="ip-cartao-cabeca">
            <div><h3>Inflação das compras</h3><p className="muted">índice mensal encadeado: a mesma cesta de itens de um mês para o outro · primeiro mês = 100</p></div>
            <div className="ft-chips ip-chips" role="group" aria-label="Categorias no gráfico">
              {CATEGORIAS_INDICE.map((c, i) => (
                <button key={c} aria-pressed={cats.includes(c)} className={cats.includes(c) ? "on" : ""} onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}>
                  <i style={{ background: `var(--serie-${i + 1})` }} />{c}
                </button>
              ))}
            </div>
          </header>
          <GraficoLinhas rotulos={meses.map(mesCurto)} base={100}
            series={[{ nome: "Geral", cor: "var(--strong)", pontos: geral, destaque: true },
              ...cats.map((c) => ({ nome: c, cor: `var(--serie-${CATEGORIAS_INDICE.indexOf(c) + 1})`, pontos: serie(c) }))]} />
        </section>

        <section className="ip-cartao">
          <header className="ip-cartao-cabeca"><div><h3>Onde economizar</h3><p className="muted">mesmo produto, fornecedor mais barato no período</p></div></header>
          {!(a.economia ?? []).length ? <p className="muted">Nenhum produto com dois fornecedores e preço diferente neste filtro.</p> : (
            <ul className="ip-eco">
              {(a.economia ?? []).slice(0, 7).map((e) => (
                <li key={`${e.produto}|${e.unidade}`}>
                  <button onClick={() => abrir(e.produto, e.unidade)}>
                    <span className="ip-eco-nome"><strong>{titulo(e.produto)}</strong>
                      <small>{titulo(e.fornecedor).slice(0, 26)} {brl(e.preco)} → <b>{titulo(e.melhor).slice(0, 26)} {brl(e.melhor_preco)}</b>/{unid(e.unidade)}</small></span>
                    <span className="ip-eco-valor">{inteiro(e.economia)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="ip-cartao">
        <header className="ip-cartao-cabeca">
          <div><h3>Onde vai o dinheiro · curva ABC</h3>
            <p className="muted">{a.pareto.produtos_80} produtos ({pctPareto}% do total) somam 80% do gasto de {reais(a.resumo.gasto)} no período · clique num produto para abrir a ficha</p></div>
          <span className="es-segmentos" role="tablist" aria-label="Agrupar por">
            {(["produtos", "fornecedores", "categorias"] as const).map((x) => <button key={x} role="tab" aria-selected={abc === x} className={abc === x ? "on" : ""} onClick={() => setAbc(x)}>{titulo(x)}</button>)}
          </span>
        </header>
        <div className="nf-tabela-wrap">
          {abc === "produtos" && (
            <table className="nf-tabela ip-tabela ip-abc">
              <thead><tr><th /><th>Produto</th><th>Fornecedor principal</th><th className="n">Gasto</th><th>Participação</th><th className="n">Último preço</th><th className="n">Variação</th><th>Preço mês a mês</th></tr></thead>
              <tbody>
                {lista.map((x) => (
                  <tr key={`${x.produto}|${x.unidade}`} className="ip-clicavel" onClick={() => abrir(x.produto, x.unidade)}>
                    <td><span className={`ip-classe c-${x.classe}`}>{x.classe}</span></td>
                    <td><strong>{titulo(x.produto)}</strong> <span className="muted">{unid(x.unidade)}</span><small className="ip-sub">{x.categoria} · {x.compras} compras</small></td>
                    <td className="muted">{titulo(x.principal)}</td>
                    <td className="n">{inteiro(x.gasto)}</td>
                    <td><span className="ip-barra"><i style={{ width: `${Math.min(100, (x.gasto / ((a.abc ?? [])[0]?.gasto || 1)) * 100)}%` }} /></span><small className="ip-sub">{x.pct.toLocaleString("pt-BR")}%</small></td>
                    <td className="n">{brl(x.ultimo)}</td>
                    <td className="n">{x.variacao == null ? <span className="muted">—</span> : <span className={`ip-selo ${x.variacao > 0 ? "sobe" : x.variacao < 0 ? "desce" : ""}`}>{pctTxt(x.variacao)}</span>}</td>
                    <td>{(x.faisca ?? []).length > 1 ? <Faisca valores={x.faisca ?? []} alta={(x.variacao ?? 0) > 0} /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {abc === "fornecedores" && (
            <table className="nf-tabela ip-tabela">
              <thead><tr><th>Fornecedor</th><th className="n">Gasto</th><th>Participação</th><th className="n">Compras</th><th className="n">Produtos</th><th>Última compra</th></tr></thead>
              <tbody>
                {(a.fornecedores ?? []).slice(0, mais ? 40 : 12).map((x) => (
                  <tr key={x.fornecedor}>
                    <td><strong>{titulo(x.fornecedor)}</strong></td><td className="n">{inteiro(x.gasto)}</td>
                    <td><span className="ip-barra"><i style={{ width: `${Math.min(100, (x.gasto / ((a.fornecedores ?? [])[0]?.gasto || 1)) * 100)}%` }} /></span><small className="ip-sub">{x.pct.toLocaleString("pt-BR")}%</small></td>
                    <td className="n">{x.compras}</td><td className="n">{x.produtos}</td><td>{dia(x.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {abc === "categorias" && (
            <table className="nf-tabela ip-tabela">
              <thead><tr><th>Categoria</th><th className="n">Gasto</th><th>Participação</th><th className="n">Produtos</th></tr></thead>
              <tbody>
                {(a.categorias ?? []).map((x) => (
                  <tr key={x.categoria}>
                    <td><strong>{x.categoria}</strong></td><td className="n">{inteiro(x.gasto)}</td>
                    <td><span className="ip-barra"><i style={{ width: `${Math.min(100, (x.gasto / ((a.categorias ?? [])[0]?.gasto || 1)) * 100)}%` }} /></span><small className="ip-sub">{x.pct.toLocaleString("pt-BR")}%</small></td>
                    <td className="n">{x.produtos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {abc !== "categorias" && <button className="ghost small ip-mais" onClick={() => setMais((m) => !m)}>{mais ? "Mostrar menos" : "Mostrar mais"}</button>}
      </section>

      <section className="ip-cartao">
        <header className="ip-cartao-cabeca"><div><h3>Gasto por mês</h3><p className="muted">soma das compras das notas, com os filtros de casa, categoria e fornecedor</p></div></header>
        <GraficoBarras rotulos={(a.meses ?? []).map((g) => mesCurto(g.mes))} valores={(a.meses ?? []).map((g) => g.gasto)} formato={reais} />
      </section>
    </>
  );
}

/* ---------- Produtos (prévia B): lista à esquerda, ficha à direita ---------- */
function Produtos({ inicio, f, args, escolhido, escolher }: {
  inicio: { soAltas: boolean; ordem: "gasto" | "variacao" | "recente" }; f: Filtros; args: (x: Filtros) => Record<string, unknown>; escolhido: { produto: string; unidade: string } | null; escolher: (p: string, u: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busca, setBusca] = useState(escolhido?.produto ?? "");
  const [soAltas, setSoAltas] = useState(inicio.soAltas);
  const [ordem, setOrdem] = useState<"gasto" | "variacao" | "recente">(inicio.ordem);
  const [lista, setLista] = useState<ProdutoLinha[] | null>(null);

  useEffect(() => {
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("precos_produtos", { ...args(f), p_busca: busca.trim() || null, p_so_altas: soAltas, p_ordem: ordem });
      const l = (data ?? []) as ProdutoLinha[];
      setLista(l);
      if (!escolhido && l[0]) escolher(l[0].produto, l[0].unidade);
    }, busca ? 300 : 0);
    return () => clearTimeout(id);
  }, [supabase, args, f, busca, soAltas, ordem]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ip-mesa">
      <aside className="ip-cartao ip-mesa-lista">
        <input type="search" className="ip-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar produto ou fornecedor…" aria-label="Procurar produto" />
        <div className="ip-mesa-opcoes">
          <label className="ip-chave"><input type="checkbox" checked={soAltas} onChange={(e) => setSoAltas(e.target.checked)} /><i aria-hidden="true" />Só os que subiram</label>
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} aria-label="Ordem">
            <option value="gasto">Maior gasto</option><option value="variacao">Maior alta</option><option value="recente">Compra mais recente</option>
          </select>
        </div>
        <div className="ip-mesa-cab muted"><span>{lista ? `${lista.length}${lista.length === 200 ? "+" : ""} produtos` : "Carregando…"}</span><span>Último · variação</span></div>
        <ul className="ip-mesa-itens">
          {(lista ?? []).map((p) => {
            const on = escolhido?.produto === p.produto && escolhido?.unidade === p.unidade;
            return (
              <li key={`${p.produto}|${p.unidade}`}>
                <button className={on ? "on" : ""} aria-current={on ? "true" : undefined} onClick={() => escolher(p.produto, p.unidade)}>
                  <span className="ip-mesa-nome"><strong>{titulo(p.produto)}</strong><small>{unid(p.unidade)} · {p.compras} compras · {p.fornecedores} {p.fornecedores === 1 ? "fornecedor" : "fornecedores"}</small></span>
                  <span className="ip-mesa-preco">{brl(p.ultimo)}</span>
                  <span className={`ip-selo ${p.variacao == null ? "" : p.variacao > 0 ? "sobe" : p.variacao < 0 ? "desce" : ""}`}>{p.variacao == null ? "—" : pctTxt(p.variacao)}</span>
                </button>
              </li>
            );
          })}
          {lista && !lista.length && <li className="muted tv-nada">Nada encontrado com esses filtros.</li>}
        </ul>
      </aside>
      <section className="ip-cartao ip-mesa-ficha">
        {escolhido ? <FichaProduto produto={escolhido.produto} unidade={escolhido.unidade} /> : <p className="muted">Escolha um produto na lista.</p>}
      </section>
    </div>
  );
}

function FichaProduto({ produto, unidade }: { produto: string; unidade: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [dias, setDias] = useState(180);
  const [d, setD] = useState<Ficha | null>(null);
  useEffect(() => {
    setD(null);
    supabase.rpc("precos_ficha", { p_produto: produto, p_unidade: unidade, p_dias: dias }).then(({ data }) => setD(data as Ficha));
  }, [supabase, produto, unidade, dias]);
  if (!d) return <div className="ip-ficha-carregando"><span /><span /><span /></div>;
  const r = d.resumo;
  const forn = d.fornecedores ?? [];
  const menorMedio = Math.min(...forn.map((x) => Number(x.medio)));
  const locais = d.locais ?? [];
  const compras = (d.compras ?? []).map((c) => ({ ...c, fornecedor: titulo(c.fornecedor), preco: Number(c.preco), quantidade: Number(c.quantidade) }));

  return (
    <div className="ip-ficha">
      <header className="ip-ficha-cab">
        <div>
          <span className="es-sobre">{d.categoria ?? "Sem categoria"}</span>
          <h2>{titulo(produto)}</h2>
          <p className="muted">{unid(unidade)} · {locais.length ? `comprado por ${locais.map((l) => casa(l.local)).join(", ")}` : "sem compras no período"}</p>
        </div>
        <span className="es-segmentos" role="radiogroup" aria-label="Período da ficha">
          {[[90, "90 d"], [180, "6 meses"], [365, "12 meses"]].map(([n, nome]) => <button key={n} role="radio" aria-checked={dias === n} className={dias === n ? "on" : ""} onClick={() => setDias(Number(n))}>{nome}</button>)}
        </span>
      </header>
      {!r || !r.compras ? <p className="muted">Nenhuma compra deste produto no período.</p> : (
        <>
          <div className="ip-ficha-numeros">
            <div><span>Último preço</span><b>{brl(r.ultimo)}</b><small>{dia(r.ultima)}</small></div>
            <div><span>Preço médio</span><b>{brl(r.medio)}</b><small>{r.compras} compras</small></div>
            <div><span>Menor pago</span><b className="ip-verde">{brl(r.menor)}</b><small>maior {brl(r.maior)}</small></div>
            <div><span>Gasto</span><b>{reais(r.gasto)}</b><small>no período</small></div>
            <div><span>Consumo médio</span><b>{Number(r.consumo_mes).toLocaleString("pt-BR")} {unid(unidade)}</b><small>por mês</small></div>
          </div>
          <h3 className="ip-ficha-titulo">Preço pago em cada compra, por fornecedor</h3>
          <GraficoPrecos compras={compras} unidade={unidade} />
          <div className="ip-ficha-dupla">
            <div>
              <h3 className="ip-ficha-titulo">Fornecedores</h3>
              <div className="nf-tabela-wrap">
                <table className="nf-tabela ip-tabela">
                  <thead><tr><th>Fornecedor</th><th className="n">Compras</th><th className="n">Médio</th><th className="n">Último</th><th>Última</th></tr></thead>
                  <tbody>
                    {forn.map((x) => (
                      <tr key={x.fornecedor}>
                        <td><strong>{titulo(x.fornecedor)}</strong>{Number(x.medio) === menorMedio && forn.length > 1 && <span className="ip-melhor-selo">mais barato</span>}</td>
                        <td className="n">{x.compras}</td><td className="n">{brl(x.medio)}</td><td className="n">{brl(x.ultimo)}</td><td>{dia(x.ultima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="ip-ficha-titulo">O que fazer</h3>
              {d.economia ? (
                <div className="ip-dica-cartao ok">
                  <strong>Economia de ~{inteiro(d.economia.por_mes)}/mês</strong>
                  <p>comprando de {titulo(d.economia.para)} ({brl(d.economia.preco_para)}) em vez de {titulo(d.economia.de)} ({brl(d.economia.preco_de)}), no consumo de hoje.</p>
                </div>
              ) : (
                <div className="ip-dica-cartao"><strong>{forn.length > 1 ? "Já compra do mais barato" : "Um fornecedor só"}</strong>
                  <p className="muted">{forn.length > 1 ? "O fornecedor principal deste produto já é o de menor preço médio no período." : "Sem outro fornecedor para comparar no período: vale cotar com outro."}</p></div>
              )}
              {locais.length > 1 && (
                <div className="ip-dica-cartao"><strong>Por casa</strong>
                  <ul className="ip-casas">{locais.map((l) => <li key={l.local}><span>{casa(l.local)}</span><b>{brl(l.medio)}</b></li>)}</ul></div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Alertas ---------- */
function Alertas({ painel, abrir }: { painel: Painel; abrir: (p: string, u: string) => void }) {
  const [lado, setLado] = useState<"altas" | "quedas">("altas");
  const lista = (lado === "altas" ? painel.altas : painel.quedas) ?? [];
  return (
    <section className="ip-cartao ip-sinais">
      <header className="ip-cartao-cabeca">
        <div><h3>Alertas de preço</h3><p className="muted">a última compra de cada item, por fornecedor, contra a média das compras anteriores (120 dias) · clique para abrir a ficha</p></div>
        <div className="ft-chips" role="tablist" aria-label="Alta ou queda">
          <button role="tab" aria-selected={lado === "altas"} className={lado === "altas" ? "on" : ""} onClick={() => setLado("altas")}>Subiram<span>{painel.altas?.length ?? 0}</span></button>
          <button role="tab" aria-selected={lado === "quedas"} className={lado === "quedas" ? "on" : ""} onClick={() => setLado("quedas")}>Caíram<span>{painel.quedas?.length ?? 0}</span></button>
        </div>
      </header>
      {!lista.length ? <p className="muted">Nenhum item {lado === "altas" ? "subiu" : "caiu"} 10% ou mais nos últimos 30 dias.</p> : (
        <ul className="ip-lista">
          {lista.map((s) => (
            <li key={`${s.produto}|${s.unidade}|${s.fornecedor}`}>
              <button className="ip-linha" onClick={() => abrir(s.produto, s.unidade)}>
                <span className="ip-linha-nome"><strong>{titulo(s.produto)}</strong><small>{titulo(s.fornecedor)} · {s.categoria} · {dia(s.data)}</small></span>
                <Faisca valores={s.faisca ?? []} alta={s.pct > 0} />
                <span className="ip-linha-preco"><strong>{brl(s.preco)}</strong><small>/{unid(s.unidade)} · média {brl(s.media)}</small></span>
                <span className={`ip-selo ${s.pct > 0 ? "sobe" : "desce"}`}>{pctTxt(s.pct)}</span>
                <span className="ip-seta ip-seta-dir" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
