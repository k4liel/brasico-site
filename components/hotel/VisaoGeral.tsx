"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MESES, somarMeses } from "@/lib/totvs-painel";
import { COR, GraficoCombinado, Kpi, Painel, Rosca, BarrasH, Segmentos, Vazio, moeda, num, pct } from "./ui";

// Visão geral do hotel (aba 1 da página /hoteis/<hotel>): indicadores do período com minigráficos e comparação com o
// ano anterior até a mesma data, dia a dia, tipos de UH, canais, evolução de 24 meses, o que já está vendido e recebimentos.
// Fonte: PMS (robô da VPS) — pms_kpi_dia (realizado: só o que já aconteceu), pms_previsao (o que já está vendido),
// pms_reservas (canais), pms_recebimentos. Contas como no PMS: ocupação = ocupadas ÷ total de UHs;
// diária média = receita ÷ ocupadas; RevPAR = receita ÷ UHs disponíveis.

type DiaKpi = { dia: string; categoria: string; disponiveis: number; bloqueadas: number; total: number; ocupadas: number; receita: number };
type Mes = { mes: string; uh_disponiveis: number; uh_total: number; diarias_vendidas: number; receita: number; ocupacao: number | null; diaria_media: number | null; revpar: number | null };
type Reserva = { canal: string | null; checkin: string | null; noites: number | null; valor_diarias: number | null; status: string | null; cancelada_em: string | null; criada_em: string | null };
type Receb = { dia: string; grupo: string; tipo: string; valor: number };
type Prev = { dia: string; uhs: number | null; ocupadas: number | null; ocupacao: number | null };
type TxDia = { dia: string; grupo: string; valor: number };
type Periodo = "mes" | "ano" | "12m";

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
const fimDoMes = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const mesNome = (m: string) => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
const mesCurto = (m: string) => `${MESES[+m.slice(5, 7) - 1].slice(0, 3)}/${m.slice(2, 4)}`;
const anoAntes = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
const contarDias = (a: string, b: string) => (b < a ? 0 : Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1);
const canalNome = (c: string | null) => { const t = (c ?? "").trim(); const m: Record<string, string> = { booking: "Booking.com", expedia: "Expedia", "site hotel": "Site do hotel" }; return t ? m[t.toLowerCase()] ?? t : "Direto / balcão"; };

function somar(l: { disponiveis: number; total: number; ocupadas: number; receita: number }[]) {
  const disp = l.reduce((a, x) => a + n(x.disponiveis), 0), tot = l.reduce((a, x) => a + n(x.total), 0);
  const ocup = l.reduce((a, x) => a + n(x.ocupadas), 0), rec = l.reduce((a, x) => a + n(x.receita), 0);
  return { disponiveis: disp, total: tot, ocupadas: ocup, receita: rec, ocupacao: tot ? (100 * ocup) / tot : null, diaria: ocup ? rec / ocup : null, revpar: disp ? rec / disp : null };
}
const variacao = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : (a - b) / Math.abs(b));

