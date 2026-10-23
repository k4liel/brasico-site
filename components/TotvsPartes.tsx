"use client";

import { useState, type CSSProperties } from "react";
import {
  type Dia, type Ponto, MESES, SEMANA, agruparGarcons, agruparPagamentos, agruparProdutos, comMovimento, dataBr, diaSemana,
  escalaBonita, inteiro, maiuscula, mesCurto, pct, plural, reais, reaisCurto, somar, somarMeses, titulo,
} from "@/lib/totvs-painel";

// Blocos do painel de vendas TOTVS (components/Totvs.tsx)

export function Indicador({ rotulo, valor, nota, classe }: { rotulo: string; valor: string; nota?: string; classe?: string }) {
  return (
    <div className="tp-indicador">
      <span className="tp-rotulo">{rotulo}</span>
      <b className={`tp-numero${classe ? ` ${classe}` : ""}`}>{valor}</b>
      {nota && <span className="tp-nota">{nota}</span>}
    </div>
  );
}

// Variação em % com seta e cor (verde sobe, vermelho desce)
export function Variacao({ v }: { v: number | null }) {
  if (v == null || !isFinite(v)) return <span className="tp-nota">sem base</span>;
  return <span className={v >= 0 ? "tp-var tp-sobe" : "tp-var tp-desce"}>{v >= 0 ? "▲" : "▼"} {pct(Math.abs(v))}</span>;
}

function Segmentos<T extends string>({ valor, opcoes, mudar, rotulo }: { valor: T; opcoes: [T, string][]; mudar: (v: T) => void; rotulo: string }) {
  return (
    <div className="tp-seg" role="group" aria-label={rotulo}>
      {opcoes.map(([v, nome]) => (
        <button key={v} type="button" className={v === valor ? "on" : ""} aria-pressed={v === valor} onClick={() => mudar(v)}>{nome}</button>
      ))}
    </div>
  );
}

const nomeDia = (d: string) => `${SEMANA[diaSemana(d)]}, ${+d.slice(8, 10)} de ${MESES[+d.slice(5, 7) - 1]}`;
const SITUACAO: Record<string, string> = { ok: "Conferido", revisar: "Para revisar", sem_movimento: "Sem movimento" };

