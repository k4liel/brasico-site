"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GraficoLinhas, GraficoBarras } from "./Graficos";
import { MESES, inteiro, reais, somarMeses } from "@/lib/totvs-painel";

// Relatório gerencial do hotel (página /hoteis/<hotel>, aba Gerencial).
// Fonte: o PMS da TOTVS Hospitalidade, lido pelo robô da VPS (robos/pms-navegador) e guardado em
// pms_kpi_dia (dia x tipo de UH: UHs, ocupadas, receita de hospedagem), pms_reservas (por canal, sem nome de hóspede),
// pms_recebimentos (forma de pagamento), pms_horas (leitura de hora em hora) e pms_previsao (o que já está vendido).
// Contas iguais às do PMS: ocupação = ocupadas ÷ total de UHs; diária média = receita ÷ ocupadas; RevPAR = receita ÷ UHs disponíveis.

type DiaKpi = { dia: string; categoria: string; disponiveis: number; bloqueadas: number; total: number; ocupadas: number; receita: number };
type Mes = { mes: string; uh_disponiveis: number; uh_total: number; diarias_vendidas: number; receita: number; ocupacao: number | null; diaria_media: number | null; revpar: number | null };
type Reserva = { reserva: string; canal: string | null; empresa: string | null; tarifa: string | null; uh: string | null; criada_em: string | null;
  checkin: string | null; checkout: string | null; noites: number | null; valor_diarias: number | null; status: string | null; cancelada_em: string | null };
type Receb = { dia: string; grupo: string; tipo: string; valor: number };
type Hora = { lido_em: string; ocupacao: number | null; ocupadas: number | null; livres: number | null; bloqueadas: number | null;
  checkins: number | null; checkouts: number | null; checkins_previstos: number | null; checkouts_previstos: number | null };
type Prev = { dia: string; uhs: number | null; ocupadas: number | null; disponiveis: number | null; bloqueadas: number | null; ocupacao: number | null; lido_dia: string };

