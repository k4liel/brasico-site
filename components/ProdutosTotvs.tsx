"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMO_RESOLVER } from "./ConferenciaFiscal";

// Cadastro fiscal dos produtos da TOTVS (aba NFC-e → "Produtos"; supabase/nfce_produtos.sql, 22/11/2026).
// A lista de produtos da API da TOTVS não está liberada para o Brasico (código 20); o cadastro vem de cada item vendido,
// que traz o produto e a tributação aplicada na nota. Cada produto mostra a classificação atual, as variações e o que a
// conferência fiscal (nfce_conferencia) achou, com como resolver no cadastro do Chef Web.
type Classe = {
  ncm: string | null; cfop: string | null; cst: string | null; aliquota: number | null; pis: string | null; cofins: string | null;
  ibscbs: string | null; cclasstrib: string | null; unidade: string | null; cest: string | null; itens?: number; ultima?: string;
};
type Produto = {
  unidade_id: string; cod: string; nome: string; grupo: string | null; ultima: string; itens: number; valor: number; icms: number;
  atual: Classe; variacoes: Classe[];
};
type Achado = { regra: string; sev: "erro" | "atencao"; unidade_id: string; cod: string | null; nome: string; campo: string; atual: string | null; esperado: string | null };

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (v: number) => Number(v).toLocaleString("pt-BR");
const dataBr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const TITULO: Record<string, string> = {
  taxa_tributada: "Taxa de serviço tributada", taxa_ncm: "Taxa com NCM de mercadoria", aliq_casas: "Alíquota diferente entre as casas",
  aliq_cafe: "Café/chá com alíquota diferente da comida", ncm_casas: "NCM diferente entre as casas", ncm_prato: "Prato com NCM de ingrediente",
  unidade: "Unidade CX", cst_cfop: "CST não combina com o CFOP", icms_conta: "Conta do ICMS errada", pis_monofasico: "PIS/Cofins em bebida monofásica",
  variacao: "Classificação variando", cclass_vazio: "Sem cClassTrib", cclass_restaurante: "Comida fora do 200047", cclass_casas: "cClassTrib diferente entre as casas",
  cclass_gorjeta: "Taxa fora do 410019",
};

