"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Indicador, Variacao } from "./TotvsPartes";
import {
  MESES, SEMANA, dataBr, diaSemana, diasNoMes, escalaBonita, inteiro, maiuscula, mesAnterior, nomeMes, pct, reais, reaisCurto, somarMeses,
} from "@/lib/totvs-painel";

// Faturamento dos hotéis na página de vendas, a partir dos lançamentos do PMS (função vendas_hoteis_dia,
// supabase/vendas_hoteis.sql). Duas partes, pedido do dono (12/11/2026): Hospedagem (diárias, taxas de serviço
// e ISS, spa e serviços) e Restaurante. Restaurante do hotel com caixa na TOTVS (Filha da Lua): vale o total
// do caixa, que já inclui o que foi para a conta do quarto; o mesmo valor que o PMS recebe da TOTVS não é somado de novo.
// O detalhe do hotel (13/11/2026, "preciso dos dados detalhados do Sempre Vivo") junta ocupação e diárias
// (pms_mes_hotel), a composição do faturamento, formas de pagamento (pms_transacoes), canais (pms_estadias_canal)
// e o consumo do restaurante nas contas.

export type HotelDia = {
  hotel_id: string; dia: string; hospedagem: number; restaurante_pms: number; restaurante_totvs: number;
  restaurante_migrado: number; spa: number; outros: number; taxas: number; iss: number; frigobar: number;
  restaurante_lancamentos: number;
};
export type HotelInfo = { id: string; nome: string; totvs_unidade: string | null };
type MesHotel = { mes: string; dias: number; uh_disponiveis: number; uh_total: number; diarias_vendidas: number; receita: number; ocupacao: number; diaria_media: number; revpar: number };
type Canal = { canal: string; reservas: number; noites: number; valor: number };

const NOME: Record<string, string> = { "filha-da-lua": "Hotel Filha da Lua", "sempre-vivo": "Hotel Sempre Vivo" };
export const nomeHotel = (h: HotelInfo) => NOME[h.id] ?? h.nome;

const n = (v: unknown) => Number(v ?? 0);
// Na tabela do dia a dia, sem centavos (cabe no cartão)
const r0 = (v: number) => Math.round(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const hospDia = (d: HotelDia) => n(d.hospedagem) + n(d.spa) + n(d.outros) + n(d.taxas);
const restDia = (d: HotelDia) => n(d.restaurante_pms) + n(d.restaurante_totvs);
const fimDoMes = (m: string) => `${m}-${String(diasNoMes(m)).padStart(2, "0")}`;
const NOME_CANAL: Record<string, string> = { booking: "Booking", expedia: "Expedia", "SITE HOTEL": "Site do hotel", PADRAO: "Padrão (balcão)" };

export function somarHotel(ds: HotelDia[]) {
  const s = { hospedagem: 0, restaurante: 0, restauranteTotvs: 0, migrado: 0, total: 0,
    diarias: 0, taxaServico: 0, iss: 0, spa: 0, outros: 0, restauranteContas: 0, frigobar: 0, lancamentos: 0, diasRestaurante: 0 };
  for (const d of ds) {
    s.hospedagem += hospDia(d);
    s.restaurante += restDia(d);
    s.restauranteTotvs += n(d.restaurante_totvs);
    s.migrado += n(d.restaurante_migrado);
    s.diarias += n(d.hospedagem);
    s.iss += n(d.iss);
    s.taxaServico += n(d.taxas) - n(d.iss);
    s.spa += n(d.spa);
    s.outros += n(d.outros);
    s.frigobar += n(d.frigobar);
    s.restauranteContas += n(d.restaurante_pms) - n(d.frigobar);
    s.lancamentos += n(d.restaurante_lancamentos);
    if (n(d.restaurante_pms) - n(d.frigobar) > 0) s.diasRestaurante++;
  }
  s.total = s.hospedagem + s.restaurante;
  return s;
}
// Último dia com lançamento no mês
export const ultimoDiaHotel = (ds: HotelDia[]) => ds.filter((d) => hospDia(d) + restDia(d) !== 0).pop()?.dia;

function ListaBarras({ itens, total }: { itens: { nome: string; valor: number; nota?: string }[]; total: number }) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <ul className="tp-lista">
      {itens.map((i) => (
        <li key={i.nome}>
          <span title={i.nome}>{i.nome}{i.nota && <small>{i.nota}</small>}</span>
          <span className="tp-linha" aria-hidden="true"><i style={{ width: `${Math.max(0, (i.valor / max) * 100)}%` }} /></span>
          <b>{reais(i.valor)}{total ? <small>{pct(i.valor / total)}</small> : null}</b>
        </li>
      ))}
    </ul>
  );
}

