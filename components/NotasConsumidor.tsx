"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import JanelaPdfNota from "./JanelaPdfNota";
import ConferenciaFiscal from "./ConferenciaFiscal";

// NFC-e da página Notas: as notas fiscais de consumidor das vendas dos restaurantes, que a TOTVS manda junto
// com cada venda (supabase/nfce.sql). Atualiza sozinho: a leitura ao vivo da TOTVS roda a cada minuto.
//  - NotasConsumidor: aba "NFC-e (vendas)". Revista em 22/11/2026 a pedido do dono ("separar as autorizadas das não
//    autorizadas, não ficar confuso"): no topo, um grupo por situação — Autorizadas (abre nela), Canceladas, Para conferir
//    (sem autorização da SEFAZ), Sem nota fiscal (ex.: assinada que vai para a conta do quarto) e Vendas canceladas —,
//    cada um com quantidade e valor do mês; embaixo, as vendas daquele grupo por dia (50 por página), a nota abre no lugar
//    com itens, impostos e PDF. Visual num bloco só em globals.css ("NFC-e", classes nc-*).
//  - LeituraNfce: bloco da aba "Leituras" (andamento do histórico por casa).
type Unidade = { id: string; nome: string };
type Mes = {
  mes: string; unidade_id: string; emitente_cnpj: string | null; notas: number; canceladas: number; pendentes: number; sem_nota: number;
  valor: number; valor_sem_nota: number; valor_pendente: number; servico: number; icms: number; pis: number; cofins: number; cbs: number; ibs: number;
};
type DiaResumo = { dia: string; unidade_id: string; situacao: string; vendas: number; valor: number };
type Forma = { mes: string; unidade_id: string; situacao: string; forma: string; vendas: number; valor: number };
type Linha = {
  unidade_id: string; chave_venda: string; dia: string; emissao: string | null; chave: string | null; emitente_cnpj: string | null;
  numero: number | null; serie: string | null; situacao: string; cupom: number | null; caixa: number | null; valor: number | null; protocolo: string | null;
  pagamentos?: { descricao: string; valor: number; recebido?: number }[];
  // Quem fechou (caixa) e, nas assinadas de hotel, de quem é a conta (ligada ao lançamento no PMS; supabase/nfce_assinadas.sql)
  operador?: string | null; atendentes?: string[]; cliente_nome?: string | null;
  quarto?: string | null; reserva?: string | null; hospede?: string | null; conta_tipo?: string | null; pms_dia?: string | null;
};
const ehAssinada = (n: Linha) => n.situacao === "sem_nota" && (n.pagamentos ?? []).some((p) => /assinad/i.test(p.descricao));
type Imp = { aliquota: number | null; base?: number | null; valor: number | null; cst?: string } | null;
type ItemV = {
  n: number; codigo: number | null; nome: string; grupo: string | null; ncm: string | null; unidade: string | null; cfop: string | null;
  cst: string | null; csosn: string | null; quantidade: number; valor_unitario: number; desconto: number; acrescimo: number;
  valor_total: number; cancelado: boolean; icms: Imp; pis: Imp; cofins: Imp;
  ibscbs: { cst: string | null; cclasstrib: string | null; base: number | null; cbs: Imp; ibs_uf: Imp; ibs_mun: Imp } | null;
};
type Completa = Linha & {
  pessoas: number | null; consumidor_identificado: boolean; subtotal: number | null; servico: number | null; desconto: number | null;
  acrescimo: number | null; taxa_entrega: number | null; troco: number | null; base_icms: number | null; icms: number | null; pis: number | null;
  cofins: number | null; cbs: number | null; ibs: number | null; itens: ItemV[]; pagamentos: { descricao: string; valor: number; recebido?: number }[];
  cancelamento: { quando?: string | null; motivo?: string | null; protocolo?: string | null; operador?: string | null } | null;
};
type Leitura = { unidade_id: string; nome: string; ultima_leitura: string | null; desde: string | null; dias_lidos: number; dias_faltam: number };