export default function VisaoGeral({ hotel }: { hotel: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [mes, setMes] = useState(() => hoje().slice(0, 7));
  const [kpi, setKpi] = useState<DiaKpi[] | null>(null);
  const [kpiAnt, setKpiAnt] = useState<DiaKpi[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [receb, setReceb] = useState<Receb[]>([]);
  const [prev, setPrev] = useState<Prev[]>([]);
  const [prevSemana, setPrevSemana] = useState<Prev[]>([]);
  const [prevPeriodo, setPrevPeriodo] = useState<Prev[]>([]);
  const [txDia, setTxDia] = useState<TxDia[]>([]);
  const [txDiaAnt, setTxDiaAnt] = useState<TxDia[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [ini, fim] = useMemo(() => {
    if (periodo === "mes") return [`${mes}-01`, fimDoMes(mes)];
    if (periodo === "ano") return [`${mes.slice(0, 4)}-01-01`, fimDoMes(mes)];
    return [`${somarMeses(mes, -11)}-01`, fimDoMes(mes)];
  }, [periodo, mes]);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([
        supabase.from("pms_mes_hotel").select("*").eq("hotel_id", hotel).order("mes"),
        supabase.from("pms_previsao_atual").select("dia,uhs,ocupadas,ocupacao").eq("hotel_id", hotel).gte("dia", hoje()).order("dia").limit(90),
      ]);
      if (m.error) setErro(m.error.message);
      setMeses((m.data as Mes[]) ?? []);
      setPrev((p.data as Prev[]) ?? []);
      const semana = new Date(Date.now() - 7 * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
      const s = await supabase.from("pms_previsao").select("dia,uhs,ocupadas,ocupacao").eq("hotel_id", hotel).eq("lido_dia", semana).gte("dia", hoje()).limit(90);
      setPrevSemana((s.data as Prev[]) ?? []);
    })();
  }, [supabase, hotel]);

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
      const ontem = new Date(Date.parse(`${h0}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const [k, ka, rs, rc, pp, tx, txa] = await Promise.all([
        pegar(ini, fim < h0 ? fim : ontem),
        pegar(anoAntes(ini), anoAntes(fim)),
        supabase.from("pms_reservas").select("canal,checkin,noites,valor_diarias,status,cancelada_em,criada_em").eq("hotel_id", hotel).gte("checkin", ini).lte("checkin", fim).limit(5000),
        supabase.from("pms_recebimentos").select("dia,grupo,tipo,valor").eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim).limit(5000),
        fim >= h0
          ? supabase.from("pms_previsao_atual").select("dia,uhs,ocupadas,ocupacao").eq("hotel_id", hotel).gte("dia", ini > h0 ? ini : h0).lte("dia", fim).order("dia").limit(400)
          : Promise.resolve({ data: [] as Prev[] }),
        supabase.from("pms_transacoes_dia").select("dia,grupo,valor").eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim < h0 ? fim : ontem).limit(5000),
        supabase.from("pms_transacoes_dia").select("dia,grupo,valor").eq("hotel_id", hotel).gte("dia", anoAntes(ini)).lte("dia", anoAntes(fim < h0 ? fim : ontem)).limit(5000),
      ]);
      setTxDia((tx.data as TxDia[]) ?? []); setTxDiaAnt((txa.data as TxDia[]) ?? []);
      setKpi(k); setKpiAnt(ka);
      setReservas((rs.data as Reserva[]) ?? []); setReceb((rc.data as Receb[]) ?? []);
      setPrevPeriodo(((pp as { data: Prev[] | null }).data) ?? []);
    })();
  }, [supabase, hotel, ini, fim]);

  const h0 = hoje();
  const ontem = new Date(Date.parse(`${h0}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const fimReal = fim < h0 ? fim : ontem;
  const realizado = kpi ?? [];
  const s = useMemo(() => somar(realizado), [realizado]);
  const antAteData = useMemo(() => kpiAnt.filter((x) => x.dia <= anoAntes(fimReal)), [kpiAnt, fimReal]);
  const sAnt = useMemo(() => somar(antAteData), [antAteData]);
  const sAntTudo = useMemo(() => somar(kpiAnt), [kpiAnt]);
  const cobertura = useMemo(() => {
    const esperado = contarDias(ini, fimReal), tem = new Set(realizado.map((x) => x.dia)).size;
    const esperadoAnt = contarDias(anoAntes(ini), anoAntes(fimReal)), temAnt = new Set(antAteData.map((x) => x.dia)).size;
    return { faltam: Math.max(0, esperado - tem), antOk: esperadoAnt > 0 && temAnt >= esperadoAnt * 0.97, antTudoOk: new Set(kpiAnt.map((x) => x.dia)).size >= contarDias(anoAntes(ini), anoAntes(fim)) * 0.97 };
  }, [ini, fim, fimReal, realizado, antAteData, kpiAnt]);
  const comp = (a: number | null, b: number | null) => (cobertura.antOk ? variacao(a, b) : null);
  const compPp = (a: number | null, b: number | null) => (cobertura.antOk && a != null && b != null ? a - b : null);

  // Série por dia (mês) ou por mês (ano / 12 meses)
  const porMes = periodo !== "mes";
  const serie = useMemo(() => {
    const chave = (d: string) => (porMes ? d.slice(0, 7) : d);
    const agrupar = (l: DiaKpi[], deslocar = false) => {
      const m = new Map<string, DiaKpi[]>();
      for (const x of l) { const d = deslocar ? `${+x.dia.slice(0, 4) + 1}${x.dia.slice(4)}` : x.dia; const k = chave(d); m.set(k, [...(m.get(k) ?? []), x]); }
      return m;
    };
    const a = agrupar(realizado), b = agrupar(kpiAnt, true);
    const pv = new Map<string, Prev[]>();
    for (const p of prevPeriodo) { const k = chave(p.dia); pv.set(k, [...(pv.get(k) ?? []), p]); }
    const chaves = [...new Set([...a.keys(), ...b.keys(), ...pv.keys()])].filter((k) => k >= chave(ini) && k <= chave(fim)).sort();
    return chaves.map((k) => {
      const sa = a.has(k) ? somar(a.get(k)!) : null, sb = b.has(k) ? somar(b.get(k)!) : null;
      const p = pv.get(k) ?? [];
      const vend = p.reduce((x, y) => x + n(y.ocupadas), 0), uhs = p.reduce((x, y) => x + n(y.uhs), 0);
      return {
        k, receita: sa?.receita ?? null, receitaAnt: sb?.receita ?? null,
        ocupacao: sa?.ocupacao ?? null, ocupacaoAnt: sb?.ocupacao ?? null,
        vendido: !sa && uhs ? (100 * vend) / uhs : null,
        diaria: sa?.diaria ?? null, revpar: sa?.revpar ?? null, diarias: sa?.ocupadas ?? null,
      };
    });
  }, [realizado, kpiAnt, prevPeriodo, ini, fim, porMes]);

  const vendido = useMemo(() => {
    const ocup = prevPeriodo.reduce((a, p) => a + n(p.ocupadas), 0), uhs = prevPeriodo.reduce((a, p) => a + n(p.uhs), 0);
    return { dias: prevPeriodo.length, ocupadas: ocup, ocupacao: uhs ? (100 * ocup) / uhs : null, projecao: s.total + uhs ? (100 * (s.ocupadas + ocup)) / (s.total + uhs) : null };
  }, [prevPeriodo, s]);

  const porTipo = useMemo(() => {
    const m = new Map<string, DiaKpi[]>();
    for (const x of realizado) m.set(x.categoria, [...(m.get(x.categoria) ?? []), x]);
    return [...m.entries()].map(([cat, l]) => ({ cat, ...somar(l), uhs: Math.max(...l.map((x) => n(x.total))) })).sort((a, b) => b.receita - a.receita);
  }, [realizado]);

  const canais = useMemo(() => {
    const val = reservas.filter((r) => !r.cancelada_em && !/cancel|no-?show/i.test(r.status ?? ""));
    const m = new Map<string, { valor: number; noites: number; n: number }>();
    for (const r of val) { const k = canalNome(r.canal); const x = m.get(k) ?? { valor: 0, noites: 0, n: 0 }; x.valor += n(r.valor_diarias); x.noites += n(r.noites); x.n++; m.set(k, x); }
    const ant = val.filter((r) => r.criada_em && r.checkin).map((r) => (Date.parse(`${r.checkin}T12:00:00-03:00`) - Date.parse(r.criada_em!)) / 86400000);
    return { lista: [...m.entries()].map(([nome, x]) => ({ nome, ...x })).sort((a, b) => b.valor - a.valor),
      canceladas: reservas.filter((r) => r.cancelada_em || /cancel/i.test(r.status ?? "")).length, total: reservas.length,
      estadia: val.length ? val.reduce((a, r) => a + n(r.noites), 0) / val.length : null, antecedencia: ant.length ? ant.reduce((a, v) => a + v, 0) / ant.length : null };
  }, [reservas]);

  const formas = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of receb) { if (/devolu|estorno/i.test(r.tipo)) continue; m.set(r.grupo, (m.get(r.grupo) ?? 0) + n(r.valor)); }
    return [...m.entries()].map(([nome, valor]) => ({ nome: nome.charAt(0) + nome.slice(1).toLowerCase(), valor })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  }, [receb]);

  // Receita total do hotel pelas transações (diárias, consumo, spa, serviços; taxas à parte)
  const areas = useMemo(() => {
    const soma = (l: TxDia[]) => {
      const m = new Map<string, number>();
      for (const t of l) { if (t.grupo === "Pagamento") continue; m.set(t.grupo, (m.get(t.grupo) ?? 0) + Number(t.valor)); }
      return m;
    };
    const a = soma(txDia), b = soma(txDiaAnt);
    const total = (m: Map<string, number>) => [...m.entries()].filter(([g]) => g !== "Taxa").reduce((x, [, v]) => x + v, 0);
    const ordem = ["Diária", "Consumo", "Spa", "Serviço", "Taxa"];
    return { lista: ordem.filter((g) => a.has(g)).map((g) => ({ nome: g === "Diária" ? "Hospedagem" : g === "Taxa" ? "Taxas (serviço e ISS)" : g, valor: a.get(g) ?? 0,
      cor: ({ "Diária": COR.azul, Consumo: COR.ambar, Spa: COR.rosa, "Serviço": COR.violeta, Taxa: COR.cinza } as Record<string, string>)[g] })),
      total: total(a), totalAnt: b.size ? total(b) : null, temDados: txDia.length > 0 };
  }, [txDia, txDiaAnt]);

  const ultimos = useMemo(() => meses.filter((m) => m.mes <= `${h0.slice(0, 7)}-01`).slice(-24), [meses, h0]);
  const primeiroMes = useMemo(() => meses.find((x) => n(x.diarias_vendidas) > 0)?.mes ?? null, [meses]);
  const pickup = useMemo(() => {
    const antes = new Map(prevSemana.map((p) => [p.dia, n(p.ocupadas)]));
    const p30 = prev.slice(0, 30), agora = p30.reduce((a, p) => a + n(p.ocupadas), 0);
    return { agora, delta: prevSemana.length ? agora - p30.reduce((a, p) => a + (antes.get(p.dia) ?? 0), 0) : null,
      ocupacao: p30.length ? (100 * agora) / p30.reduce((a, p) => a + n(p.uhs), 0) : null };
  }, [prev, prevSemana]);

  const titulo = periodo === "mes" ? mesNome(mes) : periodo === "ano" ? `${mes.slice(0, 4)} até ${MESES[+mes.slice(5, 7) - 1]}` : `12 meses até ${mesCurto(mes)}`;
  const mesAtual = h0.slice(0, 7);
  const rx = (k: string) => (porMes ? mesCurto(k) : String(+k.slice(8, 10)));
  const rd = (k: string) => (porMes ? mesNome(k) : `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`);
  const anoA = mes.slice(0, 4), anoB = String(+mes.slice(0, 4) - 1);

  if (erro) return <Vazio>Não foi possível abrir: {erro}</Vazio>;

  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo">
        <div><span className="hx-sobre">Relatório gerencial</span><h2>{titulo}</h2></div>
        <div className="hx-controles">
          <Segmentos valor={periodo} mudar={setPeriodo} rotulo="Período" opcoes={[["mes", "Mês"], ["ano", "Ano até o mês"], ["12m", "12 meses"]]} />
          <div className="hx-navmes">
            <button type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))} disabled={!!primeiroMes && `${mes}-01` <= primeiroMes}>‹</button>
            <span>{mesCurto(mes)}</span>
            <button type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))} disabled={mes >= somarMeses(mesAtual, 12)}>›</button>
            {mes !== mesAtual && <button type="button" className="hx-hoje" onClick={() => setMes(mesAtual)}>Hoje</button>}
          </div>
        </div>
      </div>

      {kpi === null ? <div className="hx-carregando"><i /><i /><i /></div> : (
        <>
          {cobertura.faltam > 0 && (
            <div className="hx-aviso">Faltam {num(cobertura.faltam)} dias deste período no banco — o histórico ainda está chegando do PMS (ou o hotel não operava). Os números cobrem só os dias que já chegaram.</div>
          )}
          <div className="hx-kpis">
            <Kpi rotulo="Taxa de ocupação" valor={pct(s.ocupacao)} delta={compPp(s.ocupacao, sAnt.ocupacao)} pontos cor={COR.azul}
              serie={serie.filter((x) => x.ocupacao != null).map((x) => x.ocupacao)} nota={`${num(s.ocupadas)} de ${num(s.total)} UHs-noite`} ajuda="Diárias vendidas ÷ total de UHs no período" />
            <Kpi rotulo="Diária média (ADR)" valor={moeda(s.diaria)} delta={comp(s.diaria, sAnt.diaria)} cor={COR.violeta} serie={serie.filter((x) => x.diaria != null).map((x) => x.diaria)} ajuda="Receita de hospedagem ÷ diárias vendidas" />
            <Kpi rotulo="RevPAR" valor={moeda(s.revpar)} delta={comp(s.revpar, sAnt.revpar)} cor={COR.ciano} serie={serie.filter((x) => x.revpar != null).map((x) => x.revpar)} ajuda="Receita de hospedagem ÷ UHs disponíveis" />
            <Kpi rotulo="Receita de hospedagem" valor={moeda(s.receita)} delta={comp(s.receita, sAnt.receita)} cor={COR.verde} serie={serie.filter((x) => x.receita != null).map((x) => x.receita)} />
            {areas.temDados && <Kpi rotulo="Receita total do hotel" valor={moeda(areas.total)} delta={comp(areas.total, areas.totalAnt)} cor={COR.rosa}
              nota={s.ocupadas ? `${moeda(areas.total / s.ocupadas)} por diária vendida` : undefined} ajuda="Hospedagem + consumo + spa + serviços (sem taxas), pelas transações do PMS" />}
            <Kpi rotulo="Diárias vendidas" valor={num(s.ocupadas)} delta={comp(s.ocupadas, sAnt.ocupadas)} cor={COR.ambar} serie={serie.filter((x) => x.diarias != null).map((x) => x.diarias)}
              nota={cobertura.antOk ? `vs. ${anoB} até a mesma data` : "sem ano anterior completo"} />
          </div>

          {vendido.dias > 0 && (
            <div className="hx-destaque">
              <div><span className="hx-sobre">Já vendido para o resto do período</span><b>{num(vendido.ocupadas)} diárias</b><span>{pct(vendido.ocupacao)} de ocupação nos {num(vendido.dias)} dias que faltam</span></div>
              <div><span className="hx-sobre">O período fecha em pelo menos</span><b>{pct(vendido.projecao)}</b><span>{cobertura.antTudoOk ? `${anoB} fechou em ${pct(sAntTudo.ocupacao)}` : "de ocupação"}</span></div>
            </div>
          )}

          <Painel sub={porMes ? "Mês a mês" : "Dia a dia"} titulo="Receita e ocupação"
            acoes={<span className="hx-legenda-mini">Barras: receita · Linhas: ocupação {!porMes && "· pontilhado claro: já vendido"}</span>}>
            <GraficoCombinado dados={serie} x="k" altura={320} rotuloX={rx} rotuloDica={rd}
              fmtEsq={(v) => moeda(v, true)} fmtDir={(v) => `${Math.round(v)}%`}
              fmt={{ receita: (v) => moeda(v), receitaAnt: (v) => moeda(v), ocupacao: (v) => pct(v), ocupacaoAnt: (v) => pct(v), vendido: (v) => pct(v) }}
              series={[
                { chave: "receita", nome: `Receita ${anoA}`, cor: COR.azul, tipo: "barra" },
                { chave: "receitaAnt", nome: `Receita ${anoB}`, cor: COR.cinza, tipo: "barra" },
                { chave: "ocupacao", nome: `Ocupação ${anoA}`, cor: COR.verde, tipo: "linha", eixo: "dir" },
                { chave: "ocupacaoAnt", nome: `Ocupação ${anoB}`, cor: COR.ambar, tipo: "linha", eixo: "dir", tracejada: true },
                ...(porMes ? [] : [{ chave: "vendido", nome: "Já vendido", cor: COR.ciano, tipo: "linha" as const, eixo: "dir" as const, tracejada: true }]),
              ]} />
            <p className="hx-nota">Estornos e correções aparecem como receita negativa no dia em que o PMS os lançou.</p>
          </Painel>

          <div className="hx-duas">
            <Painel sub="Realizado" titulo="Receita por tipo de UH">
              {porTipo.length ? <BarrasH dados={porTipo.map((t, i) => ({ nome: t.cat, valor: t.receita, cor: [COR.azul, COR.violeta, COR.ciano, COR.verde, COR.ambar][i % 5] }))} fmt={(v) => moeda(v, true)} /> : <Vazio>Sem dados.</Vazio>}
              <table className="hx-tabela compacta">
                <thead><tr><th>Tipo</th><th>UHs</th><th>Ocupação</th><th>Diária</th><th>RevPAR</th></tr></thead>
                <tbody>{porTipo.map((t) => <tr key={t.cat}><td>{t.cat}</td><td>{num(t.uhs)}</td><td>{pct(t.ocupacao)}</td><td>{moeda(t.diaria)}</td><td>{moeda(t.revpar)}</td></tr>)}</tbody>
              </table>
            </Painel>
            <Painel sub="Check-in no período" titulo="Canais de venda">
              {canais.lista.length ? (
                canais.lista.some((c) => c.valor > 0)
                  ? <Rosca dados={canais.lista.map((c) => ({ nome: c.nome, valor: c.valor }))} fmt={(v) => moeda(v, true)} sub="em diárias pelos canais" />
                  : <Rosca dados={canais.lista.map((c) => ({ nome: c.nome, valor: c.noites }))} fmt={(v) => `${num(v)} noites`} sub="noites" />
              ) : <Vazio>Sem reservas de canais neste período.</Vazio>}
              <div className="hx-trio">
                <div><span>Estadia média</span><b>{canais.estadia == null ? "—" : `${num(canais.estadia, 1)} noites`}</b></div>
                <div><span>Antecedência</span><b>{canais.antecedencia == null ? "—" : `${Math.round(canais.antecedencia)} dias`}</b></div>
                <div><span>Cancelamento</span><b>{canais.total ? pct((100 * canais.canceladas) / canais.total) : "—"}</b></div>
              </div>
            </Painel>
          </div>

          {ultimos.length > 1 && (
            <Painel sub={`Últimos ${ultimos.length} meses`} titulo="Evolução">
              <GraficoCombinado altura={280} x="mes" rotuloX={(v) => mesCurto(v.slice(0, 7))} rotuloDica={(v) => mesNome(v.slice(0, 7))}
                dados={ultimos.map((m) => ({ mes: m.mes, receita: n(m.receita), ocupacao: m.ocupacao == null ? null : Number(m.ocupacao), diaria: m.diaria_media == null ? null : Number(m.diaria_media) }))}
                fmtEsq={(v) => moeda(v, true)} fmtDir={(v) => `${Math.round(v)}%`}
                fmt={{ receita: (v) => moeda(v), ocupacao: (v) => pct(v), diaria: (v) => moeda(v) }}
                series={[
                  { chave: "receita", nome: "Receita", cor: COR.azul, tipo: "area" },
                  { chave: "ocupacao", nome: "Ocupação", cor: COR.verde, tipo: "linha", eixo: "dir" },
                ]} />
              <div className="hx-rolagem">
                <table className="hx-tabela clicavel">
                  <thead><tr><th>Mês</th><th>Ocupação</th><th>Diária média</th><th>RevPAR</th><th>Diárias</th><th>Receita</th></tr></thead>
                  <tbody>
                    {[...ultimos].reverse().map((m) => (
                      <tr key={m.mes} className={m.mes.slice(0, 7) === mes && periodo === "mes" ? "on" : ""} onClick={() => { setPeriodo("mes"); setMes(m.mes.slice(0, 7)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        <td>{mesNome(m.mes.slice(0, 7))}</td><td>{pct(m.ocupacao == null ? null : Number(m.ocupacao))}</td>
                        <td>{moeda(m.diaria_media == null ? null : Number(m.diaria_media))}</td><td>{moeda(m.revpar == null ? null : Number(m.revpar))}</td>
                        <td>{num(n(m.diarias_vendidas))}</td><td>{moeda(n(m.receita))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Painel>
          )}

          <div className="hx-tres">
            {prev.length > 0 && (
              <Painel sub="O que já está vendido" titulo="Próximos 60 dias"
                acoes={<span className="hx-legenda-mini">30 dias: {pct(pickup.ocupacao)} · {num(pickup.agora)} diárias{pickup.delta != null && <> · <b className={pickup.delta >= 0 ? "bom" : "ruim"}>{pickup.delta >= 0 ? "+" : ""}{num(pickup.delta)} na semana</b></>}</span>}>
                <GraficoCombinado altura={240} x="dia" legenda={false} rotuloX={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} rotuloDica={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`}
                  dados={prev.slice(0, 60).map((p) => ({ dia: p.dia, ocupacao: p.ocupacao == null ? null : Number(p.ocupacao) }))}
                  fmtEsq={(v) => `${Math.round(v)}%`} fmt={{ ocupacao: (v) => pct(v) }}
                  series={[{ chave: "ocupacao", nome: "Ocupação vendida", cor: COR.ciano, tipo: "area" }]} />
              </Painel>
            )}
            <Painel sub="Pelas transações do PMS" titulo="Receita por área">
              {areas.temDados ? <Rosca dados={areas.lista} fmt={(v) => moeda(v, true)} centro={moeda(areas.total, true)} sub="sem taxas" /> : <Vazio>As transações deste período ainda estão chegando do PMS.</Vazio>}
            </Painel>
            <Painel sub="Caixa do período" titulo="Recebimentos">
              {formas.length ? <Rosca dados={formas} fmt={(v) => moeda(v, true)} sub="recebido" /> : <Vazio>Sem recebimentos lançados neste período.</Vazio>}
            </Painel>
          </div>

          <p className="hx-fonte">Fonte: PMS TOTVS Hospitalidade, lido pelo robô do Brasico. Ocupação = diárias vendidas ÷ total de UHs (como no PMS) · diária média = receita ÷ diárias · RevPAR = receita ÷ UHs disponíveis.{primeiroMes && <> Histórico desde {mesNome(primeiroMes.slice(0, 7))}.</>}</p>
        </>
      )}
    </div>
  );
}
