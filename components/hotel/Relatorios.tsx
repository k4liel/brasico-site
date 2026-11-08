"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Painel, Vazio, moeda, num } from "./ui";

// Relatórios extras do PMS (aba Relatórios da página /hoteis/<hotel>): o resultado inteiro de cada relatório que o robô
// lê (pms_relatorios_config → pms_relatorio_dados): contas em aberto, governança, tarifas, cancelamentos, POS...
// Retratos ("foto") têm um por dia; os mensais, um por mês. Tabela com busca, ordem, totais e planilha.

type Config = { chave: number; nome: string; area: string; modo: "foto" | "mensal"; intervalo_min: number; descricao: string | null; ordem: number };
type Indice = { chave: number; ini: string; fim: string; n: number | null; erro: string | null; lido_em: string };
type Coluna = { nome: string | null; tipo: string | null };
type Dados = Indice & { colunas: Coluna[] | null; linhas: unknown[][] | null };

const AREAS: Record<string, string> = { contas: "Contas em aberto", governanca: "Governança", tarifas: "Tarifas e orçamento", reservas: "Reservas",
  consumo: "Consumo (pontos de venda)", producao: "Produção" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const quando = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ehNumero = (t: string | null) => /Float|Decimal|Integer|Number/i.test(t ?? "");
const ehData = (t: string | null) => /Date|Time/i.test(t ?? "");
const ehDinheiro = (c: Coluna) => ehNumero(c.tipo) && !/Integer/i.test(c.tipo ?? "") && /valor|saldo|total|receita|di[aá]ria|pre[cç]o|cr[eé]dito|d[eé]bito|tarifa|pago|faturar|adiant|dep[oó]sito|comiss/i.test(c.nome ?? "");
function mostrar(v: unknown, c: Coluna) {
  if (v == null || v === "") return "—";
  if (ehNumero(c.tipo) && typeof v === "number") return ehDinheiro(c) ? moeda(v) : num(v, Number.isInteger(v) ? 0 : 2);
  if (ehData(c.tipo) && typeof v === "string") { const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/); if (m) return `${dataBr(m[1])}${m[2] && m[2] !== "00:00" ? ` ${m[2]}` : ""}`; }
  return String(v);
}
const sem = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function planilha(d: Dados, nome: string) {
  const cols = d.colunas ?? [];
  const e = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = (d.linhas ?? []).map((l) => l.map((v, i) => (typeof v === "number" && ehNumero(cols[i]?.tipo) ? String(v).replace(".", ",") : v)).map(e).join(";"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [cols.map((c) => e(c.nome)).join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function Relatorios({ hotel, nome }: { hotel: string; nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [config, setConfig] = useState<Config[] | null>(null);
  const [indice, setIndice] = useState<Indice[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [dados, setDados] = useState<Dados | null | undefined>(undefined);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ i: number; desc: boolean } | null>(null);
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    (async () => {
      const [c, d] = await Promise.all([
        supabase.from("pms_relatorios_config").select("chave,nome,area,modo,intervalo_min,descricao,ordem").eq("ativo", true).order("ordem"),
        supabase.from("pms_relatorio_dados").select("chave,ini,fim,n,erro,lido_em").eq("hotel_id", hotel).order("ini", { ascending: false }).limit(5000),
      ]);
      const cfg = (c.data as Config[]) ?? [];
      setConfig(cfg); setIndice((d.data as Indice[]) ?? []);
      setSel((s) => s ?? cfg[0]?.chave ?? null);
    })();
  }, [supabase, hotel]);

  const atual = config?.find((c) => c.chave === sel) ?? null;
  const periodos = useMemo(() => indice.filter((x) => x.chave === sel).sort((a, b) => b.ini.localeCompare(a.ini)), [indice, sel]);
  useEffect(() => { setPeriodo(periodos.find((p) => !p.erro || p.n != null)?.ini ?? periodos[0]?.ini ?? null); setBusca(""); setOrdem(null); setPagina(0); }, [sel, periodos]);

  useEffect(() => {
    setDados(undefined);
    if (sel == null || !periodo) { setDados(null); return; }
    supabase.from("pms_relatorio_dados").select("*").eq("hotel_id", hotel).eq("chave", sel).eq("ini", periodo).order("fim", { ascending: false }).limit(1).maybeSingle()
      .then((r) => setDados((r.data as Dados) ?? null));
  }, [supabase, hotel, sel, periodo]);

  const cols = dados?.colunas ?? [];
  const linhas = useMemo(() => {
    const b = sem(busca.trim());
    let l = (dados?.linhas ?? []).filter((r) => !b || r.some((v) => v != null && sem(String(v)).includes(b)));
    if (ordem) l = [...l].sort((a, z) => {
      const x = a[ordem.i], y = z[ordem.i];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "pt-BR", { numeric: true });
      return ordem.desc ? -c : c;
    });
    return l;
  }, [dados, busca, ordem]);
  const totais = useMemo(() => cols.map((c, i) => (ehNumero(c.tipo) && !/id$|c[oó]digo|n[uú]mero|^uh$|ano|m[eê]s|dia$/i.test(c.nome ?? "") ? linhas.reduce((a, r) => a + (typeof r[i] === "number" ? (r[i] as number) : 0), 0) : null)), [cols, linhas]);
  const POR = 100, paginas = Math.max(1, Math.ceil(linhas.length / POR));
  const vis = linhas.slice(pagina * POR, (pagina + 1) * POR);

  const porArea = useMemo(() => {
    const m = new Map<string, Config[]>();
    for (const c of config ?? []) m.set(c.area, [...(m.get(c.area) ?? []), c]);
    return [...m.entries()];
  }, [config]);
  const ultimo = (chave: number) => indice.filter((x) => x.chave === chave).sort((a, b) => b.lido_em.localeCompare(a.lido_em))[0];
  const rotuloPeriodo = (p: Indice) => (atual?.modo === "foto" ? dataBr(p.ini) : `${MESES[+p.ini.slice(5, 7) - 1]}/${p.ini.slice(0, 4)}`);

  if (config === null) return <div className="hx-carregando"><i /><i /></div>;
  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo"><h2>Relatórios do PMS</h2></div>
      <div className="hx-relatorios">
        <nav className="hx-rel-lista" aria-label="Relatórios">
          {porArea.map(([area, l]) => (
            <div key={area}>
              <span className="hx-sobre">{AREAS[area] ?? area}</span>
              {l.map((c) => {
                const u = ultimo(c.chave);
                return (
                  <button key={c.chave} type="button" className={sel === c.chave ? "on" : ""} onClick={() => setSel(c.chave)}>
                    <b>{c.nome}</b>
                    <small>{!u ? "ainda não lido" : u.erro && u.n == null ? "erro na leitura" : `${c.modo === "foto" ? "retrato" : "mensal"} · ${quando(u.lido_em)}`}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="hx-rel-conteudo">
          {!atual ? <Vazio>Escolha um relatório.</Vazio> : (
            <Painel titulo={atual.nome} sub={atual.descricao ?? undefined}
              acoes={dados?.linhas?.length ? <button type="button" className="hx-botao" onClick={() => planilha(dados, `${atual.nome}-${nome}-${periodo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}>Baixar planilha</button> : undefined}>
              {periodos.length === 0 ? <Vazio>O robô ainda não leu este relatório. Ele traz {atual.modo === "foto" ? "o retrato de hoje" : "o mês atual e os anteriores"} nas próximas rodadas.</Vazio> : (
                <>
                  <div className="hx-filtros">
                    <select className="hx-select" value={periodo ?? ""} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
                      {periodos.map((p) => <option key={p.ini + p.fim} value={p.ini}>{rotuloPeriodo(p)}{p.erro && p.n == null ? " (erro)" : ` · ${num(p.n ?? 0)} linhas`}</option>)}
                    </select>
                    <input type="search" className="hx-busca" placeholder="Buscar em todas as colunas…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
                    {dados && <span className="hx-legenda-mini">Lido do PMS em {quando(dados.lido_em)}</span>}
                  </div>
                  {dados === undefined ? <p className="muted">Carregando…</p> : !dados ? <Vazio>Sem dados neste período.</Vazio> : dados.erro && !dados.linhas ? (
                    <Vazio>O PMS não devolveu este relatório: {dados.erro}. O robô tenta de novo nas próximas rodadas.</Vazio>
                  ) : linhas.length === 0 ? <Vazio>{busca ? "Nada encontrado com essa busca." : "O relatório veio vazio neste período."}</Vazio> : (
                    <>
                      <div className="hx-rolagem">
                        <table className="hx-tabela">
                          <thead><tr>{cols.map((c, i) => (
                            <th key={i} className={ehNumero(c.tipo) ? "num" : ""} onClick={() => setOrdem((o) => (o?.i === i ? { i, desc: !o.desc } : { i, desc: ehNumero(c.tipo) }))} style={{ cursor: "pointer" }}>
                              {c.nome}{ordem?.i === i ? (ordem.desc ? " ▼" : " ▲") : ""}
                            </th>
                          ))}</tr></thead>
                          <tbody>{vis.map((r, k) => <tr key={k}>{cols.map((c, i) => <td key={i} className={ehNumero(c.tipo) ? "num" : ""}>{mostrar(r[i], c)}</td>)}</tr>)}</tbody>
                          {totais.some((t) => t != null) && (
                            <tfoot><tr>{cols.map((c, i) => <td key={i} className={`num hx-forte`}>{i === 0 && totais[0] == null ? `Total (${num(linhas.length)})` : totais[i] == null ? "" : ehDinheiro(c) ? moeda(totais[i]!) : num(totais[i]!, 2)}</td>)}</tr></tfoot>
                          )}
                        </table>
                      </div>
                      {paginas > 1 && (
                        <div className="hx-paginas">
                          <button type="button" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
                          <span>Página {pagina + 1} de {paginas} · {num(linhas.length)} linhas</span>
                          <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </Painel>
          )}
        </div>
      </div>
      <p className="hx-fonte">Relatórios do próprio PMS, lidos pelo robô: retratos (contas, governança) a cada 30 min a 3 h; mensais com o mês atual a cada 2 a 6 h e o passado aos poucos. Para incluir outro relatório do PMS, é só pedir.</p>
    </div>
  );
}