const CONSULTA_RN = "https://nfce.sefaz.rn.gov.br/portalDFE/NFCe/ConsultaNFCe.aspx";
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }) : "");
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const pct = (v: number | null | undefined) => (v == null ? "" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const doc = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "");
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const num = (v: number) => v.toLocaleString("pt-BR");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const nomeDia = (d: string) => {
  const t = new Date(`${d}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const POR_PAGINA = 50;
const SITUACAO: Record<string, { txt: string; cls: string; marca: string }> = {
  autorizada: { txt: "autorizada", cls: "tv-ok", marca: "ok" },
  cancelada: { txt: "cancelada", cls: "tv-falha", marca: "erro" },
  pendente: { txt: "sem autorização", cls: "tv-falha", marca: "erro" },
  sem_nota: { txt: "sem nota fiscal", cls: "tv-revisar", marca: "aviso" },
  venda_cancelada: { txt: "venda cancelada", cls: "tv-revisar", marca: "neutro" },
};
// Os grupos do topo da aba, na ordem em que aparecem
const GRUPOS: { id: string; nome: string; explica: string }[] = [
  { id: "autorizada", nome: "Autorizadas", explica: "NFC-e emitidas no caixa e autorizadas pela SEFAZ. São as notas fiscais válidas das vendas." },
  { id: "cancelada", nome: "Canceladas", explica: "NFC-e que foram autorizadas e depois canceladas no caixa (a SEFAZ registra o cancelamento)." },
  { id: "pendente", nome: "Para conferir", explica: "Vendas que deveriam ter NFC-e, mas a TOTVS não mostra a autorização da SEFAZ (sem chave ou sem protocolo). Normalmente é nota em contingência que o caixa ainda não transmitiu: confira no caixa." },
  { id: "sem_nota", nome: "Sem nota fiscal", explica: "Vendas que não emitem NFC-e no caixa. Quase sempre é a assinada, que vai para a conta do quarto e é faturada pelo hotel; veja abaixo por forma de pagamento." },
  { id: "venda_cancelada", nome: "Vendas canceladas", explica: "Vendas canceladas no caixa antes de emitir nota fiscal." },
];
const urlPdf = (n: { unidade_id: string; chave_venda: string }) => `/api/nfce/danfce/${n.unidade_id}/${encodeURIComponent(n.chave_venda)}`;

function useBase(supabase: ReturnType<typeof createClient>) {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [pronto, setPronto] = useState(false);
  const carregar = useCallback(async () => {
    const [u, m] = await Promise.all([
      supabase.from("totvs_unidades").select("id,nome").order("ordem"),
      supabase.from("nfce_meses").select("*").order("mes", { ascending: false }),
    ]);
    setUnidades((u.data ?? []) as Unidade[]);
    setMeses((m.data ?? []) as Mes[]);
    setPronto(true);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);
  return { unidades, meses, pronto, carregar };
}

export default function NotasConsumidor() {
  const supabase = useMemo(() => createClient(), []);
  const { unidades, meses, pronto, carregar } = useBase(supabase);
  const [mes, setMes] = useState("");
  const [unidade, setUnidade] = useState("");
  const [grupo, setGrupo] = useState("autorizada");
  // Duas visões: as vendas (por grupo e dia) ou a conferência fiscal dos itens (components/ConferenciaFiscal.tsx)
  const [modo, setModo] = useState<"vendas" | "conferencia">("vendas");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [total, setTotal] = useState(0);
  const [dias, setDias] = useState<DiaResumo[]>([]);
  const [formas, setFormas] = useState<Forma[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  // Sempre Vivo: o restaurante vende pelo PDV do PMS, que não emite NFC-e (relatórios de notas do PMS vazios, 22/11/2026)
  const [pdvSv, setPdvSv] = useState<{ total: number; itens: number; dias: number } | null>(null);
  // Assinadas do mês (para o resumo: quantas já têm quarto e hóspede)
  // Casas que são hotel (as assinadas vão para a conta do quarto no PMS)
  const [hoteis, setHoteis] = useState<string[]>([]);
  useEffect(() => {
    supabase.from("pms_hoteis").select("totvs_unidade").not("totvs_unidade", "is", null)
      .then(({ data }) => setHoteis(((data ?? []) as { totvs_unidade: string }[]).map((h) => h.totvs_unidade)));
  }, [supabase]);
  const [assinadas, setAssinadas] = useState<{ unidade_id: string; valor: number; quarto: string | null; pagamentos: { descricao: string }[] }[]>([]);

  useEffect(() => { setMes((v) => v || meses[0]?.mes || ""); }, [meses]);
  useEffect(() => { setPagina(0); setAberta(null); }, [mes, unidade, grupo, termo]);
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  // Notas novas chegam a cada minuto (leitura ao vivo da TOTVS): a lista e os totais se atualizam sozinhos
  useEffect(() => {
    const t = setInterval(() => { carregar(); setVersao((v) => v + 1); }, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  const fimMes = useMemo(() => {
    if (!mes) return "";
    const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1);
    return `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}-01`;
  }, [mes]);

  // Totais por dia e formas de pagamento do mês
  useEffect(() => {
    if (!mes) return;
    Promise.all([
      supabase.from("nfce_dia_resumo").select("*").gte("dia", `${mes}-01`).lt("dia", fimMes),
      supabase.from("nfce_formas").select("*").eq("mes", mes),
    ]).then(([d, f]) => { setDias((d.data ?? []) as DiaResumo[]); setFormas((f.data ?? []) as Forma[]); });
    supabase.from("nfce_notas").select("unidade_id,valor,quarto,pagamentos").eq("situacao", "sem_nota").gte("dia", `${mes}-01`).lt("dia", fimMes).limit(5000)
      .then(({ data }) => setAssinadas(((data ?? []) as typeof assinadas).filter((x) => (x.pagamentos ?? []).some((p) => /assinad/i.test(p.descricao)))));
    const ultimo = new Date(new Date(`${fimMes}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10);
    supabase.rpc("vendas_hoteis_pdv_dia", { p_de: `${mes}-01`, p_ate: ultimo }).then(({ data }) => {
      const sv = ((data ?? []) as { hotel_id: string; total: number; itens: number }[]).filter((x) => x.hotel_id === "sempre-vivo");
      setPdvSv(sv.length ? { total: sv.reduce((s, x) => s + Number(x.total), 0), itens: sv.reduce((s, x) => s + Number(x.itens), 0), dias: sv.length } : null);
    });
  }, [supabase, mes, fimMes, versao]);

  useEffect(() => {
    (async () => {
      if (!mes) { setLinhas(pronto ? [] : null); return; }
      if (versao === 0) setLinhas(null);
      let q = supabase.from("nfce_notas")
        .select("unidade_id,chave_venda,dia,emissao,chave,emitente_cnpj,numero,serie,situacao,cupom,caixa,valor,protocolo,pagamentos,operador,atendentes,cliente_nome,quarto,reserva,hospede,conta_tipo,pms_dia", { count: "exact" })
        .gte("dia", `${mes}-01`).lt("dia", fimMes).eq("situacao", grupo);
      if (unidade) q = q.eq("unidade_id", unidade);
      const t = termo.replace(/\D/g, "");
      if (termo) {
        if (t.length === 44) q = q.eq("chave", t);
        else if (t && t === termo.replace(/\s/g, "")) q = q.or(`numero.eq.${t},cupom.eq.${t},quarto.ilike.${t}%`);
        else {
          // Texto: hóspede, quarto, operador do caixa ou garçom
          const s = termo.replace(/[%,()*]/g, " ").trim();
          q = q.or(`hospede.ilike.*${s}*,quarto.ilike.${s}*,operador.ilike.*${s}*,reserva.ilike.*${s}*`);
        }
      }
      const { data, count } = await q.order("emissao", { ascending: false, nullsFirst: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      setLinhas((data ?? []) as Linha[]);
      setTotal(count ?? 0);
    })();
  }, [supabase, mes, fimMes, unidade, grupo, termo, pagina, pronto, versao]);

  const nomeUnidade = Object.fromEntries(unidades.map((u) => [u.id, u.nome]));
  const doMes = meses.filter((m) => m.mes === mes && (!unidade || m.unidade_id === unidade));
  const soma = (k: keyof Mes) => doMes.reduce((s, m) => s + Number(m[k] ?? 0), 0);
  const diasDoFiltro = dias.filter((d) => !unidade || d.unidade_id === unidade);
  const doGrupo = (g: string) => {
    const ds = diasDoFiltro.filter((d) => d.situacao === g);
    return { vendas: ds.reduce((s, d) => s + d.vendas, 0), valor: ds.reduce((s, d) => s + Number(d.valor), 0) };
  };
  const atual = doGrupo(grupo);
  const formasDoGrupo = Object.values(formas.filter((f) => f.situacao === grupo && (!unidade || f.unidade_id === unidade))
    .reduce<Record<string, { forma: string; vendas: number; valor: number }>>((acc, f) => {
      const x = (acc[f.forma] ??= { forma: f.forma, vendas: 0, valor: 0 });
      x.vendas += f.vendas; x.valor += Number(f.valor);
      return acc;
    }, {})).sort((a, b) => b.valor - a.valor);
  const listaMeses = [...new Set(meses.map((m) => m.mes))];
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const casas = unidades.filter((u) => meses.some((m) => m.unidade_id === u.id));
  const info = GRUPOS.find((g) => g.id === grupo)!;

  // A página agrupada por dia (data de movimento do caixa)
  const porDia: { dia: string; linhas: Linha[] }[] = [];
  for (const n of linhas ?? []) {
    let g = porDia.find((x) => x.dia === n.dia);
    if (!g) porDia.push((g = { dia: n.dia, linhas: [] }));
    g.linhas.push(n);
  }
  const totalDia = (d: string) => {
    const ds = diasDoFiltro.filter((x) => x.dia === d && x.situacao === grupo);
    return { vendas: ds.reduce((s, x) => s + x.vendas, 0), valor: ds.reduce((s, x) => s + Number(x.valor), 0) };
  };

  return (
    <div className="nc">
      <div className="nc-filtros">
        <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
          {!listaMeses.length && <option value="">Sem notas ainda</option>}
          {listaMeses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
        </select>
        <div className="nc-casas" role="tablist" aria-label="Casa">
          <button role="tab" aria-selected={!unidade} className={!unidade ? "on" : ""} onClick={() => setUnidade("")}>Todas as casas</button>
          {casas.map((u) => (
            <button key={u.id} role="tab" aria-selected={unidade === u.id} className={unidade === u.id ? "on" : ""} onClick={() => setUnidade(u.id)}>{u.nome}</button>
          ))}
        </div>
        <div className="nc-modos" role="tablist" aria-label="Visão">
          <button role="tab" aria-selected={modo === "vendas"} className={modo === "vendas" ? "on" : ""} onClick={() => setModo("vendas")}>Vendas</button>
          <button role="tab" aria-selected={modo === "conferencia"} className={modo === "conferencia" ? "on" : ""} onClick={() => setModo("conferencia")}>Conferência fiscal</button>
        </div>
      </div>

      {modo === "conferencia" ? <ConferenciaFiscal mes={mes} fimMes={fimMes} unidade={unidade} nomeUnidade={nomeUnidade} /> : (<>
      {!unidade && pdvSv && pdvSv.total > 0 && (
        <div className="nc-aviso">
          <span className="nc-aviso-marca" aria-hidden="true">!</span>
          <p>
            <strong>Sempre Vivo · restaurante pelo PDV do PMS: {brl(pdvSv.total)} neste mês ({num(pdvSv.itens)} itens), sem NFC-e.</strong>{" "}
            O Sempre Vivo não usa o caixa TOTVS, e os relatórios de notas do PMS vêm vazios: o PDV de lá não emite nota fiscal de consumidor.
            Por isso essas vendas não aparecem nos grupos abaixo. Vale levar ao contador.
          </p>
        </div>
      )}

      <div className="nc-grupos" role="tablist" aria-label="Situação das vendas">
        {GRUPOS.map((g) => {
          const t = doGrupo(g.id);
          const alerta = g.id === "pendente" && t.vendas > 0;
          return (
            <button key={g.id} role="tab" aria-selected={grupo === g.id}
              className={`nc-grupo nc-g-${SITUACAO[g.id].marca}${grupo === g.id ? " on" : ""}${alerta ? " alerta" : ""}${!t.vendas ? " vazio-g" : ""}`}
              onClick={() => setGrupo(g.id)}>
              <span className="nc-grupo-nome"><i aria-hidden="true" />{g.nome}</span>
              <span className="nc-grupo-qtd">{num(t.vendas)}</span>
              <span className="nc-grupo-valor">{brl(t.valor)}</span>
            </button>
          );
        })}
      </div>

      <section className="nc-resumo">
        <p className="nc-explica">{info.explica}</p>
        {grupo === "autorizada" ? (
          <dl className="nc-numeros">
            <div><dt>Vendido com nota</dt><dd>{brl(soma("valor"))}</dd><small>{num(soma("notas"))} NFC-e · média {brl(soma("notas") ? soma("valor") / soma("notas") : 0)}</small></div>
            <div><dt>Taxa de serviço</dt><dd>{brl(soma("servico"))}</dd><small>dentro do valor das notas</small></div>
            <div><dt>ICMS · PIS · Cofins</dt><dd>{brl(soma("icms") + soma("pis") + soma("cofins"))}</dd><small>ICMS {brl(soma("icms"))} · PIS {brl(soma("pis"))} · Cofins {brl(soma("cofins"))}</small></div>
            <div><dt>CBS · IBS (teste 2026)</dt><dd>{brl(soma("cbs") + soma("ibs"))}</dd><small>CBS {brl(soma("cbs"))} · IBS {brl(soma("ibs"))}</small></div>
          </dl>
        ) : (
          <dl className="nc-numeros">
            <div><dt>{info.nome}</dt><dd>{brl(atual.valor)}</dd><small>{num(atual.vendas)} venda{atual.vendas === 1 ? "" : "s"} no mês</small></div>
            {grupo === "sem_nota" && (() => {
              const as = assinadas.filter((x) => (!unidade || x.unidade_id === unidade) && hoteis.includes(x.unidade_id));
              const lig = as.filter((x) => x.quarto);
              return as.length > 0 && (
                <div><dt>Assinadas do hotel com quarto</dt><dd>{num(lig.length)} de {num(as.length)}</dd>
                  <small>{brl(lig.reduce((s, x) => s + Number(x.valor), 0))} ligadas à conta do quarto no PMS · {brl(as.filter((x) => !x.quarto).reduce((s, x) => s + Number(x.valor), 0))} ainda sem quarto</small></div>
              );
            })()}
            {formasDoGrupo.slice(0, grupo === "sem_nota" ? 2 : 3).map((f) => (
              <div key={f.forma}><dt>{f.forma}</dt><dd>{brl(f.valor)}</dd><small>{num(f.vendas)} venda{f.vendas === 1 ? "" : "s"}</small></div>
            ))}
          </dl>
        )}
      </section>

      <div className="nc-barra">
        <h2>{info.nome} <span>· {nomeMes(mes || "2026-01")}</span></h2>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={grupo === "sem_nota" ? "Hóspede, quarto, cupom ou operador" : "Nº da nota, cupom, chave ou operador"} aria-label="Buscar NFC-e" />
      </div>

      {linhas === null ? <p className="muted">Carregando as vendas…</p> : !linhas.length ? (
        <p className="nc-vazio">{termo ? "Nenhuma venda com essa busca." : `Nenhuma venda em "${info.nome}" neste mês${unidade ? " nesta casa" : ""}.`}</p>
      ) : (
        <>
          {porDia.map((d) => {
            const td = totalDia(d.dia);
            return (
              <section key={d.dia} className="nc-dia">
                <header className="nc-dia-cabeca">
                  <h3>{nomeDia(d.dia)}</h3>
                  <span>{num(td.vendas)} {grupo === "autorizada" || grupo === "cancelada" ? "nota" : "venda"}{td.vendas === 1 ? "" : "s"} · <b>{brl(td.valor)}</b></span>
                </header>
                <ul className="nc-lista">
                  {d.linhas.map((n) => {
                    const k = `${n.unidade_id}|${n.chave_venda}`;
                    const esta = aberta === k;
                    const forma = (n.pagamentos ?? []).map((p) => p.descricao).filter((v, i, a) => a.indexOf(v) === i).join(" + ");
                    return (
                      <li key={k} className={esta ? "nc-item aberto" : "nc-item"}>
                        <button className="nc-linha" onClick={() => setAberta(esta ? null : k)} aria-expanded={esta}>
                          <span className={`nc-marca nc-m-${SITUACAO[n.situacao]?.marca ?? "neutro"}`} aria-hidden="true" />
                          <span className="nc-titulo">
                            {n.quarto ? (
                              <>
                                <strong>Quarto {n.quarto} · {n.hospede ?? (n.conta_tipo === "Company" ? "conta da empresa" : "hóspede")}</strong>
                                <small>{nomeUnidade[n.unidade_id] ?? n.unidade_id} · cupom {n.cupom ?? "—"}{n.operador ? ` · fechou: ${n.operador}` : ""}</small>
                              </>
                            ) : (
                              <>
                                <strong>{n.chave ? `NFC-e nº ${n.numero ?? "—"}` : `Cupom ${n.cupom ?? "—"}`}
                                  {ehAssinada(n) && (hoteis.includes(n.unidade_id)
                                    ? <em className="nc-sem-quarto"> · quarto ainda não achado no PMS</em>
                                    : n.cliente_nome ? <em className="nc-sem-quarto"> · cliente: {n.cliente_nome}</em> : null)}</strong>
                                <small>{nomeUnidade[n.unidade_id] ?? n.unidade_id}{n.chave ? ` · série ${n.serie ?? "—"} · cupom ${n.cupom ?? "—"}` : ""} · caixa {n.caixa ?? "—"}{n.operador ? ` · fechou: ${n.operador}` : ""}</small>
                              </>
                            )}
                          </span>
                          <span className="nc-hora">{n.emissao ? hora(n.emissao) : "—"}</span>
                          <span className="nc-forma" title={forma}>{forma || "—"}</span>
                          <span className="nc-valor">{brl(n.valor)}</span>
                          <span className="ip-seta" aria-hidden="true" />
                        </button>
                        {esta && <NfceAberta linha={n} casa={nomeUnidade[n.unidade_id]} hotel={hoteis.includes(n.unidade_id)} onFechar={() => setAberta(null)} />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {paginas > 1 && (
            <nav className="nf-paginas" aria-label="Páginas">
              <button className="ghost small" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
              <span className="muted">Página {pagina + 1} de {paginas} · {num(total)} vendas</span>
              <button className="ghost small" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
            </nav>
          )}
        </>
      )}
      </>)}
    </div>
  );
}

function NfceAberta({ linha, casa, hotel, onFechar }: { linha: Linha; casa?: string; hotel?: boolean; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [n, setN] = useState<Completa | null>(null);
  const [verPdf, setVerPdf] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    supabase.from("nfce_notas").select("*").eq("unidade_id", linha.unidade_id).eq("chave_venda", linha.chave_venda).single()
      .then(({ data }) => setN(data as Completa));
  }, [supabase, linha]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && !verPdf && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar, verPdf]);

  async function consultar() {
    if (!linha.chave) return;
    try { await navigator.clipboard.writeText(linha.chave); setCopiado(true); } catch { /* sem área de transferência */ }
    window.open(CONSULTA_RN, "_blank", "noopener");
  }

  const s = SITUACAO[linha.situacao] ?? SITUACAO.autorizada;
  const itens = n?.itens ?? [];
  const classes = [...new Set(itens.filter((i) => !i.cancelado).map((i) => i.ibscbs?.cclasstrib).filter(Boolean))] as string[];
  return (
    <div className="nf-aberta" onClick={(e) => e.stopPropagation()}>
      <header className="nf-aberta-cabeca">
        <div className="ft-painel-titulo">
          <span className="es-sobre">{linha.chave ? `NFC-e nº ${linha.numero ?? "—"} · série ${linha.serie ?? "—"}` : `Venda sem NFC-e · cupom ${linha.cupom ?? "—"}`}</span>
          <h2 className="nf-painel-nome">{casa ?? linha.unidade_id}</h2>
          <p className="muted nf-painel-sub">Emitente CNPJ {doc(linha.emitente_cnpj)} · caixa {linha.caixa ?? "—"} · cupom {linha.cupom ?? "—"}</p>
          <div className="ft-indicadores">
            <span><small>Emissão</small><b>{dia(linha.emissao)} {hora(linha.emissao)}</b></span>
            <span><small>Valor</small><b>{brl(linha.valor)}</b></span>
            <span><small>Pessoas</small><b>{n?.pessoas ?? "—"}</b></span>
            <span><small>Situação</small><b><span className={`estado ${s.cls}`}>{s.txt}</span></b></span>
          </div>
        </div>
        <div className="ft-painel-acoes">
          <button className="small" onClick={() => setVerPdf(true)}>Ver PDF</button>
          {linha.chave && <button className="ghost small" onClick={consultar} title="Copia a chave e abre a consulta da SEFAZ-RN">{copiado ? "Chave copiada" : "Consultar na SEFAZ"}</button>}
          <button className="ghost small" onClick={onFechar}>Fechar</button>
        </div>
      </header>
      <div className="nf-painel-corpo">
        {!n ? <p className="muted">Carregando a nota…</p> : (
          <>
            {linha.situacao === "pendente" && <p className="es-aviso">Esta venda deveria ter NFC-e, mas a TOTVS não mostra a autorização da SEFAZ (sem chave ou sem protocolo). Confira no caixa se a nota foi transmitida.</p>}
            {linha.situacao === "sem_nota" && !linha.quarto && (
              <p className="es-aviso">{ehAssinada(linha) && !hotel
                ? `Assinada sem nota fiscal${linha.cliente_nome ? `, no cliente "${linha.cliente_nome}" da TOTVS` : ""}. Esta casa não é hotel: não há conta de quarto para ligar.`
                : ehAssinada(linha)
                ? "Assinada sem nota fiscal. O Brasico ainda não achou na conta de nenhum quarto do PMS um lançamento \"RESTAURANTE\" com este valor (ele entra no dia seguinte; conta dividida ou lançada com outro valor não casa)."
                : "Esta venda não emitiu nota fiscal no caixa."}</p>
            )}
            {(linha.quarto || linha.operador || (linha.atendentes ?? []).length > 0) && (
              <section className="nf-bloco">
                <h3>Quem fechou{linha.quarto ? " e quem assinou" : ""}</h3>
                <dl className="nf-dados">
                  {linha.quarto && <div><dt>Assinou (conta do quarto)</dt><dd><strong>{linha.hospede ?? "—"}</strong><br /><small className="muted">quarto {linha.quarto}{linha.conta_tipo === "Company" ? " · conta da empresa" : ""}</small></dd></div>}
                  {linha.reserva && <div><dt>Reserva no PMS</dt><dd>{linha.reserva}<br /><small className="muted">lançada como RESTAURANTE em {dia(linha.pms_dia ? `${linha.pms_dia}T12:00:00-03:00` : null)}</small></dd></div>}
                  <div><dt>Fechou no caixa</dt><dd>{linha.operador ?? "—"}<br /><small className="muted">caixa {linha.caixa ?? "—"} · cupom {linha.cupom ?? "—"}</small></dd></div>
                  {!linha.quarto && linha.cliente_nome && <div><dt>Cliente na TOTVS</dt><dd>{linha.cliente_nome}</dd></div>}
                  <div><dt>Garçons</dt><dd>{(linha.atendentes ?? []).length ? (linha.atendentes ?? []).join(", ") : "—"}</dd></div>
                </dl>
              </section>
            )}
            {n.cancelamento && (
              <p className="es-aviso">Cancelada{n.cancelamento.quando ? ` em ${dia(n.cancelamento.quando)} ${hora(n.cancelamento.quando)}` : ""}{n.cancelamento.operador ? ` por ${n.cancelamento.operador}` : ""}{n.cancelamento.motivo ? ` · motivo: ${n.cancelamento.motivo}` : ""}{n.cancelamento.protocolo ? ` · protocolo ${n.cancelamento.protocolo}` : ""}.</p>
            )}
            <dl className="nf-dados">
              <div><dt>Protocolo de autorização</dt><dd>{linha.protocolo ?? "—"}</dd></div>
              <div><dt>Consumidor</dt><dd>{n.consumidor_identificado ? "Identificado (CPF na nota)" : "Não identificado"}</dd></div>
              <div><dt>Data de movimento</dt><dd>{dia(`${linha.dia}T12:00:00-03:00`)}</dd></div>
              <div><dt>Classificação da reforma</dt><dd>{classes.length ? classes.map((c) => `cClassTrib ${c}`).join(" · ") : "—"}</dd></div>
              {linha.chave && <div className="nf-dados-largo"><dt>Chave de acesso</dt><dd className="nf-chave">{chaveFmt(linha.chave)}</dd></div>}
            </dl>

            <section className="nf-bloco">
              <h3>Itens <span className="muted">· {itens.length}</span></h3>
              <div className="nf-tabela-wrap">
                <table className="nf-tabela nf-itens-tabela">
                  <thead><tr><th>#</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>CST</th><th className="n">Qtd.</th><th>Un.</th><th className="n">V. unit.</th><th className="n">Total</th><th className="n">ICMS</th><th className="n">PIS/Cofins</th><th className="n">CBS/IBS</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.n} className={i.cancelado ? "muted" : ""}>
                        <td className="muted">{i.n}</td>
                        <td><strong>{i.nome}{i.cancelado ? " (cancelado)" : ""}</strong>{i.grupo && <small>{i.grupo}{i.codigo ? ` · cód. ${i.codigo}` : ""}</small>}</td>
                        <td>{i.ncm ?? ""}</td>
                        <td>{i.cfop ?? ""}</td>
                        <td>{i.cst ?? i.csosn ?? ""}</td>
                        <td className="n">{qtd(i.quantidade)}</td>
                        <td>{i.unidade ?? ""}</td>
                        <td className="n">{brl(i.valor_unitario)}</td>
                        <td className="n">{brl(i.valor_total)}</td>
                        <td className="n">{i.icms?.valor ? <>{brl(i.icms.valor)}<small>{pct(i.icms.aliquota)}</small></> : "—"}</td>
                        <td className="n">{(i.pis?.valor || i.cofins?.valor) ? brl(Number(i.pis?.valor ?? 0) + Number(i.cofins?.valor ?? 0)) : "—"}</td>
                        <td className="n">{i.ibscbs ? <>{brl(Number(i.ibscbs.cbs?.valor ?? 0) + Number(i.ibscbs.ibs_uf?.valor ?? 0) + Number(i.ibscbs.ibs_mun?.valor ?? 0))}<small>{i.ibscbs.cclasstrib ?? ""}</small></> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="nf-colunas">
              <section className="nf-bloco">
                <h3>Totais</h3>
                <dl className="nf-totais">
                  <div><dt>Subtotal</dt><dd>{brl(n.subtotal)}</dd></div>
                  {!!n.servico && <div><dt>Taxa de serviço</dt><dd>{brl(n.servico)}</dd></div>}
                  {!!n.desconto && <div><dt>Descontos</dt><dd>{brl(n.desconto)}</dd></div>}
                  {!!n.acrescimo && <div><dt>Acréscimos</dt><dd>{brl(n.acrescimo)}</dd></div>}
                  {!!n.taxa_entrega && <div><dt>Taxa de entrega</dt><dd>{brl(n.taxa_entrega)}</dd></div>}
                  <div className="total"><dt>Total da venda</dt><dd>{brl(n.valor)}</dd></div>
                  <div><dt>ICMS (base {brl(n.base_icms)})</dt><dd>{brl(n.icms)}</dd></div>
                  <div><dt>PIS</dt><dd>{brl(n.pis)}</dd></div>
                  <div><dt>Cofins</dt><dd>{brl(n.cofins)}</dd></div>
                  <div><dt>CBS · IBS (teste da reforma)</dt><dd>{brl(n.cbs)} · {brl(n.ibs)}</dd></div>
                </dl>
              </section>
              <section className="nf-bloco">
                <h3>Pagamentos</h3>
                {n.pagamentos.length ? (
                  <dl className="nf-totais">
                    {n.pagamentos.map((p, k) => <div key={k}><dt>{p.descricao}</dt><dd>{brl(p.recebido ?? p.valor)}</dd></div>)}
                    {!!n.troco && <div><dt>Troco</dt><dd>{brl(n.troco)}</dd></div>}
                  </dl>
                ) : <p className="muted">Sem pagamentos registrados.</p>}
              </section>
            </div>
          </>
        )}
      </div>
      {verPdf && <JanelaPdfNota url={urlPdf(linha)} titulo={linha.chave ? `DANFE NFC-e · nº ${linha.numero ?? ""}` : `Venda · cupom ${linha.cupom ?? ""}`}
        subtitulo={`${casa ?? ""} · ${brl(linha.valor)}`} arquivo={linha.chave ? `NFCe-${linha.numero ?? linha.chave}.pdf` : `Venda-${linha.cupom ?? ""}.pdf`} onFechar={() => setVerPdf(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Bloco da aba Leituras: as NFC-e vêm da TOTVS junto com as vendas
// ---------------------------------------------------------------------
export function LeituraNfce() {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Leitura[]>([]);
  const carregar = useCallback(async () => {
    const { data } = await supabase.from("nfce_leitura").select("*");
    setLista((data ?? []) as Leitura[]);
  }, [supabase]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, [carregar]);
  return (
    <section className="nfs-leitura">
      <h2 className="nfs-titulo">NFC-e (vendas) · caixa TOTVS</h2>
      <p className="muted">A cada minuto a leitura ao vivo da TOTVS traz as vendas do dia e, junto, a NFC-e de cada uma (chave, protocolo e impostos). Os dias antigos entram aos poucos, um por vez, até completar o histórico do caixa.</p>
      <div className="sf-empresas">
        {lista.map((l) => {
          const ok = l.dias_faltam === 0 && !!l.ultima_leitura;
          const estado = !l.ultima_leitura ? { cls: "espera", txt: "Ainda não lida" } : ok ? { cls: "ok", txt: "Em dia" } : { cls: "espera", txt: "Buscando o histórico" };
          return (
            <article key={l.unidade_id} className="sf-empresa">
              <header className="sf-empresa-cabeca">
                <span className="nf-grupo-icone" aria-hidden="true">{l.nome.slice(0, 1)}</span>
                <span className="sf-empresa-nome"><strong>{l.nome}</strong><small>caixa TOTVS Chef Web</small></span>
                <span className={`sf-estado ${estado.cls}`}>{estado.txt}</span>
              </header>
              <dl className="sf-numeros">
                <div><dt>Dias lidos</dt><dd>{l.dias_lidos}</dd></div>
                <div><dt>Faltam</dt><dd>{l.dias_faltam}</dd></div>
                <div><dt>Última leitura</dt><dd>{l.ultima_leitura ? `${dia(l.ultima_leitura)} · ${hora(l.ultima_leitura)}` : "nunca"}</dd></div>
              </dl>
              {l.desde && <p className="sf-ultimo">Notas desde {dia(`${l.desde}T12:00:00-03:00`)}</p>}
            </article>
          );
        })}
      </div>
      <p className="muted es-nota">
        A SEFAZ não tem serviço para o emitente baixar as próprias NFC-e, e a API fiscal da TOTVS que devolveria o XML dá erro interno (chamado aberto).
        Por isso o PDF é montado com os dados da venda que o caixa mandou; a chave de acesso permite conferir cada nota no portal da SEFAZ-RN.
      </p>
    </section>
  );
}
