"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Gaveta from "./Gaveta";

// Página de produtos (aba NFC-e › Produtos), refeita em 23/11/2026 a pedido do dono: "organizada, fluida, listas que
// recolhem, cada produto detalhado com tudo o que temos, e o Ponta Negra no filtro".
// Lista: totvs_produtos_lista (cadastro do Chef Web lido do navegador + regra fiscal do NCM + vendas de 120 dias + problemas).
// Ficha: totvs_produto_detalhe (cadastro inteiro, regra do NCM nesta e nas outras casas, o mesmo produto nas outras casas,
// como sai na NFC-e e vendas por mês). Regras fiscais por NCM: totvs_regras_conferencia. SQL em supabase/totvs_produtos_painel.sql.
type Problema = { regra: string; sev: "erro" | "atencao" };
type Prod = {
  l: number; c: string; n: string; g: string | null; sg: string | null; pr: number | null; a: boolean;
  ncm: string | null; cest: string | null; cfop: string | null; icms: number | null; pis: number | null; cof: number | null;
  r_icms: number | null; r_cst: string | null; r_pis: number | null; r_cof: number | null; r_ibs: string | null; r_cc: string | null; reg: boolean;
  v_val: number | null; v_qtd: number | null; v_ult: string | null;
  nota: { cst: string | null; aliquota: number | null; cfop: string | null; cclasstrib: string | null; ibscbs_cst: string | null } | null;
  pb: Problema[];
};
type Casa = { loja_codigo: number; casa: string; unidade_id: string | null; produtos: number; ativos: number };
type Lista = { lido_em: string | null; casas: Casa[]; produtos: Prod[] };

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const brl0 = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const num = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR")}%`);
const dataBr = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

// Cada problema: rótulo curto (na lista), título e como resolver (na ficha)
const PROBLEMAS: Record<string, { curto: string; titulo: string; resolver: string }> = {
  sem_ncm: { curto: "sem NCM", titulo: "Produto sem NCM", resolver: "Em Cadastro › Produtos › Dados Fiscais, informar o NCM de 8 dígitos." },
  sem_regra: { curto: "NCM sem regra", titulo: "O NCM não tem regra fiscal nesta casa", resolver: "Cadastrar a regra fiscal do NCM na loja (Cadastro › NCM) ou trocar o NCM do produto por um que já tem regra." },
  pis: { curto: "PIS", titulo: "PIS do produto fora de 0,65%", resolver: "Em Dados Fiscais do produto, PIS 0,65% (cumulativo do Lucro Presumido)." },
  cofins: { curto: "Cofins", titulo: "Cofins do produto fora de 3%", resolver: "Em Dados Fiscais do produto, Cofins 3,00% (cumulativo do Lucro Presumido). Com 0,65% a nota sai recolhendo Cofins a menos." },
  monofasico: { curto: "monofásico", titulo: "Bebida monofásica com PIS/Cofins", resolver: "Água, refrigerante e cerveja já têm PIS/Cofins pago pelo fabricante: zerar no produto e usar CST 04 na regra do NCM." },
  regra_pis: { curto: "PIS da regra", titulo: "A regra do NCM tem PIS fora de 0,65%", resolver: "Em Cadastro › NCM, na regra desta loja, PIS 0,65% (CST 01)." },
  regra_cofins: { curto: "Cofins da regra", titulo: "A regra do NCM tem Cofins fora de 3%", resolver: "Em Cadastro › NCM, na regra desta loja, Cofins 3,00% (CST 01, por percentual)." },
  icms_regra: { curto: "ICMS ≠ regra", titulo: "ICMS do produto diferente da regra do NCM", resolver: "Igualar o Imposto (%) do produto ao da regra do NCM nesta loja (confirmar com a contabilidade qual é o certo)." },
  cfop_regra: { curto: "CFOP ≠ regra", titulo: "CFOP do produto diferente da regra do NCM", resolver: "Igualar o CFOP do produto ao da regra (5102 tributado; 5405 substituição tributária)." },
  regra_ibscbs: { curto: "sem IBS/CBS", titulo: "A regra do NCM não tem IBS/CBS", resolver: "Preencher o CST e o cClassTrib do IBS/CBS na regra do NCM (vale a partir de 2027)." },
  nota_varia: { curto: "nota varia", titulo: "Saiu nas NFC-e com classificações diferentes", resolver: "O mesmo produto saiu com CST, alíquota, CFOP ou cClassTrib diferentes em vendas diferentes: conferir a regra do NCM e o cadastro." },
  ncm_casas: { curto: "NCM entre casas", titulo: "O mesmo produto tem NCM diferente em outra casa", resolver: "Usar o mesmo NCM para o mesmo produto em todas as casas (ver a tabela abaixo)." },
};

