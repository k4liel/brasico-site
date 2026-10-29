"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Faisca, GraficoBarras, GraficoLinhas, GraficoPrecos, type Compra } from "./Graficos";

// Índice de preços (aba da página Notas): análise das compras de todas as notas (Cicchetti Management e SEFAZ),
// com o índice mensal encadeado, o gasto, os alertas de alta e de queda (um por item e fornecedor) e a busca de produto.
// Cada item abre embaixo com o histórico de preço e a comparação de fornecedores. Funções em supabase/precos_painel.sql.
type Ponto = { serie: string; mes: string; valor: number; variacao: number; itens: number; tem: boolean };
type Gasto = { mes: string; gasto: number; produtos: number };
type Sinal = { produto: string; unidade: string; fornecedor: string; categoria: string; data: string; preco: number; media: number; compras: number; pct: number; faisca: number[] | null };
export type Painel = { indice: Ponto[] | null; gasto: Gasto[] | null; categorias: { categoria: string; gasto: number }[] | null; altas: Sinal[] | null;
  quedas: Sinal[] | null; produtos: number; fornecedores: number; atualizado_em: string };
type Achado = { produto: string; unidade: string; categoria: string; compras: number; fornecedores: number; ultimo: number; ultima: string; primeiro_90: number | null };
type Fornecedor = { fornecedor: string; compras: number; medio: number; menor: number; ultimo: number; ultima: string };

