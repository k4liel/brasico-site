"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Estadia, STATUS, antecedencia, canalNome, dataBr, faseDe, hojeFortaleza, inteiro, nomeStatus, reais, somaDias, todas,
} from "@/lib/hotel-reservas";

// Reservas do hotel para análise (aba Reservas da página /hoteis/<hotel>): todas as estadias do PMS (pms_estadias)
// com o canal e o valor das diárias quando vieram por canal integrado (pms_reservas), filtros, indicadores,
// quebras por status, canal e tipo de UH, e a lista completa com planilha.

type Base = "chegada" | "saida" | "estadia" | "criacao";
type Atalho = "7d" | "30d" | "mes" | "prox30" | "ano" | "livre";

const BASES: [Base, string][] = [["chegada", "Chegada"], ["estadia", "Hospedados"], ["saida", "Saída"], ["criacao", "Feitas"]];
const ORDENS = { chegada: "Chegada", criada: "Criação", valor: "Valor", noites: "Noites" } as const;

function intervaloDe(a: Atalho, hoje: string): [string, string] {
  if (a === "7d") return [somaDias(hoje, -6), hoje];
  if (a === "30d") return [somaDias(hoje, -29), hoje];
  if (a === "mes") return [`${hoje.slice(0, 7)}-01`, new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7), 0)).toISOString().slice(0, 10)];
  if (a === "prox30") return [hoje, somaDias(hoje, 29)];
  return [`${hoje.slice(0, 4)}-01-01`, `${hoje.slice(0, 4)}-12-31`];
}

