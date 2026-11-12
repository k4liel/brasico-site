"use client";

import { useState } from "react";
import { Variacao } from "./TotvsPartes";
import { SEMANA, dataBr, diaSemana, diasNoMes, maiuscula, nomeMes, pct, reais } from "@/lib/totvs-painel";

// Faturamento dos hotéis na página de vendas, a partir dos lançamentos do PMS (função vendas_hoteis_dia,
// supabase/vendas_hoteis.sql). Duas partes, pedido do dono (12/11/2026): Hospedagem (diárias, taxas de serviço
// e ISS, spa e serviços) e Restaurante. Restaurante do hotel com caixa na TOTVS (Filha da Lua): vale o total
// do caixa, que já inclui o que foi para a conta do quarto; o mesmo valor que o PMS recebe da TOTVS não é somado de novo.

export type HotelDia = {
  hotel_id: string; dia: string; hospedagem: number; restaurante_pms: number; restaurante_totvs: number;
  restaurante_migrado: number; spa: number; outros: number; taxas: number;
};
export type HotelInfo = { id: string; nome: string; totvs_unidade: string | null };

const NOME: Record<string, string> = { "filha-da-lua": "Hotel Filha da Lua", "sempre-vivo": "Hotel Sempre Vivo" };
export const nomeHotel = (h: HotelInfo) => NOME[h.id] ?? h.nome;

const n = (v: unknown) => Number(v ?? 0);
// Na tabela do dia a dia, sem centavos (cabe no cartão)
const r0 = (v: number) => Math.round(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const hospDia = (d: HotelDia) => n(d.hospedagem) + n(d.spa) + n(d.outros) + n(d.taxas);
const restDia = (d: HotelDia) => n(d.restaurante_pms) + n(d.restaurante_totvs);

export function somarHotel(ds: HotelDia[]) {
  const s = { hospedagem: 0, restaurante: 0, restauranteTotvs: 0, migrado: 0, total: 0 };
  for (const d of ds) {
    s.hospedagem += hospDia(d);
    s.restaurante += restDia(d);
    s.restauranteTotvs += n(d.restaurante_totvs);
    s.migrado += n(d.restaurante_migrado);
  }
  s.total = s.hospedagem + s.restaurante;
  return s;
}
// Último dia com lançamento no mês
export const ultimoDiaHotel = (ds: HotelDia[]) => ds.filter((d) => hospDia(d) + restDia(d) !== 0).pop()?.dia;

export function DetalheHotel({ h, mes, ds, anterior, hoje }: { h: HotelInfo; mes: string; ds: HotelDia[]; anterior: HotelDia[]; hoje: string }) {
  const [verDias, setVerDias] = useState(false);
  const s = somarHotel(ds);
  const comValor = ds.filter((d) => hospDia(d) + restDia(d) !== 0);
  const ultimo = comValor[comValor.length - 1]?.dia;
  const limite = ultimo ? +ultimo.slice(8, 10) : 0;
  const ant = somarHotel(anterior.filter((d) => +d.dia.slice(8, 10) <= limite));
  const diasCorridos = mes === hoje.slice(0, 7) ? +hoje.slice(8, 10) : diasNoMes(mes);
  const partes = [
    { nome: "Hospedagem", valor: s.hospedagem, cor: "tp-cor-hosp", nota: "diárias, taxas de serviço e ISS, spa e serviços" },
    { nome: "Restaurante", valor: s.restaurante, cor: "tp-cor-comida",
      nota: h.totvs_unidade && s.restauranteTotvs > 0 ? "caixa da TOTVS, com o que foi para a conta do quarto" : "consumo lançado nas contas do PMS" },
  ];

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
        <section className="tp-painel tp-hotel">
          <div className="tp-hotel-topo">
            <span className="tp-rotulo">Faturamento no mês</span>
            <b className="tp-numero tp-numero-xl">{reais(s.total)}</b>
            <span className="tp-nota">Média de {reais(s.total / Math.max(1, Math.min(diasCorridos, limite)))} por dia</span>
            {ant.total > 0 && (
              <span className="tp-nota">
                <b className="tp-var-inline"><Variacao v={s.total / ant.total - 1} /></b> contra o mês anterior até o dia {limite} ({reais(ant.total)})
              </span>
            )}
          </div>
          <div className="tp-hotel-lado">
            <div className="tp-mix-barra" role="img" aria-label={partes.map((p) => `${p.nome} ${s.total ? pct(p.valor / s.total) : ""}`).join(", ")}>
              {partes.filter((p) => p.valor > 0).map((p) => <i key={p.nome} className={p.cor} style={{ flexGrow: p.valor }} title={`${p.nome}: ${reais(p.valor)}`} />)}
            </div>
            <ul className="tp-hotel-partes">
              {partes.map((p) => (
                <li key={p.nome}>
                  <i className={p.cor} aria-hidden="true" />
                  <span>{p.nome}<small>{p.nota}</small></span>
                  <b>{reais(p.valor)}</b>
                  <em>{s.total ? pct(p.valor / s.total) : ""}</em>
                </li>
              ))}
            </ul>
          </div>
          <div className="tp-hotel-rodape">
            <button type="button" className="ghost small" onClick={() => setVerDias((v) => !v)} aria-expanded={verDias}>
              {verDias ? "Esconder o dia a dia" : "Ver o dia a dia"}
            </button>
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
          </div>
        </section>
      )}
    </>
  );
}