const CATEGORIAS = ["Comida", "Bebida", "Descartáveis", "Limpeza"];
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const mil = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 100000 ? 0 : 1 })} mil` : brl(v));
const pctTxt = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const mesCurto = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", " ").replace(".", "");
const dia = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export default function IndicePrecos({ previa }: { previa?: Painel } = {}) {
  const supabase = useMemo(() => createClient(), []);
  const [p, setP] = useState<Painel | null>(previa ?? null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [tabela, setTabela] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [lado, setLado] = useState<"altas" | "quedas">("altas");

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    const { data, error } = await supabase.rpc("precos_painel");
    setCarregando(false);
    if (error) return setErro(error.message);
    setP(data as Painel);
  }, [supabase]);
  useEffect(() => { if (!previa) carregar(); }, [carregar, previa]);

  useEffect(() => {
    const t = busca.trim();
    if (t.length < 3) { setAchados(null); return; }
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("precos_procurar", { p_busca: t });
      setAchados((data ?? []) as Achado[]);
    }, 350);
    return () => clearTimeout(id);
  }, [busca, supabase]);

  if (erro) return <p className="es-aviso tv-alerta">{erro}</p>;
  if (!p) return <div className="ip-carregando"><span /><span /><span /><span /></div>;

  // O índice começa no mês anterior ao primeiro com cesta de pelo menos 30 itens comparados (esse mês vale 100)
  const todosMeses = [...new Set((p.indice ?? []).map((x) => x.mes))].sort();
  const primeiroBom = todosMeses.findIndex((m) => ((p.indice ?? []).find((x) => x.serie === "Geral" && x.mes === m)?.itens ?? 0) >= 30);
  const meses = todosMeses.slice(Math.max(0, primeiroBom - 1));
  const serie = (nome: string) => {
    const bruto = meses.map((m) => (p.indice ?? []).find((x) => x.serie === nome && x.mes === m)?.valor ?? null);
    const base = bruto[0];
    return bruto.map((v) => (v == null || !base ? v : Math.round((v / base) * 1000) / 10));
  };
  const geral = serie("Geral");
  const ultimoGeral = (p.indice ?? []).filter((x) => x.serie === "Geral").sort((a, b) => a.mes.localeCompare(b.mes)).pop();
  const gastos = p.gasto ?? [];
  const gastoAtual = gastos[gastos.length - 1], gastoAntes = gastos[gastos.length - 2];
  const varGasto = gastoAtual && gastoAntes?.gasto ? (gastoAtual.gasto / gastoAntes.gasto - 1) * 100 : null;
  const catGasto = (p.categorias ?? []).filter((c) => c.gasto > 0);
  const maxCat = Math.max(...catGasto.map((c) => c.gasto), 1);
  const lista = (lado === "altas" ? p.altas : p.quedas) ?? [];
  const chave = (s: { produto: string; unidade: string; fornecedor?: string }) => `${s.produto}|${s.unidade}|${s.fornecedor ?? ""}`;

  return (
    <div className="ip">
      <div className="ip-cabeca">
        <div>
          <span className="es-sobre">Compras · últimos 12 meses</span>
          <h2>Índice de preços</h2>
          <p className="muted">Todas as compras das notas (Cicchetti Management e SEFAZ), item a item. Atualizado {new Date(p.atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.</p>
        </div>
        <button className="ghost small" disabled={carregando} onClick={carregar}>{carregando ? "Calculando…" : "Atualizar"}</button>
      </div>

      <div className="ip-numeros">
        <div className="ip-numero">
          <span className="ip-rotulo">Índice geral</span>
          <span className="ip-valor">{geral[geral.length - 1]?.toLocaleString("pt-BR", { minimumFractionDigits: 1 }) ?? "—"}</span>
          <span className={`ip-var ${ultimoGeral && ultimoGeral.variacao > 0 ? "sobe" : "desce"}`}>{ultimoGeral ? `${pctTxt(ultimoGeral.variacao)} no mês` : ""}</span>
          <Faisca valores={geral.filter((v): v is number => v != null)} alta={(ultimoGeral?.variacao ?? 0) > 0} />
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Gasto em {gastoAtual ? mesCurto(gastoAtual.mes) : "—"}</span>
          <span className="ip-valor">{gastoAtual ? mil(gastoAtual.gasto) : "—"}</span>
          <span className="ip-var neutro">{varGasto != null ? `${pctTxt(varGasto)} sobre o mês anterior` : ""}</span>
          <Faisca valores={gastos.map((g) => g.gasto)} alta={(varGasto ?? 0) > 0} />
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Itens que subiram</span>
          <span className="ip-valor">{p.altas?.length ?? 0}</span>
          <span className="ip-var sobe">10% ou mais na última compra</span>
        </div>
        <div className="ip-numero">
          <span className="ip-rotulo">Acompanhados</span>
          <span className="ip-valor">{p.produtos.toLocaleString("pt-BR")}</span>
          <span className="ip-var neutro">produtos de {p.fornecedores} fornecedores em 90 dias</span>
        </div>
      </div>

      <div className="ip-grade">
        <section className="ip-cartao ip-largo">
          <header className="ip-cartao-cabeca">
            <div><h3>Índice mensal</h3><p className="muted">A mesma cesta de itens de um mês para o outro · primeiro mês = 100</p></div>
            <button className="ghost small" onClick={() => setTabela((t) => !t)}>{tabela ? "Ver gráfico" : "Ver tabela"}</button>
          </header>
          <div className="ft-chips ip-chips" role="group" aria-label="Categorias no gráfico">
            {CATEGORIAS.map((c, i) => (
              <button key={c} aria-pressed={cats.includes(c)} className={cats.includes(c) ? "on" : ""} onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}>
                <i style={{ background: `var(--serie-${i + 1})` }} />{c}
              </button>
            ))}
          </div>
          {tabela ? (
            <div className="nf-tabela-wrap">
              <table className="nf-tabela ip-tabela">
                <thead><tr><th>Mês</th><th className="n">Geral</th>{CATEGORIAS.map((c) => <th key={c} className="n">{c}</th>)}<th className="n">Itens comparados</th></tr></thead>
                <tbody>
                  {meses.map((m, i) => (
                    <tr key={m}>
                      <td>{mesCurto(m)}</td>
                      <td className="n"><strong>{geral[i]?.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}</strong></td>
                      {CATEGORIAS.map((c) => <td key={c} className="n">{serie(c)[i]?.toLocaleString("pt-BR", { minimumFractionDigits: 1 }) ?? "—"}</td>)}
                      <td className="n">{(p.indice ?? []).find((x) => x.serie === "Geral" && x.mes === m)?.itens ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <GraficoLinhas rotulos={meses.map(mesCurto)} base={100}
              series={[{ nome: "Geral", cor: "var(--strong)", pontos: geral, destaque: true },
                ...cats.map((c) => ({ nome: c, cor: `var(--serie-${CATEGORIAS.indexOf(c) + 1})`, pontos: serie(c) }))]} />
          )}
        </section>

        <section className="ip-cartao">
          <header className="ip-cartao-cabeca"><div><h3>Gasto por categoria</h3><p className="muted">neste mês</p></div></header>
          <ul className="ip-barras">
            {catGasto.slice(0, 9).map((c) => (
              <li key={c.categoria}>
                <span className="ip-barras-nome">{c.categoria}</span>
                <span className="ip-barras-trilho"><span style={{ width: `${(c.gasto / maxCat) * 100}%` }} /></span>
                <span className="ip-barras-valor">{mil(c.gasto)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="ip-cartao ip-largo">
          <header className="ip-cartao-cabeca"><div><h3>Gasto por mês</h3><p className="muted">soma de todas as compras das notas</p></div></header>
          <GraficoBarras rotulos={gastos.map((g) => mesCurto(g.mes))} valores={gastos.map((g) => g.gasto)} formato={mil} />
        </section>

        <section className="ip-cartao">
          <header className="ip-cartao-cabeca"><div><h3>Procurar um produto</h3><p className="muted">preço pago em cada compra, por fornecedor</p></div></header>
          <input type="search" className="ip-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: limão, mussarela, picanha" aria-label="Procurar produto" />
          {achados && !achados.length && <p className="muted">Nada encontrado.</p>}
          {achados && achados.length > 0 && <p className="muted ip-dica">Clique num resultado para ver o histórico.</p>}
        </section>
      </div>

      {achados && achados.length > 0 && (
        <section className="ip-cartao ip-sinais">
          <header className="ip-cartao-cabeca"><div><h3>Resultados para “{busca.trim()}”</h3><p className="muted">{achados.length} produtos</p></div></header>
          <ul className="ip-lista">
            {achados.map((a) => {
              const k = chave(a);
              const v90 = a.primeiro_90 ? (a.ultimo / a.primeiro_90 - 1) * 100 : null;
              return (
                <li key={k} className={aberto === k ? "aberto" : ""}>
                  <button className="ip-linha" onClick={() => setAberto(aberto === k ? null : k)} aria-expanded={aberto === k}>
                    <span className="ip-linha-nome"><strong>{titulo(a.produto)}</strong><small>{a.categoria} · {a.compras} compras · {a.fornecedores} {a.fornecedores === 1 ? "fornecedor" : "fornecedores"}</small></span>
                    <span className="ip-linha-preco"><strong>{brl(a.ultimo)}</strong><small>/{a.unidade || "un"} em {dia(a.ultima)}</small></span>
                    <span className={`ip-selo ${v90 == null ? "" : v90 > 0 ? "sobe" : "desce"}`}>{v90 == null ? "—" : `${pctTxt(v90)} em 90 dias`}</span>
                    <span className="ip-seta" aria-hidden="true" />
                  </button>
                  {aberto === k && <Detalhe produto={a.produto} unidade={a.unidade} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="ip-cartao ip-sinais">
        <header className="ip-cartao-cabeca">
          <div><h3>Alertas de preço</h3><p className="muted">a última compra de cada item, por fornecedor, contra a média das compras anteriores (120 dias)</p></div>
          <div className="ft-chips" role="tablist" aria-label="Alta ou queda">
            <button role="tab" aria-selected={lado === "altas"} className={lado === "altas" ? "on" : ""} onClick={() => setLado("altas")}>Subiram<span>{p.altas?.length ?? 0}</span></button>
            <button role="tab" aria-selected={lado === "quedas"} className={lado === "quedas" ? "on" : ""} onClick={() => setLado("quedas")}>Caíram<span>{p.quedas?.length ?? 0}</span></button>
          </div>
        </header>
        {!lista.length ? <p className="muted">Nenhum item {lado === "altas" ? "subiu" : "caiu"} 10% ou mais nos últimos 30 dias.</p> : (
          <ul className="ip-lista">
            {lista.map((s) => {
              const k = chave(s);
              return (
                <li key={k} className={aberto === k ? "aberto" : ""}>
                  <button className="ip-linha" onClick={() => setAberto(aberto === k ? null : k)} aria-expanded={aberto === k}>
                    <span className="ip-linha-nome"><strong>{titulo(s.produto)}</strong><small>{titulo(s.fornecedor)} · {s.categoria}</small></span>
                    <Faisca valores={s.faisca ?? []} alta={s.pct > 0} />
                    <span className="ip-linha-preco"><strong>{brl(s.preco)}</strong><small>/{s.unidade || "un"} · média {brl(s.media)}</small></span>
                    <span className={`ip-selo ${s.pct > 0 ? "sobe" : "desce"}`}>{pctTxt(s.pct)}</span>
                    <span className="ip-seta" aria-hidden="true" />
                  </button>
                  {aberto === k && <Detalhe produto={s.produto} unidade={s.unidade} fornecedor={s.fornecedor} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Histórico de um produto: gráfico de cada compra e a comparação entre fornecedores
function Detalhe({ produto, unidade, fornecedor }: { produto: string; unidade: string; fornecedor?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<{ compras: Compra[] | null; fornecedores: Fornecedor[] | null } | null>(null);
  useEffect(() => {
    supabase.rpc("precos_serie", { p_produto: produto, p_unidade: unidade }).then(({ data }) => setD((data ?? { compras: [], fornecedores: [] }) as typeof d));
  }, [supabase, produto, unidade]);
  if (!d) return <div className="ip-detalhe"><p className="muted">Carregando o histórico…</p></div>;
  const compras = (d.compras ?? []).map((c) => ({ ...c, fornecedor: titulo(c.fornecedor), preco: Number(c.preco), quantidade: Number(c.quantidade) }));
  const forn = d.fornecedores ?? [];
  const menor = Math.min(...forn.map((f) => Number(f.medio)));
  return (
    <div className="ip-detalhe">
      <GraficoPrecos compras={compras} unidade={unidade} />
      {forn.length > 0 && (
        <div className="nf-tabela-wrap">
          <table className="nf-tabela ip-tabela">
            <thead><tr><th>Fornecedor</th><th className="n">Compras</th><th className="n">Preço médio</th><th className="n">Menor</th><th className="n">Último</th><th>Última compra</th></tr></thead>
            <tbody>
              {forn.map((f) => (
                <tr key={f.fornecedor} className={fornecedor && f.fornecedor === fornecedor ? "ip-destaque" : ""}>
                  <td><strong>{titulo(f.fornecedor)}</strong>{Number(f.medio) === menor && forn.length > 1 && <small className="ip-melhor">menor preço médio</small>}</td>
                  <td className="n">{f.compras}</td>
                  <td className="n">{brl(f.medio)}</td>
                  <td className="n">{brl(f.menor)}</td>
                  <td className="n">{brl(f.ultimo)}</td>
                  <td>{dia(f.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