function planilha(linhas: Estadia[], nome: string) {
  const cab = ["Código", "Hóspede principal", "UH", "Tipo de UH", "Chegada", "Saída", "Noites", "Adultos", "Crianças", "Status", "Canal", "Tarifa", "Valor das diárias", "Criada em", "Cancelada em"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const corpo = linhas.map((e) => [e.codigo, e.hospede, e.uh_numero, e.tipo, e.checkin, e.checkout, e.noites, e.adultos, e.criancas, nomeStatus(e), canalNome(e),
    e.tarifa, e.valor_diarias?.toString().replace(".", ","), e.criada_em?.slice(0, 10), e.cancelada_em?.slice(0, 10)].map(esc).join(";"));
  const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...corpo].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${nome}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function HotelReservas({ hotel, nome }: { hotel: string; nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = hojeFortaleza();
  const [atalho, setAtalho] = useState<Atalho>("mes");
  const [[ini, fim], setIntervalo] = useState<[string, string]>(() => intervaloDe("mes", hojeFortaleza()));
  const [base, setBase] = useState<Base>("chegada");
  const [todasEst, setTodasEst] = useState<Estadia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<Set<number>>(new Set());
  const [canal, setCanal] = useState("");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<keyof typeof ORDENS>("chegada");
  const [pagina, setPagina] = useState(0);

  function escolherAtalho(a: Atalho) {
    setAtalho(a);
    if (a !== "livre") setIntervalo(intervaloDe(a, hoje));
  }

  // Lê as estadias que tocam o intervalo pela base escolhida
  useEffect(() => {
    setTodasEst(null); setPagina(0);
    (async () => {
      try {
        const l = await todas<Estadia>((de, ate) => {
          let q = supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel);
          if (base === "chegada") q = q.gte("checkin", ini).lte("checkin", fim);
          else if (base === "saida") q = q.gte("checkout", ini).lte("checkout", fim);
          else if (base === "estadia") q = q.lte("checkin", fim).gt("checkout", ini);
          else q = q.gte("criada_em", `${ini}T00:00:00-03:00`).lte("criada_em", `${fim}T23:59:59-03:00`);
          return q.order("checkin").range(de, ate);
        });
        setTodasEst(l); setErro(null);
      } catch (e) { setErro(e instanceof Error ? e.message : "erro"); setTodasEst([]); }
    })();
  }, [supabase, hotel, ini, fim, base]);

  const opcoesCanal = useMemo(() => [...new Set((todasEst ?? []).map(canalNome))].sort(), [todasEst]);
  const opcoesTipo = useMemo(() => [...new Set((todasEst ?? []).map((e) => e.tipo ?? "—"))].sort(), [todasEst]);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (todasEst ?? []).filter((e) =>
      (!status.size || status.has(e.status_id ?? -1)) && (!canal || canalNome(e) === canal) && (!tipo || (e.tipo ?? "—") === tipo) &&
      (!b || [e.hospede, e.codigo, e.uh_numero, e.grupo_nome, e.empresa].some((v) => (v ?? "").toLowerCase().includes(b))));
  }, [todasEst, status, canal, tipo, busca]);

  // Indicadores (canceladas e no-show contam à parte)
  const ind = useMemo(() => {
    const val = filtradas.filter((e) => e.status_id !== 5 && e.status_id !== 6);
    const comValor = val.filter((e) => e.valor_diarias != null);
    const noites = val.reduce((a, e) => a + (e.noites ?? 0), 0);
    const ant = val.map(antecedencia).filter((v): v is number => v != null && v >= 0);
    return {
      total: filtradas.length, validas: val.length, noites,
      hospedes: val.reduce((a, e) => a + (e.adultos ?? 0) + (e.criancas ?? 0), 0),
      valor: comValor.reduce((a, e) => a + Number(e.valor_diarias), 0), comValor: comValor.length,
      diaria: comValor.reduce((a, e) => a + (e.noites ?? 0), 0) ? comValor.reduce((a, e) => a + Number(e.valor_diarias), 0) / comValor.reduce((a, e) => a + (e.noites ?? 0), 0) : null,
      estadia: val.length ? noites / val.length : null,
      antecedencia: ant.length ? ant.reduce((a, v) => a + v, 0) / ant.length : null,
      canceladas: filtradas.filter((e) => e.status_id === 6).length,
      noshow: filtradas.filter((e) => e.status_id === 5).length,
    };
  }, [filtradas]);

  const porStatus = useMemo(() => Object.entries(STATUS).map(([id, s]) => ({ id: +id, ...s, n: filtradas.filter((e) => e.status_id === +id).length }))
    .filter((x) => x.n > 0), [filtradas]);
  const agrupar = (chave: (e: Estadia) => string) => {
    const m = new Map<string, { n: number; noites: number; valor: number; comValor: number }>();
    for (const e of filtradas) {
      if (e.status_id === 5 || e.status_id === 6) continue;
      const k = chave(e); const x = m.get(k) ?? { n: 0, noites: 0, valor: 0, comValor: 0 };
      x.n++; x.noites += e.noites ?? 0;
      if (e.valor_diarias != null) { x.valor += Number(e.valor_diarias); x.comValor += e.noites ?? 0; }
      m.set(k, x);
    }
    return [...m.entries()].map(([k, x]) => ({ k, ...x, diaria: x.comValor ? x.valor / x.comValor : null })).sort((a, b) => b.n - a.n);
  };
  const porCanal = useMemo(() => agrupar(canalNome), [filtradas]); // eslint-disable-line react-hooks/exhaustive-deps
  const porTipo = useMemo(() => agrupar((e) => e.tipo ?? "—"), [filtradas]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordenadas = useMemo(() => {
    const l = [...filtradas];
    if (ordem === "chegada") l.sort((a, b) => (a.checkin ?? "").localeCompare(b.checkin ?? "") || (a.uh_numero ?? "").localeCompare(b.uh_numero ?? "", "pt-BR", { numeric: true }));
    if (ordem === "criada") l.sort((a, b) => (b.criada_em ?? "").localeCompare(a.criada_em ?? ""));
    if (ordem === "valor") l.sort((a, b) => Number(b.valor_diarias ?? -1) - Number(a.valor_diarias ?? -1));
    if (ordem === "noites") l.sort((a, b) => (b.noites ?? 0) - (a.noites ?? 0));
    return l;
  }, [filtradas, ordem]);
  const POR_PAG = 50;
  const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAG));
  const vis = ordenadas.slice(pagina * POR_PAG, pagina * POR_PAG + POR_PAG);
  const maxStatus = Math.max(1, ...porStatus.map((s) => s.n));

  return (
    <div className="rv">
      <div className="rv-filtros tp-painel">
        <div className="rv-linha">
          <div className="tp-seg" role="group" aria-label="Contar por">
            {BASES.map(([v, t]) => <button key={v} type="button" className={base === v ? "on" : ""} aria-pressed={base === v} onClick={() => setBase(v)}>{t}</button>)}
          </div>
          <div className="tp-seg" role="group" aria-label="Período">
            {([["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["prox30", "Próximos 30"], ["ano", "Este ano"]] as [Atalho, string][]).map(([v, t]) => (
              <button key={v} type="button" className={atalho === v ? "on" : ""} aria-pressed={atalho === v} onClick={() => escolherAtalho(v)}>{t}</button>
            ))}
          </div>
          <label className="rv-data"><span>De</span><input type="date" value={ini} onChange={(e) => { setAtalho("livre"); setIntervalo([e.target.value, fim < e.target.value ? e.target.value : fim]); }} /></label>
          <label className="rv-data"><span>Até</span><input type="date" value={fim} onChange={(e) => { setAtalho("livre"); setIntervalo([ini > e.target.value ? e.target.value : ini, e.target.value]); }} /></label>
        </div>
        <div className="rv-linha">
          <div className="rv-chips" role="group" aria-label="Status">
            {Object.entries(STATUS).map(([id, s]) => (
              <button key={id} type="button" className={`rv-chip fase-${s.fase}${status.has(+id) ? " on" : ""}`} aria-pressed={status.has(+id)}
                onClick={() => setStatus((x) => { const n = new Set(x); if (n.has(+id)) n.delete(+id); else n.add(+id); return n; })}>
                <i />{s.nome}
              </button>
            ))}
          </div>
          <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Canal"><option value="">Todos os canais</option>{opcoesCanal.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de UH"><option value="">Todos os tipos de UH</option>{opcoesTipo.map((c) => <option key={c}>{c}</option>)}</select>
          <input type="search" className="rv-busca" placeholder="Hóspede, código, UH, grupo…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
        </div>
      </div>

      {erro && <p className="muted">Não foi possível abrir as reservas: {erro}</p>}
      {todasEst === null ? <p className="muted">Carregando…</p> : (
        <>
          <section className="tp-painel tp-kpis rv-kpis" aria-label="Indicadores das reservas">
            <div className="tp-indicador"><span className="tp-rotulo">Reservas (quartos)</span><b className="tp-numero">{inteiro(ind.validas)}</b><span className="tp-nota">{inteiro(ind.canceladas)} canceladas · {inteiro(ind.noshow)} no-show</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Noites</span><b className="tp-numero">{inteiro(ind.noites)}</b><span className="tp-nota">estadia média {ind.estadia == null ? "—" : ind.estadia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Hóspedes</span><b className="tp-numero">{inteiro(ind.hospedes)}</b><span className="tp-nota">adultos e crianças</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Valor das diárias</span><b className="tp-numero">{reais(ind.valor)}</b><span className="tp-nota">{inteiro(ind.comValor)} de {inteiro(ind.validas)} com valor do canal</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Diária média</span><b className="tp-numero">{reais(ind.diaria)}</b><span className="tp-nota">das reservas com valor</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Antecedência</span><b className="tp-numero">{ind.antecedencia == null ? "—" : `${Math.round(ind.antecedencia)} dias`}</b>
              <span className="tp-nota">cancelamento {ind.total ? `${((100 * ind.canceladas) / ind.total).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</span></div>
          </section>

          <div className="hg-grade rv-quebras">
            <section className="tp-painel" aria-label="Por status">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Situação</span><h3 className="hg-h3">Por status</h3></div></div>
              <ul className="hg-barras">
                {porStatus.map((s) => (
                  <li key={s.id}><span className="hg-barras-nome">{s.nome}</span>
                    <span className="hg-barras-trilho"><i className={`fase-${s.fase}`} style={{ width: `${Math.max(2, (100 * s.n) / maxStatus)}%` }} /></span><b>{inteiro(s.n)}</b></li>
                ))}
              </ul>
            </section>
            <section className="tp-painel" aria-label="Por canal">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Origem</span><h3 className="hg-h3">Por canal</h3></div></div>
              <div className="hg-tabela-rolagem"><table className="hg-tabela">
                <thead><tr><th>Canal</th><th>Reservas</th><th>Noites</th><th>Valor</th><th>Diária</th></tr></thead>
                <tbody>{porCanal.map((c) => <tr key={c.k}><td>{c.k}</td><td>{inteiro(c.n)}</td><td>{inteiro(c.noites)}</td><td>{c.comValor ? reais(c.valor) : "—"}</td><td>{reais(c.diaria)}</td></tr>)}</tbody>
              </table></div>
            </section>
          </div>
          <section className="tp-painel" aria-label="Por tipo de UH">
            <div className="tp-painel-topo"><div><span className="tp-rotulo">Produto</span><h3 className="hg-h3">Por tipo de UH</h3></div></div>
            <div className="hg-tabela-rolagem"><table className="hg-tabela">
              <thead><tr><th>Tipo</th><th>Reservas</th><th>Noites</th><th>Estadia média</th><th>Valor</th><th>Diária</th></tr></thead>
              <tbody>{porTipo.map((c) => <tr key={c.k}><td>{c.k}</td><td>{inteiro(c.n)}</td><td>{inteiro(c.noites)}</td><td>{c.n ? (c.noites / c.n).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}</td><td>{c.comValor ? reais(c.valor) : "—"}</td><td>{reais(c.diaria)}</td></tr>)}</tbody>
            </table></div>
          </section>

          <section className="tp-painel" aria-label="Lista de reservas">
            <div className="tp-painel-topo">
              <div><span className="tp-rotulo">{inteiro(filtradas.length)} reservas</span><h3 className="hg-h3">Lista</h3></div>
              <div className="rv-linha">
                <label className="rv-data"><span>Ordem</span>
                  <select value={ordem} onChange={(e) => setOrdem(e.target.value as keyof typeof ORDENS)}>{Object.entries(ORDENS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                </label>
                <button type="button" className="ghost small" onClick={() => planilha(ordenadas, `reservas-${nome.toLowerCase().replace(/\s+/g, "-")}-${ini}-a-${fim}`)}>Baixar planilha</button>
              </div>
            </div>
            {filtradas.length === 0 ? <p className="tp-vazio">Nenhuma reserva com esses filtros.</p> : (
              <div className="hg-tabela-rolagem"><table className="hg-tabela rv-lista">
                <thead><tr><th>Código</th><th>Hóspede</th><th>UH</th><th>Chegada</th><th>Saída</th><th>Noites</th><th>Hósp.</th><th>Status</th><th>Canal</th><th>Valor</th><th>Criada</th></tr></thead>
                <tbody>
                  {vis.map((e) => (
                    <tr key={e.item_id}>
                      <td className="rv-mono">{e.codigo}</td>
                      <td>{e.vip ? "★ " : ""}{e.hospede || "—"}{e.grupo_nome ? <small className="muted"> · {e.grupo_nome}</small> : null}</td>
                      <td>{e.uh_numero ?? <span className="muted">sem UH</span>}<small className="muted"> {e.tipo}</small></td>
                      <td>{dataBr(e.checkin)}</td><td>{dataBr(e.checkout)}</td><td>{inteiro(e.noites)}</td>
                      <td>{(e.adultos ?? 0) + (e.criancas ?? 0)}</td>
                      <td><span className={`rv-status fase-${faseDe(e)}`}>{nomeStatus(e)}</span></td>
                      <td>{canalNome(e)}</td><td>{reais(e.valor_diarias == null ? null : Number(e.valor_diarias))}</td>
                      <td>{e.criada_em ? dataBr(e.criada_em.slice(0, 10)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {paginas > 1 && (
              <div className="rv-paginas">
                <button type="button" className="ghost small" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
                <span className="tp-nota">Página {pagina + 1} de {paginas}</span>
                <button type="button" className="ghost small" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
              </div>
            )}
            <p className="tp-nota">Uma linha por quarto reservado. Canal, valor das diárias, tarifa e data de criação vêm das reservas recebidas pelos canais integrados ao PMS (site, OTAs, agências); reservas lançadas direto no PMS aparecem como “Direto / balcão”, sem valor.</p>
          </section>
        </>
      )}
    </div>
  );
}
