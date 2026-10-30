"use client";

import { useMemo, useState } from "react";
import Gaveta from "./Gaveta";

// Painel central de dívidas e impostos do grupo: o total, a divisão por situação, órgão, empresa, tributo e ano,
// e o detalhe de cada débito ao clicar. Junta o levantamento guardado em fiscal_dividas (prefeitura, FGTS e o que a
// Receita ainda não releu) com o que o relatório de situação fiscal de hoje mostra (montado em components/Receita.tsx).
// Cores dos órgãos: paleta categórica validada (slots 1–4); situação usa as cores de status, sempre com o nome escrito.

export type Divida = {
  id: string; cnpj: string; orgao: string; categoria: string; detalhe: string; competencia: string | null; vencimento: string | null;
  principal: number | null; multa: number | null; juros: number | null; total: number | null;
  situacao: "vencido" | "a_vencer" | "parcela_atraso" | "parcelado"; sensivel: boolean; fonte: string; dataBase: string; aoVivo: boolean;
};
type Empresa = { cnpj: string; apelido: string };
type Filtro = { orgao?: string; cnpj?: string; categoria?: string; situacao?: string; ano?: string; sensivel?: boolean };

export const ORGAOS = ["Receita Federal", "Prefeitura", "FGTS", "PGFN"] as const;
const COR_ORGAO: Record<string, string> = { "Receita Federal": "var(--dv-1)", Prefeitura: "var(--dv-2)", FGTS: "var(--dv-3)", PGFN: "var(--dv-4)" };
export const SITUACOES: { id: Divida["situacao"]; nome: string; explica: string }[] = [
  { id: "vencido", nome: "Vencido", explica: "Débito em aberto, já vencido" },
  { id: "parcela_atraso", nome: "Parcelas em atraso", explica: "Parcelamento com parcelas vencidas: risco de rescisão" },
  { id: "a_vencer", nome: "A vencer", explica: "Guia do mês ainda dentro do prazo" },
  { id: "parcelado", nome: "Parcelado em dia", explica: "Saldo de parcelamentos sem atraso" },
];

