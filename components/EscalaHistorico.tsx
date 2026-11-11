"use client";

// Histórico da escala (11/11/2026, pedido do dono: "para termos um controle"). Só sócios. Mostra cada mudança
// feita na escala (dia a dia), no banco de compensas e nos apelidos: quem mexeu, quando, em quem e o antes → depois.
// Dados: escala_historico (supabase/escala_historico.sql). Botão no canto da barra da escala, ao lado de Compensas.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Gaveta from "./Gaveta";
import { CODIGOS } from "@/lib/escala/regras";

type Tipo = "escala" | "compensa" | "apelido";
type Item = {
  tipo: Tipo; id: number; em: string; por: string | null; quem: string; cliente_id: number; pessoa_id: number;
  pessoa: string; local: string | null; setor: string | null; dia: string | null;
  antes: Record<string, unknown> | string | null; depois: Record<string, unknown> | string | null;
};
type Usuario = { id: string | null; nome: string; n: number; socio: boolean };
type Resp = { de: string; ate: string; usuarios: Usuario[]; itens: Item[] };

const LIMITE = 5000;
const FUSO = "America/Fortaleza";
const hojeFortaleza = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO });
const menos = (d: string, n: number) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaBr = (d: string) => `${SEMANA[new Date(d + "T12:00:00Z").getUTCDay()]} ${br(d)}`;
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: FUSO });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const NOME_COD = new Map(CODIGOS.map((c) => [c.codigo as string, c.nome]));
const PERIODOS: [number, string][] = [[0, "Hoje"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];

type Dia = { codigo?: string | null; entrada?: string | null; saida?: string | null; posto?: string | null };
function celula(v: unknown): string {
  const d = (v && typeof v === "object" ? v : {}) as Dia;
  const c = d.codigo ?? "";
  if (!c) return "sem escala";
  if (c === "T") return `${d.entrada ?? "?"}–${d.saida ?? "?"}${d.posto ? ` (${d.posto})` : ""}`;
  return NOME_COD.get(c) ?? c;
}

type Comp = { origem?: string; feriado?: string | null; motivo?: string | null; situacao?: string; usada_dia?: string | null; retroativo?: boolean };
function qualCompensa(c: Comp) {
  return c.origem === "feriado" && c.feriado ? `do feriado ${br(c.feriado)}` : `de saldo antigo${c.motivo ? ` (${c.motivo.replace(" (cancelado)", "")})` : ""}`;
}
function textoCompensa(a: Comp | null, d: Comp): string {
  if (!a) {
    if (d.origem === "feriado") return d.situacao === "cancelada" ? `Marcou que não trabalhou no feriado ${d.feriado ? br(d.feriado) : ""}` : `Marcou que trabalhou no feriado ${d.feriado ? br(d.feriado) : ""} (+1 compensa)`;
    return `Lançou 1 compensa de saldo antigo${d.motivo ? ` (${d.motivo})` : ""}`;
  }
  if (a.situacao !== d.situacao) {
    if (d.situacao === "usada") return `Deu a compensa ${qualCompensa(d)} na folga de ${d.usada_dia ? diaBr(d.usada_dia) : "?"}`;
    if (a.situacao === "usada" && d.situacao === "aberta") return `Devolveu a compensa ${qualCompensa(d)} (tirou a FC de ${a.usada_dia ? diaBr(a.usada_dia) : "?"})`;
    if (d.situacao === "cancelada") return d.motivo === "não trabalhou" ? `Mudou para “não trabalhou” no feriado ${d.feriado ? br(d.feriado) : ""}` : `Cancelou a compensa ${qualCompensa(d)}`;
    if (d.situacao === "aberta") return `Reabriu a compensa ${qualCompensa(d)} (trabalhou no feriado)`;
  }
  if (a.usada_dia !== d.usada_dia) return `Trocou a folga da compensa ${qualCompensa(d)}: ${a.usada_dia ? diaBr(a.usada_dia) : "—"} → ${d.usada_dia ? diaBr(d.usada_dia) : "—"}`;
  return `Alterou a compensa ${qualCompensa(d)}`;
}

function descrever(i: Item): { titulo: string; antes?: string; depois?: string; obs?: string } {
  if (i.tipo === "escala") return { titulo: i.dia ? diaBr(i.dia) : "Escala", antes: celula(i.antes), depois: celula(i.depois) };
  if (i.tipo === "apelido") return { titulo: "Apelido", antes: (i.antes as string) || "sem apelido", depois: (i.depois as string) || "sem apelido" };
  const d = (i.depois ?? {}) as Comp;
  return { titulo: textoCompensa(i.antes as Comp | null, d), obs: d.retroativo ? "registrado antes de existir o histórico" : undefined };
}

function planilha(itens: Item[]) {
  const e = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["Data", "Hora", "Quem mexeu", "Tipo", "Pessoa", "Casa", "Setor", "O quê", "Antes", "Depois"];
  const linhas = itens.map((i) => { const t = descrever(i); return [br(diaDe(i.em)) + "/" + diaDe(i.em).slice(0, 4), horaDe(i.em), i.quem,
    i.tipo === "escala" ? "Escala" : i.tipo === "compensa" ? "Compensa" : "Apelido", i.pessoa, i.local, i.setor, t.titulo, t.antes, t.depois].map(e).join(";"); });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [cab.map(e).join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `historico-escala-${hojeFortaleza()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function EscalaHistorico({ supabase, local }: { supabase: SupabaseClient; local: string }) {
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState(7);
  const [resp, setResp] = useState<Resp | null>(null);
  const [erro, setErro] = useState("");
  const [lendo, setLendo] = useState(false);
  const [quem, setQuem] = useState("");          // "" = todos; "_lideres" = quem não é sócio; senão o id
  const [tipo, setTipo] = useState<"" | Tipo>("");
  const [busca, setBusca] = useState("");
  const [soCasa, setSoCasa] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setLendo(true); setErro("");
    const hoje = hojeFortaleza();
    supabase.rpc("escala_historico", { p_de: menos(hoje, dias), p_ate: hoje, p_limite: LIMITE }).then(({ data, error }) => {
      if (!vivo) return;
      setLendo(false);
      if (error) { setErro(error.message); return; }
      setResp(data as Resp);
    });
    return () => { vivo = false; };
  }, [aberto, dias, supabase]);

  const socios = useMemo(() => new Set((resp?.usuarios ?? []).filter((u) => u.socio).map((u) => u.id)), [resp]);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (resp?.itens ?? []).filter((i) =>
      (!soCasa || !local || i.local === local)
      && (!tipo || i.tipo === tipo)
      && (!quem || (quem === "_lideres" ? !socios.has(i.por) : i.por === quem))
      && (!b || `${i.pessoa} ${i.setor ?? ""}`.toLowerCase().includes(b)));
  }, [resp, busca, tipo, quem, socios, soCasa, local]);
  const porDia = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of lista.slice(0, 1500)) { const d = diaDe(i.em); m.set(d, [...(m.get(d) ?? []), i]); }
    return [...m.entries()];
  }, [lista]);
  const pessoas = new Set(lista.map((i) => `${i.cliente_id}:${i.pessoa_id}`)).size;
  const quemMexeu = new Set(lista.map((i) => i.por)).size;

  return (
    <>
      <button className="ep-icone-botao" onClick={() => setAberto(true)} title="Histórico: quem mudou o quê na escala e nas compensas">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
        Histórico
      </button>

      {aberto && (
        <Gaveta titulo="Histórico da escala" sub="Cada mudança na escala, nas compensas e nos apelidos: quem mexeu, quando e o antes → depois. Só os sócios veem." fechar={() => setAberto(false)}
          topo={
            <>
              <div className="cmp-numeros">
                <div><span>Mudanças</span><b>{lista.length}</b></div>
                <div><span>Pessoas</span><b>{pessoas}</b><small>na escala</small></div>
                <div><span>Quem mexeu</span><b>{quemMexeu}</b><small>usuários</small></div>
                <div><span>Período</span><b className="eh-periodo">{resp ? (dias === 0 ? "hoje" : `${br(resp.de)}–${br(resp.ate)}`) : "…"}</b></div>
              </div>
              <div className="eh-filtros">
                <div className="eh-chips" role="group" aria-label="Período">
                  {PERIODOS.map(([n, t]) => <button key={n} className={dias === n ? "on" : ""} onClick={() => setDias(n)}>{t}</button>)}
                </div>
                <select value={quem} onChange={(e) => setQuem(e.target.value)} aria-label="Quem mexeu">
                  <option value="">Todos os usuários</option>
                  <option value="_lideres">Só líderes (não sócios)</option>
                  {(resp?.usuarios ?? []).map((u) => <option key={u.id ?? "x"} value={u.id ?? ""}>{u.nome}{u.socio ? " (sócio)" : ""} · {u.n}</option>)}
                </select>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | Tipo)} aria-label="Tipo">
                  <option value="">Escala, compensas e apelidos</option>
                  <option value="escala">Só a escala</option>
                  <option value="compensa">Só as compensas</option>
                  <option value="apelido">Só os apelidos</option>
                </select>
                <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou setor" />
                {local && <label className="eh-casa"><input type="checkbox" checked={soCasa} onChange={(e) => setSoCasa(e.target.checked)} /> Só {local}</label>}
                <button className="ghost small" disabled={!lista.length} onClick={() => planilha(lista)}>Planilha</button>
              </div>
            </>
          }>
          {erro && <p className="tv-alerta">{erro}</p>}
          {lendo && !resp && <p className="cmp-vazio">Lendo o histórico…</p>}
          {resp && resp.itens.length >= LIMITE && <p className="tv-alerta">Mostrando as {LIMITE} mudanças mais novas do período. Escolha um período menor para ver as mais antigas.</p>}
          {resp && !lista.length && <p className="cmp-vazio">Nenhuma mudança {quem || tipo || busca ? "com esses filtros" : "neste período"}.</p>}
          {lista.length > 1500 && <p className="muted small">Na tela, as 1.500 mais novas; a planilha leva todas as {lista.length}.</p>}
          {porDia.map(([d, itens]) => (
            <section key={d} className="eh-dia">
              <h3>{d === hojeFortaleza() ? "Hoje" : diaBr(d)} <span>{itens.length} {itens.length === 1 ? "mudança" : "mudanças"}</span></h3>
              <ul>
                {itens.map((i) => {
                  const t = descrever(i);
                  return (
                    <li key={`${i.tipo}${i.id}`} className={`eh-item t-${i.tipo}`}>
                      <span className="eh-hora">{horaDe(i.em)}</span>
                      <span className="eh-texto">
                        <span className="eh-linha1"><b className={socios.has(i.por) ? "eh-quem socio" : "eh-quem"}>{i.quem}</b> <span className="eh-tipo">{i.tipo === "escala" ? "escala" : i.tipo === "compensa" ? "compensa" : "apelido"}</span> · <b>{i.pessoa}</b> <small>{[i.local, i.setor].filter(Boolean).join(" · ")}</small></span>
                        <span className="eh-linha2">
                          {t.antes !== undefined
                            ? <>{t.titulo}: <s>{t.antes}</s> → <b>{t.depois}</b></>
                            : t.titulo}
                          {t.obs && <small> · {t.obs}</small>}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Gaveta>
      )}
    </>
  );
}
