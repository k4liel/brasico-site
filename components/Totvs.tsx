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

function Cartao({ rotulo, valor, nota, destaque }: { rotulo: string; valor: string; nota?: string; destaque?: "ouro" | "verde" }) {
  return (
    <div className="tp-kpi">
      <span className="tp-rotulo">{rotulo}</span>
      <b className={destaque ? `tp-valor ${destaque}` : "tp-valor"}>{valor}</b>
      {nota && <span className="muted tp-nota">{nota}</span>}
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

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="vendas" />
      <main className="miolo tt">
        <div className="tp-cabeca">
          <div>
            <h1>TOTVS</h1>
            <p className="muted">Painel das unidades com os dados do Chef Web, por data de movimento.</p>
          </div>
          <select className="tp-mes" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            {(meses.length ? meses : [mes]).map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
        </div>

        {buscando.length > 0 && (
          <p className="tp-aviso">
            Buscando o histórico na TOTVS, um dia por vez, de ontem para trás:{" "}
            {buscando.map((h) => `${unidades.find((u) => u.id === h.unidade_id)?.nome ?? h.unidade_id} em ${dataBr(h.cursor)}/${h.cursor.slice(0, 4)}`).join(" · ")}.
            Os meses aparecem aqui conforme chegam.
          </p>
        )}

        {/* Resumo de todas as unidades */}
        <section className="tp-unidades" aria-label="Resumo das unidades">
          {resumoUnidades.map(({ u, s: su, ds: dsu, ultimo, diasEsperados, revisar }) => (
            <button key={u.id} className={u.id === unidade ? "tp-unidade on" : "tp-unidade"} onClick={() => setUnidade(u.id)}>
              <span className="tp-rotulo">{u.nome}</span>
              <b className="tp-valor ouro">{dias === null ? "…" : reais(su.total)}</b>
              <span className="muted tp-nota">
                {dsu.length} de {diasEsperados} dias · {su.pessoas ? `${reais(su.total / su.pessoas)} por pessoa` : "sem pessoas"}
              </span>
              <span className="tp-nota">
                {ultimo ? `Último dia ${dataBr(ultimo.dia)}: ${reais(Number(ultimo.total))}` : "Sem dados neste mês"}
                {revisar > 0 && <span className="tp-tag revisar">{revisar} para revisar</span>}
              </span>
            </button>
          ))}
        </section>

        {sel && (
          <>
            <div className="tp-titulo">
              <h2>{sel.u.nome}</h2>
              <span className="tp-tag">{nomeMes(mes)}</span>
              {ultimoDia && <span className="muted">atualizado até {dataBr(ultimoDia)}</span>}
            </div>

            {faltam.length > 0 && (
              <div className="tp-aviso">
                <span>
                  Faltam {faltam.length} dia(s) deste mês{faltam.length <= 6 ? `: ${faltam.map(dataBr).join(", ")}` : ""}.
                </span>
                {puxaveis.length > 0 && (
                  <button className="ghost small" onClick={puxarFaltantes} disabled={!!puxando && puxando.startsWith("Pedindo")}>Puxar {puxaveis.length} dia(s)</button>
                )}
                {puxando && <span className="muted">{puxando}</span>}
              </div>
            )}

            {nDias === 0 ? (
              <p className="vazio muted">Nenhum dia deste mês foi puxado ainda para esta unidade.</p>
            ) : (
              <>
                <section className="tp-grade">
                  <Cartao rotulo="Total físico" valor={reais(s.total)} nota={`${nDias} dia(s) lançados`} destaque="ouro" />
                  <Cartao rotulo="Pessoas" valor={inteiro(s.pessoas)} nota="clientes no período" />
                  <Cartao rotulo="Cupons" valor={inteiro(s.vendas)} nota="vendas fechadas" />
                  <Cartao rotulo="Ticket por pessoa" valor={s.pessoas ? reais(s.total / s.pessoas) : "—"} destaque="verde" />
                  <Cartao rotulo="Ticket por cupom" valor={s.vendas ? reais(s.total / s.vendas) : "—"} />
                  <Cartao rotulo="Serviço" valor={reais(s.servico)} nota={produtosValor ? `${pct(s.servico / produtosValor)} sobre produtos` : undefined} />
                </section>

                <section className="tp-bloco tp-ritmo">
                  <span className="tp-rotulo">Ritmo comercial</span>
                  <div className="tp-ritmo-linha">
                    <div>
                      <span className="muted tp-nota">{projecao ? "Projeção pelo ritmo atual" : "Realizado no mês"}</span>
                      <b className="tp-grande">{reais(projecao ?? s.total)}</b>
                      {projecao && <div className="tp-barra"><i style={{ width: `${Math.min(100, (s.total / projecao) * 100)}%` }} /></div>}
                      <span className="muted tp-nota">
                        {projecao ? `${nDias} dia(s) lançados de ${diasNoMes(mes)}; realizado ${reais(s.total)}.` : `${nDias} dia(s) lançados.`}
                      </span>
                    </div>
                    <div className="tp-compara">
                      <span className="muted tp-nota">Contra {MESES[+mesAnterior(mes).slice(5, 7) - 1]} até o mesmo dia</span>
                      <b className={variacao == null ? "" : variacao >= 0 ? "tp-sobe" : "tp-desce"}>
                        {variacao == null ? "sem dados" : `${variacao >= 0 ? "+" : ""}${pct(variacao)}`}
                      </b>
                      {variacao != null && <span className="muted tp-nota">{reais(totalAnterior)} no mês anterior</span>}
                    </div>
                  </div>
                  <div className="tp-mix">
                    <span>Comida <b>{produtosValor ? pct(s.comida / produtosValor) : "—"}</b> · {reais(s.comida)}</span>
                    <span>Bebida <b>{produtosValor ? pct(s.bebida / produtosValor) : "—"}</b> · {reais(s.bebida)}</span>
                    {s.outros > 0 && <span>Outros <b>{pct(s.outros / produtosValor)}</b> · {reais(s.outros)}</span>}
                  </div>
                </section>

                <section className="tp-bloco">
                  <span className="tp-rotulo">Evolução diária do mês</span>
                  <div className="tp-dias" role="list">
                    {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                      const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                      const d = ds.find((x) => x.dia === dia);
                      return (
                        <div key={dia} className="tp-dia" role="listitem" title={d ? `${dataBr(dia)} · ${reais(Number(d.total))} · ${d.pessoas} pessoas${d.status === "revisar" ? " · para revisar" : ""}` : `${dataBr(dia)} · sem dados`}>
                          <span className="tp-dia-barra"><i className={d ? d.status : "vazio"} style={{ height: d ? `${Math.max(4, (Number(d.total) / maxDia) * 100)}%` : "3px" }} /></span>
                          <span className="tp-dia-n">{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="tp-mix muted">
                    <span>Média <b>{reais(s.total / nDias)}</b></span>
                    <span>Pico <b>{reais(maxDia)}</b></span>
                    {ultimoDia && <span>Último <b>{reais(Number(ds[ds.length - 1].total))}</b></span>}
                  </div>
                </section>

                <div className="tp-duas">
                  <section className="tp-bloco">
                    <span className="tp-rotulo">Desempenho por dia da semana</span>
                    <ul className="tp-lista">
                      {porSemana.map((x) => (
                        <li key={x.nome}>
                          <span>{x.nome} <span className="muted">· {x.n} dia(s)</span></span>
                          <span className="tp-linha-barra"><i style={{ width: `${(x.media / maxSemana) * 100}%` }} /></span>
                          <b>{x.n ? reaisCurto(x.media) : "—"}</b>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="tp-bloco">
                    <span className="tp-rotulo">Como entrou no caixa</span>
                    <ul className="tp-lista">
                      {pagamentos.slice(0, 8).map((p) => (
                        <li key={`${p.tipo}${p.forma}`}>
                          <span>{p.forma}{p.tipo !== "caixa" ? <span className="muted"> · {p.tipo}</span> : null}</span>
                          <span className="tp-linha-barra"><i style={{ width: `${(p.valor / totalPag) * 100}%` }} /></span>
                          <b>{reais(p.valor)} <span className="muted">{pct(p.valor / totalPag)}</span></b>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="tp-duas">
                  <section className="tp-bloco">
                    <span className="tp-rotulo">Produtos que puxam o faturamento</span>
                    <ol className="tp-ranking">
                      {produtos.map((p) => (
                        <li key={p.nome}>
                          <span><b>{p.nome}</b><span className="muted"> · {p.grupo} · {inteiro(p.quantidade)} un</span></span>
                          <b>{reais(p.valor)}</b>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="tp-bloco">
                    <span className="tp-rotulo">Garçons no mês</span>
                    <ol className="tp-ranking">
                      {garcons.map((g) => (
                        <li key={g.nome}>
                          <span><b>{g.nome}</b><span className="muted"> · {inteiro(g.itens)} itens · {g.dias.size} dia(s)</span></span>
                          <b>{reais(g.valor)}</b>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>

                <section className="tp-bloco">
                  <span className="tp-rotulo">Auditoria · perdas e abatimentos</span>
                  <div className="tp-grade tp-grade-auditoria">
                    <Cartao rotulo="Descontos" valor={reais(s.descontos)} />
                    <Cartao rotulo="Cortesias" valor={reais(s.cortesias)} />
                    <Cartao rotulo="Assinadas" valor={reais(s.assinadas)} />
                    <Cartao rotulo="Sangrias" valor={reais(s.sangrias)} />
                    <Cartao rotulo="Cancelamentos" valor={`${inteiro(s.itensCancelados)} itens`} nota={`${inteiro(s.cuponsCancelados)} cupom(ns) cancelado(s)`} />
                  </div>
                </section>

                <section className="tp-bloco">
                  <span className="tp-rotulo">Qualidade dos dados</span>
                  <div className="tp-mix">
                    <span>Dias lançados <b>{nDias} de {+ultimoPossivel.slice(8, 10)}</b></span>
                    <span>Conferidos <b>{ds.filter((d) => d.status === "ok").length}</b></span>
                    <span>Sem movimento <b>{ds.filter((d) => d.status === "sem_movimento").length}</b></span>
                    <span>Para revisar <b>{sel.revisar}</b>{sel.revisar > 0 && <span className="muted"> ({ds.filter((d) => d.status === "revisar").map((d) => dataBr(d.dia)).join(", ")})</span>}</span>
                  </div>
                  <p className="muted tp-nota">&quot;Para revisar&quot; quer dizer que alguma conferência do dia não bateu na TOTVS; os números aparecem como vieram.</p>
                </section>
              </>
            )}
          </>
        )}

        <details className="tt-como">
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
                <span className="muted">Todo dia às 6h busca o dia anterior de cada unidade e repete os dias que falharam</span>
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
