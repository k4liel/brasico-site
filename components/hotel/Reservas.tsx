"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Estadia, STATUS, antecedencia, canalNome, dataBr, faseDe, hojeFortaleza, nomeStatus, somaDias, todas,
} from "@/lib/hotel-reservas";
import { COR, GraficoCombinado, Kpi, Painel, Rosca, Segmentos, Vazio, moeda, num, pct } from "./ui";

// Reservas do hotel para análise (aba Reservas da página /hoteis/<hotel>): todas as estadias do PMS (pms_estadias,
// com canal e valor de pms_reservas), filtros, indicadores, gráficos e a lista. Clicar numa reserva abre o painel
// lateral com os detalhes e as transações dela (pms_transacoes).

type Base = "chegada" | "estadia" | "saida" | "criacao";
type Atalho = "7d" | "30d" | "mes" | "prox30" | "ano" | "livre";
type Tx = { chave: string; dia: string; grupo: string | null; descricao: string | null; valor: number; estornado: boolean };

const COR_FASE: Record<string, string> = {
  reservada: "var(--fase-reservada)", pendente: "var(--fase-pendente)", hospedada: "var(--fase-hospedada)",
  finalizada: "var(--fase-finalizada)", noshow: "var(--fase-noshow)", cancelada: "var(--fase-cancelada)",
};
function intervaloDe(a: Atalho, h: string): [string, string] {
  if (a === "7d") return [somaDias(h, -6), h];
  if (a === "30d") return [somaDias(h, -29), h];
  if (a === "mes") return [`${h.slice(0, 7)}-01`, new Date(Date.UTC(+h.slice(0, 4), +h.slice(5, 7), 0)).toISOString().slice(0, 10)];
  if (a === "prox30") return [h, somaDias(h, 29)];
  return [`${h.slice(0, 4)}-01-01`, `${h.slice(0, 4)}-12-31`];
}
function planilha(l: Estadia[], nome: string) {
  const cab = ["Código", "Hóspede principal", "UH", "Tipo de UH", "Chegada", "Saída", "Noites", "Adultos", "Crianças", "Status", "Canal", "Tarifa", "Valor das diárias", "Criada em"];
  const e = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const c = l.map((x) => [x.codigo, x.hospede, x.uh_numero, x.tipo, x.checkin, x.checkout, x.noites, x.adultos, x.criancas, nomeStatus(x), canalNome(x), x.tarifa,
    x.valor_diarias?.toString().replace(".", ","), x.criada_em?.slice(0, 10)].map(e).join(";"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [cab.map(e).join(";"), ...c].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function Reservas({ hotel, nome }: { hotel: string; nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const h = hojeFortaleza();
  const [atalho, setAtalho] = useState<Atalho>("mes");
  const [[ini, fim], setIntervalo] = useState<[string, string]>(() => intervaloDe("mes", hojeFortaleza()));
  const [base, setBase] = useState<Base>("chegada");
  const [lista, setLista] = useState<Estadia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<Set<number>>(new Set());
  const [canal, setCanal] = useState("");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberta, setAberta] = useState<Estadia | null>(null);
  const [txs, setTxs] = useState<Tx[] | null>(null);

  useEffect(() => {
    setLista(null); setPagina(0);
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
        setLista(l); setErro(null);
      } catch (e) { setErro(e instanceof Error ? e.message : "erro"); setLista([]); }
    })();
  }, [supabase, hotel, ini, fim, base]);

  // Transações da reserva aberta
  useEffect(() => {
    setTxs(null);
    if (!aberta?.codigo) return;
    supabase.from("pms_transacoes").select("chave,dia,grupo,descricao,valor,estornado").eq("hotel_id", hotel).eq("reserva", aberta.codigo).order("dia").limit(500)
      .then((r) => setTxs((r.data as Tx[]) ?? []));
  }, [supabase, hotel, aberta]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setAberta(null); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, []);

  const opCanal = useMemo(() => [...new Set((lista ?? []).map(canalNome))].sort(), [lista]);
  const opTipo = useMemo(() => [...new Set((lista ?? []).map((e) => e.tipo ?? "—"))].sort(), [lista]);
  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (lista ?? []).filter((e) => (!status.size || status.has(e.status_id ?? -1)) && (!canal || canalNome(e) === canal) && (!tipo || (e.tipo ?? "—") === tipo) &&
      (!b || [e.hospede, e.codigo, e.uh_numero, e.grupo_nome, e.empresa].some((v) => (v ?? "").toLowerCase().includes(b))));
  }, [lista, status, canal, tipo, busca]);

  const ind = useMemo(() => {
    const val = filtradas.filter((e) => e.status_id !== 5 && e.status_id !== 6);
    const cv = val.filter((e) => e.valor_diarias != null);
    const noites = val.reduce((a, e) => a + (e.noites ?? 0), 0);
    const ant = val.map(antecedencia).filter((v): v is number => v != null && v >= 0);
    const vlr = cv.reduce((a, e) => a + Number(e.valor_diarias), 0), nCv = cv.reduce((a, e) => a + (e.noites ?? 0), 0);
    return { total: filtradas.length, validas: val.length, noites, hospedes: val.reduce((a, e) => a + (e.adultos ?? 0) + (e.criancas ?? 0), 0),
      valor: vlr, comValor: cv.length, diaria: nCv ? vlr / nCv : null, estadia: val.length ? noites / val.length : null,
      antecedencia: ant.length ? ant.reduce((a, v) => a + v, 0) / ant.length : null,
      canceladas: filtradas.filter((e) => e.status_id === 6).length, noshow: filtradas.filter((e) => e.status_id === 5).length, ant };
  }, [filtradas]);

  // Gráficos
  const porDia = useMemo(() => {
    const campo = (e: Estadia) => (base === "saida" ? e.checkout : base === "criacao" ? e.criada_em?.slice(0, 10) ?? null : e.checkin);
    const m = new Map<string, Record<string, number>>();
    for (const e of filtradas) {
      const d = campo(e); if (!d || d < ini || d > fim) continue;
      const x = m.get(d) ?? {}; const f = faseDe(e); x[f] = (x[f] ?? 0) + 1; m.set(d, x);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, x]) => ({ dia, ...x }));
  }, [filtradas, base, ini, fim]);
  const faixasAnt = useMemo(() => {
    const f = [["Mesmo dia", 0, 1], ["1–7 dias", 1, 8], ["8–30 dias", 8, 31], ["31–60 dias", 31, 61], ["61–90 dias", 61, 91], ["+90 dias", 91, 99999]] as const;
    return f.map(([nome, a, b]) => ({ faixa: nome, reservas: ind.ant.filter((v) => v >= a && v < b).length }));
  }, [ind.ant]);
  const porCanal = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtradas) { if (e.status_id === 5 || e.status_id === 6) continue; const k = canalNome(e); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtradas]);
  const porStatus = useMemo(() => Object.entries(STATUS).map(([id, s]) => ({ nome: s.nome, valor: filtradas.filter((e) => e.status_id === +id).length, cor: COR_FASE[s.fase] })).filter((x) => x.valor), [filtradas]);

  const POR = 50, paginas = Math.max(1, Math.ceil(filtradas.length / POR));
  const vis = filtradas.slice(pagina * POR, (pagina + 1) * POR);
  const serieFases = (["reservada", "pendente", "hospedada", "finalizada", "noshow", "cancelada"] as const).filter((f) => porDia.some((d) => (d as unknown as Record<string, number>)[f]));
  const nomeFase: Record<string, string> = { reservada: "Confirmada", pendente: "Pendente", hospedada: "Hospedada", finalizada: "Finalizada", noshow: "No-show", cancelada: "Cancelada" };

  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo">
        <div><span className="hx-sobre">Análise de reservas</span><h2>Reservas</h2></div>
        <div className="hx-controles">
          <Segmentos valor={base} mudar={setBase} rotulo="Contar por" opcoes={[["chegada", "Chegadas"], ["estadia", "Hospedados"], ["saida", "Saídas"], ["criacao", "Feitas no período"]]} />
        </div>
      </div>
      <div className="hx-filtros hx-filtros-topo">
        <Segmentos valor={atalho} rotulo="Período" mudar={(a) => { setAtalho(a); if (a !== "livre") setIntervalo(intervaloDe(a, h)); }}
          opcoes={[["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["prox30", "Próximos 30"], ["ano", "Este ano"]]} />
        <label className="hx-campo"><span>De</span><input type="date" value={ini} onChange={(e) => { setAtalho("livre"); setIntervalo([e.target.value, fim < e.target.value ? e.target.value : fim]); }} /></label>
        <label className="hx-campo"><span>Até</span><input type="date" value={fim} onChange={(e) => { setAtalho("livre"); setIntervalo([ini > e.target.value ? e.target.value : ini, e.target.value]); }} /></label>
        <select className="hx-select" value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Canal"><option value="">Todos os canais</option>{opCanal.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="hx-select" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de UH"><option value="">Todos os tipos</option>{opTipo.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="search" className="hx-busca" placeholder="Hóspede, código, UH, grupo…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
      </div>
      <div className="hx-chips" role="group" aria-label="Status">
        {Object.entries(STATUS).map(([id, s]) => (
          <button key={id} type="button" className={status.has(+id) ? "on" : ""} aria-pressed={status.has(+id)}
            onClick={() => setStatus((x) => { const n2 = new Set(x); if (n2.has(+id)) n2.delete(+id); else n2.add(+id); return n2; })}>
            <i style={{ background: COR_FASE[s.fase] }} />{s.nome}
          </button>
        ))}
        {status.size > 0 && <button type="button" className="hx-limpar" onClick={() => setStatus(new Set())}>Limpar</button>}
      </div>

      {erro && <Vazio>Não foi possível abrir as reservas: {erro}</Vazio>}
      {lista === null ? <div className="hx-carregando"><i /><i /><i /></div> : (
        <>
          <div className="hx-kpis">
            <Kpi rotulo="Reservas" valor={num(ind.validas)} cor={COR.azul} nota={`${num(ind.canceladas)} canceladas · ${num(ind.noshow)} no-show`} serie={porDia.map((d) => Object.values(d).reduce((a: number, v) => a + (typeof v === "number" ? v : 0), 0))} />
            <Kpi rotulo="Noites" valor={num(ind.noites)} cor={COR.violeta} nota={`estadia média ${ind.estadia == null ? "—" : num(ind.estadia, 1)}`} />
            <Kpi rotulo="Hóspedes" valor={num(ind.hospedes)} cor={COR.ciano} nota="adultos e crianças" />
            <Kpi rotulo="Valor das diárias" valor={moeda(ind.valor)} cor={COR.verde} nota={`${num(ind.comValor)} de ${num(ind.validas)} com valor do canal`} />
            <Kpi rotulo="Diária média" valor={moeda(ind.diaria)} cor={COR.ambar} nota={`antecedência ${ind.antecedencia == null ? "—" : `${Math.round(ind.antecedencia)} dias`} · cancel. ${ind.total ? pct((100 * ind.canceladas) / ind.total) : "—"}`} />
          </div>

          <Painel sub={base === "saida" ? "Saídas por dia" : base === "criacao" ? "Reservas feitas por dia" : base === "estadia" ? "Chegadas por dia" : "Chegadas por dia"} titulo="Volume e situação">
            {porDia.length ? (
              <GraficoCombinado dados={porDia} x="dia" altura={280} rotuloX={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} rotuloDica={(v) => dataBr(v)} fmtEsq={(v) => num(v)}
                fmt={Object.fromEntries(serieFases.map((f) => [f, (v: number) => `${num(v)} reserva${v === 1 ? "" : "s"}`]))}
                series={serieFases.map((f) => ({ chave: f, nome: nomeFase[f], cor: COR_FASE[f], tipo: "barra" as const, pilha: "s" }))} />
            ) : <Vazio>Sem reservas com esses filtros.</Vazio>}
          </Painel>

          <div className="hx-tres">
            <Painel sub="Origem" titulo="Canais"><Rosca dados={porCanal} fmt={(v) => `${num(v)}`} altura={190} sub="reservas" /></Painel>
            <Painel sub="Situação" titulo="Status"><Rosca dados={porStatus} fmt={(v) => `${num(v)}`} altura={190} sub="reservas" /></Painel>
            <Painel sub="Com quanto tempo reservam" titulo="Antecedência">
              <GraficoCombinado dados={faixasAnt} x="faixa" altura={230} legenda={false} fmtEsq={(v) => num(v)} fmt={{ reservas: (v) => `${num(v)} reservas` }}
                series={[{ chave: "reservas", nome: "Reservas", cor: COR.violeta, tipo: "barra" }]} />
            </Painel>
          </div>

          <Painel sub={`${num(filtradas.length)} reservas`} titulo="Lista de reservas"
            acoes={<button type="button" className="hx-botao" onClick={() => planilha(filtradas, `reservas-${nome.toLowerCase().replace(/\s+/g, "-")}-${ini}-a-${fim}`)}>Baixar planilha</button>}>
            {filtradas.length === 0 ? <Vazio>Nenhuma reserva com esses filtros.</Vazio> : (
              <div className="hx-rolagem">
                <table className="hx-tabela clicavel">
                  <thead><tr><th>Hóspede</th><th>UH</th><th>Chegada</th><th>Saída</th><th className="num">Noites</th><th className="num">Hósp.</th><th>Status</th><th>Canal</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {vis.map((e) => (
                      <tr key={e.item_id} onClick={() => setAberta(e)} className={aberta?.item_id === e.item_id ? "on" : ""}>
                        <td><b className="hx-forte">{e.vip ? "★ " : ""}{e.hospede || "—"}</b><small className="mono muted">{e.codigo}</small></td>
                        <td>{e.uh_numero ?? <span className="muted">sem UH</span>}<small className="muted">{e.tipo}</small></td>
                        <td className="mono">{dataBr(e.checkin)}</td><td className="mono">{dataBr(e.checkout)}</td>
                        <td className="num">{num(e.noites)}</td><td className="num">{(e.adultos ?? 0) + (e.criancas ?? 0)}</td>
                        <td><span className="hx-etiqueta" style={{ ["--c" as string]: COR_FASE[faseDe(e)] }}>{nomeStatus(e)}</span></td>
                        <td>{canalNome(e)}</td>
                        <td className="num mono">{e.valor_diarias == null ? "—" : moeda(Number(e.valor_diarias))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {paginas > 1 && (
              <div className="hx-paginas">
                <button type="button" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
                <span>Página {pagina + 1} de {paginas}</span>
                <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
              </div>
            )}
          </Painel>
          <p className="hx-fonte">Uma linha por quarto reservado. Canal, valor e data de criação vêm das reservas dos canais integrados ao PMS (site, OTAs, agências); as lançadas direto no PMS aparecem como “Direto / balcão”, sem valor.</p>
        </>
      )}

      {aberta && (
        <>
          <div className="hx-veu" onClick={() => setAberta(null)} />
          <aside className="hx-gaveta" role="dialog" aria-label={`Reserva ${aberta.codigo ?? ""}`}>
            <header>
              <div><span className="hx-sobre mono">{aberta.codigo}</span><h3>{aberta.vip ? "★ " : ""}{aberta.hospede || "Hóspede não informado"}</h3>
                <span className="hx-etiqueta" style={{ ["--c" as string]: COR_FASE[faseDe(aberta)] }}>{nomeStatus(aberta)}</span></div>
              <button type="button" className="hx-fechar" aria-label="Fechar" onClick={() => setAberta(null)}>×</button>
            </header>
            <div className="hx-gaveta-grade">
              <div><span>Chegada</span><b>{dataBr(aberta.checkin)}</b></div>
              <div><span>Saída</span><b>{dataBr(aberta.checkout)}</b></div>
              <div><span>Noites</span><b>{num(aberta.noites)}</b></div>
              <div><span>Hóspedes</span><b>{aberta.adultos ?? 0} adultos{aberta.criancas ? ` · ${aberta.criancas} crianças` : ""}</b></div>
              <div><span>UH</span><b>{aberta.uh_numero ?? "sem UH"}</b></div>
              <div><span>Tipo</span><b>{aberta.tipo ?? "—"}</b></div>
              <div><span>Canal</span><b>{canalNome(aberta)}</b></div>
              <div><span>Tarifa</span><b>{aberta.tarifa ?? "—"}</b></div>
              {aberta.grupo_nome && <div><span>Grupo</span><b>{aberta.grupo_nome}</b></div>}
              {aberta.empresa && <div><span>Empresa</span><b>{aberta.empresa}</b></div>}
              <div><span>Criada em</span><b>{aberta.criada_em ? dataBr(aberta.criada_em.slice(0, 10)) : "—"}</b></div>
              <div><span>Antecedência</span><b>{antecedencia(aberta) == null ? "—" : `${Math.round(antecedencia(aberta)!)} dias`}</b></div>
            </div>
            <div className="hx-gaveta-total"><span>Diárias informadas pelo canal</span><b>{aberta.valor_diarias == null ? "A conferir" : moeda(Number(aberta.valor_diarias))}</b></div>
            <h4>Transações da reserva</h4>
            {txs === null ? <p className="muted">Carregando…</p> : txs.length === 0 ? <p className="muted">Nenhuma transação desta reserva no banco ainda.</p> : (
              <>
                <ul className="hx-gaveta-tx">
                  {txs.map((t) => (
                    <li key={t.chave} className={t.estornado ? "estornado" : ""}>
                      <span className="mono">{dataBr(t.dia).slice(0, 5)}</span><span>{t.descricao}<small>{t.grupo}{t.estornado ? " · estornado" : ""}</small></span>
                      <b className={Number(t.valor) < 0 ? "neg" : ""}>{moeda(Number(t.valor))}</b>
                    </li>
                  ))}
                </ul>
                <div className="hx-gaveta-somas">
                  <div><span>Lançado</span><b>{moeda(txs.filter((t) => t.grupo !== "Pagamento").reduce((a, t) => a + Number(t.valor), 0))}</b></div>
                  <div><span>Pago</span><b>{moeda(Math.abs(txs.filter((t) => t.grupo === "Pagamento").reduce((a, t) => a + Number(t.valor), 0)))}</b></div>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