type Periodo = "mes" | "ano" | "12m";

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const perc = (v: number | null | undefined, casas = 1) => (v == null || !isFinite(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`);
const moeda = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : reais(v));
const mesNome = (m: string) => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
const mesCurto = (m: string) => `${MESES[+m.slice(5, 7) - 1].slice(0, 3)}/${m.slice(2, 4)}`;
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
const fimDoMes = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

function somarKpi(linhas: { disponiveis: number; total: number; ocupadas: number; receita: number }[]) {
  const disp = linhas.reduce((a, x) => a + n(x.disponiveis), 0);
  const tot = linhas.reduce((a, x) => a + n(x.total), 0);
  const ocup = linhas.reduce((a, x) => a + n(x.ocupadas), 0);
  const rec = linhas.reduce((a, x) => a + n(x.receita), 0);
  return {
    disponiveis: disp, total: tot, ocupadas: ocup, receita: rec,
    ocupacao: tot ? (100 * ocup) / tot : null,
    diaria: ocup ? rec / ocup : null,
    revpar: disp ? rec / disp : null,
  };
}
type Soma = ReturnType<typeof somarKpi>;

function Var({ atual, base, pontos }: { atual: number | null; base: number | null; pontos?: boolean }) {
  if (atual == null || base == null || !isFinite(atual) || !isFinite(base) || (!pontos && base === 0)) return <span className="tp-nota">sem base</span>;
  const d = pontos ? atual - base : (atual - base) / Math.abs(base);
  const txt = pontos ? `${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` : `${(Math.abs(d) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return <span className={d >= 0 ? "tp-var tp-sobe" : "tp-var tp-desce"}>{d >= 0 ? "▲" : "▼"} {txt}</span>;
}

function Kpi({ rotulo, valor, atual, base, pontos, nota }: { rotulo: string; valor: string; atual: number | null; base: number | null; pontos?: boolean; nota?: string }) {
  return (
    <div className="tp-indicador">
      <span className="tp-rotulo">{rotulo}</span>
      <b className="tp-numero">{valor}</b>
      <span className="tp-nota"><Var atual={atual} base={base} pontos={pontos} /> <span className="muted">vs. ano anterior</span></span>
      {nota && <span className="tp-nota">{nota}</span>}
    </div>
  );
}

export default function HotelGerencial({ hotel }: { hotel: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [mes, setMes] = useState(() => hoje().slice(0, 7));
  const [kpi, setKpi] = useState<DiaKpi[] | null>(null);
  const [kpiAnt, setKpiAnt] = useState<DiaKpi[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [receb, setReceb] = useState<Receb[]>([]);
  const [hora, setHora] = useState<Hora | null>(null);
  const [prev, setPrev] = useState<Prev[]>([]);
  const [prevSemana, setPrevSemana] = useState<Prev[]>([]);
  const [prevPeriodo, setPrevPeriodo] = useState<Prev[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [primeiroMes, setPrimeiroMes] = useState<string | null>(null);

  // Intervalo do período escolhido (e o mesmo intervalo um ano antes)
  const [ini, fim] = useMemo(() => {
    if (periodo === "mes") return [`${mes}-01`, fimDoMes(mes)];
    if (periodo === "ano") return [`${mes.slice(0, 4)}-01-01`, fimDoMes(mes)];
    return [`${somarMeses(mes, -11)}-01`, fimDoMes(mes)];
  }, [periodo, mes]);
  const anoAntes = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;

  // Dados que não dependem do período: meses (evolução), leitura de agora, previsão
  useEffect(() => {
    (async () => {
      const [m, h, p] = await Promise.all([
        supabase.from("pms_mes_hotel").select("*").eq("hotel_id", hotel).order("mes"),
        supabase.from("pms_horas").select("*").eq("hotel_id", hotel).order("lido_em", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("pms_previsao_atual").select("dia,uhs,ocupadas,disponiveis,bloqueadas,ocupacao,lido_dia").eq("hotel_id", hotel).gte("dia", hoje()).order("dia").limit(90),
      ]);
      if (m.error) setErro(m.error.message);
      const lista = (m.data as Mes[]) ?? [];
      setMeses(lista);
      setPrimeiroMes(lista.find((x) => n(x.diarias_vendidas) > 0 || n(x.receita) !== 0)?.mes ?? null);
      setHora((h.data as Hora) ?? null);
      const pv = (p.data as Prev[]) ?? [];
      setPrev(pv);
      // Previsão como estava 7 dias antes (para o "pickup" das reservas da semana)
      const semana = new Date(Date.now() - 7 * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
      const s = await supabase.from("pms_previsao").select("dia,ocupadas,ocupacao,lido_dia").eq("hotel_id", hotel).eq("lido_dia", semana).gte("dia", hoje()).limit(90);
      setPrevSemana((s.data as Prev[]) ?? []);
    })();
  }, [supabase, hotel]);

  // Dados do período
  useEffect(() => {
    setKpi(null);
    (async () => {
      const pegar = async (a: string, b: string) => {
        const out: DiaKpi[] = [];
        for (let de = 0; ; de += 1000) {
          const r = await supabase.from("pms_kpi_dia").select("dia,categoria,disponiveis,bloqueadas,total,ocupadas,receita")
            .eq("hotel_id", hotel).gte("dia", a).lte("dia", b).order("dia").range(de, de + 999);
          if (r.error) { setErro(r.error.message); break; }
          out.push(...((r.data as DiaKpi[]) ?? []));
          if ((r.data ?? []).length < 1000) break;
        }
        return out;
      };
      const h0 = hoje();
      const [k, ka, rs, rc, pp] = await Promise.all([
        pegar(ini, fim < h0 ? fim : h0),
        pegar(anoAntes(ini), anoAntes(fim)),
        supabase.from("pms_reservas").select("reserva,canal,empresa,tarifa,uh,criada_em,checkin,checkout,noites,valor_diarias,status,cancelada_em")
          .eq("hotel_id", hotel).gte("checkin", ini).lte("checkin", fim).limit(5000),
        supabase.from("pms_recebimentos").select("dia,grupo,tipo,valor").eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim).limit(5000),
        fim >= h0
          ? supabase.from("pms_previsao_atual").select("dia,uhs,ocupadas,disponiveis,bloqueadas,ocupacao,lido_dia").eq("hotel_id", hotel)
              .gte("dia", ini > h0 ? ini : h0).lte("dia", fim).order("dia").limit(400)
          : Promise.resolve({ data: [] as Prev[] }),
      ]);
      setKpi(k); setKpiAnt(ka);
      setPrevPeriodo(((pp as { data: Prev[] | null }).data) ?? []);
      setReservas((rs.data as Reserva[]) ?? []);
      setReceb((rc.data as Receb[]) ?? []);
    })();
  }, [supabase, hotel, ini, fim]);

  const hojeStr = hoje();
  // Realizado = até ontem (o dia de hoje ainda está acontecendo); o resto do período é "já vendido"
  // (o relatório de KPIs do PMS só tem o que já aconteceu; o futuro vem da previsão de disponibilidade)
  const realizado = useMemo(() => (kpi ?? []).filter((x) => x.dia < hojeStr), [kpi, hojeStr]);
  const limiteAnt = anoAntes(hojeStr);
  const s: Soma = useMemo(() => somarKpi(realizado), [realizado]);
  const sAnt: Soma = useMemo(() => somarKpi(fim < hojeStr ? kpiAnt : kpiAnt.filter((x) => x.dia < limiteAnt)), [kpiAnt, fim, hojeStr, limiteAnt]);
  const sAntTudo: Soma = useMemo(() => somarKpi(kpiAnt), [kpiAnt]);
  const vendido = useMemo(() => {
    const ocup = prevPeriodo.reduce((a, p) => a + n(p.ocupadas), 0);
    const uhs = prevPeriodo.reduce((a, p) => a + n(p.uhs), 0);
    return { dias: prevPeriodo.length, ocupadas: ocup, uhs, ocupacao: uhs ? (100 * ocup) / uhs : null,
      projecao: s.total + uhs ? (100 * (s.ocupadas + ocup)) / (s.total + uhs) : null };
  }, [prevPeriodo, s]);

  // Por dia (gráfico): realizado do relatório de KPIs; de hoje em diante, o que já está vendido
  const porDia = useMemo(() => {
    const m = new Map<string, DiaKpi[]>();
    for (const x of realizado) m.set(x.dia, [...(m.get(x.dia) ?? []), x]);
    const ma = new Map<string, DiaKpi[]>();
    for (const x of kpiAnt) { const d = `${+x.dia.slice(0, 4) + 1}${x.dia.slice(4)}`; ma.set(d, [...(ma.get(d) ?? []), x]); }
    const pv = new Map(prevPeriodo.map((p) => [p.dia, p]));
    const dias = [...new Set([...m.keys(), ...pv.keys()])].sort();
    return dias.map((d) => {
      const p = pv.get(d);
      const a = m.has(d) ? somarKpi(m.get(d)!) : p ? { ...somarKpi([]), ocupadas: n(p.ocupadas), total: n(p.uhs), ocupacao: p.ocupacao == null ? null : Number(p.ocupacao), receita: NaN } : somarKpi([]);
      return { dia: d, futuro: !m.has(d), a, b: ma.has(d) ? somarKpi(ma.get(d)!) : null };
    });
  }, [realizado, kpiAnt, prevPeriodo]);

  // Por tipo de UH
  const porTipo = useMemo(() => {
    const m = new Map<string, DiaKpi[]>();
    for (const x of realizado) m.set(x.categoria, [...(m.get(x.categoria) ?? []), x]);
    return [...m.entries()].map(([cat, l]) => ({ cat, ...somarKpi(l), uhs: Math.max(...l.map((x) => n(x.total))) }))
      .sort((a, b) => b.receita - a.receita);
  }, [realizado]);

  // Canais (reservas com check-in no período)
  const canais = useMemo(() => {
    const validas = reservas.filter((r) => !r.cancelada_em && !/cancel|no-?show/i.test(r.status ?? ""));
    const m = new Map<string, { reservas: number; noites: number; valor: number; antecedencia: number[] }>();
    for (const r of validas) {
      const c = (r.canal || "Direto / sem canal").trim();
      const x = m.get(c) ?? { reservas: 0, noites: 0, valor: 0, antecedencia: [] };
      x.reservas++; x.noites += n(r.noites); x.valor += n(r.valor_diarias);
      if (r.criada_em && r.checkin) x.antecedencia.push((Date.parse(`${r.checkin}T12:00:00-03:00`) - Date.parse(r.criada_em)) / 86400000);
      m.set(c, x);
    }
    const tot = [...m.values()].reduce((a, x) => a + x.valor, 0);
    const lista = [...m.entries()].map(([canal, x]) => ({ canal, ...x, part: tot ? x.valor / tot : 0,
      diaria: x.noites ? x.valor / x.noites : null,
      antecedencia: x.antecedencia.length ? x.antecedencia.reduce((a, v) => a + v, 0) / x.antecedencia.length : null })).sort((a, b) => b.valor - a.valor);
    const canceladas = reservas.filter((r) => r.cancelada_em || /cancel/i.test(r.status ?? "")).length;
    const noshow = reservas.filter((r) => /no-?show/i.test(r.status ?? "")).length;
    const estadia = validas.length ? validas.reduce((a, r) => a + n(r.noites), 0) / validas.length : null;
    const antec = validas.filter((r) => r.criada_em && r.checkin).map((r) => (Date.parse(`${r.checkin}T12:00:00-03:00`) - Date.parse(r.criada_em!)) / 86400000);
    return { lista, total: reservas.length, validas: validas.length, canceladas, noshow, estadia,
      antecedencia: antec.length ? antec.reduce((a, v) => a + v, 0) / antec.length : null };
  }, [reservas]);

  // Recebimentos por forma de pagamento
  const formas = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of receb) {
      const k = /devolu|estorno/i.test(r.tipo) ? `${r.grupo} (devolução)` : r.grupo;
      m.set(k, (m.get(k) ?? 0) + n(r.valor));
    }
    const lista = [...m.entries()].map(([forma, valor]) => ({ forma, valor })).filter((x) => x.valor !== 0).sort((a, b) => b.valor - a.valor);
    return { lista, total: lista.reduce((a, x) => a + x.valor, 0) };
  }, [receb]);

  // Previsão: pickup da semana
  const pickup = useMemo(() => {
    const antes = new Map(prevSemana.map((p) => [p.dia, n(p.ocupadas)]));
    const proximos30 = prev.slice(0, 30);
    const agora = proximos30.reduce((a, p) => a + n(p.ocupadas), 0);
    const ant = proximos30.reduce((a, p) => a + (antes.get(p.dia) ?? NaN), 0);
    return { agora, semanaPassada: isFinite(ant) && prevSemana.length ? ant : null,
      ocupacao30: proximos30.length ? proximos30.reduce((a, p) => a + n(p.ocupadas), 0) / proximos30.reduce((a, p) => a + n(p.uhs), 0) * 100 : null };
  }, [prev, prevSemana]);

  const ultimos = useMemo(() => meses.filter((m) => m.mes <= `${hojeStr.slice(0, 7)}-01`).slice(-24), [meses, hojeStr]);
  const semDados = kpi !== null && (kpi.length === 0) && meses.length === 0;
  const tituloPeriodo = periodo === "mes" ? mesNome(mes) : periodo === "ano" ? `${mes.slice(0, 4)} até ${MESES[+mes.slice(5, 7) - 1]}` : `12 meses até ${mesCurto(mes)}`;
  const mesAtual = hojeStr.slice(0, 7);

  if (erro) return <p className="muted">Não foi possível abrir o relatório: {erro}</p>;

  return (
    <div className="hg">
      {/* Agora (leitura de hora em hora) */}
      {hora && (
        <section className="tp-painel hg-agora" aria-label="Situação agora">
          <div className="tp-painel-topo">
            <div><span className="tp-rotulo">Agora no hotel</span><h3 className="hg-h3">Situação do dia</h3></div>
            <span className="tp-nota">Atualizado às {new Date(hora.lido_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" })} · leitura de hora em hora</span>
          </div>
          <div className="tp-kpis hg-kpis-6">
            <div className="tp-indicador"><span className="tp-rotulo">Ocupação agora</span><b className="tp-numero">{perc(n(hora.ocupacao), 1)}</b></div>
            <div className="tp-indicador"><span className="tp-rotulo">Ocupadas</span><b className="tp-numero">{inteiro(n(hora.ocupadas))}</b></div>
            <div className="tp-indicador"><span className="tp-rotulo">Livres</span><b className="tp-numero">{inteiro(n(hora.livres))}</b></div>
            <div className="tp-indicador"><span className="tp-rotulo">Bloqueadas</span><b className="tp-numero">{inteiro(n(hora.bloqueadas))}</b></div>
            <div className="tp-indicador"><span className="tp-rotulo">Check-ins</span><b className="tp-numero">{inteiro(n(hora.checkins))}<small className="muted"> / {inteiro(n(hora.checkins_previstos))}</small></b><span className="tp-nota">feitos / previstos</span></div>
            <div className="tp-indicador"><span className="tp-rotulo">Check-outs</span><b className="tp-numero">{inteiro(n(hora.checkouts))}<small className="muted"> / {inteiro(n(hora.checkouts_previstos))}</small></b><span className="tp-nota">feitos / previstos</span></div>
          </div>
        </section>
      )}

      {/* Escolha do período */}
      <div className="tp-titulo hg-periodo">
        <div>
          <span className="tp-rotulo">Relatório gerencial</span>
          <h2>{tituloPeriodo}</h2>
        </div>
        <div className="hg-controles">
          <div className="tp-seg" role="group" aria-label="Período">
            {([["mes", "Mês"], ["ano", "Ano até o mês"], ["12m", "12 meses"]] as [Periodo, string][]).map(([v, t]) => (
              <button key={v} type="button" className={periodo === v ? "on" : ""} aria-pressed={periodo === v} onClick={() => setPeriodo(v)}>{t}</button>
            ))}
          </div>
          <div className="hg-mes">
            <button type="button" className="ghost small" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}
              disabled={!!primeiroMes && `${mes}-01` <= primeiroMes}>‹</button>
            <span>{mesCurto(mes)}</span>
            <button type="button" className="ghost small" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}
              disabled={mes >= somarMeses(mesAtual, 12)}>›</button>
            {mes !== mesAtual && <button type="button" className="ghost small" onClick={() => setMes(mesAtual)}>Hoje</button>}
          </div>
        </div>
      </div>

      {kpi === null ? (
        <p className="muted">Carregando…</p>
      ) : semDados ? (
        <div className="vazio">
          <p>O histórico deste hotel ainda está sendo trazido do PMS.</p>
          <p className="muted">O robô busca mês a mês; volte em alguns minutos.</p>
        </div>
      ) : (
        <>
          {/* Indicadores do período */}
          <section className="tp-painel tp-kpis hg-kpis-5" aria-label="Indicadores do período">
            <Kpi rotulo="Taxa de ocupação" valor={perc(s.ocupacao)} atual={s.ocupacao} base={sAnt.ocupacao} pontos />
            <Kpi rotulo="Diária média (ADR)" valor={moeda(s.diaria)} atual={s.diaria} base={sAnt.diaria} />
            <Kpi rotulo="RevPAR" valor={moeda(s.revpar)} atual={s.revpar} base={sAnt.revpar} />
            <Kpi rotulo="Receita de hospedagem" valor={moeda(s.receita)} atual={s.receita} base={sAnt.receita} />
            <Kpi rotulo="Diárias vendidas" valor={inteiro(s.ocupadas)} atual={s.ocupadas} base={sAnt.ocupadas}
              nota={`de ${inteiro(s.total)} UHs-noite`} />
          </section>
          {vendido.dias > 0 && (
            <p className="tp-nota hg-nota-futuro">
              Realizado até ontem. Nos {inteiro(vendido.dias)} dias que faltam do período, já estão vendidas <b>{inteiro(vendido.ocupadas)} diárias</b>
              {" "}({perc(vendido.ocupacao)} de ocupação). Com isso, a ocupação do período fecha em pelo menos <b>{perc(vendido.projecao)}</b>
              {sAntTudo.total ? <> (ano anterior, período inteiro: {perc(sAntTudo.ocupacao)})</> : null}.
            </p>
          )}

          {/* Dia a dia */}
          {periodo === "mes" && porDia.length > 0 && (
            <section className="tp-painel" aria-label="Ocupação e receita por dia">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Dia a dia</span><h3 className="hg-h3">Ocupação</h3></div>
                <span className="tp-nota">dias a partir de hoje = já vendido</span></div>
              <GraficoLinhas rotulos={porDia.map((d) => String(+d.dia.slice(8, 10)))} altura={240}
                formato={(v) => `${Math.round(v)}%`}
                series={[
                  { nome: mes.slice(0, 4), cor: "var(--serie-1)", pontos: porDia.map((d) => d.a.ocupacao) },
                  { nome: String(+mes.slice(0, 4) - 1), cor: "var(--serie-2)", pontos: porDia.map((d) => d.b?.ocupacao ?? null) },
                ]} />
              <div className="tp-painel-topo hg-sub"><div><h3 className="hg-h3">Receita de hospedagem</h3></div></div>
              <GraficoLinhas rotulos={porDia.map((d) => String(+d.dia.slice(8, 10)))} altura={220}
                formato={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : inteiro(v))}
                series={[
                  { nome: mes.slice(0, 4), cor: "var(--serie-1)", pontos: porDia.map((d) => (d.futuro ? null : d.a.receita)) },
                  { nome: String(+mes.slice(0, 4) - 1), cor: "var(--serie-2)", pontos: porDia.map((d) => d.b?.receita ?? null) },
                ]} />
              <p className="tp-nota">A receita é lançada pelo PMS no dia da diária; estornos e correções aparecem como valor negativo no dia em que foram feitos.</p>
            </section>
          )}

          <div className="hg-grade">
            {/* Por tipo de UH */}
            <section className="tp-painel" aria-label="Desempenho por tipo de UH">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Realizado</span><h3 className="hg-h3">Por tipo de UH</h3></div></div>
              <div className="hg-tabela-rolagem">
                <table className="hg-tabela">
                  <thead><tr><th>Tipo</th><th>UHs</th><th>Diárias</th><th>Ocupação</th><th>Diária média</th><th>RevPAR</th><th>Receita</th></tr></thead>
                  <tbody>
                    {porTipo.map((t) => (
                      <tr key={t.cat}><td>{t.cat}</td><td>{inteiro(t.uhs)}</td><td>{inteiro(t.ocupadas)}</td><td>{perc(t.ocupacao)}</td>
                        <td>{moeda(t.diaria)}</td><td>{moeda(t.revpar)}</td><td>{moeda(t.receita)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>Total</td><td>{inteiro(porTipo.reduce((a, t) => a + t.uhs, 0))}</td><td>{inteiro(s.ocupadas)}</td><td>{perc(s.ocupacao)}</td>
                    <td>{moeda(s.diaria)}</td><td>{moeda(s.revpar)}</td><td>{moeda(s.receita)}</td></tr></tfoot>
                </table>
              </div>
            </section>

            {/* Canais */}
            <section className="tp-painel" aria-label="Reservas por canal">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Check-in no período</span><h3 className="hg-h3">Canais de venda</h3></div>
                <span className="tp-nota">{inteiro(canais.validas)} reservas · {inteiro(canais.canceladas)} canceladas · {inteiro(canais.noshow)} no-show</span></div>
              {canais.lista.length === 0 ? <p className="tp-vazio">Sem reservas de canais neste período.</p> : (
                <div className="hg-tabela-rolagem">
                  <table className="hg-tabela">
                    <thead><tr><th>Canal</th><th>Reservas</th><th>Noites</th><th>Valor</th><th>Part.</th><th>Diária</th><th>Antecedência</th></tr></thead>
                    <tbody>
                      {canais.lista.map((c) => (
                        <tr key={c.canal}><td>{c.canal}</td><td>{inteiro(c.reservas)}</td><td>{inteiro(c.noites)}</td><td>{moeda(c.valor)}</td>
                          <td>{perc(c.part * 100, 0)}</td><td>{moeda(c.diaria)}</td><td>{c.antecedencia == null ? "—" : `${Math.round(c.antecedencia)} dias`}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="hg-linha-dados">
                <span><span className="tp-rotulo">Estadia média</span> <b>{canais.estadia == null ? "—" : `${canais.estadia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} noites`}</b></span>
                <span><span className="tp-rotulo">Antecedência média</span> <b>{canais.antecedencia == null ? "—" : `${Math.round(canais.antecedencia)} dias`}</b></span>
                <span><span className="tp-rotulo">Cancelamento</span> <b>{canais.total ? perc((100 * canais.canceladas) / canais.total) : "—"}</b></span>
              </div>
              <p className="tp-nota">Reservas que chegam pelos canais integrados ao PMS (Omnibees, OTAs e agências). O valor é o das diárias informado pelo canal.</p>
            </section>
          </div>

          {/* Evolução mensal */}
          {ultimos.length > 1 && (
            <section className="tp-painel" aria-label="Evolução mês a mês">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Últimos {ultimos.length} meses</span><h3 className="hg-h3">Evolução mês a mês</h3></div></div>
              <GraficoBarras rotulos={ultimos.map((m) => mesCurto(m.mes))} valores={ultimos.map((m) => Math.max(0, n(m.receita)))} altura={200}
                formato={(v) => `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`} />
              <div className="hg-tabela-rolagem">
                <table className="hg-tabela hg-tabela-meses">
                  <thead><tr><th>Mês</th><th>Ocupação</th><th>Diária média</th><th>RevPAR</th><th>Diárias</th><th>Receita</th></tr></thead>
                  <tbody>
                    {[...ultimos].reverse().map((m) => (
                      <tr key={m.mes} className={m.mes.slice(0, 7) === mes ? "on" : ""} onClick={() => { setPeriodo("mes"); setMes(m.mes.slice(0, 7)); }}>
                        <td>{mesNome(m.mes.slice(0, 7))}</td><td>{perc(m.ocupacao == null ? null : Number(m.ocupacao))}</td>
                        <td>{moeda(m.diaria_media == null ? null : Number(m.diaria_media))}</td><td>{moeda(m.revpar == null ? null : Number(m.revpar))}</td>
                        <td>{inteiro(n(m.diarias_vendidas))}</td><td>{moeda(n(m.receita))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="hg-grade">
            {/* Previsão */}
            {prev.length > 0 && (
              <section className="tp-painel" aria-label="Previsão de ocupação">
                <div className="tp-painel-topo"><div><span className="tp-rotulo">O que já está vendido</span><h3 className="hg-h3">Próximos 60 dias</h3></div>
                  <span className="tp-nota">
                    30 dias: {perc(pickup.ocupacao30)} · {inteiro(pickup.agora)} diárias
                    {pickup.semanaPassada != null && <> · {pickup.agora - pickup.semanaPassada >= 0 ? "+" : ""}{inteiro(pickup.agora - pickup.semanaPassada)} na última semana</>}
                  </span></div>
                <GraficoLinhas rotulos={prev.slice(0, 60).map((p) => `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`)} altura={220}
                  formato={(v) => `${Math.round(v)}%`}
                  series={[{ nome: "Ocupação vendida", cor: "var(--serie-1)", pontos: prev.slice(0, 60).map((p) => (p.ocupacao == null ? null : Number(p.ocupacao))) }]} />
              </section>
            )}

            {/* Recebimentos */}
            <section className="tp-painel" aria-label="Recebimentos por forma de pagamento">
              <div className="tp-painel-topo"><div><span className="tp-rotulo">Caixa do período</span><h3 className="hg-h3">Recebimentos</h3></div>
                <span className="tp-nota">{moeda(formas.total)}</span></div>
              {formas.lista.length === 0 ? <p className="tp-vazio">Sem recebimentos lançados neste período.</p> : (
                <ul className="hg-barras">
                  {formas.lista.map((f) => (
                    <li key={f.forma}>
                      <span className="hg-barras-nome">{f.forma}</span>
                      <span className="hg-barras-trilho"><i style={{ width: `${Math.max(2, (100 * Math.abs(f.valor)) / Math.max(...formas.lista.map((x) => Math.abs(x.valor))))}%` }} className={f.valor < 0 ? "neg" : ""} /></span>
                      <b>{moeda(f.valor)}</b>
                    </li>
                  ))}
                </ul>
              )}
              <p className="tp-nota">Tudo o que entrou no caixa do hotel (hospedagem, consumo e extras), pela data do recebimento.</p>
            </section>
          </div>

          <p className="tp-nota hg-fonte">
            Fonte: PMS TOTVS Hospitalidade, relatórios “Disponibilidade e KPIs por Categoria e Dia”, “Produção por Channel” e “Resumo Financeiro”,
            lidos pelo robô do Brasico. Ocupação = diárias vendidas ÷ total de UHs (como no PMS); diária média = receita ÷ diárias; RevPAR = receita ÷ UHs disponíveis.
            {primeiroMes && <> Histórico desde {mesNome(primeiroMes.slice(0, 7))}.</>}
          </p>
        </>
      )}
    </div>
  );
}