// ---------------------------------------------------------------------------------------------
// Detalhe de um dia (abre ao clicar numa barra do gráfico)
// ---------------------------------------------------------------------------------------------
export function PainelDia({ d, onFechar, onAnterior, onProximo }: {
  d: Dia; onFechar: () => void; onAnterior?: () => void; onProximo?: () => void;
}) {
  const s = somar([d]);
  const pags = agruparPagamentos([d]);
  const totalPag = pags.reduce((a, p) => a + p.valor, 0) || 1;
  const produtos = agruparProdutos([d]).slice(0, 8);
  const garcons = agruparGarcons([d]).slice(0, 6);
  const itensCanc = (d.cancelados ?? []).filter((c) => c.tipo === "item").length;
  const cuponsCanc = (d.cancelados ?? []).filter((c) => c.tipo === "venda").length;
  return (
    <section className="tp-painel tp-dia" aria-label={`Detalhe de ${nomeDia(d.dia)}`}>
      <div className="tp-dia-topo">
        <div>
          <span className="tp-rotulo">Detalhe do dia</span>
          <h3>{nomeDia(d.dia)}</h3>
        </div>
        <span className={`tp-chip tp-chip-${d.status}`}>{SITUACAO[d.status] ?? d.status}</span>
        <div className="tp-dia-nav">
          <button type="button" className="ghost small" onClick={onAnterior} disabled={!onAnterior} aria-label="Dia anterior">‹</button>
          <button type="button" className="ghost small" onClick={onProximo} disabled={!onProximo} aria-label="Próximo dia">›</button>
          <button type="button" className="ghost small" onClick={onFechar} aria-label="Fechar o detalhe do dia">Fechar</button>
        </div>
      </div>

      {d.status === "revisar" && (d.divergencias ?? []).length > 0 && (
        <ul className="tp-alerta-lista">
          {d.divergencias.map((x, i) => (
            <li key={i}>{x.conferencia}: {reais(Math.abs(Number(x.diferenca ?? x.valor ?? 0)))} de diferença</li>
          ))}
        </ul>
      )}

      {d.status === "sem_movimento" ? (
        <p className="tp-vazio">A TOTVS não tem vendas neste dia (loja fechada).</p>
      ) : (
        <>
          <div className="tp-kpis tp-kpis-dia">
            <Indicador rotulo="Faturamento" valor={reais(s.total)} />
            <Indicador rotulo="Pessoas" valor={inteiro(s.pessoas)} nota={s.pessoas ? `${reais(s.total / s.pessoas)} por pessoa` : undefined} />
            <Indicador rotulo="Cupons" valor={inteiro(s.vendas)} nota={s.vendas ? `${reais(s.total / s.vendas)} por cupom` : undefined} />
            <Indicador rotulo="Taxa de serviço" valor={reais(s.servico)} />
            <Indicador rotulo="Descontos" valor={reais(s.descontos)} />
            <Indicador rotulo="Cancelamentos" valor={plural(itensCanc, "item", "itens")} nota={plural(cuponsCanc, "cupom inteiro", "cupons inteiros")} />
          </div>
          <div className="tp-tres">
            <div>
              <h4>Pagamentos</h4>
              <ul className="tp-lista tp-lista-curta">
                {pags.map((p) => (
                  <li key={`${p.tipo}${p.forma}`}>
                    <span title={p.forma}>{titulo(p.forma)}</span>
                    <b>{reais(p.valor)}<small>{pct(p.valor / totalPag)}</small></b>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Produtos que mais venderam</h4>
              <ul className="tp-lista tp-lista-curta">
                {produtos.map((p) => (
                  <li key={p.nome}>
                    <span title={p.nome}>{titulo(p.nome)}<small>{inteiro(p.quantidade)} un.</small></span>
                    <b>{reais(p.valor)}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Garçons</h4>
              <ul className="tp-lista tp-lista-curta">
                {garcons.map((g) => (
                  <li key={g.nome}>
                    <span title={g.nome}>{titulo(g.nome)}<small>{inteiro(g.vendas)} atend.</small></span>
                    <b>{reais(g.valor)}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {(s.sangrias > 0 || s.cortesias > 0 || s.assinadas > 0) && (
            <p className="tp-nota tp-dia-rodape">
              {[s.cortesias > 0 && `Cortesias ${reais(s.cortesias)}`, s.assinadas > 0 && `Assinadas ${reais(s.assinadas)}`, s.sangrias > 0 && `Sangrias ${reais(s.sangrias)}`]
                .filter(Boolean).join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Evolução: os 12 meses até o mês escolhido, com o mesmo mês do ano anterior marcado
// ---------------------------------------------------------------------------------------------
export function Evolucao({ serie, mes, hoje, meses, onEscolher }: {
  serie: Ponto[] | null; mes: string; hoje: string; meses: string[]; onEscolher: (m: string) => void;
}) {
  const [foco, setFoco] = useState<string | null>(null);
  const porMes = new Map<string, { total: number; dias: number }>();
  for (const p of serie ?? []) {
    if (!comMovimento(p)) continue;
    const m = p.dia.slice(0, 7);
    const x = porMes.get(m) ?? { total: 0, dias: 0 };
    x.total += Number(p.total); x.dias += 1;
    porMes.set(m, x);
  }
  const lista = Array.from({ length: 12 }, (_, i) => {
    const m = somarMeses(mes, i - 11);
    const atual = porMes.get(m);
    const antes = porMes.get(somarMeses(m, -12));
    return { m, total: atual?.total ?? 0, dias: atual?.dias ?? 0, antes: antes?.total ?? 0, parcial: m === hoje.slice(0, 7) };
  });
  const escala = escalaBonita(Math.max(...lista.flatMap((x) => [x.total, x.antes]), 1));
  const f = lista.find((x) => x.m === foco);
  const doze = lista.reduce((a, x) => a + x.total, 0);
  const dozeAntes = lista.reduce((a, x) => a + x.antes, 0);

  return (
    <section className="tp-painel">
      <div className="tp-painel-topo">
        <h3>Evolução mensal</h3>
        <span className="tp-nota" aria-live="polite">
          {f
            ? `${maiuscula(mesCurto(f.m))}${f.parcial ? " (parcial)" : ""} · ${reais(f.total)}${f.antes ? ` · ${mesCurto(somarMeses(f.m, -12))}: ${reais(f.antes)}` : ""}`
            : `12 meses: ${reais(doze)}${dozeAntes > 0 ? ` · 12 meses antes: ${reais(dozeAntes)}` : ""}`}
        </span>
      </div>
      {serie === null ? <div className="tp-carregando-linha" aria-label="Carregando" /> : (
        <>
          <div className="tp-grafico tp-grafico-meses" style={{ "--tp-dias": 12 } as CSSProperties}>
            <div className="tp-plot">
              {[1, 0.5, 0].map((x) => (
                <span key={x} className={x ? "tp-grade" : "tp-grade base"} style={{ bottom: `${x * 100}%` }} aria-hidden="true">
                  <em>{x ? reaisCurto(escala * x) : "R$ 0"}</em>
                </span>
              ))}
              <div className="tp-barras" role="list" onMouseLeave={() => setFoco(null)}>
                {lista.map((x) => {
                  const clicavel = meses.includes(x.m) && x.m !== mes;
                  return (
                    <div key={x.m} role="listitem" tabIndex={0}
                      className={`tp-coluna${x.m === mes ? " escolhido" : ""}${foco === x.m ? " on" : ""}${x.parcial ? " parcial" : ""}${clicavel ? " clicavel" : ""}`}
                      onMouseEnter={() => setFoco(x.m)} onFocus={() => setFoco(x.m)} onBlur={() => setFoco(null)}
                      onClick={() => clicavel && onEscolher(x.m)} onKeyDown={(e) => e.key === "Enter" && clicavel && onEscolher(x.m)}
                      aria-label={`${mesCurto(x.m)}: ${reais(x.total)}${x.antes ? `; ano anterior ${reais(x.antes)}` : ""}`}>
                      {x.total > 0 && <i style={{ height: `${(x.total / escala) * 100}%` }} />}
                      {x.antes > 0 && <b className="tp-marca-ano" style={{ bottom: `${(x.antes / escala) * 100}%` }} />}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="tp-dias" aria-hidden="true">
              {lista.map((x) => <span key={x.m} className="marco">{mesCurto(x.m)}</span>)}
            </div>
          </div>
          <p className="tp-nota tp-legenda-dias">
            <span className="tp-chave-ano" /> mesmo mês do ano anterior · mês atual parcial · clique num mês para abrir
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Produtos do período: busca, categoria, ordem e lista completa
// ---------------------------------------------------------------------------------------------
type Categoria = "todas" | "comida" | "bebida" | "outros";
export function Produtos({ dias }: { dias: Dia[] }) {
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState<Categoria>("todas");
  const [ordem, setOrdem] = useState<"valor" | "quantidade">("valor");
  const [todos, setTodos] = useState(false);
  const base = agruparProdutos(dias);
  const totalProdutos = base.reduce((a, p) => a + p.valor, 0) || 1;
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = base
    .filter((p) => cat === "todas" || p.categoria === cat)
    .filter((p) => !termo || `${p.nome} ${p.grupo}`.toLocaleLowerCase("pt-BR").includes(termo))
    .sort((a, b) => (ordem === "valor" ? b.valor - a.valor : b.quantidade - a.quantidade));
  const mostrar = todos || termo ? filtrados : filtrados.slice(0, 15);
  return (
    <section className="tp-painel">
      <div className="tp-painel-topo">
        <h3>Produtos</h3>
        <span className="tp-nota">{inteiro(base.length)} produtos vendidos no período</span>
      </div>
      <div className="tp-controles">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou grupo" aria-label="Buscar produto" />
        <Segmentos rotulo="Categoria" valor={cat} mudar={setCat} opcoes={[["todas", "Todos"], ["comida", "Comida"], ["bebida", "Bebida"], ["outros", "Outros"]]} />
        <Segmentos rotulo="Ordenar por" valor={ordem} mudar={setOrdem} opcoes={[["valor", "Por valor"], ["quantidade", "Por quantidade"]]} />
      </div>
      {filtrados.length === 0 ? <p className="tp-vazio">Nenhum produto encontrado.</p> : (
        <div className="tp-rolagem">
          <table className="tp-tabela tp-tabela-produtos">
            <thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Valor</th><th className="tp-col-part">Part.</th></tr></thead>
            <tbody>
              {mostrar.map((p, i) => (
                <tr key={p.nome}>
                  <td>{i + 1}</td>
                  <td title={p.nome}>{titulo(p.nome)}<small>{titulo(p.grupo ?? "")}</small></td>
                  <td>{inteiro(p.quantidade)}</td>
                  <td>{reais(p.valor)}</td>
                  <td className="tp-col-part">{pct(p.valor / totalProdutos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!termo && filtrados.length > 15 && (
        <button type="button" className="ghost small tp-mais" onClick={() => setTodos(!todos)}>
          {todos ? "Mostrar só os 15 primeiros" : `Ver todos os ${inteiro(filtrados.length)}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Garçons: ranking completo do período
// ---------------------------------------------------------------------------------------------
export function Garcons({ dias }: { dias: Dia[] }) {
  const [todos, setTodos] = useState(false);
  const lista = agruparGarcons(dias);
  const total = lista.reduce((a, g) => a + g.valor, 0) || 1;
  const mostrar = todos ? lista : lista.slice(0, 10);
  return (
    <section className="tp-painel">
      <div className="tp-painel-topo">
        <h3>Garçons</h3>
        <span className="tp-nota">por valor vendido em itens, sem a taxa de serviço</span>
      </div>
      <div className="tp-rolagem">
        <table className="tp-tabela tp-tabela-garcons">
          <thead><tr><th>#</th><th>Nome</th><th>Atend.</th><th className="tp-col-part">Por atend.</th><th>Valor</th><th className="tp-col-part">Part.</th></tr></thead>
          <tbody>
            {mostrar.map((g, i) => (
              <tr key={g.nome}>
                <td>{i + 1}</td>
                <td title={g.nome}>{titulo(g.nome)}<small>{plural(g.dias.size, "dia", "dias")} · {plural(g.itens, "item", "itens")}</small></td>
                <td>{inteiro(g.vendas)}</td>
                <td className="tp-col-part">{g.vendas ? reais(g.valor / g.vendas) : "—"}</td>
                <td>{reais(g.valor)}</td>
                <td className="tp-col-part">{pct(g.valor / total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > 10 && (
        <button type="button" className="ghost small tp-mais" onClick={() => setTodos(!todos)}>
          {todos ? "Mostrar só os 10 primeiros" : `Ver todos os ${lista.length}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Abatimentos e perdas, com a lista de cancelamentos e sangrias
// ---------------------------------------------------------------------------------------------
export function Perdas({ dias }: { dias: Dia[] }) {
  const [aba, setAba] = useState<"cancelamentos" | "sangrias">("cancelamentos");
  const [todos, setTodos] = useState(false);
  const s = somar(dias);
  const cancelados = dias.flatMap((d) => (d.cancelados ?? []).map((c) => ({ ...c, dia: d.dia }))).reverse();
  const sangrias = dias.flatMap((d) => (d.sangrias ?? []).map((x) => ({ ...x, dia: d.dia }))).reverse();
  const lista = aba === "cancelamentos" ? cancelados : sangrias;
  const limite = todos ? lista.length : 20;
  return (
    <section className="tp-painel">
      <div className="tp-painel-topo"><h3>Abatimentos e perdas</h3></div>
      <div className="tp-kpis tp-kpis-5">
        <Indicador rotulo="Descontos" valor={reais(s.descontos)} nota={s.total ? `${pct(s.descontos / (s.total + s.descontos))} do bruto` : undefined} />
        <Indicador rotulo="Cortesias" valor={reais(s.cortesias)} />
        <Indicador rotulo="Assinadas" valor={reais(s.assinadas)} />
        <Indicador rotulo="Sangrias" valor={reais(s.sangrias)} nota={plural(sangrias.length, "retirada", "retiradas")} />
        <Indicador rotulo="Cancelamentos" valor={plural(s.itensCancelados, "item", "itens")} nota={plural(s.cuponsCancelados, "cupom inteiro", "cupons inteiros")} />
      </div>
      {(cancelados.length > 0 || sangrias.length > 0) && (
        <div className="tp-detalhe-perdas">
          <Segmentos rotulo="Ver lista de" valor={aba} mudar={(v) => { setAba(v); setTodos(false); }}
            opcoes={[["cancelamentos", `Cancelamentos (${cancelados.length})`], ["sangrias", `Sangrias (${sangrias.length})`]]} />
          {lista.length === 0 ? <p className="tp-vazio">Nada no período.</p> : (
            <div className="tp-rolagem">
              {aba === "cancelamentos" ? (
                <table className="tp-tabela tp-tabela-lista cancelamentos">
                  <thead><tr><th>Dia</th><th>O que foi cancelado</th><th>Quem</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {cancelados.slice(0, limite).map((c, i) => (
                      <tr key={i}>
                        <td>{dataBr(c.dia)}</td>
                        <td>{c.tipo === "venda" ? `Cupom ${c.cupom ?? ""} inteiro${c.total ? ` (${reais(Number(c.total))})` : ""}` : titulo(c.produto ?? "Item")}</td>
                        <td>{titulo(c.operador ?? "") || "—"}</td>
                        <td>{c.motivo ? maiuscula(c.motivo.toLocaleLowerCase("pt-BR")) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="tp-tabela tp-tabela-lista sangrias">
                  <thead><tr><th>Dia</th><th>Quem</th><th>Motivo</th><th>Valor</th></tr></thead>
                  <tbody>
                    {sangrias.slice(0, limite).map((x, i) => (
                      <tr key={i}>
                        <td>{dataBr(x.dia)}{x.caixa != null && <small>Caixa {x.caixa}</small>}</td>
                        <td>{titulo(x.operador ?? "") || "—"}</td>
                        <td>{x.motivo ? maiuscula(x.motivo.toLocaleLowerCase("pt-BR")) : "—"}</td>
                        <td>{reais(Number(x.valor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {lista.length > 20 && (
            <button type="button" className="ghost small tp-mais" onClick={() => setTodos(!todos)}>
              {todos ? "Mostrar menos" : `Ver todos os ${inteiro(lista.length)}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
