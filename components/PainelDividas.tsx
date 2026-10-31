"use client";

import { useMemo, useState } from "react";
import Gaveta from "./Gaveta";

// Painel central de dívidas e impostos do grupo. Uma faixa só no topo (o total e o mapa proporcional por órgão e
// tributo); abaixo, a tabela de calor empresa × órgão, o que é dinheiro de terceiros e a idade da dívida.
// Tudo abre o detalhe de cada lançamento. Junta o levantamento guardado em fiscal_dividas com o relatório de situação
// fiscal de hoje (montado em components/Receita.tsx). Cores dos órgãos: paleta categórica validada (slots 1–4);
// situação usa cores de status, sempre com o nome escrito.

export type Divida = {
  id: string; cnpj: string; orgao: string; categoria: string; detalhe: string; competencia: string | null; vencimento: string | null;
  principal: number | null; multa: number | null; juros: number | null; total: number | null;
  situacao: "vencido" | "a_vencer" | "parcela_atraso" | "parcelado"; sensivel: boolean; fonte: string; dataBase: string; aoVivo: boolean;
};
type Empresa = { cnpj: string; apelido: string };
type Filtro = { orgao?: string; cnpj?: string; categoria?: string; situacao?: string; ano?: string; sensivel?: boolean };
type Dica = { x: number; y: number; titulo: string; linhas: string[] } | null;

export const ORGAOS = ["Receita Federal", "Prefeitura", "FGTS", "PGFN"] as const;
const COR_ORGAO: Record<string, string> = { "Receita Federal": "var(--dv-1)", Prefeitura: "var(--dv-2)", FGTS: "var(--dv-3)", PGFN: "var(--dv-4)" };
export const SITUACOES: { id: Divida["situacao"]; nome: string; explica: string }[] = [
  { id: "vencido", nome: "Vencido", explica: "Débito em aberto, já vencido" },
  { id: "parcela_atraso", nome: "Parcelas em atraso", explica: "Parcelamento com parcelas vencidas: risco de rescisão" },
  { id: "a_vencer", nome: "A vencer", explica: "Guia do mês ainda dentro do prazo" },
  { id: "parcelado", nome: "Parcelado em dia", explica: "Saldo de parcelamentos sem atraso" },
];