export default function ProdutosTotvs({ mes, fimMes, unidade, nomeUnidade }: {
  mes: string; fimMes: string; unidade: string; nomeUnidade: Record<string, string>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [achados, setAchados] = useState<Achado[]>([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"" | "erro" | "atencao" | "ok" | "mudou">("");
  const [grupo, setGrupo] = useState("");
  const [aberto, setAberto] = useState("");

  useEffect(() => {
    setProdutos(null); setErro("");
    const ultimo = new Date(new Date(`${fimMes}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10);
    Promise.all([
      supabase.rpc("nfce_produtos", { p_unidade: unidade || null, p_dias: 120 }),
      supabase.rpc("nfce_conferencia", { p_de: `${mes}-01`, p_ate: ultimo, p_unidade: unidade || null }),
    ]).then(([p, c]) => {
      if (p.error) { setErro(p.error.message); return; }
      setProdutos((p.data ?? []) as Produto[]);
      setAchados(((c.data as { achados?: Achado[] } | null)?.achados ?? []) as Achado[]);
    });
  }, [supabase, mes, fimMes, unidade]);

  const porProduto = useMemo(() => {
    const m = new Map<string, Achado[]>();
    for (const a of achados) {
      const k = `${a.unidade_id}|${a.cod ?? a.nome}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [achados]);

  if (erro) return <p className="es-aviso">Não deu para montar o cadastro: {erro}</p>;
  if (!produtos) return <p className="muted">Montando o cadastro dos produtos a partir das vendas…</p>;

  const situacao = (p: Produto) => {
    const a = porProduto.get(`${p.unidade_id}|${p.cod}`) ?? [];
    return a.some((x) => x.sev === "erro") ? "erro" : a.length ? "atencao" : "ok";
  };
  const grupos = [...new Set(produtos.map((p) => p.grupo ?? "Sem grupo"))].sort();
  const t = busca.trim().toLowerCase();
  const lista = produtos.filter((p) => {
    if (grupo && (p.grupo ?? "Sem grupo") !== grupo) return false;
    if (t && !p.nome.toLowerCase().includes(t) && !p.cod.includes(t) && !(p.atual?.ncm ?? "").includes(t)) return false;
    if (filtro === "mudou") return p.variacoes.length > 1;
    if (filtro) return situacao(p) === filtro;
    return true;
  });
  const conta = { erro: 0, atencao: 0, mudou: 0 };
  for (const p of produtos) {
    const s = situacao(p);
    if (s === "erro") conta.erro++; else if (s === "atencao") conta.atencao++;
    if (p.variacoes.length > 1) conta.mudou++;
  }
  const casas = [...new Set(lista.map((p) => p.unidade_id))];

  function planilha() {
    const linhas = [["Casa", "Código", "Produto", "Grupo", "NCM", "CFOP", "CST", "ICMS %", "PIS", "Cofins", "CST IBS/CBS", "cClassTrib", "Unidade", "Última venda", "Itens", "Vendido", "Situação", "Problemas", "Como resolver"]];
    for (const p of lista) {
      const a = porProduto.get(`${p.unidade_id}|${p.cod}`) ?? [];
      const c = p.atual ?? ({} as Classe);
      linhas.push([nomeUnidade[p.unidade_id] ?? p.unidade_id, p.cod, p.nome, p.grupo ?? "", c.ncm ?? "", c.cfop ?? "", c.cst ?? "", c.aliquota == null ? "" : String(c.aliquota),
        c.pis ?? "", c.cofins ?? "", c.ibscbs ?? "", c.cclasstrib ?? "", c.unidade ?? "", p.ultima, String(p.itens), String(p.valor).replace(".", ","),
        situacao(p), a.map((x) => `${TITULO[x.regra] ?? x.regra}: ${x.atual ?? ""} → ${x.esperado ?? ""}`).join(" | "),
        [...new Set(a.map((x) => COMO_RESOLVER[x.regra]).filter(Boolean))].join(" | ")]);
    }
    const csv = "﻿" + linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `produtos-totvs${unidade ? `-${unidade}` : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cf pt">
      <dl className="nc-numeros">
        <div><dt>Produtos vendidos</dt><dd>{num(produtos.length)}</dd><small>nos últimos 120 dias</small></div>
        <div><dt>Com erro</dt><dd className={conta.erro ? "cf-ruim" : ""}>{num(conta.erro)}</dd><small>a corrigir no cadastro</small></div>
        <div><dt>Com atenção</dt><dd>{num(conta.atencao)}</dd><small>a conferir com a contabilidade</small></div>
        <div><dt>Mudaram de classificação</dt><dd>{num(conta.mudou)}</dd><small>saíram de jeitos diferentes</small></div>
      </dl>
      <p className="nc-explica cf-escopo">
        A classificação de cada produto como ele sai na NFC-e (o que a TOTVS aplica na venda), atualizada a cada venda. A lista de produtos da API da
        TOTVS ainda não está liberada para o Brasico; quando for, o cadastro completo (inclusive o que não vendeu) entra aqui. Os problemas vêm da
        conferência fiscal do mês. O Brasico só lê: a correção é feita no cadastro do produto no Chef Web.
      </p>

      <div className="nc-barra">
        <h2>Cadastro dos produtos</h2>
        <div className="cf-acoes">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Situação">
            <option value="">Todos</option>
            <option value="erro">Com erro</option>
            <option value="atencao">Com atenção</option>
            <option value="ok">Sem problema</option>
            <option value="mudou">Mudaram de classificação</option>
          </select>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
            <option value="">Todos os grupos</option>
            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, código ou NCM" aria-label="Buscar" />
          <button className="ghost small" onClick={planilha}>Baixar planilha</button>
        </div>
      </div>

      {!lista.length && <p className="muted">Nenhum produto com esses filtros.</p>}

      {casas.map((casa) => {
        const daCasa = lista.filter((p) => p.unidade_id === casa);
        return (
          <section key={casa} className="cf-regra cf-info aberta">
            <div className="pt-casa"><strong>{nomeUnidade[casa] ?? casa}</strong><small>{num(daCasa.length)} produtos</small></div>
            <div className="nf-tabela-wrap">
              <table className="nf-tabela cf-tabela pt-tabela">
                <thead><tr><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST</th><th className="n">ICMS</th><th>PIS/Cofins</th><th>IBS/CBS</th><th className="n">Vendido</th><th>Situação</th></tr></thead>
                <tbody>
                  {daCasa.map((p) => {
                    const k = `${p.unidade_id}|${p.cod}`;
                    const a = porProduto.get(k) ?? [];
                    const s = situacao(p);
                    const c = p.atual ?? ({} as Classe);
                    const esta = aberto === k;
                    return (
                      <Fragment key={k}>
                        <tr className={`pt-linha${esta ? " aberta" : ""}`} onClick={() => setAberto(esta ? "" : k)}>
                          <td><strong>{p.nome}</strong><small>cód. {p.cod}{p.grupo ? ` · ${p.grupo}` : ""} · última venda {dataBr(p.ultima)}</small></td>
                          <td>{c.ncm ?? "—"}</td>
                          <td>{c.cfop ?? "—"}</td>
                          <td>{c.cst ?? "—"}</td>
                          <td className="n">{c.aliquota == null ? "—" : `${num(c.aliquota)}%`}</td>
                          <td>{c.pis ?? "—"} / {c.cofins ?? "—"}</td>
                          <td>{c.ibscbs ?? "—"}{c.cclasstrib ? ` · ${c.cclasstrib}` : ""}</td>
                          <td className="n">{brl(p.valor)}</td>
                          <td>
                            <span className={`pt-sit ${s}`}>{s === "erro" ? `${a.filter((x) => x.sev === "erro").length} erro${a.filter((x) => x.sev === "erro").length === 1 ? "" : "s"}` : s === "atencao" ? "atenção" : "ok"}</span>
                            {p.variacoes.length > 1 && <span className="pt-sit mudou">mudou</span>}
                          </td>
                        </tr>
                        {esta && (
                          <tr className="pt-detalhe"><td colSpan={9}>
                            {a.length ? (
                              <ul className="pt-problemas">
                                {a.map((x, i) => (
                                  <li key={i} className={x.sev}>
                                    <b>{TITULO[x.regra] ?? x.regra}</b>
                                    <span>{x.campo}: {x.atual ?? "—"} → {x.esperado ?? "—"}</span>
                                    {COMO_RESOLVER[x.regra] && <small>Como resolver: {COMO_RESOLVER[x.regra]}</small>}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="muted">Nenhum problema na conferência deste mês.</p>}
                            {p.variacoes.length > 1 && (
                              <>
                                <p className="pt-sub">Classificações com que o produto saiu (mais recente primeiro)</p>
                                <table className="nf-tabela cf-tabela">
                                  <thead><tr><th>Última venda</th><th className="n">Itens</th><th>NCM</th><th>CFOP</th><th>CST</th><th className="n">ICMS</th><th>PIS/Cofins</th><th>IBS/CBS</th><th>Unid.</th></tr></thead>
                                  <tbody>
                                    {p.variacoes.map((v, i) => (
                                      <tr key={i}>
                                        <td>{v.ultima ? dataBr(v.ultima) : "—"}</td><td className="n">{num(v.itens ?? 0)}</td><td>{v.ncm ?? "—"}</td><td>{v.cfop ?? "—"}</td>
                                        <td>{v.cst ?? "—"}</td><td className="n">{v.aliquota == null ? "—" : `${num(v.aliquota)}%`}</td>
                                        <td>{v.pis ?? "—"} / {v.cofins ?? "—"}</td><td>{v.ibscbs ?? "—"}{v.cclasstrib ? ` · ${v.cclasstrib}` : ""}</td><td>{v.unidade ?? "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
