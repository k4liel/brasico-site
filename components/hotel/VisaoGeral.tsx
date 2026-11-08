"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MESES, somarMeses } from "@/lib/totvs-painel";
import { COR, GraficoCombinado, Kpi, Lista, Painel, Resumo, Segmentos, Vazio, compacto, moeda, num, reais, pct } from "./ui";

// Visão geral do hotel (aba 1 da página /hoteis/<hotel>): indicadores do período com minigráficos e comparação com o
// ano anterior até a mesma data, dia a dia, tipos de UH, canais, evolução de 24 meses, o que já está vendido e recebimentos.
// Fonte: PMS (robô da VPS) — pms_kpi_dia_ajustado (pms_kpi_dia com o nº real de UHs por tipo; realizado: só o que já aconteceu), pms_previsao (o que já está vendido),
// pms_reservas (canais), pms_recebimentos. Contas como no PMS: ocupação = ocupadas ÷ total de UHs;
// diária média = receita ÷ ocupadas; RevPAR = receita ÷ UHs disponíveis.

type DiaKpi = { dia: string; categoria: string; disponiveis: number; bloqueadas: number; total: number; ocupadas: number; receita: number };
type Mes = { mes: string; uh_disponiveis: number; uh_total: number; diarias_vendidas: number; receita: number; ocupacao: number | null; diaria_media: number | null; revpar: number | null };
type Reserva = { canal: string | null; checkin: string | null; noites: number | null; valor_diarias: number | null; status: string | null; cancelada_em: string | null; criada_em: string | null };
type Receb = { dia: string; grupo: string; tipo: string; valor: number };
type Prev = { dia: string; uhs: number | null; ocupadas: number | null; ocupacao: number | null };
type TxDia = { dia: string; grupo: string; valor: number };
type TxPag = { descricao: string | null; valor: number };
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
  const [txPag, setTxPag] = useState<TxPag[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [verTabela, setVerTabela] = useState(false);

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
          const r = await supabase.from("pms_kpi_dia_ajustado").select("dia,categoria,disponiveis,bloqueadas,total,ocupadas,receita")
            .eq("hotel_id", hotel).gte("dia", a).lte("dia", b).order("dia").range(de, de + 999);
          if (r.error) { setErro(r.error.message); break; }
          out.push(...((r.data as DiaKpi[]) ?? []));
          if ((r.data ?? []).length < 1000) break;
        }
        return out;
      };
      const h0 = hoje();
      const ontem = new Date(Date.parse(`${h0}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const [k, ka, rs, rc, pp, tx, txa, tp] = await Promise.all([
        pegar(ini, fim < h0 ? fim : ontem),
        pegar(anoAntes(ini), anoAntes(fim)),
        supabase.from("pms_reservas").select("canal,checkin,noites,valor_diarias,status,cancelada_em,criada_em").eq("hotel_id", hotel).gte("checkin", ini).lte("checkin", fim).limit(5000),
        supabase.from("pms_recebimentos").select("dia,grupo,tipo,valor").eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim).limit(5000),
        fim >= h0
          ? supabase.from("pms_previsao_atual").select("dia,uhs,ocupadas,ocupacao").eq("hotel_id", hotel).gte("dia", ini > h0 ? ini : h0).lte("dia", fim).order("dia").limit(400)
          : Promise.resolve({ data: [] as Prev[] }),
        supabase.from("pms_transacoes_dia").select("dia,grupo,valor").eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim < h0 ? fim : ontem).limit(5000),
        supabase.from("pms_transacoes_dia").select("dia,grupo,valor").eq("hotel_id", hotel).gte("dia", anoAntes(ini)).lte("dia", anoAntes(fim < h0 ? fim : ontem)).limit(5000),
        supabase.from("pms_transacoes").select("descricao,valor").eq("hotel_id", hotel).eq("grupo", "Pagamento").gte("dia", ini).lte("dia", fim).limit(10000),
      ]);
      setTxPag((tp.data as TxPag[]) ?? []);
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
    if (txPag.length) { // pagamentos lançados no PMS (mais completos e atualizados que o relatório de recebimentos)
      for (const t of txPag) { const k = (t.descricao ?? "Outros").trim(); m.set(k, (m.get(k) ?? 0) + Number(t.valor)); }
      return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
    }
    for (const r of receb) { if (/devolu|estorno/i.test(r.tipo)) continue; m.set(r.grupo, (m.get(r.grupo) ?? 0) + n(r.valor)); }
    return [...m.entries()].map(([nome, valor]) => ({ nome: nome.charAt(0) + nome.slice(1).toLowerCase(), valor })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  }, [receb, txPag]);

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
  const vs = cobertura.antOk ? anoB : undefined;

  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo">
        <h2>{titulo}</h2>
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
            <div className="hx-aviso">Faltam {num(cobertura.faltam)} dias deste período no banco (o histórico ainda está chegando do PMS). Os números cobrem só os dias que já chegaram.</div>
          )}

          <div className="hx-kpis">
            <Kpi rotulo="Ocupação" valor={pct(s.ocupacao)} delta={compPp(s.ocupacao, sAnt.ocupacao)} pontos vs={vs}
              nota={`${num(s.ocupadas)} de ${num(s.total)} diárias`} ajuda="Diárias vendidas ÷ total de UHs no período" />
            <Kpi rotulo="Diária média" valor={moeda(s.diaria)} delta={comp(s.diaria, sAnt.diaria)} vs={vs} ajuda="Receita de hospedagem ÷ diárias vendidas" />
            <Kpi rotulo="RevPAR" valor={moeda(s.revpar)} delta={comp(s.revpar, sAnt.revpar)} vs={vs} ajuda="Receita de hospedagem ÷ UHs disponíveis" />
            {areas.temDados
              ? <Kpi rotulo="Receita total" valor={moeda(areas.total)} delta={comp(areas.total, areas.totalAnt)} vs={vs} nota={`hospedagem ${moeda(s.receita)}`}
                  ajuda="Hospedagem + consumo + spa + serviços (sem taxas), pelas transações do PMS" />
              : <Kpi rotulo="Receita de hospedagem" valor={moeda(s.receita)} delta={comp(s.receita, sAnt.receita)} vs={vs} />}
          </div>

          <Resumo itens={[
            { rotulo: "Diárias vendidas", valor: num(s.ocupadas), nota: cobertura.antOk ? `${num(sAnt.ocupadas)} em ${anoB}` : undefined },
            { rotulo: "Receita de hospedagem", valor: moeda(s.receita) },
            ...(vendido.dias > 0 ? [
              { rotulo: "Já vendido no resto do período", valor: `${num(vendido.ocupadas)} diárias`, nota: `${pct(vendido.ocupacao)} nos ${num(vendido.dias)} dias que faltam` },
              { rotulo: "Fecha em pelo menos", valor: pct(vendido.projecao), nota: cobertura.antTudoOk ? `${anoB} fechou em ${pct(sAntTudo.ocupacao)}` : "de ocupação" },
            ] : []),
          ]} />

          <Painel titulo="Receita e ocupação" sub={porMes ? "mês a mês" : "dia a dia"}>
            <GraficoCombinado dados={serie} x="k" altura={300} rotuloX={rx} rotuloDica={rd}
              fmtEsq={(v) => compacto(v)} fmtDir={(v) => `${Math.round(v)}%`}
              fmt={{ receita: (v) => moeda(v), ocupacao: (v) => pct(v), ocupacaoAnt: (v) => pct(v), vendido: (v) => pct(v) }}
              series={[
                { chave: "receita", nome: "Receita de hospedagem (R$)", cor: COR.azul, tipo: "barra" },
                { chave: "ocupacao", nome: "Ocupação", cor: COR.verde, tipo: "linha", eixo: "dir" },
                ...(cobertura.antTudoOk || cobertura.antOk ? [{ chave: "ocupacaoAnt", nome: `Ocupação ${anoB}`, cor: COR.cinza, tipo: "linha" as const, eixo: "dir" as const, tracejada: true }] : []),
                ...(!porMes && vendido.dias > 0 ? [{ chave: "vendido", nome: "Já vendido", cor: COR.ambar, tipo: "linha" as const, eixo: "dir" as const, tracejada: true }] : []),
              ]} />
          </Painel>

          <div className="hx-duas">
            <Painel titulo="Receita por área" sub="pelas transações do PMS">
              {areas.temDados ? <Lista dados={areas.lista} fmt={reais} total={areas.lista.filter((a) => a.nome !== "Taxas (serviço e ISS)").reduce((x, a) => x + a.valor, 0)} />
                : <Vazio>As transações deste período ainda estão chegando do PMS.</Vazio>}
            </Painel>
            <Painel titulo="Canais de venda" sub="check-in no período, sem canceladas">
              {canais.lista.length
                ? <Lista dados={canais.lista.map((c) => ({ nome: c.nome, valor: canais.lista.some((x) => x.valor > 0) ? c.valor : c.noites }))}
                    fmt={canais.lista.some((x) => x.valor > 0) ? reais : (v) => `${num(v)} noites`} />
                : <Vazio>Sem reservas de canais neste período.</Vazio>}
              <Resumo itens={[
                { rotulo: "Estadia média", valor: canais.estadia == null ? "—" : `${num(canais.estadia, 1)} noites` },
                { rotulo: "Antecedência", valor: canais.antecedencia == null ? "—" : `${Math.round(canais.antecedencia)} dias` },
                { rotulo: "Cancelamento", valor: canais.total ? pct((100 * canais.canceladas) / canais.total) : "—" },
              ]} />
            </Painel>
          </div>

          <div className="hx-duas">
            <Painel titulo="Tipos de UH" sub="realizado no período">
              {porTipo.length ? (
                <div className="hx-rolagem">
                  <table className="hx-tabela">
                    <thead><tr><th>Tipo</th><th className="num">Ocupação</th><th className="num">Diária</th><th className="num">Receita</th></tr></thead>
                    <tbody>{porTipo.map((t) => (
                      <tr key={t.cat}><td>{t.cat}<small className="muted">{num(t.uhs)} UH{t.uhs === 1 ? "" : "s"}</small></td>
                        <td className="num">{pct(t.ocupacao)}</td><td className="num">{moeda(t.diaria)}</td><td className="num hx-forte">{reais(t.receita)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <Vazio>Sem dados.</Vazio>}
            </Painel>
            <Painel titulo="Recebimentos" sub="formas de pagamento no período">
              <Lista dados={formas} fmt={reais} cor={COR.verde} />
            </Painel>
          </div>

          {prev.length > 0 && (
            <Painel titulo="Próximos 60 dias" sub="ocupação já vendida"
              acoes={<span className="hx-legenda-mini">Próximos 30 dias: <b>{pct(pickup.ocupacao)}</b>{pickup.delta != null && <> · <b className={pickup.delta >= 0 ? "bom" : "ruim"}>{pickup.delta >= 0 ? "+" : ""}{num(pickup.delta)} diárias</b> na última semana</>}</span>}>
              <GraficoCombinado altura={200} x="dia" legenda={false} rotuloX={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} rotuloDica={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`}
                dados={prev.slice(0, 60).map((p) => ({ dia: p.dia, ocupacao: p.ocupacao == null ? null : Number(p.ocupacao) }))}
                fmtDir={(v) => `${Math.round(v)}%`} fmt={{ ocupacao: (v) => pct(v) }}
                series={[{ chave: "ocupacao", nome: "Ocupação vendida", cor: COR.azul, tipo: "area", eixo: "dir" }]} />
            </Painel>
          )}

          {ultimos.length > 1 && (
            <Painel titulo="Evolução" sub={`últimos ${ultimos.length} meses`}
              acoes={<button type="button" className="hx-botao" onClick={() => setVerTabela(!verTabela)}>{verTabela ? "Ver gráfico" : "Ver tabela"}</button>}>
              {!verTabela ? (
                <GraficoCombinado altura={260} x="mes" rotuloX={(v) => mesCurto(v.slice(0, 7))} rotuloDica={(v) => mesNome(v.slice(0, 7))}
                  dados={ultimos.map((m) => ({ mes: m.mes, receita: n(m.receita), ocupacao: m.ocupacao == null ? null : Number(m.ocupacao) }))}
                  fmtEsq={(v) => compacto(v)} fmtDir={(v) => `${Math.round(v)}%`}
                  fmt={{ receita: (v) => moeda(v), ocupacao: (v) => pct(v) }}
                  series={[
                    { chave: "receita", nome: "Receita de hospedagem (R$)", cor: COR.azul, tipo: "barra" },
                    { chave: "ocupacao", nome: "Ocupação", cor: COR.verde, tipo: "linha", eixo: "dir" },
                  ]} />
              ) : (
                <div className="hx-rolagem">
                  <table className="hx-tabela clicavel">
                    <thead><tr><th>Mês</th><th className="num">Ocupação</th><th className="num">Diária média</th><th className="num">RevPAR</th><th className="num">Diárias</th><th className="num">Receita</th></tr></thead>
                    <tbody>
                      {[...ultimos].reverse().map((m) => (
                        <tr key={m.mes} className={m.mes.slice(0, 7) === mes && periodo === "mes" ? "on" : ""} onClick={() => { setPeriodo("mes"); setMes(m.mes.slice(0, 7)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                          <td>{mesNome(m.mes.slice(0, 7))}</td><td className="num">{pct(m.ocupacao == null ? null : Number(m.ocupacao))}</td>
                          <td className="num">{moeda(m.diaria_media == null ? null : Number(m.diaria_media))}</td><td className="num">{moeda(m.revpar == null ? null : Number(m.revpar))}</td>
                          <td className="num">{num(n(m.diarias_vendidas))}</td><td className="num hx-forte">{moeda(n(m.receita))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Painel>
          )}

          <p className="hx-fonte">Fonte: PMS TOTVS Hospitalidade, lido pelo robô do Brasico. Ocupação = diárias vendidas ÷ total de UHs (como no PMS) · diária média = receita ÷ diárias · RevPAR = receita ÷ UHs disponíveis. Estornos aparecem como receita negativa no dia em que o PMS os lançou.{primeiroMes && <> Histórico desde {mesNome(primeiroMes.slice(0, 7))}.</>}</p>
        </>
      )}
    </div>
  );
}