const reais = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const compacto = (v: number) =>
  v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`
    : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : reais(v);
const pct = (v: number, t: number) => (!t ? "0%" : v > 0 && v / t < 0.001 ? "< 0,1%" : `${((v / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
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
  const [dica, setDica] = useState<Dica>(null);
  const nome = (cnpj: string) => empresas.find((e) => e.cnpj === cnpj)?.apelido ?? cnpj;
  const abrir = (f: Filtro) => { setDica(null); setFiltro(f); };
  const mostrar = (ev: React.MouseEvent, titulo: string, linhas: string[]) => {
    const caixa = (ev.currentTarget as HTMLElement).closest(".dv")!.getBoundingClientRect();
    setDica({ x: ev.clientX - caixa.left, y: ev.clientY - caixa.top, titulo, linhas });
  };

  const total = soma(dividas);
  const porSituacao = SITUACOES.map((s) => ({ ...s, v: soma(dividas.filter((d) => d.situacao === s.id)) }));
  const emAtraso = porSituacao.filter((s) => s.id === "vencido" || s.id === "parcela_atraso").reduce((x, s) => x + s.v, 0);
  const sensiveis = dividas.filter((d) => d.sensivel);
  const semValor = dividas.filter((d) => d.total == null);
  const vivos = [...new Set(dividas.filter((d) => d.aoVivo).map((d) => nome(d.cnpj)))];
  const levantamento = [...new Set(dividas.filter((d) => !d.aoVivo).map((d) => d.dataBase))].sort();

  // Onde está a dívida: tributo por tributo (cor do órgão), do maior para o menor; os menores viram "outros"
  const ranking = useMemo(() => {
    const m = new Map<string, { orgao: string; categoria: string; v: number; n: number }>();
    for (const d of dividas) {
      if (!d.total) continue;
      const k = d.orgao + "|" + d.categoria;
      const x = m.get(k) ?? { orgao: d.orgao, categoria: d.categoria, v: 0, n: 0 };
      x.v += d.total; x.n++;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.v - a.v);
  }, [dividas]);
  const [verTodos, setVerTodos] = useState(false);
  const VISIVEIS = 8;
  const principais = verTodos ? ranking : ranking.slice(0, VISIVEIS);
  const outros = ranking.slice(VISIVEIS);
  const maxRanking = Math.max(1, ...ranking.map((x) => x.v));

  const cnpjs = [...new Set(dividas.map((d) => d.cnpj))].sort((a, b) => soma(dividas.filter((d) => d.cnpj === b)) - soma(dividas.filter((d) => d.cnpj === a)));
  const celulas = cnpjs.flatMap((c) => ORGAOS.map((o) => soma(dividas.filter((d) => d.cnpj === c && d.orgao === o))));
  const maxCelula = Math.max(1, ...celulas);
  const porOrgao = ORGAOS.map((o) => ({ o, v: soma(dividas.filter((d) => d.orgao === o)), n: dividas.filter((d) => d.orgao === o).length }));

  const anos = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dividas) if (d.total) m.set(anoDe(d), (m.get(anoDe(d)) ?? 0) + d.total);
    return [...m.entries()].filter(([a]) => /^\d{4}$/.test(a)).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dividas]);
  const maxAno = Math.max(1, ...anos.map(([, v]) => v));
  const passo = maxAno > 1e6 ? 500000 : maxAno > 4e5 ? 200000 : 100000;
  const topo = Math.ceil(maxAno / passo) * passo;
  const grades = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);

  const sensPorTipo = ["INSS descontado dos funcionários", "IRRF retido", "CSRF retida", "FGTS"].map((c) => ({ c, v: soma(sensiveis.filter((d) => d.categoria === c)) })).filter((x) => x.v);

  return (
    <section className="dv" aria-label="Dívidas e impostos do grupo" onMouseLeave={() => setDica(null)}>
      {/* ===== Faixa principal: o total e onde ele está ===== */}
      <div className="dv-faixa">
        <div className="dv-resumo">
          <p className="dv-resumo-rotulo">Total devido pelo grupo</p>
          <button className="dv-heroi" onClick={() => abrir({})} aria-label={`Total devido: ${reais(total)}. Ver todos os lançamentos`}>
            <span className="dv-moeda">R$</span>{total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </button>
          <p className="dv-atraso"><b>{compacto(emAtraso)}</b> já em atraso, {pct(emAtraso, total)} do total</p>

          <div className="dv-medidor" role="img" aria-label="Divisão por situação">
            {porSituacao.filter((s) => s.v > 0).map((s) => (
              <button key={s.id} className={`dv-seg s-${s.id}`} style={{ flexGrow: s.v }} onClick={() => abrir({ situacao: s.id })}
                onMouseMove={(ev) => mostrar(ev, s.nome, [reais(s.v), `${pct(s.v, total)} do total`, s.explica])} aria-label={`${s.nome}: ${reais(s.v)}`} />
            ))}
          </div>
          <dl className="dv-situacoes">
            {porSituacao.map((s) => (
              <button key={s.id} onClick={() => abrir({ situacao: s.id })} disabled={!s.v}>
                <dt><i className={`s-${s.id}`} aria-hidden="true" />{s.nome}</dt>
                <dd>{reais(s.v)}</dd>
              </button>
            ))}
          </dl>
          <p className="dv-origem">
            {vivos.length > 0 && <>Receita de hoje para {vivos.join(" e ")}. </>}
            {levantamento.length > 0 && <>Prefeitura, FGTS e o restante vêm do levantamento de {levantamento.map(dia).join(", ")}.</>}
          </p>
        </div>

        <div className="dv-onde">
          <p className="dv-resumo-rotulo">Por órgão</p>
          <div className="dv-orgaos-barra" role="img" aria-label="Divisão por órgão">
            {porOrgao.filter((x) => x.v > 0).map((x) => (
              <button key={x.o} style={{ flexGrow: x.v, background: COR_ORGAO[x.o] }} onClick={() => abrir({ orgao: x.o })} aria-label={`${x.o}: ${reais(x.v)}`} />
            ))}
          </div>
          <div className="dv-orgaos">
            {porOrgao.filter((x) => x.n).map((x) => (
              <button key={x.o} onClick={() => abrir({ orgao: x.o })}>
                <span className="dv-orgao-nome"><i style={{ background: COR_ORGAO[x.o] }} aria-hidden="true" />{x.o}</span>
                <span className="dv-orgao-valor">{x.v ? compacto(x.v) : "negociado"}</span>
                <span className="dv-orgao-pct">{x.v ? pct(x.v, total) : "sem saldo no relatório"}</span>
              </button>
            ))}
          </div>

          <p className="dv-resumo-rotulo dv-onde-titulo">Onde está a dívida</p>
          <ol className="dv-ranking">
            {principais.map((x) => (
              <li key={x.orgao + x.categoria}>
                <button onClick={() => abrir({ orgao: x.orgao, categoria: x.categoria })} title={`${x.categoria} · ${x.orgao}`}>
                  <span className="dv-rk-nome"><i style={{ background: COR_ORGAO[x.orgao] }} aria-hidden="true" />{x.categoria}{x.categoria !== x.orgao && <small>{x.orgao}</small>}</span>
                  <span className="dv-rk-trilho"><i style={{ width: `${Math.max(1.5, (x.v / maxRanking) * 100)}%`, background: COR_ORGAO[x.orgao] }} /></span>
                  <span className="dv-rk-valor">{compacto(x.v)}</span>
                  <span className="dv-rk-pct">{pct(x.v, total)}</span>
                </button>
              </li>
            ))}
          </ol>
          {outros.length > 0 && (
            <button className="dv-rk-mais" onClick={() => setVerTodos(!verTodos)}>
              {verTodos ? "Mostrar só os maiores" : `Mais ${outros.length} tributos menores: ${compacto(outros.reduce((s, x) => s + x.v, 0))} (${pct(outros.reduce((s, x) => s + x.v, 0), total)})`}
            </button>
          )}
        </div>
      </div>

      {/* ===== Empresa × órgão (calor) ===== */}
      <div className="dv-linha">
        <div className="dv-painel dv-painel-largo">
          <div className="dv-painel-topo">
            <h3>Quem deve a quem</h3>
            <span>Quanto mais forte a cor, maior a dívida</span>
          </div>
          <div className="dv-matriz-caixa">
            <table className="dv-matriz">
              <thead>
                <tr><th scope="col">Empresa</th>{ORGAOS.map((o) => <th key={o} scope="col"><i style={{ background: COR_ORGAO[o] }} aria-hidden="true" />{o}</th>)}<th scope="col">Total</th></tr>
              </thead>
              <tbody>
                {cnpjs.map((c) => {
                  const da = dividas.filter((d) => d.cnpj === c);
                  return (
                    <tr key={c}>
                      <th scope="row"><button onClick={() => abrir({ cnpj: c })}>{nome(c)}</button></th>
                      {ORGAOS.map((o) => {
                        const l = da.filter((d) => d.orgao === o);
                        const v = soma(l);
                        const forca = v ? 10 + Math.round((v / maxCelula) * 55) : 0;
                        return (
                          <td key={o}>
                            {l.length ? (
                              <button style={{ background: v ? `color-mix(in srgb, ${COR_ORGAO[o]} ${forca}%, transparent)` : undefined }} onClick={() => abrir({ cnpj: c, orgao: o })}
                                onMouseMove={(ev) => mostrar(ev, `${nome(c)} · ${o}`, [v ? reais(v) : "Negociado, sem saldo no relatório", `${l.length} lançamento${l.length > 1 ? "s" : ""}`])}>
                                {v ? compacto(v) : "negociado"}
                              </button>
                            ) : <span className="dv-vazio">—</span>}
                          </td>
                        );
                      })}
                      <td className="dv-matriz-total"><button onClick={() => abrir({ cnpj: c })}>{compacto(soma(da))}</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><th scope="row">Grupo</th>{porOrgao.map((x) => <td key={x.o}>{x.v ? compacto(x.v) : "—"}</td>)}<td className="dv-matriz-total">{compacto(total)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="dv-painel">
          <div className="dv-painel-topo"><h3>Dinheiro de terceiros</h3></div>
          <button className="dv-terceiros" onClick={() => abrir({ sensivel: true })}>
            <span className="dv-terceiros-valor">{reais(soma(sensiveis))}</span>
            <span className="dv-terceiros-texto">foram descontados dos funcionários ou retidos de terceiros e não chegaram ao governo. Vêm antes de qualquer outra dívida: o atraso pode virar processo criminal ou trabalhista.</span>
          </button>
          <ul className="dv-terceiros-lista">
            {sensPorTipo.map((x) => (
              <li key={x.c}><button onClick={() => abrir({ sensivel: true, categoria: x.c })}><span>{x.c}</span><b>{reais(x.v)}</b></button></li>
            ))}
          </ul>
        </div>
      </div>

      {/* ===== Idade da dívida ===== */}
      <div className="dv-painel">
        <div className="dv-painel-topo">
          <h3>Idade da dívida</h3>
          <span>Valor por ano da competência. Quanto mais antigo, mais multa e juros já correram.</span>
        </div>
        <div className="dv-grafico">
          <div className="dv-eixo" aria-hidden="true">
            {[...grades].reverse().map((g) => <span key={g}>{g ? compacto(g).replace(",00", "") : "0"}</span>)}
          </div>
          <div className="dv-area">
            {grades.map((g) => <i key={g} className="dv-grade-linha" style={{ bottom: `${(g / topo) * 100}%` }} aria-hidden="true" />)}
            <div className="dv-colunas">
              {anos.map(([a, v]) => (
                <button key={a} className="dv-coluna" onClick={() => abrir({ ano: a })}
                  onMouseMove={(ev) => mostrar(ev, `Competência ${a}`, [reais(v), `${pct(v, total)} do total`])} aria-label={`${a}: ${reais(v)}`}>
                  <span className="dv-coluna-barra" style={{ height: `${(v / topo) * 100}%` }}><span className="dv-coluna-valor">{compacto(v)}</span></span>
                </button>
              ))}
            </div>
          </div>
          <div className="dv-anos" aria-hidden="true">{anos.map(([a]) => <span key={a}>{a}</span>)}</div>
        </div>
        {semValor.length > 0 && <p className="dv-nota">{semValor.length === 1 ? "1 lançamento não tem" : `${semValor.length} lançamentos não têm`} valor no relatório (dívida ativa negociada na PGFN, parcelas do Simples sem valor informado) e aparece{semValor.length === 1 ? "" : "m"} só no detalhe.</p>}
      </div>

      {dica && (
        <div className="dv-dica" style={{ left: dica.x, top: dica.y }} role="tooltip">
          <b>{dica.titulo}</b>
          {dica.linhas.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}

      {filtro && (
        <Detalhe filtro={filtro} itens={dividas.filter((d) => casa(d, filtro))} nome={nome} fechar={() => setFiltro(null)} limpar={(k) => setFiltro({ ...filtro, [k]: undefined })} />
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
    <Gaveta titulo={chips.length ? chips.map(([, t]) => t).join(" · ") : "Todas as dívidas do grupo"} sub={`${itens.length} ${itens.length === 1 ? "lançamento" : "lançamentos"}, ${reais(totalGeral)}`} fechar={fechar}>
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