// Nomes legíveis dos campos do cadastro (o resto aparece com o nome do Chef Web)
const ROTULO: Record<string, string> = {
  TextoFiscal: "Texto fiscal", CodNCM: "NCM", CodCEST: "CEST", Imposto: "ICMS (%)", Tributo: "Tributo", CFOPVendaID: "CFOP de venda", CSTVenda: "CST de venda",
  CSTPIS: "CST do PIS", PIS: "PIS (%)", PISValor: "PIS (valor)", PISTipoCalculo: "Cálculo do PIS", CSTCOFINS: "CST da Cofins", COFINS: "Cofins (%)",
  COFINSValor: "Cofins (valor)", COFINSTipoCalculo: "Cálculo da Cofins", Produto_CST_IBS_CBS_VI: "CST IBS/CBS", Produto_ClassTribIBSCBS_VI: "cClassTrib",
  PercentualCBS: "CBS (%)", PercentualIBSUF: "IBS UF (%)", PercentualIBSMun: "IBS município (%)", PerReducaoBCICMS: "Redução da base do ICMS (%)",
  CodigoBeneficioFiscal: "Benefício fiscal", ReducaoIcmsEfetivo: "Redução ICMS efetivo (%)", AliquotaIcmsEfetivo: "Alíquota ICMS efetivo (%)",
  AliquotaICMSST: "Alíquota ICMS ST (%)", CodigoCreditoPresumido: "Crédito presumido", CFOP: "CFOP de compra", CST: "CST de compra", ReducaoICMS: "Redução do ICMS",
  TributoCompra: "Tributo na compra", IndicadorIncentivoFiscal: "Incentivo fiscal", CodigoGTIN: "GTIN (código de barras)", IAT: "IAT (arredondamento)",
  IPPT: "IPPT (produção)", TipoItem: "Tipo do item", UtilizaCodigoBarras: "Usa código de barras",
};

