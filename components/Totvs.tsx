"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { Garcons, Indicador, PainelDia, Perdas, Produtos, Variacao } from "./TotvsPartes";
import { DetalheHotel, type HotelDia, type HotelInfo, nomeHotel, somarHotel, ultimoDiaHotel } from "./VendasHoteis";
import {
  type Dia, type Historico, type Ponto, type Unidade, MESES, SEMANA, comMovimento, dataBr, dataLonga, diaSemana, diasNoMes,
  escalaBonita, hojeFortaleza, inteiro, maiuscula, mesAnterior, nomeMes, pct, planilhaDoMes, plural, reais, reaisCurto, somar, somarMeses,
} from "@/lib/totvs-painel";

// Página TOTVS: painel das unidades (no estilo do dashboard do Cicchetti Management) com os dados
// já puxados da TOTVS Chef Web (totvs_dias), e o desenho de como a integração funciona.

function Seta() {
  return (
    <div className="tt-seta" aria-hidden="true">
      <svg width="16" height="26" viewBox="0 0 16 26"><path d="M8 0v22M2 16l6 7 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}

export default function Totvs({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [meses, setMeses] = useState<string[]>([]);
  const [mes, setMes] = useState(() => hojeFortaleza().slice(0, 7));
  const [unidade, setUnidade] = useState<string | null>(null);
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [serie, setSerie] = useState<Ponto[] | null>(null);
  const [puxando, setPuxando] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  // O detalhe do dia já vem aberto no último dia com venda; só fecha quando a pessoa fecha
  const [fechouDia, setFechouDia] = useState(false);
  const [historico, setHistorico] = useState<Historico[]>([]);
  // Unidades encerradas: ficam só como arquivo (sem extração), com o resumo de toda a operação
  const [encerradas, setEncerradas] = useState<Unidade[]>([]);
  const [arquivo, setArquivo] = useState<Record<string, Ponto[]>>({});
  // Hotéis (PMS): só aparecem para quem vê os dados dos hotéis (os sócios)
  const [hoteis, setHoteis] = useState<HotelInfo[]>([]);
  const [hoteisDias, setHoteisDias] = useState<HotelDia[] | null>(null);
  // Hotel escolhido nos cartões do topo (null = uma unidade da TOTVS)
  const [hotelSel, setHotelSel] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("totvs_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      const { data: u } = await supabase.from("totvs_unidades").select("id,nome,loja,ativa,ordem,encerrada_em").order("ordem");
      const todas = (u ?? []) as Unidade[];
      const lista = todas.filter((x) => x.ativa && x.loja != null && !x.encerrada_em);
      const fechadas = todas.filter((x) => x.encerrada_em);
      setUnidades(lista);
      setEncerradas(fechadas);
      setUnidade((atual) => atual ?? lista[0]?.id ?? null);
      const arq: Record<string, Ponto[]> = {};
      for (const f of fechadas) {
        const { data: pts } = await supabase.from("totvs_dias").select("dia,total,pessoas,status").eq("unidade_id", f.id)
          .lte("dia", f.encerrada_em as string).order("dia").limit(5000);
        arq[f.id] = (pts ?? []) as Ponto[];
      }
      setArquivo(arq);
      const { data: hs } = await supabase.from("pms_hoteis").select("id,nome,totvs_unidade").eq("ativa", true).order("id");
      setHoteis((hs ?? []) as HotelInfo[]);
    })();
  }, [supabase, userId]);

  // Meses com dados e andamento da busca do histórico (mudam enquanto o histórico chega)
  const carregarMeses = useCallback(async () => {
    if (!acesso) return;
    const { data: p } = await supabase.from("totvs_dias").select("dia").order("dia", { ascending: true }).limit(1);
    const primeiro = (p?.[0]?.dia as string | undefined)?.slice(0, 7) ?? hojeFortaleza().slice(0, 7);
    const ms: string[] = [];
    for (let m = hojeFortaleza().slice(0, 7); m >= primeiro; m = mesAnterior(m)) ms.push(m);
    setMeses(ms);
    const { data: h } = await supabase.from("totvs_historico").select("unidade_id,cursor,parado,motivo");
    setHistorico((h ?? []) as Historico[]);
  }, [supabase, acesso]);

  // O mês escolhido e o anterior, com todos os detalhes
  const carregar = useCallback(async () => {
    if (!acesso) return;
    const de = `${mesAnterior(mes)}-01`;
    const ate = `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
    const { data } = await supabase.from("totvs_dias")
      .select("unidade_id,dia,status,vendas,pessoas,total,resumo,produtos,pagamentos,garcons,cancelados,sangrias,divergencias")
      .gte("dia", de).lte("dia", ate).order("dia");
    setDias((data ?? []) as Dia[]);
  }, [supabase, acesso, mes]);

  // Só os totais dos 24 meses até o escolhido, para a evolução e a comparação com o ano anterior
  const carregarSerie = useCallback(async () => {
    if (!acesso || !unidade) return;
    const { data } = await supabase.from("totvs_dias").select("dia,total,pessoas,status").eq("unidade_id", unidade)
      .gte("dia", `${somarMeses(mes, -23)}-01`).lte("dia", `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`).order("dia").limit(1000);
    setSerie((data ?? []) as Ponto[]);
  }, [supabase, acesso, unidade, mes]);

  // Faturamento dos hotéis no mês escolhido e no anterior (função vendas_hoteis_dia)
  const carregarHoteis = useCallback(async () => {
    if (!acesso || !hoteis.length) return;
    setHoteisDias(null);
    const { data } = await supabase.rpc("vendas_hoteis_dia", { p_de: `${mesAnterior(mes)}-01`, p_ate: `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}` });
    setHoteisDias((data ?? []) as HotelDia[]);
  }, [supabase, acesso, hoteis.length, mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    carregarHoteis();
  }, [carregarHoteis]);

  useEffect(() => {
    carregarSerie();
  }, [carregarSerie]);

  useEffect(() => {
    carregarMeses();
  }, [carregarMeses]);

  useEffect(() => {
    setAberto(null);
    setFechouDia(false);
  }, [mes, unidade]);

  useEffect(() => {
    if (!acesso) return;
    const ch = supabase.channel("totvs-painel")
      .on("postgres_changes", { event: "*", schema: "public", table: "totvs_dias" }, () => {
        carregar();
        carregarSerie();
        carregarMeses();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, acesso, carregar, carregarSerie, carregarMeses]);

  if (acesso === false)
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="vendas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à integração com a TOTVS.</p></main>
      </div>
    );

  const hoje = hojeFortaleza();
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const mesAtual = mes === hoje.slice(0, 7);
  // Ontem só "falta" depois da agenda das 4h30 (que tenta de novo até as 6h30)
  const antesDaAgenda = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours() < 7;
  const ultimoPossivel = mesAtual ? ontem : `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
  // Unidade encerrada: nada depois do último dia de operação entra nas contas
  const fimDe = (id: string) => encerradas.find((u) => u.id === id)?.encerrada_em ?? null;
  const operando = (d: { unidade_id: string; dia: string }) => { const f = fimDe(d.unidade_id); return !f || d.dia <= f; };
  const doMes = (dias ?? []).filter((d) => d.dia.startsWith(mes) && operando(d));
  const doAnterior = (dias ?? []).filter((d) => d.dia.startsWith(mesAnterior(mes)) && operando(d));

  // Resumo de cada unidade no mês (a encerrada aparece nos meses em que ainda operava)
  const noMes = [...unidades, ...encerradas.filter((u) => (u.encerrada_em as string).slice(0, 7) >= mes && (arquivo[u.id] ?? []).some((p) => p.dia.startsWith(mes)))];
  const resumoDe = (u: Unidade) => {
    const ds = doMes.filter((d) => d.unidade_id === u.id);
    const s = somar(ds);
    const ultimo = ds[ds.length - 1];
    const fim = u.encerrada_em && u.encerrada_em < ultimoPossivel ? u.encerrada_em : ultimoPossivel;
    const diasEsperados = fim.startsWith(mes) ? Math.max(0, +fim.slice(8, 10) - (!u.encerrada_em && mesAtual && antesDaAgenda && !ds.some((d) => d.dia === ontem) ? 1 : 0)) : 0;
    return { u, ds, s, ultimo, diasEsperados, revisar: ds.filter((d) => d.status === "revisar").length };
  };
  const resumoUnidades = noMes.map(resumoDe);

  const unidadeSel = [...unidades, ...encerradas].find((u) => u.id === unidade);
  const encerradaSel = unidadeSel?.encerrada_em ?? null;
  const sel = resumoUnidades.find((x) => x.u.id === unidade) ?? (unidadeSel ? resumoDe(unidadeSel) : undefined);
  const ds = sel?.ds ?? [];
  const ativos = ds.filter(comMovimento);
  const s = somar(ds);
  const produtosValor = s.comida + s.bebida + s.outros;
  const nDias = ativos.length;
  const ultimoDia = ds[ds.length - 1]?.dia;
  const limiteDia = ultimoDia ? +ultimoDia.slice(8, 10) : 0;
  // Projeção pelos dias corridos do calendário (dias fechados também contam), não só pelos dias com venda
  const projecao = !encerradaSel && mesAtual && limiteDia && limiteDia < diasNoMes(mes) ? (s.total / limiteDia) * diasNoMes(mes) : null;

  // Comparações no mesmo trecho do mês: mês anterior e mesmo mês do ano anterior
  const anteriorAteDia = doAnterior.filter((d) => d.unidade_id === unidade && +d.dia.slice(8, 10) <= limiteDia);
  const totalAnterior = somar(anteriorAteDia).total;
  const anteriorCompleto = limiteDia > 0 && anteriorAteDia.length >= Math.ceil(limiteDia * 0.9);
  const mesAnoAntes = somarMeses(mes, -12);
  const anoAntes = (serie ?? []).filter((p) => p.dia.startsWith(mesAnoAntes) && +p.dia.slice(8, 10) <= limiteDia && (!encerradaSel || p.dia <= encerradaSel));
  const totalAnoAntes = anoAntes.reduce((a, p) => a + Number(p.total), 0);
  const anoAntesCompleto = limiteDia > 0 && anoAntes.length >= Math.ceil(limiteDia * 0.9) && totalAnoAntes > 0;

  const faltam: string[] = [];
  const ultimoDaUnidade = encerradaSel && encerradaSel < ultimoPossivel ? encerradaSel : ultimoPossivel;
  if (!encerradaSel) for (let i = 1; i <= +ultimoPossivel.slice(8, 10); i++) {
    const d = `${mes}-${String(i).padStart(2, "0")}`;
    if (d <= ultimoPossivel && !ds.some((x) => x.dia === d) && !(d === ontem && antesDaAgenda)) faltam.push(d);
  }

  const maxDia = Math.max(...ds.map((d) => Number(d.total)), 1);
  const melhor = ativos.reduce<Dia | undefined>((m, d) => (!m || Number(d.total) > Number(m.total) ? d : m), undefined);

  const buscando = historico.filter((h) => !h.parado);

  // Um dia por vez: vários pedidos juntos fazem a TOTVS estourar o tempo
  async function puxarFaltantes() {
    if (!unidade || !faltam.length) return;
    let falhas = 0;
    for (const [i, d] of faltam.entries()) {
      setPuxando(`Pedindo ${dataBr(d)} à TOTVS (${i + 1} de ${faltam.length})…`);
      const { data: id } = await supabase.rpc("totvs_extrair", { p_unidade: unidade, p_dia: d });
      let status = "rodando";
      for (let t = 0; t < 60 && id && (status === "na_fila" || status === "rodando"); t++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const { data: e } = await supabase.from("totvs_execucoes").select("status").eq("id", id).maybeSingle();
        status = e?.status ?? status;
      }
      if (!id || status === "falha" || status === "rodando") falhas++;
    }
    setPuxando(falhas ? `Terminei, mas ${falhas} dia(s) não vieram. Tente de novo daqui a pouco.` : "Pronto: todos os dias pedidos chegaram.");
  }

  function baixarPlanilha() {
    if (!sel) return;
    const blob = new Blob([planilhaDoMes(sel.u.nome, ds)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vendas-${sel.u.id}-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Cartões do topo: restaurantes da TOTVS e hotéis inteiros (PMS). O restaurante com caixa na TOTVS que pertence
  // a um hotel (Filha da Lua) entra só uma vez, dentro do hotel, separado em hospedagem e restaurante.
  const hoteisMes = (hoteisDias ?? []).filter((d) => d.dia.startsWith(mes) && d.dia <= hoje);
  const hoteisNoMes = hoteis.filter((h) => hoteisDias === null || hoteisMes.some((d) => d.hotel_id === h.id));
  const ligadas = new Set(hoteisNoMes.map((h) => h.totvs_unidade).filter(Boolean));
  const unidadesCartao = resumoUnidades.filter((x) => !ligadas.has(x.u.id));
  const hoteisCartao = hoteisNoMes.map((h) => {
    const dh = hoteisMes.filter((d) => d.hotel_id === h.id);
    return { h, s: somarHotel(dh), ultimo: ultimoDiaHotel(dh) };
  });
  const totalGeral = unidadesCartao.reduce((a, x) => a + x.s.total, 0) + hoteisCartao.reduce((a, x) => a + x.s.total, 0);
  const hotelAtivo = hoteisNoMes.find((h) => h.id === hotelSel) ?? null;
  // Restaurante do hotel escolhido com caixa na TOTVS: o detalhe da TOTVS aparece embaixo do hotel
  const mostrarTotvs = !hotelAtivo || (!!hotelAtivo.totvs_unidade && hotelAtivo.totvs_unidade === unidade);
  function escolherUnidade(id: string) { setHotelSel(null); setUnidade(id); }
  function escolherHotel(h: HotelInfo) { setHotelSel(h.id); if (h.totvs_unidade) setUnidade(h.totvs_unidade); }
  const escala = escalaBonita(maxDia);
  const diaFoco = foco ? ds.find((d) => d.dia === foco) : undefined;
  const diaPadrao = (ativos[ativos.length - 1] ?? ds[ds.length - 1])?.dia ?? null;
  const abertoAgora = aberto ?? (fechouDia ? null : diaPadrao);
  const iAberto = abertoAgora ? ds.findIndex((d) => d.dia === abertoAgora) : -1;
  const diaAberto = iAberto >= 0 ? ds[iAberto] : undefined;
  const anos = Array.from(new Set(meses.map((m) => m.slice(0, 4)))).sort();
  const mix = [
    { nome: "Comida", valor: s.comida, cor: "tp-cor-comida" },
    { nome: "Bebida", valor: s.bebida, cor: "tp-cor-bebida" },
    { nome: "Outros", valor: s.outros, cor: "tp-cor-outros" },
  ].filter((x) => x.valor > 0);

  // Resumo de toda a operação de cada unidade encerrada (o "arquivo")
  const resumoArquivo = encerradas.map((u) => {
    const pts = (arquivo[u.id] ?? []).filter(comMovimento);
    const total = pts.reduce((a, p) => a + Number(p.total), 0);
    const pessoas = pts.reduce((a, p) => a + Number(p.pessoas), 0);
    const porMes = new Map<string, number>();
    for (const p of pts) porMes.set(p.dia.slice(0, 7), (porMes.get(p.dia.slice(0, 7)) ?? 0) + Number(p.total));
    const melhorMes = [...porMes.entries()].sort((a, b) => b[1] - a[1])[0];
    return { u, inicio: pts[0]?.dia ?? null, total, pessoas, dias: pts.length, meses: porMes.size, melhorMes };
  });

  function abrirArquivo(u: Unidade) {
    escolherUnidade(u.id);
    const ultimoMes = (u.encerrada_em as string).slice(0, 7);
    if (mes > ultimoMes) setMes(ultimoMes);
    requestAnimationFrame(() => document.getElementById("tp-unidade")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function abrirDia(dia: string) {
    const fechar = abertoAgora === dia;
    setAberto(fechar ? null : dia);
    setFechouDia(fechar);
    requestAnimationFrame(() => document.getElementById("tp-dia")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="vendas" />
      <main className="miolo tp">
        <header className="tp-cabeca">
          <div>
            <span className="tp-sobre">Restaurantes e hotéis</span>
            <h1>Faturamento das operações</h1>
          </div>
        </header>

        {/* Período: mês e ano em duas caixas; meses sem dados ficam desativados */}
        <nav className="tp-periodo" aria-label="Escolher período">
          <select aria-label="Mês" value={mes.slice(5)} onChange={(e) => setMes(`${mes.slice(0, 4)}-${e.target.value}`)}>
            {MESES.map((nome, i) => {
              const mm = String(i + 1).padStart(2, "0");
              const m = `${mes.slice(0, 4)}-${mm}`;
              return <option key={mm} value={mm} disabled={!meses.includes(m) || (!!encerradaSel && m > encerradaSel.slice(0, 7))}>{maiuscula(nome)}</option>;
            })}
          </select>
          <select aria-label="Ano" value={mes.slice(0, 4)}
            onChange={(e) => { const a = e.target.value; setMes(meses.find((m) => m.startsWith(a) && m.slice(5) === mes.slice(5)) ?? meses.filter((m) => m.startsWith(a)).pop() ?? mes); }}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </nav>

        {buscando.length > 0 && (
          <p className="tp-sinc">
            <span className="tp-pulso" aria-hidden="true" />
            <span>
              Importando o histórico da TOTVS, do mais recente para o mais antigo. Agora em{" "}
              {buscando.map((h) => `${unidades.find((u) => u.id === h.unidade_id)?.nome ?? h.unidade_id} ${dataBr(h.cursor)}/${h.cursor.slice(0, 4)}`).join(" · ")}.
            </span>
          </p>
        )}

        {/* Um cartão por operação: restaurante (TOTVS) ou hotel inteiro (PMS) */}
        <section className="tp-painel tp-geral" aria-label="Faturamento das operações">
          <div className="tp-geral-total">
            <span className="tp-rotulo">Faturamento no mês</span>
            <b className="tp-numero tp-numero-xl">{dias === null ? "—" : reais(totalGeral)}</b>
            <span className="tp-nota">{maiuscula(nomeMes(mes))} · {plural(unidadesCartao.length + hoteisCartao.length, "operação", "operações")}</span>
          </div>
          <div className="tp-geral-unidades">
            {unidadesCartao.map(({ u, s: su, ds: dsu, ultimo, diasEsperados, revisar }) => {
              const on = !hotelAtivo && u.id === unidade;
              return (
                <button key={u.id} className={on ? "tp-unidade on" : "tp-unidade"} onClick={() => escolherUnidade(u.id)} aria-pressed={on}>
                  <span className="tp-unidade-nome">{u.nome}</span>
                  {u.encerrada_em && <span className="tp-encerrada">Encerrada em {dataLonga(u.encerrada_em)}</span>}
                  <b className="tp-numero">{dias === null ? "—" : reais(su.total)}</b>
                  <span className="tp-participa" aria-hidden="true"><i style={{ width: `${totalGeral ? (su.total / totalGeral) * 100 : 0}%` }} /></span>
                  <span className="tp-nota">
                    Restaurante · {totalGeral ? `${pct(su.total / totalGeral)} do total · ` : ""}{dsu.length}/{diasEsperados} dias
                    {ultimo ? ` · até ${dataBr(ultimo.dia)}` : ""}
                  </span>
                  {revisar > 0 && <span className="tp-selo">{revisar} para revisar</span>}
                </button>
              );
            })}
            {hoteisCartao.map(({ h, s: sh, ultimo }) => {
              const on = hotelAtivo?.id === h.id;
              const carregando = hoteisDias === null || dias === null;
              return (
                <button key={h.id} className={on ? "tp-unidade on" : "tp-unidade"} onClick={() => escolherHotel(h)} aria-pressed={on}>
                  <span className="tp-unidade-nome">{nomeHotel(h)}</span>
                  <b className="tp-numero">{carregando ? "—" : reais(sh.total)}</b>
                  <span className="tp-participa" aria-hidden="true"><i style={{ width: `${totalGeral ? (sh.total / totalGeral) * 100 : 0}%` }} /></span>
                  <ul className="tp-unidade-partes">
                    <li><i className="tp-cor-hosp" aria-hidden="true" /><span>Hospedagem</span><b>{carregando ? "—" : reais(sh.hospedagem)}</b></li>
                    <li><i className="tp-cor-comida" aria-hidden="true" /><span>Restaurante</span><b>{carregando ? "—" : reais(sh.restaurante)}</b></li>
                  </ul>
                  <span className="tp-nota">
                    {totalGeral && !carregando ? `${pct(sh.total / totalGeral)} do total` : ""}{ultimo ? ` · até ${dataBr(ultimo)}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {resumoArquivo.length > 0 && (
          <section className="tp-arquivo" aria-label="Unidades encerradas">
            <div className="tp-arquivo-cabeca">
              <span className="tp-sobre">Arquivo</span>
              <span className="tp-nota">Unidades que encerraram as atividades. Os dados ficam guardados para consulta e não recebem atualização.</span>
            </div>
            {resumoArquivo.map(({ u, inicio, total, pessoas, dias: nd, meses: nm, melhorMes }) => (
              <button key={u.id} type="button" className={u.id === unidade ? "tp-arquivo-cartao on" : "tp-arquivo-cartao"} onClick={() => abrirArquivo(u)} aria-pressed={u.id === unidade}>
                <span className="tp-arquivo-nome">
                  <b>{u.nome}</b>
                  <span className="tp-encerrada">Encerrada em {dataLonga(u.encerrada_em as string)}</span>
                </span>
                <span className="tp-arquivo-dado"><span className="tp-rotulo">Período de operação</span><b>{inicio ? `${dataLonga(inicio)} a ${dataLonga(u.encerrada_em as string)}` : "—"}</b></span>
                <span className="tp-arquivo-dado"><span className="tp-rotulo">Faturamento no período</span><b>{reais(total)}</b></span>
                <span className="tp-arquivo-dado"><span className="tp-rotulo">Dias com venda</span><b>{inteiro(nd)}{nm ? ` · ${plural(nm, "mês", "meses")}` : ""}</b></span>
                <span className="tp-arquivo-dado"><span className="tp-rotulo">Ticket por pessoa</span><b>{pessoas ? reais(total / pessoas) : "—"}</b></span>
                <span className="tp-arquivo-dado"><span className="tp-rotulo">Melhor mês</span><b>{melhorMes ? `${maiuscula(nomeMes(melhorMes[0]))} · ${reaisCurto(melhorMes[1])}` : "—"}</b></span>
              </button>
            ))}
          </section>
        )}

        {dias === null && <div className="tp-carregando" aria-label="Carregando"><i /><i /><i /></div>}

        {hotelAtivo && hoteisDias !== null && (
          <DetalheHotel key={`${hotelAtivo.id}-${mes}`} supabase={supabase} h={hotelAtivo} mes={mes} hoje={hoje}
            ds={hoteisMes.filter((d) => d.hotel_id === hotelAtivo.id)}
            anterior={hoteisDias.filter((d) => d.hotel_id === hotelAtivo.id && d.dia.startsWith(mesAnterior(mes)))} />
        )}

        {sel && dias !== null && mostrarTotvs && (
          <>
            <div className="tp-titulo" id={hotelAtivo ? "tp-restaurante" : "tp-unidade"}>
              <div>
                <h2>{hotelAtivo ? `Restaurante do ${nomeHotel(hotelAtivo)} · caixa TOTVS` : sel.u.nome}{encerradaSel && <span className="tp-encerrada tp-encerrada-titulo">Arquivo · encerrada em {dataLonga(encerradaSel)}</span>}</h2>
                <span className="tp-nota">
                  {encerradaSel
                    ? `${maiuscula(nomeMes(mes))} · dados guardados até o último dia de operação, sem atualização`
                    : <>{maiuscula(nomeMes(mes))}{ultimoDia ? ` · atualizado até ${dataBr(ultimoDia)}` : ""}
                      {mesAtual && antesDaAgenda && ultimoDia !== ontem ? ` · ${dataBr(ontem)} chega às 4h30` : ""}</>}
                </span>
              </div>
              {ds.length > 0 && (
                <button type="button" className="ghost small tp-baixar" onClick={baixarPlanilha} title="Planilha com um dia por linha (abre no Excel)">
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v9M4 6.5 8 10.5l4-4M2 13.5h12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Baixar planilha
                </button>
              )}
            </div>

            {faltam.length > 0 && buscando.length === 0 && (
              <div className="tp-faltam">
                <span>
                  Faltam {faltam.length} dia(s) neste mês{faltam.length <= 6 ? `: ${faltam.map(dataBr).join(", ")}` : ""}.
                </span>
                <button className="ghost small" onClick={puxarFaltantes} disabled={!!puxando && puxando.startsWith("Pedindo")}>Buscar na TOTVS</button>
                {puxando && <span className="muted">{puxando}</span>}
              </div>
            )}

            {nDias === 0 ? (
              <p className="tp-vazio">
                {encerradaSel && mes > encerradaSel.slice(0, 7)
                  ? <>{sel.u.nome} encerrou as atividades em {dataLonga(encerradaSel)}.{" "}
                    <button type="button" className="ghost small" onClick={() => setMes(encerradaSel.slice(0, 7))}>Ver o último mês de operação</button></>
                  : `Ainda não há vendas deste mês para ${sel.u.nome}.`}
              </p>
            ) : (
              <>
                <section className="tp-painel tp-kpis">
                  <Indicador rotulo="Média por dia" valor={reais(s.total / nDias)} nota={`${plural(nDias, "dia", "dias")} com movimento`} />
                  <Indicador rotulo="Pessoas" valor={inteiro(s.pessoas)} nota={`${inteiro(s.pessoas / nDias)} por dia`} />
                  <Indicador rotulo="Ticket por pessoa" valor={s.pessoas ? reais(s.total / s.pessoas) : "—"} />
                  <Indicador rotulo="Cupons" valor={inteiro(s.vendas)} nota={`${inteiro(s.vendas / nDias)} por dia`} />
                  <Indicador rotulo="Ticket por cupom" valor={s.vendas ? reais(s.total / s.vendas) : "—"} />
                  <Indicador rotulo="Taxa de serviço" valor={reais(s.servico)} nota={produtosValor ? `${pct(s.servico / produtosValor)} dos produtos` : undefined} />
                </section>

                <section className="tp-painel tp-ritmo">
                  <div className="tp-ritmo-principal">
                    <span className="tp-rotulo">{projecao ? "Projeção para o mês" : "Realizado no mês"}</span>
                    <b className="tp-numero tp-numero-xl">{reais(projecao ?? s.total)}</b>
                    {projecao ? (
                      <>
                        <span className="tp-progresso" aria-hidden="true"><i style={{ width: `${Math.min(100, (s.total / projecao) * 100)}%` }} /></span>
                        <span className="tp-nota">{reais(s.total)} realizados em {limiteDia} de {diasNoMes(mes)} dias, pelo ritmo atual.</span>
                      </>
                    ) : (
                      <span className="tp-nota">{plural(nDias, "dia", "dias")} com movimento{melhor ? ` · melhor dia ${dataBr(melhor.dia)} (${reais(Number(melhor.total))})` : ""}</span>
                    )}
                  </div>
                  <div className="tp-ritmo-compara">
                    <div>
                      <span className="tp-rotulo">Contra {MESES[+mesAnterior(mes).slice(5, 7) - 1]}, até o dia {limiteDia}</span>
                      {anteriorCompleto && totalAnterior > 0 ? (
                        <>
                          <b className="tp-numero"><Variacao v={s.total / totalAnterior - 1} /></b>
                          <span className="tp-nota">{reais(totalAnterior)} no mesmo período</span>
                        </>
                      ) : <span className="tp-nota">O mês anterior não está completo no Brasico.</span>}
                    </div>
                    <div>
                      <span className="tp-rotulo">Contra {MESES[+mesAnoAntes.slice(5, 7) - 1]} de {mesAnoAntes.slice(0, 4)}, até o dia {limiteDia}</span>
                      {serie === null ? <span className="tp-nota">Carregando…</span> : anoAntesCompleto ? (
                        <>
                          <b className="tp-numero"><Variacao v={s.total / totalAnoAntes - 1} /></b>
                          <span className="tp-nota">{reais(totalAnoAntes)} no mesmo período</span>
                        </>
                      ) : <span className="tp-nota">Sem vendas desse mês no Brasico para comparar.</span>}
                    </div>
                  </div>
                  {mix.length > 0 && (
                    <div className="tp-mix">
                      <span className="tp-rotulo">Mix de vendas</span>
                      <div className="tp-mix-barra" role="img" aria-label={mix.map((m) => `${m.nome} ${pct(m.valor / produtosValor)}`).join(", ")}>
                        {mix.map((m) => <i key={m.nome} className={m.cor} style={{ flexGrow: m.valor }} title={`${m.nome}: ${reais(m.valor)}`} />)}
                      </div>
                      <ul className="tp-legenda">
                        {mix.map((m) => (
                          <li key={m.nome}><i className={m.cor} />{m.nome} <b>{pct(m.valor / produtosValor)}</b> <span>{reais(m.valor)}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <section className="tp-painel">
                  <div className="tp-painel-topo">
                    <h3>Faturamento por dia</h3>
                    <span className="tp-nota" aria-live="polite">
                      {diaFoco
                        ? `${SEMANA[diaSemana(diaFoco.dia)]}, ${dataBr(diaFoco.dia)} · ${reais(Number(diaFoco.total))} · ${inteiro(diaFoco.pessoas)} pessoas${diaFoco.status === "revisar" ? " · para revisar" : ""}`
                        : `Média ${reais(s.total / nDias)} · clique num dia para ver o detalhe`}
                    </span>
                  </div>
                  <div className="tp-grafico" style={{ "--tp-dias": diasNoMes(mes) } as CSSProperties}>
                    <div className="tp-plot">
                      {[1, 0.5, 0].map((f) => (
                        <span key={f} className={f ? "tp-grade" : "tp-grade base"} style={{ bottom: `${f * 100}%` }} aria-hidden="true">
                          <em>{f ? reaisCurto(escala * f) : "R$ 0"}</em>
                        </span>
                      ))}
                      <span className="tp-media" style={{ bottom: `${(s.total / nDias / escala) * 100}%` }} aria-hidden="true" />
                      <div className="tp-barras" role="list" onMouseLeave={() => setFoco(null)}>
                        {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                          const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                          const d = ds.find((x) => x.dia === dia);
                          return (
                            <div key={dia} role="listitem"
                              className={`tp-coluna${foco === dia ? " on" : ""}${abertoAgora === dia ? " escolhido" : ""}${d ? " clicavel" : ""}${d?.status === "revisar" ? " revisar" : ""}`}
                              onMouseEnter={() => setFoco(dia)} onFocus={() => setFoco(dia)} onBlur={() => setFoco(null)} tabIndex={d ? 0 : -1}
                              onClick={() => d && abrirDia(dia)} onKeyDown={(e) => d && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrirDia(dia))}
                              aria-label={d ? `${dataBr(dia)}: ${reais(Number(d.total))}${d.status === "revisar" ? ", para revisar" : ""}. Abrir detalhe` : `${dataBr(dia)}: sem dados`}>
                              {d ? <i style={{ height: `${Math.max(1, (Number(d.total) / escala) * 100)}%` }} /> : dia <= ultimoDaUnidade ? <i className="falta" /> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="tp-dias" aria-hidden="true">
                      {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                        const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                        const marco = i === 0 || (i + 1) % 5 === 0;
                        return <span key={dia} className={`${[0, 6].includes(diaSemana(dia)) ? "fds" : ""}${marco ? " marco" : ""}`}>{i + 1}</span>;
                      })}
                    </div>
                  </div>
                  <p className="tp-nota tp-legenda-dias">
                    <span className="tp-chave-media" /> média do mês · números em negrito: sábados e domingos
                    {ds.some((d) => d.status === "revisar") && <> · <span className="tp-chave-revisar" /> dia para revisar</>}
                  </p>
                </section>

                {diaAberto && (
                  <div id="tp-dia">
                    <PainelDia d={diaAberto} onFechar={() => { setAberto(null); setFechouDia(true); }}
                      onAnterior={iAberto > 0 ? () => setAberto(ds[iAberto - 1].dia) : undefined}
                      onProximo={iAberto < ds.length - 1 ? () => setAberto(ds[iAberto + 1].dia) : undefined} />
                  </div>
                )}

                <Produtos key={`p-${unidade}-${mes}`} dias={ds} />
                <Garcons key={`g-${unidade}-${mes}`} dias={ds} />
                <Perdas key={`a-${unidade}-${mes}`} dias={ds} />

                <p className="tp-qualidade">
                  {ds.length} de {ultimoDaUnidade.startsWith(mes) ? +ultimoDaUnidade.slice(8, 10) : diasNoMes(mes)} dias lançados · {ds.filter((d) => d.status === "ok").length} conferidos (o pago bate com o vendido)
                  {ds.some((d) => d.status === "sem_movimento") && ` · ${ds.filter((d) => d.status === "sem_movimento").length} sem movimento`}
                  {sel.revisar > 0 && ` · ${sel.revisar} para revisar (${ds.filter((d) => d.status === "revisar").map((d) => dataBr(d.dia)).join(", ")}): o pago não bateu com o vendido, e os números aparecem como vieram.`}
                </p>
              </>
            )}
          </>
        )}

        <details className="tp-como">
          <summary>Como a integração funciona</summary>
          <section className="tt-fluxo" aria-label="Como funciona a integração">
            <div className="tt-caixa tt-origem">
              <span className="tt-passo">1</span>
              <b>TOTVS Chef Web</b>
              <span className="muted">O sistema de caixa das lojas</span>
              <div className="tt-chips">{unidades.map((u) => <span key={u.id} className="tt-chip">{u.nome}</span>)}</div>
            </div>
            <Seta />
            <div className="tt-linha">
              <div className="tt-caixa">
                <span className="tt-passo">2</span>
                <b>Agenda diária</b>
                <span className="muted">Todo dia às 4h30 busca o dia anterior de cada unidade e tenta de novo, até as 6h30, o que faltar da última semana. Ao meio-dia confere o dia anterior outra vez</span>
              </div>
              <div className="tt-ou" aria-hidden="true">ou</div>
              <div className="tt-caixa">
                <span className="tt-passo">2</span>
                <b>Pedido do site ou do Claude</b>
                <span className="muted">Para buscar dias que faltam</span>
              </div>
            </div>
            <Seta />
            <div className="tt-caixa">
              <span className="tt-passo">3</span>
              <b>Chef Web API</b>
              <span className="muted">Busca vendas, sangrias e fechamentos de caixa do dia, só para leitura: nada é alterado na TOTVS</span>
            </div>
            <Seta />
            <div className="tt-caixa">
              <span className="tt-passo">4</span>
              <b>Conferência</b>
              <span className="muted">Cada venda é conferida com o que foi pago; o dia que não bate fica marcado para revisar</span>
            </div>
            <Seta />
            <div className="tt-caixa tt-destino">
              <span className="tt-passo">5</span>
              <b>Banco do Brasico</b>
              <span className="muted">Um resumo por unidade e dia, que só os sócios veem. Este painel e os Claudes leem daqui</span>
            </div>
          </section>
        </details>
      </main>
    </div>
  );
}