export function DetalheHotel({ supabase, h, mes, ds, anterior, hoje }: {
  supabase: SupabaseClient; h: HotelInfo; mes: string; ds: HotelDia[]; anterior: HotelDia[]; hoje: string;
}) {
  const [verDias, setVerDias] = useState(false);
  const [foco, setFoco] = useState<string | null>(null);
  const [mesesHotel, setMesesHotel] = useState<MesHotel[] | null>(null);
  const [anoAntes, setAnoAntes] = useState<HotelDia[] | null>(null);
  const [pagamentos, setPagamentos] = useState<{ forma: string; valor: number; vezes: number }[] | null>(null);
  const [canais, setCanais] = useState<Canal[] | null>(null);
  const mesAno = somarMeses(mes, -12);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [m, a, p, c] = await Promise.all([
        supabase.from("pms_mes_hotel").select("mes,dias,uh_disponiveis,uh_total,diarias_vendidas,receita,ocupacao,diaria_media,revpar")
          .eq("hotel_id", h.id).in("mes", [`${mes}-01`, `${mesAnterior(mes)}-01`, `${mesAno}-01`]),
        supabase.rpc("vendas_hoteis_dia", { p_de: `${mesAno}-01`, p_ate: fimDoMes(mesAno) }),
        supabase.from("pms_transacoes").select("descricao,valor").eq("hotel_id", h.id).eq("grupo", "Pagamento")
          .gte("dia", `${mes}-01`).lte("dia", fimDoMes(mes)).limit(5000),
        supabase.from("pms_estadias_canal").select("canal,noites,valor_diarias,status_id").eq("hotel_id", h.id)
          .gte("checkin", `${mes}-01`).lte("checkin", fimDoMes(mes)).limit(5000),
      ]);
      if (!vivo) return;
      setMesesHotel((m.data ?? []) as MesHotel[]);
      setAnoAntes(((a.data ?? []) as HotelDia[]).filter((d) => d.hotel_id === h.id));
      const pg = new Map<string, { forma: string; valor: number; vezes: number }>();
      for (const x of (p.data ?? []) as { descricao: string | null; valor: number }[]) {
        const forma = x.descricao?.trim() || "Sem forma";
        const atual = pg.get(forma) ?? { forma, valor: 0, vezes: 0 };
        atual.valor += n(x.valor); atual.vezes++;
        pg.set(forma, atual);
      }
      setPagamentos([...pg.values()].filter((x) => Math.abs(x.valor) >= 0.01).sort((x, y) => y.valor - x.valor));
      const cs = new Map<string, Canal>();
      for (const x of (c.data ?? []) as { canal: string | null; noites: number; valor_diarias: number | null; status_id: number }[]) {
        if (x.status_id === 5 || x.status_id === 6) continue;
        const nome = x.canal ? NOME_CANAL[x.canal] ?? x.canal : "Direto / sem canal";
        const atual = cs.get(nome) ?? { canal: nome, reservas: 0, noites: 0, valor: 0 };
        atual.reservas++; atual.noites += n(x.noites); atual.valor += n(x.valor_diarias);
        cs.set(nome, atual);
      }
      setCanais([...cs.values()].sort((x, y) => y.noites - x.noites));
    })();
    return () => { vivo = false; };
  }, [supabase, h.id, mes, mesAno]);

  const s = somarHotel(ds);
  const comValor = ds.filter((d) => hospDia(d) + restDia(d) !== 0);
  const ultimo = comValor[comValor.length - 1]?.dia;
  const limite = ultimo ? +ultimo.slice(8, 10) : 0;
  const ant = somarHotel(anterior.filter((d) => +d.dia.slice(8, 10) <= limite));
  const ano = anoAntes ? somarHotel(anoAntes.filter((d) => +d.dia.slice(8, 10) <= limite)) : null;
  const diasCorridos = mes === hoje.slice(0, 7) ? +hoje.slice(8, 10) : diasNoMes(mes);
  const mediaDia = s.total / Math.max(1, Math.min(diasCorridos, limite));
  const mh = mesesHotel?.find((x) => x.mes.startsWith(mes));
  const temTotvs = !!h.totvs_unidade && s.restauranteTotvs > 0;
  const partes = [
    { nome: "Hospedagem", valor: s.hospedagem, cor: "tp-cor-hosp" },
    { nome: "Restaurante", valor: s.restaurante, cor: "tp-cor-comida" },
  ];
  const composicao = [
    { nome: "Diárias", valor: s.diarias, nota: "com diferença de diária, early e late" },
    { nome: "Taxa de serviço", valor: s.taxaServico },
    { nome: "ISS", valor: s.iss },
    { nome: "Spa", valor: s.spa },
    { nome: "Outros serviços", valor: s.outros, nota: "lavanderia, terceirizados…" },
    { nome: "Restaurante", valor: temTotvs ? s.restauranteTotvs : s.restauranteContas, nota: temTotvs ? "caixa da TOTVS" : "consumo nas contas" },
    { nome: "Frigobar", valor: s.frigobar },
  ].filter((x) => Math.abs(x.valor) >= 0.5);
  const recebido = (pagamentos ?? []).reduce((a, x) => a + x.valor, 0);

  // Gráfico: barras empilhadas (hospedagem embaixo, restaurante em cima), sem os dias negativos (estornos)
  const maxDia = Math.max(...ds.map((d) => Math.max(0, hospDia(d)) + Math.max(0, restDia(d))), 1);
  const escala = escalaBonita(maxDia);
  const dFoco = foco ? ds.find((d) => d.dia === foco) : undefined;

  return (
    <>
      <div className="tp-titulo" id="tp-unidade">
        <div>
          <h2>{nomeHotel(h)}</h2>
          <span className="tp-nota">{maiuscula(nomeMes(mes))}{ultimo ? ` · lançamentos do PMS até ${dataBr(ultimo)}` : ""}</span>
        </div>
      </div>
      {comValor.length === 0 ? (
        <p className="tp-vazio">Ainda não há lançamentos deste mês no PMS para {nomeHotel(h)}.</p>
      ) : (
        <>
          <section className="tp-painel tp-kpis">
            <Indicador rotulo="Ocupação" valor={mh ? `${n(mh.ocupacao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
              nota={mh ? `${inteiro(mh.diarias_vendidas)} de ${inteiro(mh.uh_total)} UHs-noite` : undefined} />
            <Indicador rotulo="Diárias vendidas" valor={mh ? inteiro(mh.diarias_vendidas) : "—"} nota={mh && mh.dias ? `${n(mh.diarias_vendidas / mh.dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por noite` : undefined} />
            <Indicador rotulo="Diária média" valor={mh && mh.diarias_vendidas ? reais(n(mh.diaria_media)) : "—"} nota="só a diária, sem taxas" />
            <Indicador rotulo="RevPAR" valor={mh ? reais(n(mh.revpar)) : "—"} nota="diárias ÷ UHs disponíveis" />
            <Indicador rotulo="Restaurante por diária" valor={mh && mh.diarias_vendidas ? reais(s.restaurante / mh.diarias_vendidas) : "—"} nota="restaurante ÷ diárias vendidas" />
            <Indicador rotulo="Média por dia" valor={reais(mediaDia)} nota="faturamento total" />
          </section>

          <section className="tp-painel tp-ritmo">
            <div className="tp-ritmo-principal">
              <span className="tp-rotulo">Faturamento no mês</span>
              <b className="tp-numero tp-numero-xl">{reais(s.total)}</b>
              <span className="tp-nota">Hospedagem {reais(s.hospedagem)} · restaurante {reais(s.restaurante)}</span>
            </div>
            <div className="tp-ritmo-compara">
              <div>
                <span className="tp-rotulo">Contra {MESES[+mesAnterior(mes).slice(5, 7) - 1]}, até o dia {limite}</span>
                {ant.total > 0 ? (
                  <>
                    <b className="tp-numero"><Variacao v={s.total / ant.total - 1} /></b>
                    <span className="tp-nota">{reais(ant.total)} no mesmo período</span>
                  </>
                ) : <span className="tp-nota">Sem lançamentos no mês anterior.</span>}
              </div>
              <div>
                <span className="tp-rotulo">Contra {MESES[+mesAno.slice(5, 7) - 1]} de {mesAno.slice(0, 4)}, até o dia {limite}</span>
                {ano === null ? <span className="tp-nota">Carregando…</span> : ano.total > 0 ? (
                  <>
                    <b className="tp-numero"><Variacao v={s.total / ano.total - 1} /></b>
                    <span className="tp-nota">{reais(ano.total)} no mesmo período</span>
                  </>
                ) : <span className="tp-nota">Sem lançamentos desse mês no PMS para comparar.</span>}
              </div>
            </div>
            <div className="tp-mix">
              <span className="tp-rotulo">Hospedagem × restaurante</span>
              <div className="tp-mix-barra" role="img" aria-label={partes.map((p) => `${p.nome} ${s.total ? pct(p.valor / s.total) : ""}`).join(", ")}>
                {partes.filter((p) => p.valor > 0).map((p) => <i key={p.nome} className={p.cor} style={{ flexGrow: p.valor }} title={`${p.nome}: ${reais(p.valor)}`} />)}
              </div>
              <ul className="tp-legenda">
                {partes.map((p) => (
                  <li key={p.nome}><i className={p.cor} />{p.nome} <b>{s.total ? pct(p.valor / s.total) : ""}</b> <span>{reais(p.valor)}</span></li>
                ))}
              </ul>
              <span className="tp-nota">Hospedagem = diárias, taxas de serviço e ISS, spa e serviços. Restaurante = {temTotvs ? "caixa da TOTVS (com o que foi para a conta do quarto) e frigobar" : "consumo lançado nas contas do PMS e frigobar"}.</span>
            </div>
          </section>

          <section className="tp-painel">
            <div className="tp-painel-topo">
              <h3>Faturamento por dia</h3>
              <span className="tp-nota" aria-live="polite">
                {dFoco
                  ? `${SEMANA[diaSemana(dFoco.dia)]}, ${dataBr(dFoco.dia)} · hospedagem ${reais(hospDia(dFoco))} · restaurante ${reais(restDia(dFoco))}`
                  : `Média ${reais(mediaDia)} · passe o mouse num dia para ver as partes`}
              </span>
            </div>
            <div className="tp-grafico" style={{ "--tp-dias": diasNoMes(mes) } as CSSProperties}>
              <div className="tp-plot">
                {[1, 0.5, 0].map((f) => (
                  <span key={f} className={f ? "tp-grade" : "tp-grade base"} style={{ bottom: `${f * 100}%` }} aria-hidden="true">
                    <em>{f ? reaisCurto(escala * f) : "R$ 0"}</em>
                  </span>
                ))}
                <div className="tp-barras" role="list" onMouseLeave={() => setFoco(null)}>
                  {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                    const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                    const d = ds.find((x) => x.dia === dia);
                    const hh = d ? Math.max(0, hospDia(d)) : 0, rr = d ? Math.max(0, restDia(d)) : 0;
                    return (
                      <div key={dia} role="listitem" className={`tp-coluna${foco === dia ? " on" : ""}`} tabIndex={d ? 0 : -1}
                        onMouseEnter={() => setFoco(dia)} onFocus={() => setFoco(dia)} onBlur={() => setFoco(null)}
                        aria-label={d ? `${dataBr(dia)}: hospedagem ${reais(hospDia(d))}, restaurante ${reais(restDia(d))}` : `${dataBr(dia)}: sem lançamentos`}>
                        {d && hh + rr > 0 && (
                          <span className="tp-pilha" style={{ height: `${Math.max(1, ((hh + rr) / escala) * 100)}%` }}>
                            {hh > 0 && <i className="h" style={{ flexGrow: hh }} />}
                            {rr > 0 && <i className="r" style={{ flexGrow: rr }} />}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="tp-dias" aria-hidden="true">
                {Array.from({ length: diasNoMes(mes) }, (_, i) => {
                  const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                  const marco = i === 0 || (i + 1) % 5 === 0;
                  return <span key={dia} className={`${[0, 6].includes(diaSemana(dia)) ? "fds" : ""}${marco ? " marco" : ""}`}>{i + 1}</span>;
                })}
              </div>
            </div>
            <ul className="tp-legenda tp-legenda-dias">
              <li><i className="tp-cor-hosp" />Hospedagem</li>
              <li><i className="tp-cor-comida" />Restaurante</li>
            </ul>
          </section>

          <div className="tp-duas">
            <section className="tp-painel">
              <div className="tp-painel-topo"><h3>De onde vem o faturamento</h3><span className="tp-nota">{reais(s.total)}</span></div>
              <ListaBarras itens={composicao} total={s.total} />
            </section>
            <section className="tp-painel">
              <div className="tp-painel-topo"><h3>Como foi pago</h3><span className="tp-nota">{pagamentos === null ? "Carregando…" : `${reais(recebido)} recebidos no mês`}</span></div>
              {pagamentos && pagamentos.length > 0
                ? <ListaBarras itens={pagamentos.map((x) => ({ nome: x.forma, valor: x.valor, nota: `${inteiro(x.vezes)}×` }))} total={recebido} />
                : pagamentos && <p className="tp-nota">Nenhum pagamento lançado neste mês.</p>}
              <p className="tp-nota tp-obs">O que entrou no caixa no mês, de qualquer estadia (inclui adiantamentos de reservas futuras).</p>
            </section>
          </div>

          <div className="tp-duas">
            <section className="tp-painel">
              <div className="tp-painel-topo"><h3>Canais das reservas</h3><span className="tp-nota">chegadas no mês, sem canceladas e no-show</span></div>
              {canais === null ? <p className="tp-nota">Carregando…</p> : canais.length === 0 ? <p className="tp-nota">Nenhuma chegada neste mês.</p> : (
                <ul className="tp-lista">
                  {canais.map((c) => (
                    <li key={c.canal}>
                      <span>{c.canal}<small>{inteiro(c.reservas)} {c.reservas === 1 ? "reserva" : "reservas"}</small></span>
                      <span className="tp-linha" aria-hidden="true"><i style={{ width: `${(c.noites / Math.max(...canais.map((x) => x.noites), 1)) * 100}%` }} /></span>
                      <b>{inteiro(c.noites)} {c.noites === 1 ? "noite" : "noites"}{c.valor > 0 && <small>{reais(c.valor)}</small>}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="tp-painel">
              <div className="tp-painel-topo"><h3>Restaurante</h3><span className="tp-nota">{reais(s.restaurante)}</span></div>
              {temTotvs ? (
                <p className="tp-nota">O restaurante do {nomeHotel(h)} vende pelo caixa da TOTVS ({reais(s.restauranteTotvs)}); produtos, garçons e pagamentos estão logo abaixo.
                  {s.migrado > 0 ? ` Desse valor, ${reais(s.migrado)} foram para a conta do quarto e não foram somados de novo.` : ""}</p>
              ) : (
                <ul className="tp-lista tp-lista-dados">
                  <li><span>Consumo lançado nas contas</span><b>{reais(s.restauranteContas)}</b></li>
                  <li><span>Lançamentos</span><b>{inteiro(s.lancamentos)}</b></li>
                  <li><span>Valor médio por lançamento</span><b>{s.lancamentos ? reais(s.restauranteContas / s.lancamentos) : "—"}</b></li>
                  <li><span>Dias com consumo</span><b>{inteiro(s.diasRestaurante)}</b></li>
                  {s.frigobar > 0 && <li><span>Frigobar</span><b>{reais(s.frigobar)}</b></li>}
                </ul>
              )}
              {!temTotvs && <p className="tp-nota tp-obs">O PMS recebe do restaurante só o total de cada conta (com os 10%). Os itens vendidos ficam no PDV do hotel: estamos testando os relatórios do PMS que trazem esse detalhe.</p>}
            </section>
          </div>

          <section className="tp-painel">
            <div className="tp-painel-topo">
              <h3>Dia a dia</h3>
              <button type="button" className="ghost small" onClick={() => setVerDias((v) => !v)} aria-expanded={verDias}>
                {verDias ? "Esconder" : "Ver a tabela"}
              </button>
            </div>
            {verDias && (
              <div className="tp-hotel-tabela-caixa">
                <table className="tp-hotel-tabela">
                  <thead><tr><th>Dia</th><th>Hospedagem</th><th>Restaurante</th><th>Total</th></tr></thead>
                  <tbody>
                    {comValor.map((d) => (
                      <tr key={d.dia}>
                        <td>{dataBr(d.dia)} <small>{SEMANA[diaSemana(d.dia)].slice(0, 3)}</small></td>
                        <td>{r0(hospDia(d))}</td>
                        <td>{r0(restDia(d))}</td>
                        <td>{r0(hospDia(d) + restDia(d))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
