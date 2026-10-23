"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { Evolucao, Garcons, Indicador, PainelDia, Perdas, Produtos, Variacao } from "./TotvsPartes";
import {
  type Dia, type Historico, type Ponto, type Unidade, MESES, SEMANA, agruparPagamentos, comMovimento, dataBr, diaSemana, diasNoMes,
  escalaBonita, hojeFortaleza, inteiro, maiuscula, mesAnterior, nomeMes, pct, planilhaDoMes, plural, reais, reaisCurto, somar, somarMeses, titulo,
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
  const [historico, setHistorico] = useState<Historico[]>([]);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("totvs_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      const { data: u } = await supabase.from("totvs_unidades").select("id,nome,loja,ativa,ordem").order("ordem");
      const lista = ((u ?? []) as Unidade[]).filter((x) => x.ativa && x.loja != null);
      setUnidades(lista);
      setUnidade((atual) => atual ?? lista[0]?.id ?? null);
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

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    carregarSerie();
  }, [carregarSerie]);

  useEffect(() => {
    carregarMeses();
  }, [carregarMeses]);

  useEffect(() => {
    setAberto(null);
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
  const doMes = (dias ?? []).filter((d) => d.dia.startsWith(mes));
  const doAnterior = (dias ?? []).filter((d) => d.dia.startsWith(mesAnterior(mes)));

  // Resumo de cada unidade no mês
  const resumoUnidades = unidades.map((u) => {
    const ds = doMes.filter((d) => d.unidade_id === u.id);
    const s = somar(ds);
    const ultimo = ds[ds.length - 1];
    const diasEsperados = Math.max(0, +ultimoPossivel.slice(8, 10) - (mesAtual && antesDaAgenda && !ds.some((d) => d.dia === ontem) ? 1 : 0));
    return { u, ds, s, ultimo, diasEsperados, revisar: ds.filter((d) => d.status === "revisar").length };
  });

  const sel = resumoUnidades.find((x) => x.u.id === unidade);
  const ds = sel?.ds ?? [];
  const ativos = ds.filter(comMovimento);
  const s = somar(ds);
  const produtosValor = s.comida + s.bebida + s.outros;
  const nDias = ativos.length;
  const ultimoDia = ds[ds.length - 1]?.dia;
  const limiteDia = ultimoDia ? +ultimoDia.slice(8, 10) : 0;
  // Projeção pelos dias corridos do calendário (dias fechados também contam), não só pelos dias com venda
  const projecao = mesAtual && limiteDia && limiteDia < diasNoMes(mes) ? (s.total / limiteDia) * diasNoMes(mes) : null;

  // Comparações no mesmo trecho do mês: mês anterior e mesmo mês do ano anterior
  const anteriorAteDia = doAnterior.filter((d) => d.unidade_id === unidade && +d.dia.slice(8, 10) <= limiteDia);
  const totalAnterior = somar(anteriorAteDia).total;
  const anteriorCompleto = limiteDia > 0 && anteriorAteDia.length >= Math.ceil(limiteDia * 0.9);
  const mesAnoAntes = somarMeses(mes, -12);
  const anoAntes = (serie ?? []).filter((p) => p.dia.startsWith(mesAnoAntes) && +p.dia.slice(8, 10) <= limiteDia);
  const totalAnoAntes = anoAntes.reduce((a, p) => a + Number(p.total), 0);
  const anoAntesCompleto = limiteDia > 0 && anoAntes.length >= Math.ceil(limiteDia * 0.9) && totalAnoAntes > 0;

  const faltam: string[] = [];
  for (let i = 1; i <= +ultimoPossivel.slice(8, 10); i++) {
    const d = `${mes}-${String(i).padStart(2, "0")}`;
    if (d <= ultimoPossivel && !ds.some((x) => x.dia === d) && !(d === ontem && antesDaAgenda)) faltam.push(d);
  }

  const maxDia = Math.max(...ds.map((d) => Number(d.total)), 1);
  const melhor = ativos.reduce<Dia | undefined>((m, d) => (!m || Number(d.total) > Number(m.total) ? d : m), undefined);
  const porSemana = SEMANA.map((nome, w) => {
    const x = ativos.filter((d) => diaSemana(d.dia) === w);
    return { nome, n: x.length, media: x.length ? x.reduce((a, d) => a + Number(d.total), 0) / x.length : 0 };
  });
  const maxSemana = Math.max(...porSemana.map((x) => x.media), 1);
  const pagamentos = agruparPagamentos(ds);
  const totalPag = pagamentos.reduce((a, p) => a + p.valor, 0) || 1;

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

  const totalGeral = resumoUnidades.reduce((a, x) => a + x.s.total, 0);
  const pessoasGeral = resumoUnidades.reduce((a, x) => a + x.s.pessoas, 0);
  const escala = escalaBonita(maxDia);
  const diaFoco = foco ? ds.find((d) => d.dia === foco) : undefined;
  const iAberto = aberto ? ds.findIndex((d) => d.dia === aberto) : -1;
  const diaAberto = iAberto >= 0 ? ds[iAberto] : undefined;
  const anos = Array.from(new Set(meses.map((m) => m.slice(0, 4)))).sort();
  const mix = [
    { nome: "Comida", valor: s.comida, cor: "tp-cor-comida" },
    { nome: "Bebida", valor: s.bebida, cor: "tp-cor-bebida" },
    { nome: "Outros", valor: s.outros, cor: "tp-cor-outros" },
  ].filter((x) => x.valor > 0);

  function abrirDia(dia: string) {
    setAberto((a) => (a === dia ? null : dia));
    requestAnimationFrame(() => document.getElementById("tp-dia")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="vendas" />
      <main className="miolo tp">
        <header className="tp-cabeca">
          <div>
            <span className="tp-sobre">TOTVS · Chef Web</span>
            <h1>Vendas das unidades</h1>
          </div>
        </header>

        {/* Período: ano e mês, só os meses que já têm dados ficam ativos */}
        <nav className="tp-periodo" aria-label="Escolher período">
          <div className="tp-anos" role="group" aria-label="Ano">
            {anos.map((a) => (
              <button key={a} className={a === mes.slice(0, 4) ? "on" : ""} aria-pressed={a === mes.slice(0, 4)}
                onClick={() => setMes(meses.find((m) => m.startsWith(a) && m.slice(5) === mes.slice(5)) ?? meses.find((m) => m.startsWith(a)) ?? mes)}>
                {a}
              </button>
            ))}
          </div>
          <div className="tp-mesesgrade" role="group" aria-label="Mês">
            {MESES.map((nome, i) => {
              const m = `${mes.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`;
              const tem = meses.includes(m);
              return (
                <button key={m} className={m === mes ? "on" : ""} disabled={!tem} aria-pressed={m === mes} onClick={() => setMes(m)} title={tem ? maiuscula(nomeMes(m)) : "Sem dados"}>
                  {maiuscula(nome.slice(0, 3))}
                </button>
              );
            })}
          </div>
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

        {/* Resumo de todas as unidades */}
        <section className="tp-painel tp-geral" aria-label="Resumo das unidades">
          <div className="tp-geral-total">
            <span className="tp-rotulo">Todas as unidades</span>
            <b className="tp-numero tp-numero-xl">{dias === null ? "—" : reais(totalGeral)}</b>
            <span className="tp-nota">{maiuscula(nomeMes(mes))}{pessoasGeral ? ` · ${inteiro(pessoasGeral)} pessoas · ${reais(totalGeral / pessoasGeral)} por pessoa` : ""}</span>
          </div>
          <div className="tp-geral-unidades">
            {resumoUnidades.map(({ u, s: su, ds: dsu, ultimo, diasEsperados, revisar }) => (
              <button key={u.id} className={u.id === unidade ? "tp-unidade on" : "tp-unidade"} onClick={() => setUnidade(u.id)} aria-pressed={u.id === unidade}>
                <span className="tp-unidade-nome">{u.nome}</span>
                <b className="tp-numero">{dias === null ? "—" : reais(su.total)}</b>
                <span className="tp-participa" aria-hidden="true"><i style={{ width: `${totalGeral ? (su.total / totalGeral) * 100 : 0}%` }} /></span>
                <span className="tp-nota">
                  {totalGeral ? `${pct(su.total / totalGeral)} do total · ` : ""}{dsu.length}/{diasEsperados} dias
                  {ultimo ? ` · até ${dataBr(ultimo.dia)}` : ""}
                </span>
                {revisar > 0 && <span className="tp-selo">{revisar} para revisar</span>}
              </button>
            ))}
          </div>
        </section>

        {dias === null && <div className="tp-carregando" aria-label="Carregando"><i /><i /><i /></div>}

        {sel && dias !== null && (
          <>
            <div className="tp-titulo">
              <div>
                <h2>{sel.u.nome}</h2>
                <span className="tp-nota">
                  {maiuscula(nomeMes(mes))}{ultimoDia ? ` · atualizado até ${dataBr(ultimoDia)}` : ""}
                  {mesAtual && antesDaAgenda && ultimoDia !== ontem ? ` · ${dataBr(ontem)} chega às 4h30` : ""}
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
              <p className="tp-vazio">Ainda não há vendas deste mês para {sel.u.nome}.</p>
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
                              className={`tp-coluna${foco === dia ? " on" : ""}${aberto === dia ? " escolhido" : ""}${d ? " clicavel" : ""}${d?.status === "revisar" ? " revisar" : ""}`}
                              onMouseEnter={() => setFoco(dia)} onFocus={() => setFoco(dia)} onBlur={() => setFoco(null)} tabIndex={d ? 0 : -1}
                              onClick={() => d && abrirDia(dia)} onKeyDown={(e) => d && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrirDia(dia))}
                              aria-label={d ? `${dataBr(dia)}: ${reais(Number(d.total))}${d.status === "revisar" ? ", para revisar" : ""}. Abrir detalhe` : `${dataBr(dia)}: sem dados`}>
                              {d ? <i style={{ height: `${Math.max(1, (Number(d.total) / escala) * 100)}%` }} /> : dia <= ultimoPossivel ? <i className="falta" /> : null}
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
                    <PainelDia d={diaAberto} onFechar={() => setAberto(null)}
                      onAnterior={iAberto > 0 ? () => setAberto(ds[iAberto - 1].dia) : undefined}
                      onProximo={iAberto < ds.length - 1 ? () => setAberto(ds[iAberto + 1].dia) : undefined} />
                  </div>
                )}

                <Evolucao serie={serie} mes={mes} hoje={hoje} meses={meses} onEscolher={setMes} />

                <div className="tp-duas">
                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Média por dia da semana</h3><span className="tp-nota">só dias com movimento</span></div>
                    <ul className="tp-lista">
                      {porSemana.map((x) => (
                        <li key={x.nome}>
                          <span>{x.nome}<small>{plural(x.n, "dia", "dias")}</small></span>
                          <span className="tp-linha"><i style={{ width: `${(x.media / maxSemana) * 100}%` }} /></span>
                          <b>{x.n ? reais(x.media) : "—"}</b>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Formas de pagamento</h3><span className="tp-nota">{reais(totalPag)} recebidos</span></div>
                    <ul className="tp-lista">
                      {pagamentos.slice(0, 8).map((p) => (
                        <li key={`${p.tipo}${p.forma}`}>
                          <span title={p.forma}>{titulo(p.forma)}{p.tipo !== "caixa" && <small>{p.tipo}</small>}</span>
                          <span className="tp-linha"><i style={{ width: `${(p.valor / totalPag) * 100}%` }} /></span>
                          <b>{reais(p.valor)}<small>{pct(p.valor / totalPag)}</small></b>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <Produtos key={`p-${unidade}-${mes}`} dias={ds} />
                <Garcons key={`g-${unidade}-${mes}`} dias={ds} />
                <Perdas key={`a-${unidade}-${mes}`} dias={ds} />

                <p className="tp-qualidade">
                  {ds.length} de {+ultimoPossivel.slice(8, 10)} dias lançados · {ds.filter((d) => d.status === "ok").length} conferidos (o pago bate com o vendido)
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
                <span className="muted">Todo dia às 4h30 busca o dia anterior de cada unidade e tenta de novo, até as 6h30, o que faltar da última semana</span>
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
