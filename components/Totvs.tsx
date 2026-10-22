"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Página TOTVS: painel das unidades (no estilo do dashboard do Cicchetti Management) com os dados
// já puxados da TOTVS Chef Web (totvs_dias), e o desenho de como a integração funciona.
type Unidade = { id: string; nome: string; loja: number | null; ativa: boolean; ordem: number };
type Historico = { unidade_id: string; cursor: string; parado: boolean; motivo: string };
type Produto = { nome: string; grupo: string; categoria: string; quantidade: number; valor: number };
type Pagamento = { tipo: string; forma: string; valor: number; vezes: number };
type Garcom = { nome: string; itens: number; valor: number; vendas: number };
type Cancelado = { tipo: string };
type Dia = {
  unidade_id: string; dia: string; status: string; vendas: number; pessoas: number; total: number;
  resumo: Record<string, number>; produtos: Produto[]; pagamentos: Pagamento[]; garcons: Garcom[]; cancelados: Cancelado[];
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const reais = (v: number) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const reaisCurto = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : reais(v));
const inteiro = (v: number) => Math.round(v ?? 0).toLocaleString("pt-BR");
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const hojeFortaleza = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diasNoMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
const mesAnterior = (mes: string) => {
  const d = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 2, 1));
  return d.toISOString().slice(0, 7);
};
const nomeMes = (mes: string) => `${MESES[+mes.slice(5, 7) - 1]} de ${mes.slice(0, 4)}`;
const r = (d: Dia, k: string) => Number(d.resumo?.[k] ?? 0);
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
// Nomes da TOTVS vêm em caixa alta; na tela ficam só com as iniciais maiúsculas
const titulo = (t: string) => t.toLocaleLowerCase("pt-BR").replace(/(^|[\s\-/(])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR"));
// Topo do eixo do gráfico: um valor redondo logo acima do maior dia
function escalaBonita(max: number) {
  const p = 10 ** Math.floor(Math.log10(max || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p;
}

function somar(dias: Dia[]) {
  const s = { total: 0, pessoas: 0, vendas: 0, servico: 0, comida: 0, bebida: 0, outros: 0, descontos: 0, cortesias: 0, assinadas: 0, sangrias: 0, itensCancelados: 0, cuponsCancelados: 0 };
  for (const d of dias) {
    s.total += Number(d.total); s.pessoas += d.pessoas; s.vendas += d.vendas;
    s.servico += r(d, "servico"); s.comida += r(d, "comida"); s.bebida += r(d, "bebida"); s.outros += r(d, "outros");
    s.descontos += r(d, "descontos"); s.cortesias += r(d, "cortesias"); s.assinadas += r(d, "assinadas"); s.sangrias += r(d, "sangrias");
    s.itensCancelados += r(d, "itens_cancelados"); s.cuponsCancelados += r(d, "vendas_canceladas");
  }
  return s;
}

function agrupar<T>(dias: Dia[], lista: (d: Dia) => T[], chave: (x: T) => string, juntar: (a: T | undefined, x: T, dia: string) => T) {
  const m = new Map<string, T>();
  for (const d of dias) for (const x of lista(d) ?? []) m.set(chave(x), juntar(m.get(chave(x)), x, d.dia));
  return Array.from(m.values());
}

function Seta() {
  return (
    <div className="tt-seta" aria-hidden="true">
      <svg width="16" height="26" viewBox="0 0 16 26"><path d="M8 0v22M2 16l6 7 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}

function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="tp-indicador">
      <span className="tp-rotulo">{rotulo}</span>
      <b className="tp-numero">{valor}</b>
      {nota && <span className="tp-nota">{nota}</span>}
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
  const [puxando, setPuxando] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
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

  const carregar = useCallback(async () => {
    if (!acesso) return;
    const de = `${mesAnterior(mes)}-01`;
    const ate = `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
    const { data } = await supabase.from("totvs_dias")
      .select("unidade_id,dia,status,vendas,pessoas,total,resumo,produtos,pagamentos,garcons,cancelados")
      .gte("dia", de).lte("dia", ate).order("dia");
    setDias((data ?? []) as Dia[]);
  }, [supabase, acesso, mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    carregarMeses();
  }, [carregarMeses]);

  useEffect(() => {
    if (!acesso) return;
    const ch = supabase.channel("totvs-painel")
      .on("postgres_changes", { event: "*", schema: "public", table: "totvs_dias" }, () => {
        carregar();
        carregarMeses();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, acesso, carregar, carregarMeses]);

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
  const ultimoPossivel = mesAtual ? ontem : `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
  const doMes = (dias ?? []).filter((d) => d.dia.startsWith(mes));
  const doAnterior = (dias ?? []).filter((d) => d.dia.startsWith(mesAnterior(mes)));

  // Resumo de cada unidade no mês
  const resumoUnidades = unidades.map((u) => {
    const ds = doMes.filter((d) => d.unidade_id === u.id);
    const s = somar(ds);
    const ultimo = ds[ds.length - 1];
    const diasEsperados = Math.max(0, +ultimoPossivel.slice(8, 10));
    return { u, ds, s, ultimo, diasEsperados, revisar: ds.filter((d) => d.status === "revisar").length };
  });

  const sel = resumoUnidades.find((x) => x.u.id === unidade);
  const ds = sel?.ds ?? [];
  const s = somar(ds);
  const produtosValor = s.comida + s.bebida + s.outros;
  const nDias = ds.length;
  const ultimoDia = ds[ds.length - 1]?.dia;
  const projecao = mesAtual && nDias ? (s.total / nDias) * diasNoMes(mes) : null;
  const limiteDia = ultimoDia ? +ultimoDia.slice(8, 10) : 0;
  const anteriorAteDia = doAnterior.filter((d) => d.unidade_id === unidade && +d.dia.slice(8, 10) <= limiteDia);
  const totalAnterior = somar(anteriorAteDia).total;
  const variacao = totalAnterior > 0 ? s.total / totalAnterior - 1 : null;
  const faltam: string[] = [];
  for (let i = 1; i <= +ultimoPossivel.slice(8, 10); i++) {
    const d = `${mes}-${String(i).padStart(2, "0")}`;
    if (d <= ultimoPossivel && !ds.some((x) => x.dia === d)) faltam.push(d);
  }

  const maxDia = Math.max(...ds.map((d) => Number(d.total)), 1);
  const porSemana = SEMANA.map((nome, w) => {
    const x = ds.filter((d) => diaSemana(d.dia) === w);
    return { nome, n: x.length, media: x.length ? x.reduce((a, d) => a + Number(d.total), 0) / x.length : 0 };
  });
  const maxSemana = Math.max(...porSemana.map((x) => x.media), 1);

  const produtos = agrupar<Produto>(ds, (d) => d.produtos, (p) => p.nome,
    (a, p) => ({ ...p, quantidade: (a?.quantidade ?? 0) + Number(p.quantidade), valor: (a?.valor ?? 0) + Number(p.valor) }))
    .sort((a, b) => b.valor - a.valor).slice(0, 10);
  const pagamentos = agrupar<Pagamento>(ds, (d) => d.pagamentos, (p) => `${p.tipo}|${p.forma}`,
    (a, p) => ({ ...p, valor: (a?.valor ?? 0) + Number(p.valor), vezes: (a?.vezes ?? 0) + Number(p.vezes) }))
    .sort((a, b) => b.valor - a.valor);
  const totalPag = pagamentos.reduce((a, p) => a + p.valor, 0) || 1;
  const garcons = agrupar<Garcom & { dias: Set<string> }>(ds, (d) => d.garcons as (Garcom & { dias: Set<string> })[], (g) => g.nome,
    (a, g, dia) => ({ ...g, itens: (a?.itens ?? 0) + Number(g.itens), valor: (a?.valor ?? 0) + Number(g.valor), vendas: (a?.vendas ?? 0) + Number(g.vendas), dias: new Set([...(a?.dias ?? []), dia]) }))
    .sort((a, b) => b.valor - a.valor).slice(0, 8);

  const puxaveis = faltam;
  const buscando = historico.filter((h) => !h.parado);

  // Um dia por vez: vários pedidos juntos fazem a TOTVS estourar o tempo
  async function puxarFaltantes() {
    if (!unidade || !puxaveis.length) return;
    let falhas = 0;
    for (const [i, d] of puxaveis.entries()) {
      setPuxando(`Pedindo ${dataBr(d)} à TOTVS (${i + 1} de ${puxaveis.length})…`);
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

  const totalGeral = resumoUnidades.reduce((a, x) => a + x.s.total, 0);
  const pessoasGeral = resumoUnidades.reduce((a, x) => a + x.s.pessoas, 0);
  const anteriorCompleto = limiteDia > 0 && anteriorAteDia.length >= Math.ceil(limiteDia * 0.9);
  const escala = escalaBonita(maxDia);
  const diaFoco = foco ? ds.find((d) => d.dia === foco) : undefined;
  const anos = Array.from(new Set(meses.map((m) => m.slice(0, 4)))).sort();
  const mix = [
    { nome: "Comida", valor: s.comida, cor: "tp-cor-comida" },
    { nome: "Bebida", valor: s.bebida, cor: "tp-cor-bebida" },
    { nome: "Outros", valor: s.outros, cor: "tp-cor-outros" },
  ].filter((x) => x.valor > 0);

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
              <h2>{sel.u.nome}</h2>
              <span className="tp-nota">{maiuscula(nomeMes(mes))}{ultimoDia ? ` · atualizado até ${dataBr(ultimoDia)}` : ""}</span>
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
              <p className="tp-vazio">Ainda não há dias deste mês para {sel.u.nome}.</p>
            ) : (
              <>
                <section className="tp-painel tp-kpis">
                  <Indicador rotulo="Média por dia" valor={reais(s.total / nDias)} nota={`${nDias} dia(s) com movimento`} />
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
                    {projecao && (
                      <>
                        <span className="tp-progresso" aria-hidden="true"><i style={{ width: `${Math.min(100, (s.total / projecao) * 100)}%` }} /></span>
                        <span className="tp-nota">{reais(s.total)} realizados em {nDias} de {diasNoMes(mes)} dias, pelo ritmo atual.</span>
                      </>
                    )}
                  </div>
                  <div className="tp-ritmo-compara">
                    <span className="tp-rotulo">Contra {MESES[+mesAnterior(mes).slice(5, 7) - 1]}, até o dia {limiteDia}</span>
                    {anteriorCompleto && variacao != null ? (
                      <>
                        <b className={`tp-numero ${variacao >= 0 ? "tp-sobe" : "tp-desce"}`}>{variacao >= 0 ? "▲" : "▼"} {pct(Math.abs(variacao))}</b>
                        <span className="tp-nota">{reais(totalAnterior)} no mesmo período</span>
                      </>
                    ) : (
                      <span className="tp-nota">O mês anterior ainda não está completo no Brasico.</span>
                    )}
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
                        : `Média ${reais(s.total / nDias)} · melhor dia ${reais(maxDia)}`}
                    </span>
                  </div>
                  <div className="tp-grafico">
                    <div className="tp-eixo" aria-hidden="true">
                      {[1, 0.5, 0].map((f) => <span key={f}>{f ? reaisCurto(escala * f) : "0"}</span>)}
                    </div>
                    <div className="tp-barras" role="list" onMouseLeave={() => setFoco(null)}>
                      {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                        const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                        const d = ds.find((x) => x.dia === dia);
                        const fds = [0, 6].includes(diaSemana(dia));
                        return (
                          <div key={dia} role="listitem" className={`tp-coluna${foco === dia ? " on" : ""}`}
                            onMouseEnter={() => setFoco(dia)} onFocus={() => setFoco(dia)} onBlur={() => setFoco(null)} tabIndex={d ? 0 : -1}
                            aria-label={d ? `${dataBr(dia)}: ${reais(Number(d.total))}` : `${dataBr(dia)}: sem dados`}>
                            <span className="tp-coluna-area">
                              {d ? <i style={{ height: `${Math.max(1.5, (Number(d.total) / escala) * 100)}%` }} /> : dia <= ultimoPossivel ? <i className="falta" /> : null}
                            </span>
                            <span className={`tp-coluna-n${fds ? " fds" : ""}`}>{i + 1}</span>
                            <span className={d?.status === "revisar" ? "tp-ponto" : "tp-ponto off"} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="tp-nota tp-legenda-dias"><span className="tp-ponto" /> dia para revisar · sábados e domingos em destaque</p>
                </section>

                <div className="tp-duas">
                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Média por dia da semana</h3></div>
                    <ul className="tp-lista">
                      {porSemana.map((x) => (
                        <li key={x.nome}>
                          <span>{x.nome}<small>{x.n} dia(s)</small></span>
                          <span className="tp-linha"><i style={{ width: `${(x.media / maxSemana) * 100}%` }} /></span>
                          <b>{x.n ? reais(x.media) : "—"}</b>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Formas de pagamento</h3></div>
                    <ul className="tp-lista">
                      {pagamentos.slice(0, 7).map((p) => (
                        <li key={`${p.tipo}${p.forma}`}>
                          <span title={p.forma}>{titulo(p.forma)}{p.tipo !== "caixa" && <small>{p.tipo}</small>}</span>
                          <span className="tp-linha"><i style={{ width: `${(p.valor / totalPag) * 100}%` }} /></span>
                          <b>{reais(p.valor)}<small>{pct(p.valor / totalPag)}</small></b>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="tp-duas">
                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Produtos mais vendidos</h3><span className="tp-nota">por faturamento</span></div>
                    <table className="tp-tabela">
                      <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Valor</th></tr></thead>
                      <tbody>
                        {produtos.map((p, i) => (
                          <tr key={p.nome}>
                            <td>{i + 1}</td>
                            <td title={p.nome}>{titulo(p.nome)}<small>{titulo(p.grupo ?? "")}</small></td>
                            <td>{inteiro(p.quantidade)}</td>
                            <td>{reais(p.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <section className="tp-painel">
                    <div className="tp-painel-topo"><h3>Garçons</h3><span className="tp-nota">por valor vendido</span></div>
                    <table className="tp-tabela">
                      <thead><tr><th>#</th><th>Nome</th><th>Itens</th><th>Valor</th></tr></thead>
                      <tbody>
                        {garcons.map((g, i) => (
                          <tr key={g.nome}>
                            <td>{i + 1}</td>
                            <td title={g.nome}>{titulo(g.nome)}<small>{g.dias.size} dia(s)</small></td>
                            <td>{inteiro(g.itens)}</td>
                            <td>{reais(g.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </div>

                <section className="tp-painel">
                  <div className="tp-painel-topo"><h3>Abatimentos e perdas</h3></div>
                  <div className="tp-kpis tp-kpis-5">
                    <Indicador rotulo="Descontos" valor={reais(s.descontos)} />
                    <Indicador rotulo="Cortesias" valor={reais(s.cortesias)} />
                    <Indicador rotulo="Assinadas" valor={reais(s.assinadas)} />
                    <Indicador rotulo="Sangrias" valor={reais(s.sangrias)} />
                    <Indicador rotulo="Cancelamentos" valor={`${inteiro(s.itensCancelados)} itens`} nota={`${inteiro(s.cuponsCancelados)} cupom(ns)`} />
                  </div>
                </section>

                <p className="tp-qualidade">
                  {nDias} de {+ultimoPossivel.slice(8, 10)} dias lançados · {ds.filter((d) => d.status === "ok").length} conferidos
                  {ds.some((d) => d.status === "sem_movimento") && ` · ${ds.filter((d) => d.status === "sem_movimento").length} sem movimento`}
                  {sel.revisar > 0 && ` · ${sel.revisar} para revisar (${ds.filter((d) => d.status === "revisar").map((d) => dataBr(d.dia)).join(", ")}): alguma conferência da TOTVS não bateu, e os números aparecem como vieram.`}
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
              <span className="muted">Os números são conferidos; o dia que não bate fica marcado para revisar</span>
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