export default function ProdutosTotvs() {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState("");
  const [insumos, setInsumos] = useState(false);
  const [inativos, setInativos] = useState(false);
  const [casa, setCasa] = useState(0);
  const [situacao, setSituacao] = useState<"" | "erro" | "atencao" | "ok" | "vendidos">("");
  const [grupo, setGrupo] = useState("");
  const [busca, setBusca] = useState("");
  const [fechadas, setFechadas] = useState<Record<string, boolean>>({});
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [ficha, setFicha] = useState<Prod | null>(null);
  const [regrasAbertas, setRegrasAbertas] = useState(false);

  useEffect(() => {
    setLista(null); setErro("");
    supabase.rpc("totvs_produtos_lista", { p_insumos: insumos }).then(({ data, error }) => {
      if (error) setErro(error.message); else setLista(data as Lista);
    });
  }, [supabase, insumos]);

  const t = busca.trim().toLowerCase();
  const filtrando = !!(t || situacao || grupo);
  const sit = (p: Prod) => (p.pb.some((x) => x.sev === "erro") ? "erro" : p.pb.length ? "atencao" : "ok");
  const visiveis = useMemo(() => (lista?.produtos ?? []).filter((p) =>
    (inativos || p.a) && (!casa || p.l === casa) && (!grupo || (p.g ?? "Sem grupo") === grupo)
    && (!situacao || (situacao === "vendidos" ? !!p.v_val : sit(p) === situacao))
    && (!t || p.n.toLowerCase().includes(t) || p.c === t || (p.ncm ?? "").includes(t))), [lista, inativos, casa, grupo, situacao, t]);

  if (erro) return <p className="es-aviso">Não deu para carregar os produtos: {erro}</p>;
  if (!lista) return <p className="muted">Carregando os produtos…</p>;
  if (!lista.casas.length) return <p className="muted">O cadastro do Chef Web ainda não foi lido. Abra o Chef Web no navegador do app e peça ao Claude para buscar.</p>;

  const base = lista.produtos.filter((p) => (inativos || p.a) && (!casa || p.l === casa));
  const conta = { total: base.length, erro: base.filter((p) => sit(p) === "erro").length, atencao: base.filter((p) => sit(p) === "atencao").length, vendidos: base.filter((p) => p.v_val).length };
  const grupos = [...new Set(lista.produtos.map((p) => p.g ?? "Sem grupo"))].sort();
  const nomeCasa = (l: number) => lista.casas.find((c) => c.loja_codigo === l)?.casa ?? String(l);

  // Casa → grupo › subgrupo → produtos
  const arvore = lista.casas.filter((c) => !casa || c.loja_codigo === casa).map((c) => {
    const ps = visiveis.filter((p) => p.l === c.loja_codigo);
    const blocos = new Map<string, Prod[]>();
    for (const p of ps) {
      const k = `${p.g ?? "Sem grupo"} › ${p.sg ?? "Sem subgrupo"}`;
      if (!blocos.has(k)) blocos.set(k, []);
      blocos.get(k)!.push(p);
    }
    return { c, ps, blocos: [...blocos.entries()] };
  }).filter((x) => x.ps.length);

  const todasChaves = arvore.flatMap((x) => x.blocos.map(([k]) => `${x.c.loja_codigo}|${k}`));
  const abrirTudo = () => { setFechadas({}); setAbertos(Object.fromEntries(todasChaves.map((k) => [k, true]))); };
  const recolherTudo = () => { setAbertos({}); setFechadas(Object.fromEntries(arvore.map((x) => [String(x.c.loja_codigo), true]))); };

  function planilha() {
    const linhas = [["Casa", "Código", "Produto", "Grupo", "Subgrupo", "Situação", "Preço", "NCM", "CEST", "CFOP", "ICMS produto", "ICMS regra", "PIS", "Cofins",
      "CST regra", "CST IBS/CBS", "cClassTrib", "Vendido 120 dias", "Última venda", "Problemas"]];
    for (const p of visiveis) {
      linhas.push([nomeCasa(p.l), p.c, p.n, p.g ?? "", p.sg ?? "", p.a ? "ativo" : "inativo", p.pr == null ? "" : String(p.pr).replace(".", ","), p.ncm ?? "",
        p.cest ?? "", p.cfop ?? "", p.icms == null ? "" : String(p.icms).replace(".", ","), p.r_icms == null ? "" : String(p.r_icms).replace(".", ","),
        p.pis == null ? "" : String(p.pis).replace(".", ","), p.cof == null ? "" : String(p.cof).replace(".", ","), p.r_cst ?? "", p.r_ibs ?? "", p.r_cc ?? "",
        p.v_val == null ? "" : String(p.v_val).replace(".", ","), p.v_ult ?? "", p.pb.map((x) => PROBLEMAS[x.regra]?.titulo ?? x.regra).join(" | ")]);
    }
    const csv = "﻿" + linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "produtos-totvs.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pd">
      <p className="pd-intro">
        Todos os produtos do cadastro do Chef Web, com a regra fiscal do NCM de cada casa, as vendas dos últimos 120 dias (NFC-e) e o que precisa
        corrigir. Clique num produto para ver a ficha completa. Lido do Chef Web em {dataBr(lista.lido_em)}; quando o cadastro mudar, peça ao Claude para buscar de novo.
      </p>

      <div className="pd-numeros">
        <button className={!situacao ? "on" : ""} onClick={() => setSituacao("")}><span>Produtos</span><b>{num(conta.total)}</b><small>{inativos ? "ativos e inativos" : "ativos"}{insumos ? ", com insumos" : ""}</small></button>
        <button className={situacao === "erro" ? "on ruim" : "ruim"} onClick={() => setSituacao(situacao === "erro" ? "" : "erro")}><span>Com erro</span><b>{num(conta.erro)}</b><small>a corrigir no Chef Web</small></button>
        <button className={situacao === "atencao" ? "on atencao" : "atencao"} onClick={() => setSituacao(situacao === "atencao" ? "" : "atencao")}><span>Com atenção</span><b>{num(conta.atencao)}</b><small>a conferir</small></button>
        <button className={situacao === "vendidos" ? "on" : ""} onClick={() => setSituacao(situacao === "vendidos" ? "" : "vendidos")}><span>Vendidos</span><b>{num(conta.vendidos)}</b><small>nos últimos 120 dias</small></button>
      </div>

      <div className="pd-filtros">
        <div className="pd-casas" role="tablist" aria-label="Casa">
          <button role="tab" aria-selected={!casa} className={!casa ? "on" : ""} onClick={() => setCasa(0)}>Todas as casas</button>
          {lista.casas.map((c) => (
            <button key={c.loja_codigo} role="tab" aria-selected={casa === c.loja_codigo} className={casa === c.loja_codigo ? "on" : ""} onClick={() => setCasa(c.loja_codigo)}>
              {c.casa}<span>{num(inativos ? c.produtos : c.ativos)}</span>
            </button>
          ))}
        </div>
        <div className="pd-linha">
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto, código ou NCM" aria-label="Buscar produto" />
          <select value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)} aria-label="Situação">
            <option value="">Todas as situações</option>
            <option value="erro">Com erro</option>
            <option value="atencao">Com atenção</option>
            <option value="ok">Sem problema</option>
            <option value="vendidos">Vendidos em 120 dias</option>
          </select>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
            <option value="">Todos os grupos</option>
            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className="pd-check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Inativos</label>
          <label className="pd-check"><input type="checkbox" checked={insumos} onChange={(e) => setInsumos(e.target.checked)} /> Insumos (estoque)</label>
          <span className="pd-acoes">
            <button className="ghost small" onClick={abrirTudo}>Abrir tudo</button>
            <button className="ghost small" onClick={recolherTudo}>Recolher tudo</button>
            <button className="ghost small" onClick={planilha}>Planilha</button>
          </span>
        </div>
      </div>

      {!arvore.length && <p className="muted">Nenhum produto com esses filtros.</p>}

      {arvore.map(({ c, ps, blocos }) => {
        const kc = String(c.loja_codigo);
        const casaAberta = !fechadas[kc];
        const erros = ps.filter((p) => sit(p) === "erro").length;
        const atencoes = ps.filter((p) => sit(p) === "atencao").length;
        return (
          <section key={kc} className={`pd-casa${casaAberta ? " aberta" : ""}`}>
            <button className="pd-casa-cabeca" onClick={() => setFechadas((x) => ({ ...x, [kc]: casaAberta }))} aria-expanded={casaAberta}>
              <span className="pd-casa-nome"><strong>{c.casa}</strong><small>loja {c.loja_codigo} no Chef Web · {num(ps.length)} produtos</small></span>
              <span className="pd-contas">{erros > 0 && <i className="erro">{num(erros)} com erro</i>}{atencoes > 0 && <i className="atencao">{num(atencoes)} com atenção</i>}</span>
              <span className="ip-seta" aria-hidden="true" />
            </button>
            {casaAberta && (
              <div className="pd-casa-corpo">
                {blocos.map(([nomeBloco, itens]) => {
                  const kb = `${kc}|${nomeBloco}`;
                  const aberto = abertos[kb] ?? filtrando;
                  const e = itens.filter((p) => sit(p) === "erro").length;
                  const a = itens.filter((p) => sit(p) === "atencao").length;
                  const vendido = itens.reduce((s, p) => s + Number(p.v_val ?? 0), 0);
                  return (
                    <div key={kb} className={`pd-bloco${aberto ? " aberto" : ""}`}>
                      <button className="pd-bloco-cabeca" onClick={() => setAbertos((x) => ({ ...x, [kb]: !aberto }))} aria-expanded={aberto}>
                        <span className="pd-bloco-nome">{nomeBloco}</span>
                        <span className="pd-bloco-info">{num(itens.length)} produto{itens.length === 1 ? "" : "s"}{vendido ? ` · ${brl0(vendido)} em 120 dias` : ""}</span>
                        <span className="pd-contas">{e > 0 && <i className="erro">{num(e)}</i>}{a > 0 && <i className="atencao">{num(a)}</i>}</span>
                        <span className="ip-seta" aria-hidden="true" />
                      </button>
                      {aberto && (
                        <div className="nf-tabela-wrap">
                          <table className="nf-tabela pd-tabela">
                            <thead><tr><th>Produto</th><th>NCM</th><th className="n">ICMS</th><th className="n">PIS · Cofins</th><th>IBS/CBS</th><th className="n">Vendido</th><th>O que corrigir</th></tr></thead>
                            <tbody>
                              {itens.map((p) => (
                                <tr key={p.c} className={`pd-item ${sit(p)}${p.a ? "" : " inativo"}`} onClick={() => setFicha(p)} tabIndex={0}
                                  onKeyDown={(ev) => { if (ev.key === "Enter") setFicha(p); }}>
                                  <td><strong>{p.n}</strong><small>cód. {p.c}{p.pr ? ` · ${brl(p.pr)}` : ""}{p.a ? "" : " · inativo"}</small></td>
                                  <td>{p.ncm || "—"}{p.cest ? <small>CEST {p.cest}</small> : null}</td>
                                  <td className="n">{pct(p.icms)}{p.r_icms != null && p.icms != null && p.r_icms !== p.icms ? <small>regra {pct(p.r_icms)}</small> : null}</td>
                                  <td className="n">{p.pis == null ? "—" : num(p.pis)} · {p.cof == null ? "—" : num(p.cof)}</td>
                                  <td>{p.r_ibs ?? "—"}{p.r_cc ? <small>{p.r_cc}</small> : null}</td>
                                  <td className="n">{p.v_val ? brl0(p.v_val) : "—"}{p.v_ult ? <small>{dataBr(p.v_ult)}</small> : null}</td>
                                  <td>{p.pb.length ? p.pb.map((x) => <span key={x.regra} className={`pd-chip ${x.sev}`}>{PROBLEMAS[x.regra]?.curto ?? x.regra}</span>) : <span className="pd-chip ok">ok</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <section className={`pd-casa${regrasAbertas ? " aberta" : ""}`}>
        <button className="pd-casa-cabeca" onClick={() => setRegrasAbertas((x) => !x)} aria-expanded={regrasAbertas}>
          <span className="pd-casa-nome"><strong>Regras fiscais por NCM</strong><small>a tributação que cada produto herda do NCM, em cada casa (Chef Web › Cadastro › NCM)</small></span>
          <span className="pd-contas" />
          <span className="ip-seta" aria-hidden="true" />
        </button>
        {regrasAbertas && <div className="pd-casa-corpo"><RegrasTotvs /></div>}
      </section>

      {ficha && <Ficha p={ficha} casa={nomeCasa(ficha.l)} fechar={() => setFicha(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ficha do produto (painel lateral)
type Detalhe = {
  produto: Record<string, unknown> & { campos?: Record<string, string> };
  regra: Record<string, unknown> | null;
  regras_ncm: { loja: string; uf: string; regime: string; cest: string; icms: number | null; cst: string | null; cfop: string | null; pis: string; cofins: string; ibscbs: string }[] | null;
  outras_casas: { casa: string; codigo: string; nome: string; situacao: string; ncm: string | null; cfop: string | null; icms: number | null; pis: number | null; cofins: number | null; preco: number | null }[] | null;
  nota: { cst: string | null; aliquota: number | null; cfop: string | null; ncm: string | null; pis_cst: string | null; pis: number | null; cofins_cst: string | null; cofins: number | null; ibscbs_cst: string | null; cclasstrib: string | null; itens: number; ultima: string; primeira: string }[] | null;
  vendas_mes: { mes: string; itens: number; qtd: number; valor: number; icms: number }[] | null;
};

function Ficha({ p, casa, fechar }: { p: Prod; casa: string; fechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setD(null); setErro("");
    supabase.rpc("totvs_produto_detalhe", { p_loja: p.l, p_codigo: p.c }).then(({ data, error }) => { if (error) setErro(error.message); else setD(data as Detalhe); });
  }, [supabase, p.l, p.c]);

  const campos = (d?.produto?.campos ?? {}) as Record<string, string>;
  const r = d?.regra as Record<string, string | number | null> | null;
  const total = (d?.vendas_mes ?? []).reduce((s, v) => s + Number(v.valor), 0);

  return (
    <Gaveta titulo={p.n} sub={`${casa} · código ${p.c} · ${p.g ?? "sem grupo"} › ${p.sg ?? "sem subgrupo"}`} fechar={fechar}>
      <div className="pd-ficha">
        <dl className="pd-resumo">
          <div><dt>Situação</dt><dd>{p.a ? "Ativo" : "Inativo"}</dd></div>
          <div><dt>Preço</dt><dd>{brl(p.pr)}</dd></div>
          <div><dt>Vendido em 120 dias</dt><dd>{p.v_val ? brl(p.v_val) : "—"}</dd></div>
          <div><dt>Última venda</dt><dd>{dataBr(p.v_ult)}</dd></div>
        </dl>

        <section className="pd-sec">
          <h3>O que precisa corrigir</h3>
          {p.pb.length ? (
            <ul className="pd-problemas">
              {p.pb.map((x) => (
                <li key={x.regra} className={x.sev}>
                  <b>{PROBLEMAS[x.regra]?.titulo ?? x.regra}</b>
                  <span>{PROBLEMAS[x.regra]?.resolver}</span>
                </li>
              ))}
            </ul>
          ) : <p className="pd-ok">Nenhum problema encontrado neste produto.</p>}
        </section>

        {erro && <p className="es-aviso">Não deu para carregar a ficha: {erro}</p>}
        {!d && !erro && <p className="muted">Carregando a ficha…</p>}

        {d && (
          <>
            <section className="pd-sec">
              <h3>Cadastro no Chef Web</h3>
              <dl className="pd-campos">
                {Object.keys(ROTULO).filter((k) => k in campos).concat(Object.keys(campos).filter((k) => !(k in ROTULO))).map((k) => (
                  <div key={k}><dt>{ROTULO[k] ?? k}</dt><dd>{campos[k] === "" || campos[k] == null ? "—" : campos[k]}</dd></div>
                ))}
              </dl>
              <p className="pd-nota">Campos em branco no produto (como CST e IBS/CBS) vêm da regra fiscal do NCM, abaixo.</p>
            </section>

            <section className="pd-sec">
              <h3>Regra fiscal do NCM {p.ncm ?? ""} nesta casa</h3>
              {r ? (
                <dl className="pd-campos">
                  <div><dt>Tributo</dt><dd>{r.tributo ?? "—"}</dd></div>
                  <div><dt>ICMS</dt><dd>{pct(r.imposto as number)}</dd></div>
                  <div><dt>CST</dt><dd>{r.cst ?? "—"}</dd></div>
                  <div><dt>CFOP</dt><dd>{r.cfop ?? "—"}</dd></div>
                  <div><dt>Tipo do item</dt><dd>{r.tipo_item ?? "—"}</dd></div>
                  <div><dt>CEST</dt><dd>{r.cest || "—"}</dd></div>
                  <div><dt>Redução da base</dt><dd>{pct(r.red_bc as number)}</dd></div>
                  <div><dt>FCP</dt><dd>{pct(r.fcp as number)}</dd></div>
                  <div><dt>PIS</dt><dd>{r.pis_cst ?? "—"} · {pct(r.pis_valor as number)}</dd></div>
                  <div><dt>Cofins</dt><dd>{r.cofins_cst ?? "—"} · {pct(r.cofins_valor as number)}</dd></div>
                  <div><dt>CST IBS/CBS</dt><dd>{r.ibscbs_cst ?? "—"}</dd></div>
                  <div><dt>cClassTrib</dt><dd>{r.cclasstrib ?? "—"}</dd></div>
                  <div><dt>CBS · IBS UF · IBS mun.</dt><dd>{pct(r.cbs as number)} · {pct(r.ibs_uf as number)} · {pct(r.ibs_mun as number)}</dd></div>
                  <div><dt>Redução CBS · IBS</dt><dd>{pct(r.red_cbs as number)} · {pct(r.red_ibs as number)}</dd></div>
                  <div><dt>Benefício fiscal</dt><dd>{r.cod_beneficio ?? "—"}</dd></div>
                  <div><dt>Incentivo fiscal</dt><dd>{r.incentivo ?? "—"}</dd></div>
                </dl>
              ) : <p className="pd-nota">Este NCM não tem regra fiscal nesta casa.</p>}
              {(d.regras_ncm?.length ?? 0) > 1 && (
                <>
                  <h4>O mesmo NCM em todas as casas</h4>
                  <div className="nf-tabela-wrap">
                    <table className="nf-tabela pd-tabela">
                      <thead><tr><th>Casa</th><th>UF · regime</th><th className="n">ICMS</th><th>CST</th><th>CFOP</th><th>PIS</th><th>Cofins</th><th>IBS/CBS</th></tr></thead>
                      <tbody>{d.regras_ncm!.map((x, k) => (
                        <tr key={k}><td>{x.loja}</td><td>{x.uf} · {x.regime}</td><td className="n">{pct(x.icms)}</td><td>{x.cst ?? "—"}</td><td>{x.cfop ?? "—"}</td><td>{x.pis}</td><td>{x.cofins}</td><td>{x.ibscbs}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {(d.outras_casas?.length ?? 0) > 0 && (
              <section className="pd-sec">
                <h3>O mesmo produto nas outras casas</h3>
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela pd-tabela">
                    <thead><tr><th>Casa</th><th>Código</th><th>NCM</th><th>CFOP</th><th className="n">ICMS</th><th className="n">PIS · Cofins</th><th className="n">Preço</th></tr></thead>
                    <tbody>{d.outras_casas!.map((x, k) => (
                      <tr key={k} className={x.ncm !== p.ncm ? "pd-dif" : ""}><td>{x.casa}<small>{x.situacao}</small></td><td>{x.codigo}</td><td>{x.ncm ?? "—"}</td><td>{x.cfop ?? "—"}</td>
                        <td className="n">{pct(x.icms)}</td><td className="n">{num(x.pis)} · {num(x.cofins)}</td><td className="n">{brl(x.preco)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="pd-sec">
              <h3>Como sai na NFC-e</h3>
              {d.nota?.length ? (
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela pd-tabela">
                    <thead><tr><th>Período</th><th className="n">Itens</th><th>NCM</th><th>CST</th><th className="n">ICMS</th><th>CFOP</th><th>PIS</th><th>Cofins</th><th>IBS/CBS</th></tr></thead>
                    <tbody>{d.nota.map((x, k) => (
                      <tr key={k}><td>{dataBr(x.primeira)} a {dataBr(x.ultima)}</td><td className="n">{num(x.itens)}</td><td>{x.ncm ?? "—"}</td><td>{x.cst ?? "—"}</td><td className="n">{pct(x.aliquota)}</td>
                        <td>{x.cfop ?? "—"}</td><td>{x.pis_cst ?? "—"} · {pct(x.pis)}</td><td>{x.cofins_cst ?? "—"} · {pct(x.cofins)}</td><td>{x.ibscbs_cst ?? "—"} · {x.cclasstrib ?? "—"}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="pd-nota">Nenhuma NFC-e deste produto nesta casa.</p>}
            </section>

            <section className="pd-sec">
              <h3>Vendas por mês</h3>
              {d.vendas_mes?.length ? (
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela pd-tabela">
                    <thead><tr><th>Mês</th><th className="n">Quantidade</th><th className="n">Vendido</th><th className="n">ICMS na nota</th></tr></thead>
                    <tbody>
                      {d.vendas_mes.map((v) => <tr key={v.mes}><td>{mesCurto(v.mes)}</td><td className="n">{num(v.qtd)}</td><td className="n">{brl(v.valor)}</td><td className="n">{brl(v.icms)}</td></tr>)}
                      <tr className="pd-total"><td>Total</td><td className="n">{num(d.vendas_mes.reduce((s, v) => s + Number(v.qtd), 0))}</td><td className="n">{brl(total)}</td><td className="n">{brl(d.vendas_mes.reduce((s, v) => s + Number(v.icms), 0))}</td></tr>
                    </tbody>
                  </table>
                </div>
              ) : <p className="pd-nota">Sem vendas com NFC-e.</p>}
            </section>
          </>
        )}
      </div>
    </Gaveta>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Regras fiscais do Chef Web por NCM (supabase/totvs_regras_fiscais.sql)
type RegraAchado = { regra: string; sev: "erro" | "atencao"; loja_codigo: number; casa: string; ncm: string; cest: string; campo: string; atual: string; esperado: string };
type Regras = { lido_em: string | null; regras: number; achados: RegraAchado[]; lista: Record<string, string | number | null>[] };
const REGRA_TITULO: Record<string, string> = {
  uf: "Regra fiscal com UF errada", pis: "PIS com alíquota errada", cofins: "Cofins com alíquota errada",
  monofasico: "Bebida monofásica pagando PIS/Cofins", sem_regra: "Produto vendido sem regra fiscal do NCM",
  casas: "Mesmo NCM com regra diferente entre as casas", regime: "Regra do Simples Nacional (a empresa é do regime normal)",
  monofasico_cst: "CST de PIS/Cofins diferente entre as casas", ibscbs: "Regra sem IBS/CBS", tipo_item: "Regra sem tipo do item",
  st_sem_cest: "Substituição tributária sem CEST",
};
const REGRA_RESOLVER: Record<string, string> = {
  uf: "Apagar (ou corrigir para RN) a regra da UF errada no cadastro do NCM, na loja.",
  pis: "Corrigir o PIS da regra do NCM para 0,65% (CST 01), como no restante.",
  cofins: "Corrigir a Cofins da regra do NCM para 3,00% (CST 01, por percentual), como no restante.",
  monofasico: "Na regra do NCM, PIS e Cofins com CST 04 (monofásico), sem alíquota.",
  sem_regra: "Cadastrar a regra fiscal desse NCM na loja (ou trocar o NCM do produto para um que já tem regra).",
  casas: "Igualar a regra do NCM nas casas, na versão que a contabilidade confirmar (alíquota, CST, PIS/Cofins, cClassTrib).",
  regime: "A Brasico77 é do regime normal: a regra do Simples não é usada e pode ser removida (confirmar com a contabilidade).",
  monofasico_cst: "Usar o mesmo CST de PIS/Cofins nas duas casas (04 para bebida monofásica).",
  ibscbs: "Preencher o CST e o cClassTrib do IBS/CBS na regra do NCM (vale a partir de 2027).",
  tipo_item: "Preencher o tipo do item (00 = mercadoria para revenda).",
  st_sem_cest: "Informar o CEST do produto com substituição tributária.",
};

function RegrasTotvs() {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<Regras | null>(null);
  const [aberta, setAberta] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  useEffect(() => { supabase.rpc("totvs_regras_conferencia").then(({ data }) => setR((data ?? null) as Regras | null)); }, [supabase]);
  if (!r) return <p className="muted">Lendo as regras fiscais…</p>;
  if (!r.regras) return <p className="muted">As regras fiscais ainda não foram lidas.</p>;
  const grupos = Object.keys(REGRA_TITULO).map((id) => ({ id, itens: r.achados.filter((a) => a.regra === id) })).filter((g) => g.itens.length);
  return (
    <div className="pd-regras">
      <p className="pd-nota">{num(r.regras)} regras lidas em {r.lido_em ? new Date(r.lido_em).toLocaleDateString("pt-BR") : "—"}. Cada produto pega a tributação da regra do NCM dele na casa.</p>
      {grupos.map((g) => {
        const sev = g.itens.some((a) => a.sev === "erro") ? "erro" : "atencao";
        const esta = aberta === g.id;
        return (
          <div key={g.id} className={`pd-bloco${esta ? " aberto" : ""}`}>
            <button className="pd-bloco-cabeca" onClick={() => setAberta(esta ? "" : g.id)} aria-expanded={esta}>
              <span className="pd-bloco-nome">{REGRA_TITULO[g.id]}</span>
              <span className="pd-bloco-info">{num(g.itens.length)} regra{g.itens.length === 1 ? "" : "s"}</span>
              <span className="pd-contas"><i className={sev}>{sev === "erro" ? "erro" : "atenção"}</i></span>
              <span className="ip-seta" aria-hidden="true" />
            </button>
            {esta && (
              <div className="pd-bloco-corpo">
                <p className="cf-resolver"><b>Como resolver:</b> {REGRA_RESOLVER[g.id]}</p>
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela pd-tabela">
                    <thead><tr><th>Casa</th><th>NCM</th><th>Como está</th><th>Esperado</th></tr></thead>
                    <tbody>{g.itens.map((a, k) => (
                      <tr key={k}><td>{a.casa}</td><td>{a.ncm}{a.cest ? <small>CEST {a.cest}</small> : null}</td><td><small>{a.campo}</small>{a.atual}</td><td>{a.esperado}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className={`pd-bloco${verTodas ? " aberto" : ""}`}>
        <button className="pd-bloco-cabeca" onClick={() => setVerTodas((x) => !x)} aria-expanded={verTodas}>
          <span className="pd-bloco-nome">Todas as regras</span>
          <span className="pd-bloco-info">{num(r.regras)} regras</span>
          <span className="pd-contas" />
          <span className="ip-seta" aria-hidden="true" />
        </button>
        {verTodas && (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela pd-tabela">
              <thead><tr><th>Loja</th><th>UF · regime</th><th>NCM</th><th>CEST</th><th className="n">ICMS</th><th>CFOP</th><th>CST</th><th>PIS</th><th>Cofins</th><th>IBS/CBS</th></tr></thead>
              <tbody>{r.lista.map((x, k) => (
                <Fragment key={k}>
                  <tr><td>{String(x.loja_nome ?? x.loja_codigo)}</td><td>{String(x.uf)} · {String(x.regime)}</td><td>{String(x.ncm)}</td><td>{String(x.cest ?? "") || "—"}</td>
                    <td className="n">{x.imposto == null ? "—" : `${x.imposto}%`}</td><td>{String(x.cfop ?? "—")}</td><td>{String(x.cst ?? "—")}</td>
                    <td>{String(x.pis_cst ?? "—")} · {x.pis_valor ?? "—"}</td><td>{String(x.cofins_cst ?? "—")} · {x.cofins_valor ?? "—"}</td><td>{String(x.ibscbs_cst ?? "—")} · {String(x.cclasstrib ?? "—")}</td></tr>
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