const reais = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const mil = (v: number) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi` : `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`);
const pct = (v: number, t: number) => (t ? `${((v / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%");
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const comp = (c: string | null) => {
  if (!c) return "—";
  const m = c.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MESES[Number(m[2]) - 1]}/${m[1]}`;
  const t = c.match(/^(\d{4})-T(\d)$/);
  if (t) return `${t[2]}º tri/${t[1]}`;
  return c;
};
const anoDe = (d: Divida) => (d.competencia?.match(/^\d{4}/)?.[0] ?? d.vencimento?.slice(0, 4) ?? "sem data");
const soma = (l: Divida[]) => l.reduce((s, d) => s + (d.total ?? 0), 0);
const casa = (d: Divida, f: Filtro) =>
  (!f.orgao || d.orgao === f.orgao) && (!f.cnpj || d.cnpj === f.cnpj) && (!f.categoria || d.categoria === f.categoria) &&
  (!f.situacao || d.situacao === f.situacao) && (!f.ano || anoDe(d) === f.ano) && (!f.sensivel || d.sensivel);

export default function PainelDividas({ dividas, empresas }: { dividas: Divida[]; empresas: Empresa[] }) {
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const nome = (cnpj: string) => empresas.find((e) => e.cnpj === cnpj)?.apelido ?? cnpj;

  const total = soma(dividas);
  const porSituacao = SITUACOES.map((s) => ({ ...s, v: soma(dividas.filter((d) => d.situacao === s.id)) }));
  const emAtraso = porSituacao.filter((s) => s.id === "vencido" || s.id === "parcela_atraso").reduce((x, s) => x + s.v, 0);
  const porOrgao = ORGAOS.map((o) => ({ o, v: soma(dividas.filter((d) => d.orgao === o)), n: dividas.filter((d) => d.orgao === o).length }));
  const maxOrgao = Math.max(1, ...porOrgao.map((x) => x.v));
  const cnpjs = [...new Set(dividas.map((d) => d.cnpj))].sort((a, b) => soma(dividas.filter((d) => d.cnpj === b)) - soma(dividas.filter((d) => d.cnpj === a)));
  const porTributo = useMemo(() => {
    const m = new Map<string, { v: number; orgao: string }>();
    for (const d of dividas) {
      const x = m.get(d.categoria) ?? { v: 0, orgao: d.orgao };
      x.v += d.total ?? 0;
      m.set(d.categoria, x);
    }
    return [...m.entries()].map(([c, x]) => ({ c, ...x })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  }, [dividas]);
  const maxTributo = Math.max(1, ...porTributo.map((x) => x.v));
  const anos = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dividas) if (d.total) m.set(anoDe(d), (m.get(anoDe(d)) ?? 0) + d.total);
    return [...m.entries()].filter(([a]) => /^\d{4}$/.test(a)).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dividas]);
  const maxAno = Math.max(1, ...anos.map(([, v]) => v));
  const sensiveis = dividas.filter((d) => d.sensivel);
  const semValor = dividas.filter((d) => d.total == null);
  const fontes = [...new Set(dividas.map((d) => `${d.aoVivo ? "ao vivo" : "levantamento"}|${d.fonte}`))];

  const abrir = (f: Filtro) => setFiltro(f);
  const detalhe = filtro ? dividas.filter((d) => casa(d, filtro)) : [];

  return (
    <section className="dv" aria-label="Dívidas e impostos do grupo">
      <div className="dv-cabeca">
        <div>
          <h2>Dívidas e impostos em aberto</h2>
          <p className="muted">
            {fontes.map((f) => { const [tipo, fonte] = f.split("|"); return <span key={f} className={tipo === "ao vivo" ? "dv-fonte vivo" : "dv-fonte"}>{tipo === "ao vivo" ? "● " : ""}{fonte}</span>; })}
          </p>
        </div>
        <button className="ghost small" onClick={() => abrir({})}>Ver todos os {dividas.length} lançamentos</button>
      </div>

      <div className="dv-grade">
        {/* Total e situação */}
        <div className="dv-cartao dv-total">
          <span className="dv-rotulo">Total devido pelo grupo</span>
          <button className="dv-heroi" onClick={() => abrir({})}>{reais(total)}</button>
          <span className="dv-sub"><b>{reais(emAtraso)}</b> já em atraso ({pct(emAtraso, total)})</span>
          <div className="dv-pilha" role="img" aria-label="Divisão por situação">
            {porSituacao.filter((s) => s.v > 0).map((s) => (
              <button key={s.id} className={`dv-seg s-${s.id}`} style={{ flexGrow: s.v }} onClick={() => abrir({ situacao: s.id })} title={`${s.nome}: ${reais(s.v)} (${pct(s.v, total)})`} />
            ))}
          </div>
          <ul className="dv-legenda">
            {porSituacao.map((s) => (
              <li key={s.id}>
                <button onClick={() => abrir({ situacao: s.id })} disabled={!s.v}>
                  <i className={`s-${s.id}`} aria-hidden="true" />
                  <span>{s.nome}</span>
                  <b>{reais(s.v)}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Por órgão */}
        <div className="dv-cartao">
          <span className="dv-rotulo">Por órgão</span>
          <ul className="dv-barras">
            {porOrgao.map((x) => (
              <li key={x.o}>
                <button onClick={() => abrir({ orgao: x.o })} disabled={!x.n} title={`${x.o}: ${reais(x.v)}`}>
                  <span className="dv-barra-nome"><i style={{ background: COR_ORGAO[x.o] }} aria-hidden="true" />{x.o}</span>
                  <span className="dv-barra-valor">{x.v ? reais(x.v) : x.n ? "sem valor no relatório" : "—"}<small>{x.v ? pct(x.v, total) : ""}</small></span>
                  <span className="dv-trilho"><i style={{ width: `${(x.v / maxOrgao) * 100}%`, background: COR_ORGAO[x.o] }} /></span>
                </button>
              </li>
            ))}
          </ul>
          {sensiveis.length > 0 && (
            <button className="dv-sensivel" onClick={() => abrir({ sensivel: true })}>
              <b>{reais(soma(sensiveis))}</b>
              <span>são dinheiro dos funcionários ou retido de terceiros (INSS descontado, IRRF, CSRF e FGTS): pagar antes do resto.</span>
            </button>
          )}
        </div>
      </div>

      {/* Empresa × órgão */}
      <div className="dv-cartao">
        <span className="dv-rotulo">Por empresa e órgão</span>
        <div className="dv-matriz-caixa">
          <table className="dv-matriz">
            <thead><tr><th>Empresa</th>{ORGAOS.map((o) => <th key={o}><i style={{ background: COR_ORGAO[o] }} aria-hidden="true" />{o}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {cnpjs.map((c) => {
                const da = dividas.filter((d) => d.cnpj === c);
                return (
                  <tr key={c}>
                    <th scope="row"><button onClick={() => abrir({ cnpj: c })}>{nome(c)}</button></th>
                    {ORGAOS.map((o) => {
                      const l = da.filter((d) => d.orgao === o);
                      const v = soma(l);
                      return <td key={o}>{l.length ? <button onClick={() => abrir({ cnpj: c, orgao: o })}>{v ? reais(v) : "negociado"}</button> : <span className="muted">—</span>}</td>;
                    })}
                    <td className="dv-forte"><button onClick={() => abrir({ cnpj: c })}>{reais(soma(da))}</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><th>Total</th>{porOrgao.map((x) => <td key={x.o}>{x.v ? reais(x.v) : "—"}</td>)}<td className="dv-forte">{reais(total)}</td></tr></tfoot>
          </table>
        </div>
      </div>

      <div className="dv-grade">
        {/* Por tributo */}
        <div className="dv-cartao">
          <span className="dv-rotulo">Por tributo</span>
          <ul className="dv-barras compactas">
            {porTributo.map((x) => (
              <li key={x.c}>
                <button onClick={() => abrir({ categoria: x.c })} title={`${x.c}: ${reais(x.v)}`}>
                  <span className="dv-barra-nome">{x.c}</span>
                  <span className="dv-barra-valor">{mil(x.v)}<small>{pct(x.v, total)}</small></span>
                  <span className="dv-trilho"><i style={{ width: `${(x.v / maxTributo) * 100}%`, background: COR_ORGAO[x.orgao] }} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Por ano */}
        <div className="dv-cartao">
          <span className="dv-rotulo">Por ano da competência</span>
          <div className="dv-colunas" role="img" aria-label="Valor por ano">
            {anos.map(([a, v]) => (
              <button key={a} className="dv-coluna" onClick={() => abrir({ ano: a })} title={`${a}: ${reais(v)}`}>
                <span className="dv-coluna-valor">{mil(v)}</span>
                <span className="dv-coluna-barra"><i style={{ height: `${Math.max(2, (v / maxAno) * 100)}%` }} /></span>
                <span className="dv-coluna-ano">{a}</span>
              </button>
            ))}
          </div>
          <p className="muted small">Quanto mais antigo, mais multa e juros já correram. A Brasico77 ainda deve Simples de 2021.</p>
          {semValor.length > 0 && <p className="muted small">{semValor.length} item(ns) sem valor no relatório (dívida ativa negociada, parcelas sem valor informado): aparecem no detalhe.</p>}
        </div>
      </div>

      {filtro && (
        <Detalhe filtro={filtro} itens={detalhe} nome={nome} fechar={() => setFiltro(null)} limpar={(k) => setFiltro({ ...filtro, [k]: undefined })} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Detalhe: a lista de lançamentos de um recorte, agrupada por empresa e órgão
// ---------------------------------------------------------------------
function Detalhe({ filtro, itens, nome, fechar, limpar }: { filtro: Filtro; itens: Divida[]; nome: (c: string) => string; fechar: () => void; limpar: (k: keyof Filtro) => void }) {
  const [ordem, setOrdem] = useState<"valor" | "data">("valor");
  const chips: [keyof Filtro, string][] = [];
  if (filtro.cnpj) chips.push(["cnpj", nome(filtro.cnpj)]);
  if (filtro.orgao) chips.push(["orgao", filtro.orgao]);
  if (filtro.categoria) chips.push(["categoria", filtro.categoria]);
  if (filtro.situacao) chips.push(["situacao", SITUACOES.find((s) => s.id === filtro.situacao)?.nome ?? filtro.situacao]);
  if (filtro.ano) chips.push(["ano", `ano ${filtro.ano}`]);
  if (filtro.sensivel) chips.push(["sensivel", "dinheiro de terceiros"]);
  const grupos = new Map<string, Divida[]>();
  for (const d of itens) {
    const k = `${nome(d.cnpj)} · ${d.orgao}`;
    grupos.set(k, [...(grupos.get(k) ?? []), d]);
  }
  const ordenar = (l: Divida[]) => [...l].sort((a, b) => ordem === "valor" ? (b.total ?? 0) - (a.total ?? 0) : (b.competencia ?? b.vencimento ?? "").localeCompare(a.competencia ?? a.vencimento ?? ""));
  const totalGeral = soma(itens);

  function baixar() {
    const linhas = [["Empresa", "Órgão", "Tributo", "Detalhe", "Competência", "Vencimento", "Principal", "Multa", "Juros", "Total", "Situação", "Fonte"]];
    for (const d of itens) linhas.push([nome(d.cnpj), d.orgao, d.categoria, d.detalhe, comp(d.competencia), dia(d.vencimento),
      ...[d.principal, d.multa, d.juros, d.total].map((v) => (v == null ? "" : v.toFixed(2).replace(".", ","))),
      SITUACOES.find((s) => s.id === d.situacao)?.nome ?? d.situacao, d.fonte]);
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dividas-do-grupo.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Gaveta titulo={chips.length ? chips.map(([, t]) => t).join(" · ") : "Todas as dívidas do grupo"} sub={`${itens.length} lançamentos · ${reais(totalGeral)}`} fechar={fechar}>
      <div className="dv-detalhe-barra">
        <div className="dv-chips">
          {chips.map(([k, t]) => <button key={k} className="dv-chip" onClick={() => limpar(k)} title="Tirar este filtro">{t} ×</button>)}
        </div>
        <div className="dv-chips">
          <button className={ordem === "valor" ? "dv-chip on" : "dv-chip"} onClick={() => setOrdem("valor")}>maior valor</button>
          <button className={ordem === "data" ? "dv-chip on" : "dv-chip"} onClick={() => setOrdem("data")}>mais recente</button>
          <button className="dv-chip" onClick={baixar}>Baixar planilha</button>
        </div>
      </div>
      {[...grupos.entries()].sort((a, b) => soma(b[1]) - soma(a[1])).map(([g, l]) => (
        <section key={g} className="dv-grupo">
          <div className="dv-grupo-topo"><strong>{g}</strong><span>{reais(soma(l))}</span></div>
          <table className="dv-tabela">
            <thead><tr><th>Tributo</th><th>Competência</th><th>Situação</th><th>Valor</th></tr></thead>
            <tbody>
              {ordenar(l).map((d) => (
                <tr key={d.id}>
                  <td><b>{d.categoria}</b>{d.sensivel && <span className="dv-marca-sensivel" title="Dinheiro de terceiros">retido</span>}<div className="muted small">{d.detalhe}</div></td>
                  <td>{comp(d.competencia)}{d.vencimento && <div className="muted small">venc. {dia(d.vencimento)}</div>}</td>
                  <td><span className={`dv-status s-${d.situacao}`}>{SITUACOES.find((s) => s.id === d.situacao)?.nome}</span><div className="muted small">{d.aoVivo ? "Receita, ao vivo" : `levantamento ${dia(d.dataBase)}`}</div></td>
                  <td className="dv-valor">{reais(d.total)}{d.multa || d.juros ? <div className="muted small">{reais(d.principal)} + {reais((d.multa ?? 0) + (d.juros ?? 0))} de encargos</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {itens.length === 0 && <p className="muted">Nada neste recorte.</p>}
    </Gaveta>
  );
}
