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

// ---------- treemap (algoritmo "squarified": retângulos o mais perto possível de quadrados) ----------
type Ret = { x: number; y: number; w: number; h: number };
function squarify(valores: number[], area: Ret): Ret[] {
  const total = valores.reduce((a, b) => a + b, 0);
  if (!total) return valores.map(() => ({ x: area.x, y: area.y, w: 0, h: 0 }));
  const escala = (area.w * area.h) / total;
  const areas = valores.map((v) => v * escala);
  const out: Ret[] = [];
  let resto = { ...area };
  let linha: number[] = [];
  const pior = (l: number[], lado: number) => {
    const s = l.reduce((a, b) => a + b, 0);
    return Math.max((lado * lado * Math.max(...l)) / (s * s), (s * s) / (lado * lado * Math.min(...l)));
  };
  const assentar = (l: number[], r: Ret): Ret => {
    const s = l.reduce((a, b) => a + b, 0);
    if (r.w >= r.h) {
      const larg = s / r.h;
      let y = r.y;
      for (const a of l) { out.push({ x: r.x, y, w: larg, h: a / larg }); y += a / larg; }
      return { x: r.x + larg, y: r.y, w: r.w - larg, h: r.h };
    }
    const alt = s / r.w;
    let x = r.x;
    for (const a of l) { out.push({ x, y: r.y, w: a / alt, h: alt }); x += a / alt; }
    return { x: r.x, y: r.y + alt, w: r.w, h: r.h - alt };
  };
  for (let i = 0; i < areas.length;) {
    const lado = Math.min(resto.w, resto.h);
    if (!linha.length || pior([...linha, areas[i]], lado) <= pior(linha, lado)) { linha.push(areas[i]); i++; }
    else { resto = assentar(linha, resto); linha = []; }
  }
  if (linha.length) assentar(linha, resto);
  return out;
}

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

  // Treemap: órgão → tributo, em unidades de um retângulo 160 × 100
  const mapa = useMemo(() => {
    const orgaos = ORGAOS.map((o) => {
      const m = new Map<string, number>();
      for (const d of dividas.filter((x) => x.orgao === o)) m.set(d.categoria, (m.get(d.categoria) ?? 0) + (d.total ?? 0));
      const tributos = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      return { o, v: tributos.reduce((s, [, v]) => s + v, 0), tributos };
    }).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const blocos = squarify(orgaos.map((x) => x.v), { x: 0, y: 0, w: 160, h: 100 });
    return orgaos.flatMap((x, i) => {
      const b = blocos[i];
      const dentro = squarify(x.tributos.map(([, v]) => v), b);
      return x.tributos.map(([c, v], j) => ({ orgao: x.o, totalOrgao: x.v, categoria: c, v, r: dentro[j], primeiro: j === 0 }));
    });
  }, [dividas]);

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

        <div className="dv-mapa-caixa">
          <div className="dv-mapa-legenda">
            {porOrgao.filter((x) => x.n).map((x) => (
              <button key={x.o} onClick={() => abrir({ orgao: x.o })}>
                <i style={{ background: COR_ORGAO[x.o] }} aria-hidden="true" />{x.o}<b>{x.v ? compacto(x.v) : "negociado"}</b>
              </button>
            ))}
          </div>
          <div className="dv-mapa" role="img" aria-label="Mapa proporcional da dívida por órgão e tributo">
            {mapa.map((t) => {
              const area = t.r.w * t.r.h;
              // O que cabe no retângulo (o mapa tem ~300 px de altura = 100 unidades)
              const grande = t.r.w > 24 && t.r.h > 15;
              const alto = grande && t.r.h > 26;
              const medio = !grande && t.r.w > 14 && t.r.h > 9;
              return (
                <button key={t.orgao + t.categoria} className="dv-bloco"
                  style={{ left: `${(t.r.x / 160) * 100}%`, top: `${t.r.y}%`, width: `${(t.r.w / 160) * 100}%`, height: `${t.r.h}%`, ["--c" as string]: COR_ORGAO[t.orgao] }}
                  onClick={() => abrir({ orgao: t.orgao, categoria: t.categoria })}
                  onMouseMove={(ev) => mostrar(ev, t.categoria, [t.orgao, reais(t.v), `${pct(t.v, total)} do total do grupo`])}
                  aria-label={`${t.categoria}, ${t.orgao}: ${reais(t.v)}`}>
                  {(grande || medio) && area > 0 && (
                    <span className={grande ? (alto ? "dv-bloco-texto alto" : "dv-bloco-texto") : "dv-bloco-texto pequeno"}>
                      <span className="dv-bloco-nome">{t.categoria}</span>
                      <span className="dv-bloco-valor">{compacto(t.v)}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
