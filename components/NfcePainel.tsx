"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ApuracaoIcms from "./ApuracaoIcms";
import ConferenciaFiscal from "./ConferenciaFiscal";

// Área de NFC-e com menu lateral (23/11/2026, prévia "A · lateral" escolhida pelo dono). Visões novas deste arquivo:
// Visão geral (nfce_visao_geral), Impostos do mês (nfce_meses + Apuração do ICMS), Pendências (nfce_pendencias +
// conferência item a item) e Reforma 2027 (nfce_reforma). SQL em supabase/nfce_area.sql. O menu fica em components/Notas.tsx.
export type IrPara = (vista: string) => void;

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const brl0 = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const num = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));
const pct = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d })}%`);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const mesCurto = (m: string) => `${MES3[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dataBr = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const mesAtual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).slice(0, 7);

function useMeses() {
  const supabase = useMemo(() => createClient(), []);
  const [meses, setMeses] = useState<string[]>([]);
  useEffect(() => {
    supabase.from("nfce_meses").select("mes").then(({ data }) => setMeses([...new Set(((data ?? []) as { mes: string }[]).map((x) => x.mes))].sort().reverse()));
  }, [supabase]);
  return meses;
}

function SeletorMes({ mes, setMes, meses }: { mes: string; setMes: (m: string) => void; meses: string[] }) {
  return (
    <select className="nx-mes" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
      {(meses.length ? meses : [mes]).map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
    </select>
  );
}

// Barras simples (SVG) com o último valor em dourado e rótulo ao passar o mouse
function Barras({ dados, altura = 180, destaque }: { dados: { rotulo: string; valor: number; dica?: string }[]; altura?: number; destaque?: number }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const w = 760, bw = w / Math.max(1, dados.length), base = altura - 22;
  const alvo = destaque ?? dados.length - 1;
  return (
    <div className="nx-barras">
      <svg viewBox={`0 0 ${w} ${altura}`} width="100%" height={altura} role="img" aria-label="Gráfico de barras">
        {dados.map((d, i) => {
          const h = Math.max(2, (d.valor / max) * (base - 18));
          const x = i * bw + Math.min(6, bw * 0.12), largura = bw - Math.min(12, bw * 0.24);
          return (
            <g key={i} onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
              <rect x={i * bw} y={0} width={bw} height={altura} fill="transparent" />
              <rect x={x} y={base - h} width={largura} height={h} rx={4} className={i === alvo ? "nx-b-on" : sobre === i ? "nx-b-sobre" : "nx-b"} />
              {(dados.length <= 16 || i % 3 === 0) && <text x={x + largura / 2} y={altura - 6} textAnchor="middle" className="nx-b-rot">{d.rotulo}</text>}
            </g>
          );
        })}
      </svg>
      {sobre != null && <div className="nx-dica">{dados[sobre].rotulo} · <b>{dados[sobre].dica ?? brl0(dados[sobre].valor)}</b></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
type VG = {
  mes: string;
  meses: { mes: string; valor: number; notas: number; icms: number; piscofins: number; sem_nota: number }[];
  casas: { id: string; nome: string; loja: number; notas: number; valor: number; sem_nota: number; pendentes: number; canceladas: number; icms: number;
    pis: number; cofins: number; cbs: number; ibs: number; servico: number; valor_ant: number; erros: number; atencoes: number; desde: string | null }[];
  pendencias: { produtos_erro: number; produtos_atencao: number; produtos_ok: number; regras_erro: number; decisoes: number };
  reforma: { itens: number; i200047: number | null; i000001: number | null; i410019: number | null; ivazio: number | null } | null;
  fazer: { sev: "erro" | "atencao"; titulo: string; detalhe: string; valor: number | null; vista: string; filtro: string | null }[];
};

export function VisaoGeralNfce({ irPara }: { irPara: IrPara }) {
  const supabase = useMemo(() => createClient(), []);
  const meses = useMeses();
  const [mes, setMes] = useState(mesAtual());
  const [d, setD] = useState<VG | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setD(null); setErro("");
    supabase.rpc("nfce_visao_geral", { p_mes: mes }).then(({ data, error }) => { if (error) setErro(error.message); else setD(data as VG); });
  }, [supabase, mes]);
  if (erro) return <p className="es-aviso">Não deu para montar a visão geral: {erro}</p>;
  if (!d) return <p className="muted">Montando a visão geral…</p>;

  const tot = d.casas.reduce((s, c) => ({ valor: s.valor + Number(c.valor), notas: s.notas + c.notas, sem: s.sem + Number(c.sem_nota), icms: s.icms + Number(c.icms),
    pc: s.pc + Number(c.pis) + Number(c.cofins), ant: s.ant + Number(c.valor_ant), canc: s.canc + c.canceladas, pend: s.pend + c.pendentes }),
    { valor: 0, notas: 0, sem: 0, icms: 0, pc: 0, ant: 0, canc: 0, pend: 0 });
  const varia = tot.ant ? ((tot.valor - tot.ant) / tot.ant) * 100 : null;
  const pend = d.pendencias.produtos_erro + d.pendencias.regras_erro;
  const serie = d.meses.slice(-14);
  const idx = serie.findIndex((m) => m.mes === mes);

  return (
    <div className="nx">
      <div className="nx-acoes"><SeletorMes mes={mes} setMes={setMes} meses={meses} /></div>
      <div className="nx-kpis">
        <div className="nx-kpi"><span>Vendido com NFC-e</span><b>{brl0(tot.valor)}</b><small>{num(tot.notas)} notas{varia != null ? <> · <i className={varia >= 0 ? "bom" : "ruim"}>{varia >= 0 ? "+" : ""}{pct(varia, 0)} × mês anterior</i></> : null}</small></div>
        <div className="nx-kpi"><span>Impostos destacados</span><b>{brl0(tot.icms + tot.pc)}</b><small>ICMS {brl0(tot.icms)} · PIS/Cofins {brl0(tot.pc)}</small></div>
        <div className="nx-kpi"><span>Sem nota fiscal</span><b>{brl0(tot.sem)}</b><small>assinadas na conta do quarto{tot.canc ? ` · ${num(tot.canc)} canceladas` : ""}</small></div>
        <button className="nx-kpi nx-kpi-btn" onClick={() => irPara("nfce:pendencias")}><span>Pendências</span><b className={pend ? "ruim" : "bom"}>{num(pend)}</b><small>{num(d.pendencias.produtos_erro)} produtos · {num(d.pendencias.regras_erro)} regras · {num(d.pendencias.decisoes)} decisões</small></button>
      </div>

      <section className="nx-card">
        <header className="nx-card-cab"><h3>Vendas com NFC-e, mês a mês</h3><span className="nx-legenda"><i className="b" />meses anteriores <i className="on" />{nomeMes(mes)}</span></header>
        <Barras dados={serie.map((m) => ({ rotulo: mesCurto(m.mes), valor: Number(m.valor), dica: `${brl0(m.valor)} · ${num(m.notas)} notas · ICMS ${brl0(m.icms)}` }))} destaque={idx >= 0 ? idx : undefined} />
      </section>

      <div className="nx-dois">
        <section className="nx-card">
          <header className="nx-card-cab"><h3>O que fazer agora</h3><button className="ghost small" onClick={() => irPara("nfce:pendencias")}>Todas as pendências</button></header>
          {d.fazer.length ? (
            <ul className="nx-fazer">
              {d.fazer.map((f, i) => (
                <li key={i} className={f.sev}>
                  <button onClick={() => irPara(`nfce:${f.vista}`)}>
                    <span className="nx-fazer-txt"><b>{f.titulo}</b><small>{f.detalhe}</small></span>
                    {f.valor != null && <span className="nx-fazer-v">{brl0(f.valor)}</span>}
                    <span className="ip-seta nx-seta" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="pd-ok">Nada pendente.</p>}
        </section>
        <section className="nx-card">
          <header className="nx-card-cab"><h3>Por casa</h3><span className="sub">{nomeMes(mes)}</span></header>
          <ul className="nx-casas">
            {d.casas.map((c) => (
              <li key={c.id}>
                <div className="nx-casa-l"><b>{c.nome}</b><small>{c.notas ? `${num(c.notas)} notas · ICMS ${brl0(c.icms)}` : c.desde ? "sem vendas neste mês" : "o caixa ainda não manda vendas à TOTVS"}{Number(c.sem_nota) > 0 ? ` · ${brl0(c.sem_nota)} em assinadas` : ""}</small></div>
                <div className="nx-casa-r"><b>{c.valor ? brl0(c.valor) : "—"}</b>
                  {c.erros > 0 ? <span className="pd-chip erro">{num(c.erros)} produtos com erro</span> : c.atencoes > 0 ? <span className="pd-chip atencao">{num(c.atencoes)} com atenção</span> : <span className="pd-chip ok">cadastro ok</span>}
                </div>
              </li>
            ))}
          </ul>
          {d.reforma && d.reforma.itens > 0 && (
            <button className="nx-reforma" onClick={() => irPara("nfce:reforma")}>
              <span><b>Pronto para a reforma (2027)</b><small>{pct(100 * Number(d.reforma.i200047 ?? 0) / d.reforma.itens)} dos itens com o cClassTrib de restaurante (200047)</small></span>
              <span className="nx-medidor"><i style={{ width: `${Math.min(100, 100 * Number(d.reforma.i200047 ?? 0) / d.reforma.itens)}%` }} /></span>
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
type MesLinha = { mes: string; unidade_id: string; notas: number; valor: number; icms: number; pis: number; cofins: number; cbs: number; ibs: number; servico: number; valor_sem_nota: number };

export function ImpostosNfce() {
  const supabase = useMemo(() => createClient(), []);
  const [linhas, setLinhas] = useState<MesLinha[] | null>(null);
  const [unidades, setUnidades] = useState<{ id: string; nome: string }[]>([]);
  const [casa, setCasa] = useState("");
  const [verApuracao, setVerApuracao] = useState(true);
  useEffect(() => {
    Promise.all([
      supabase.from("nfce_meses").select("mes,unidade_id,notas,valor,icms,pis,cofins,cbs,ibs,servico,valor_sem_nota"),
      supabase.from("totvs_unidades").select("id,nome,ordem").order("ordem"),
    ]).then(([m, u]) => { setLinhas((m.data ?? []) as MesLinha[]); setUnidades((u.data ?? []) as { id: string; nome: string }[]); });
  }, [supabase]);
  if (!linhas) return <p className="muted">Somando os impostos…</p>;
  const casas = unidades.filter((u) => linhas.some((l) => l.unidade_id === u.id));
  const porMes = new Map<string, MesLinha>();
  for (const l of linhas.filter((x) => !casa || x.unidade_id === casa)) {
    const a = porMes.get(l.mes) ?? { ...l, notas: 0, valor: 0, icms: 0, pis: 0, cofins: 0, cbs: 0, ibs: 0, servico: 0, valor_sem_nota: 0 };
    for (const k of ["notas", "valor", "icms", "pis", "cofins", "cbs", "ibs", "servico", "valor_sem_nota"] as const) a[k] = Number(a[k]) + Number(l[k]);
    porMes.set(l.mes, a);
  }
  const lista = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
  const serie = [...lista].reverse().slice(-14);
  const t12 = lista.slice(0, 12).reduce((s, m) => ({ valor: s.valor + m.valor, icms: s.icms + m.icms, pc: s.pc + m.pis + m.cofins, rf: s.rf + m.cbs + m.ibs }), { valor: 0, icms: 0, pc: 0, rf: 0 });
  return (
    <div className="nx">
      <div className="nx-acoes pd-casas">
        <button className={!casa ? "on" : ""} onClick={() => setCasa("")}>Todas as casas</button>
        {casas.map((u) => <button key={u.id} className={casa === u.id ? "on" : ""} onClick={() => setCasa(u.id)}>{u.nome}</button>)}
      </div>
      <div className="nx-kpis">
        <div className="nx-kpi"><span>Vendido em 12 meses</span><b>{brl0(t12.valor)}</b><small>NFC-e autorizadas</small></div>
        <div className="nx-kpi"><span>ICMS em 12 meses</span><b>{brl0(t12.icms)}</b><small>{pct(100 * t12.icms / (t12.valor || 1))} do vendido</small></div>
        <div className="nx-kpi"><span>PIS + Cofins</span><b>{brl0(t12.pc)}</b><small>{pct(100 * t12.pc / (t12.valor || 1))} do vendido</small></div>
        <div className="nx-kpi"><span>CBS + IBS (teste)</span><b>{brl0(t12.rf)}</b><small>destacado em 2026, não se paga</small></div>
      </div>
      <section className="nx-card">
        <header className="nx-card-cab"><h3>Impostos destacados nas notas, mês a mês</h3><span className="nx-legenda">ICMS + PIS + Cofins</span></header>
        <Barras dados={serie.map((m) => ({ rotulo: mesCurto(m.mes), valor: m.icms + m.pis + m.cofins, dica: `ICMS ${brl0(m.icms)} · PIS/Cofins ${brl0(m.pis + m.cofins)}` }))} altura={160} />
      </section>
      <section className="nx-card">
        <header className="nx-card-cab"><h3>Mês a mês</h3><span className="sub">a taxa de serviço entra no vendido</span></header>
        <div className="nf-tabela-wrap">
          <table className="nf-tabela pd-tabela">
            <thead><tr><th>Mês</th><th className="n">Notas</th><th className="n">Vendido</th><th className="n">ICMS</th><th className="n">PIS</th><th className="n">Cofins</th><th className="n">CBS</th><th className="n">IBS</th><th className="n">Taxa de serviço</th><th className="n">Carga</th><th className="n">Sem nota</th></tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.mes}>
                  <td>{nomeMes(m.mes)}</td><td className="n">{num(m.notas)}</td><td className="n">{brl0(m.valor)}</td><td className="n">{brl0(m.icms)}</td>
                  <td className="n">{brl0(m.pis)}</td><td className="n">{brl0(m.cofins)}</td><td className="n">{brl0(m.cbs)}</td><td className="n">{brl0(m.ibs)}</td>
                  <td className="n">{brl0(m.servico)}</td><td className="n">{pct(100 * (m.icms + m.pis + m.cofins) / (m.valor || 1))}</td><td className="n">{brl0(m.valor_sem_nota)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={`pd-casa${verApuracao ? " aberta" : ""}`}>
        <button className="pd-casa-cabeca" onClick={() => setVerApuracao((x) => !x)} aria-expanded={verApuracao}>
          <span className="pd-casa-nome"><strong>Apuração do ICMS</strong><small>ICMS das vendas menos o crédito das compras, mais o DIFAL de fora do RN, por empresa (estimativa para conferir o contador)</small></span>
          <span className="pd-contas" /><span className="ip-seta" aria-hidden="true" />
        </button>
        {verApuracao && <div className="pd-casa-corpo"><ApuracaoIcms /></div>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
type Pend = {
  chefweb_produtos: { regra: string; sev: "erro" | "atencao"; loja: number; casa: string; produtos: number; vendido: number; exemplos: string[] }[];
  chefweb_regras: { regra: string; sev: "erro" | "atencao"; regras: number; casas: string[]; exemplos: string[] }[];
  decisoes: { origem: string; chave: string; nome: string; valor: string | null; decisao: string | null }[];
  acompanhar: { pendentes_mes: number; canceladas_mes: number; casas: { nome: string; desde: string | null; ate: string | null }[]; cadastro_lido: string | null; regras_lidas: string | null };
};
const PROD_TITULO: Record<string, string> = {
  sem_ncm: "Produto sem NCM", sem_regra: "NCM sem regra fiscal na casa", pis: "PIS do produto fora de 0,65%", cofins: "Cofins do produto fora de 3%",
  monofasico: "Bebida monofásica com PIS/Cofins", regra_pis: "Regra do NCM com PIS fora de 0,65%", regra_cofins: "Regra do NCM com Cofins fora de 3%",
  icms_regra: "ICMS do produto diferente da regra", cfop_regra: "CFOP do produto diferente da regra", regra_ibscbs: "Regra do NCM sem IBS/CBS",
  nota_varia: "Classificação variando nas NFC-e", ncm_casas: "NCM diferente entre as casas",
};
const REGRA_TITULO: Record<string, string> = {
  uf: "Regra com UF errada", pis: "Regra com PIS errado", cofins: "Regra com Cofins errada", monofasico: "Monofásico pagando PIS/Cofins",
  casas: "Mesmo NCM diferente entre as casas", regime: "Regra do Simples sobrando", monofasico_cst: "CST de PIS/Cofins diferente entre as casas",
  ibscbs: "Regra sem IBS/CBS", tipo_item: "Regra sem tipo do item", st_sem_cest: "ST sem CEST", sem_regra: "NCM vendido sem regra",
};

export function PendenciasNfce({ irPara }: { irPara: IrPara }) {
  const supabase = useMemo(() => createClient(), []);
  const meses = useMeses();
  const [p, setP] = useState<Pend | null>(null);
  const [erro, setErro] = useState("");
  const [mesConf, setMesConf] = useState(mesAtual());
  const [verConf, setVerConf] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.rpc("nfce_pendencias").then(({ data, error }) => { if (error) setErro(error.message); else setP(data as Pend); });
    supabase.from("totvs_unidades").select("id,nome").then(({ data }) => setNomes(Object.fromEntries(((data ?? []) as { id: string; nome: string }[]).map((u) => [u.id, u.nome]))));
  }, [supabase]);
  if (erro) return <p className="es-aviso">Não deu para montar as pendências: {erro}</p>;
  if (!p) return <p className="muted">Juntando as pendências…</p>;
  const aDefinir = p.decisoes.filter((d) => !d.valor);
  const definidas = p.decisoes.filter((d) => d.valor);
  // Conta as tarefas (cada cartão é um tipo de problema numa casa), não os produtos: o mesmo produto pode ter mais de um problema
  const nChef = p.chefweb_produtos.filter((x) => x.sev === "erro").length + p.chefweb_regras.filter((x) => x.sev === "erro").length;
  const fim = (() => { const d = new Date(Number(mesConf.slice(0, 4)), Number(mesConf.slice(5, 7)), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();
  return (
    <div className="nx">
      <div className="nx-colunas">
        <section className="nx-col">
          <header><h3>Corrigir no Chef Web</h3><span className="pd-chip erro">{num(nChef)} tarefa{nChef === 1 ? "" : "s"} com erro</span></header>
          {p.chefweb_produtos.map((x, i) => (
            <article key={`p${i}`} className={`nx-tarefa ${x.sev}`}>
              <b>{PROD_TITULO[x.regra] ?? x.regra}</b>
              <small>{x.casa} · {num(x.produtos)} produto{x.produtos === 1 ? "" : "s"}{x.vendido ? ` · ${brl0(x.vendido)} vendidos em 120 dias` : ""}</small>
              <small className="nx-ex">{x.exemplos.filter(Boolean).slice(0, 3).join(" · ")}</small>
              <div className="nx-tarefa-rod"><button className="ghost small" onClick={() => irPara("nfce:produtos")}>Ver produtos</button></div>
            </article>
          ))}
          {p.chefweb_regras.map((x, i) => (
            <article key={`r${i}`} className={`nx-tarefa ${x.sev}`}>
              <b>{REGRA_TITULO[x.regra] ?? x.regra}</b>
              <small>{x.casas.filter(Boolean).join(", ")} · {num(x.regras)} regra{x.regras === 1 ? "" : "s"} fiscal{x.regras === 1 ? "" : "is"}</small>
              <small className="nx-ex">{x.exemplos.slice(0, 2).join(" · ")}</small>
              <div className="nx-tarefa-rod"><button className="ghost small" onClick={() => irPara("nfce:produtos")}>Ver regras</button></div>
            </article>
          ))}
        </section>
        <section className="nx-col">
          <header><h3>Decidir com a contabilidade</h3><span className="pd-chip atencao">{num(aDefinir.length)} a definir</span></header>
          {aDefinir.map((d) => (
            <article key={d.chave} className="nx-tarefa atencao"><b>{d.nome}</b><small>{d.origem === "icms" ? "Apuração do ICMS" : "Conferência das NFC-e"} · a definir</small>{d.decisao && <small className="nx-ex">{d.decisao}</small>}</article>
          ))}
          {definidas.map((d) => (
            <article key={d.chave} className="nx-tarefa ok"><b>{d.nome}</b><small>definido: <b>{d.valor}</b></small></article>
          ))}
          <p className="pd-nota">As respostas da contabilidade entram aqui e a conferência passa a cobrar o valor decidido.</p>
        </section>
        <section className="nx-col">
          <header><h3>Acompanhar</h3><span className={`pd-chip ${p.acompanhar.pendentes_mes ? "erro" : "ok"}`}>{p.acompanhar.pendentes_mes ? `${num(p.acompanhar.pendentes_mes)} sem autorização` : "em dia"}</span></header>
          <article className={`nx-tarefa ${p.acompanhar.pendentes_mes ? "erro" : "ok"}`}><b>NFC-e sem autorização no mês</b><small>{p.acompanhar.pendentes_mes ? `${num(p.acompanhar.pendentes_mes)} venda(s) sem nota autorizada: conferir no caixa` : "nenhuma nota em contingência"}</small>
            {p.acompanhar.pendentes_mes > 0 && <div className="nx-tarefa-rod"><button className="ghost small" onClick={() => irPara("nfce:notas")}>Ver notas</button></div>}</article>
          <article className="nx-tarefa ok"><b>Notas canceladas no mês</b><small>{num(p.acompanhar.canceladas_mes)} cancelada(s) pelo caixa</small></article>
          {p.acompanhar.casas.map((c) => (
            <article key={c.nome} className={`nx-tarefa ${c.desde ? "ok" : "atencao"}`}><b>{c.nome}</b><small>{c.desde ? `NFC-e de ${dataBr(c.desde)} a ${dataBr(c.ate)}` : "o caixa ainda não manda vendas à TOTVS (chamado aberto)"}</small></article>
          ))}
          <article className="nx-tarefa ok"><b>Cadastro do Chef Web</b><small>produtos lidos em {dataBr(p.acompanhar.cadastro_lido)} · regras em {dataBr(p.acompanhar.regras_lidas)}; peça ao Claude para buscar de novo quando mudar</small></article>
        </section>
      </div>
      <section className={`pd-casa${verConf ? " aberta" : ""}`}>
        <button className="pd-casa-cabeca" onClick={() => setVerConf((x) => !x)} aria-expanded={verConf}>
          <span className="pd-casa-nome"><strong>Conferência item a item das notas</strong><small>as 15 regras aplicadas a cada item das NFC-e do mês, com o impacto em reais</small></span>
          <span className="pd-contas" /><span className="ip-seta" aria-hidden="true" />
        </button>
        {verConf && (
          <div className="pd-casa-corpo">
            <div className="nx-acoes"><SeletorMes mes={mesConf} setMes={setMesConf} meses={meses} /></div>
            <ConferenciaFiscal mes={mesConf} fimMes={fim} unidade="" nomeUnidade={nomes} />
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
type Ref = {
  de: string; meses: number;
  linhas: { unidade_id: string; casa: string; categoria: string; cclasstrib: string; ibscbs_cst: string | null; itens: number; valor: number }[];
  impostos: { unidade_id: string; valor: number; pis: number; cofins: number; cbs: number; ibs: number; icms: number; servico: number }[];
};
const CAT: Record<string, string> = { comida: "Comida", bebida: "Bebidas", taxa: "Taxa de serviço", outros: "Outros" };
const CCLASS: Record<string, string> = { "000001": "tributação integral", "200047": "bares e restaurantes (−40%)", "410019": "gorjeta (fora da base)", vazio: "sem classificação" };
const ALVO: Record<string, string> = { comida: "200047", bebida: "200047", taxa: "410019" };

export function ReformaNfce() {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<Ref | null>(null);
  const [erro, setErro] = useState("");
  const [aliq, setAliq] = useState("8,8");
  useEffect(() => {
    supabase.rpc("nfce_reforma", { p_meses: 3 }).then(({ data, error }) => { if (error) setErro(error.message); else setR(data as Ref); });
  }, [supabase]);
  if (erro) return <p className="es-aviso">Não deu para montar a reforma: {erro}</p>;
  if (!r) return <p className="muted">Conferindo a classificação da reforma…</p>;
  const casas = [...new Set(r.linhas.map((l) => l.unidade_id))];
  const aliqNum = Number(aliq.replace(",", ".")) || 0;
  const pronto = (u?: string) => {
    const ls = r.linhas.filter((l) => (!u || l.unidade_id === u) && ALVO[l.categoria]);
    const total = ls.reduce((s, l) => s + Number(l.valor), 0);
    const certo = ls.filter((l) => l.cclasstrib === ALVO[l.categoria]).reduce((s, l) => s + Number(l.valor), 0);
    return total ? (100 * certo) / total : 0;
  };
  return (
    <div className="nx">
      <section className="nx-card nx-linha-tempo">
        <header className="nx-card-cab"><h3>O que muda</h3><span className="sub">reforma do consumo (EC 132/2023, LC 214/2025)</span></header>
        <ol>
          <li className="on"><b>2026</b><span>teste: CBS 0,9% e IBS 0,1% destacados na nota, sem pagar</span></li>
          <li><b>2027</b><span>CBS para valer; acabam PIS e Cofins</span></li>
          <li><b>2029–2032</b><span>ICMS e ISS caem ano a ano; IBS sobe</span></li>
          <li><b>2033</b><span>modelo completo: só CBS, IBS e Imposto Seletivo</span></li>
        </ol>
      </section>
      <div className="nx-kpis">
        <div className="nx-kpi"><span>Pronto para 2027</span><b className={pronto() < 50 ? "ruim" : "bom"}>{pct(pronto(), 0)}</b><small>do vendido com o cClassTrib certo (comida e bebida 200047, gorjeta 410019)</small></div>
        {casas.map((u) => {
          const nome = r.linhas.find((l) => l.unidade_id === u)?.casa ?? u;
          return <div key={u} className="nx-kpi"><span>{nome}</span><b className={pronto(u) < 50 ? "ruim" : "bom"}>{pct(pronto(u), 0)}</b><small>pronto para 2027</small></div>;
        })}
      </div>
      {casas.map((u) => {
        const ls = r.linhas.filter((l) => l.unidade_id === u);
        const nome = ls[0]?.casa ?? u;
        const imp = r.impostos.find((i) => i.unidade_id === u);
        const porCat = ["comida", "bebida", "taxa", "outros"].map((c) => ({ c, ls: ls.filter((l) => l.categoria === c) })).filter((x) => x.ls.length);
        const baseSemTaxa = ls.filter((l) => l.categoria !== "taxa").reduce((s, l) => s + Number(l.valor), 0);
        const cbs2027 = baseSemTaxa * (aliqNum / 100) * 0.6;
        const pisCofins = imp ? Number(imp.pis) + Number(imp.cofins) : 0;
        return (
          <section key={u} className="nx-card">
            <header className="nx-card-cab"><h3>{nome}</h3><span className="sub">últimos {r.meses} meses (desde {mesCurto(r.de)})</span></header>
            <div className="nf-tabela-wrap">
              <table className="nf-tabela pd-tabela">
                <thead><tr><th>Categoria</th><th>cClassTrib nas notas</th><th className="n">Itens</th><th className="n">Vendido</th><th>Deveria ser</th></tr></thead>
                <tbody>
                  {porCat.flatMap(({ c, ls: lc }) => lc.map((l, k) => (
                    <tr key={`${c}${k}`} className={ALVO[c] ? (l.cclasstrib === ALVO[c] ? "nx-ok" : "nx-dif") : ""}>
                      <td>{k === 0 ? <b>{CAT[c]}</b> : ""}</td>
                      <td>{l.cclasstrib}<small>{CCLASS[l.cclasstrib] ?? ""}{l.ibscbs_cst ? ` · CST ${l.ibscbs_cst}` : ""}</small></td>
                      <td className="n">{num(l.itens)}</td><td className="n">{brl0(l.valor)}</td>
                      <td>{ALVO[c] ? (l.cclasstrib === ALVO[c] ? <span className="pd-chip ok">certo</span> : <span className="pd-chip atencao">{ALVO[c]} · a confirmar</span>) : "—"}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <div className="nx-sim">
              <div><span>PIS + Cofins hoje (período)</span><b>{brl0(pisCofins)}</b></div>
              <div><span>CBS em 2027, mesmo vendido</span><b>{brl0(cbs2027)}</b><small>{aliq}% com 40% de redução, gorjeta fora da base</small></div>
              <div><span>Diferença</span><b className={cbs2027 > pisCofins ? "ruim" : "bom"}>{brl0(cbs2027 - pisCofins)}</b><small>{cbs2027 > pisCofins ? "a mais" : "a menos"} no período</small></div>
            </div>
          </section>
        );
      })}
      <p className="pd-nota">
        Alíquota da CBS em 2027: <input className="nx-aliq" value={aliq} onChange={(e) => setAliq(e.target.value)} aria-label="Alíquota da CBS em 2027" />% (estimativa;
        troque quando sair a alíquota oficial). A simulação usa a regra da calculadora oficial da Receita: bares e restaurantes com 40% de redução
        (cClassTrib 200047) e gorjeta fora da base (410019). O enquadramento é da contabilidade.
      </p>
    </div>
  );
}
