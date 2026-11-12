"use client";

import { useState } from "react";
import { Variacao } from "./TotvsPartes";
import { SEMANA, dataBr, diaSemana, diasNoMes, maiuscula, nomeMes, pct, reais } from "@/lib/totvs-painel";

// Faturamento dos hotéis na página de vendas, a partir dos lançamentos do PMS (função vendas_hoteis_dia,
// supabase/vendas_hoteis.sql). Restaurante do hotel com caixa na TOTVS (Filha da Lua): vale o total do caixa,
// que já inclui o que foi para a conta do quarto; o mesmo valor que o PMS recebe da TOTVS não é somado de novo.

export type HotelDia = {
  hotel_id: string; dia: string; hospedagem: number; restaurante_pms: number; restaurante_totvs: number;
  restaurante_migrado: number; spa: number; outros: number; taxas: number;
};
export type HotelInfo = { id: string; nome: string; totvs_unidade: string | null };

const NOME_CURTO: Record<string, string> = { "filha-da-lua": "Filha da Lua", "sempre-vivo": "Sempre Vivo" };
export const nomeHotel = (h: HotelInfo) => NOME_CURTO[h.id] ?? h.nome;

const n = (v: unknown) => Number(v ?? 0);
// Na tabela do dia a dia, sem centavos (cabe no cartão)
const r0 = (v: number) => Math.round(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export function somarHotel(ds: HotelDia[]) {
  const s = { hospedagem: 0, restaurante: 0, restauranteTotvs: 0, migrado: 0, spa: 0, taxas: 0, total: 0 };
  for (const d of ds) {
    s.hospedagem += n(d.hospedagem);
    s.restaurante += n(d.restaurante_pms) + n(d.restaurante_totvs);
    s.restauranteTotvs += n(d.restaurante_totvs);
    s.migrado += n(d.restaurante_migrado);
    s.spa += n(d.spa) + n(d.outros);
    s.taxas += n(d.taxas);
  }
  s.total = s.hospedagem + s.restaurante + s.spa + s.taxas;
  return s;
}
const totalDia = (d: HotelDia) => n(d.hospedagem) + n(d.restaurante_pms) + n(d.restaurante_totvs) + n(d.spa) + n(d.outros) + n(d.taxas);

const PARTES = [
  { chave: "hospedagem", nome: "Hospedagem", cor: "tp-cor-hosp" },
  { chave: "restaurante", nome: "Restaurante", cor: "tp-cor-comida" },
  { chave: "spa", nome: "Spa e serviços", cor: "tp-cor-outros" },
  { chave: "taxas", nome: "Taxas (serviço e ISS)", cor: "tp-cor-taxas" },
] as const;

function CartaoHotel({ h, mes, ds, anterior, hoje }: { h: HotelInfo; mes: string; ds: HotelDia[]; anterior: HotelDia[]; hoje: string }) {
  const [verDias, setVerDias] = useState(false);
  const s = somarHotel(ds);
  const comValor = ds.filter((d) => totalDia(d) !== 0);
  const ultimo = comValor[comValor.length - 1]?.dia;
  const limite = ultimo ? +ultimo.slice(8, 10) : 0;
  const ant = somarHotel(anterior.filter((d) => +d.dia.slice(8, 10) <= limite));
  const mesAtual = mes === hoje.slice(0, 7);
  const diasCorridos = mesAtual ? +hoje.slice(8, 10) : diasNoMes(mes);
  const partes = PARTES.map((p) => ({ ...p, valor: s[p.chave] })).filter((p) => p.valor !== 0);
  const positivo = partes.filter((p) => p.valor > 0).reduce((a, p) => a + p.valor, 0);

  return (
    <article className="tp-painel tp-hotel">
      <div className="tp-hotel-topo">
        <span className="tp-unidade-nome">{nomeHotel(h)}</span>
        <b className="tp-numero tp-numero-xl">{reais(s.total)}</b>
        <span className="tp-nota">
          {ultimo ? `Até ${dataBr(ultimo)} · média de ${reais(s.total / Math.max(1, Math.min(diasCorridos, limite)))} por dia` : "Sem lançamentos neste mês"}
        </span>
        {ant.total > 0 && limite > 0 && (
          <span className="tp-nota">
            <b className="tp-var-inline"><Variacao v={s.total / ant.total - 1} /></b> contra o mês anterior até o dia {limite} ({reais(ant.total)})
          </span>
        )}
      </div>

      {positivo > 0 && (
        <div className="tp-mix-barra" role="img" aria-label={partes.map((p) => `${p.nome} ${pct(p.valor / s.total)}`).join(", ")}>
          {partes.filter((p) => p.valor > 0).map((p) => <i key={p.chave} className={p.cor} style={{ flexGrow: p.valor }} title={`${p.nome}: ${reais(p.valor)}`} />)}
        </div>
      )}
      <ul className="tp-hotel-partes">
        {partes.map((p) => (
          <li key={p.chave}>
            <i className={p.cor} aria-hidden="true" />
            <span>{p.nome}</span>
            <b>{reais(p.valor)}</b>
            <em>{s.total ? pct(p.valor / s.total) : ""}</em>
          </li>
        ))}
      </ul>

      {h.totvs_unidade && s.restauranteTotvs > 0 && (
        <p className="tp-nota tp-hotel-obs">
          Restaurante pelo caixa da TOTVS ({reais(s.restauranteTotvs)}), que já inclui o que foi para a conta do quarto
          {s.migrado > 0 ? ` (${reais(s.migrado)} que o PMS recebeu da TOTVS e não foram somados de novo)` : ""}.
          {s.restaurante - s.restauranteTotvs > 0 ? ` Frigobar e consumo lançados no PMS: ${reais(s.restaurante - s.restauranteTotvs)}.` : ""}
        </p>
      )}

      {comValor.length > 0 && (
        <>
          <button type="button" className="ghost small tp-hotel-dias-botao" onClick={() => setVerDias((v) => !v)} aria-expanded={verDias}>
            {verDias ? "Esconder o dia a dia" : "Ver o dia a dia"}
          </button>
          {verDias && (
            <div className="tp-hotel-tabela-caixa">
              <table className="tp-hotel-tabela">
                <thead>
                  <tr><th>Dia</th><th>Hospedagem</th><th>Restaurante</th><th>Spa e serv.</th><th>Taxas</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {comValor.map((d) => (
                    <tr key={d.dia}>
                      <td>{dataBr(d.dia)} <small>{SEMANA[diaSemana(d.dia)].slice(0, 3)}</small></td>
                      <td>{r0(n(d.hospedagem))}</td>
                      <td>{r0(n(d.restaurante_pms) + n(d.restaurante_totvs))}</td>
                      <td>{r0(n(d.spa) + n(d.outros))}</td>
                      <td>{r0(n(d.taxas))}</td>
                      <td>{r0(totalDia(d))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export default function VendasHoteis({ hoteis, dados, mes, anterior, hoje }: {
  hoteis: HotelInfo[]; dados: HotelDia[]; mes: string; anterior: string; hoje: string;
}) {
  if (!hoteis.length) return null;
  const doMes = dados.filter((d) => d.dia.startsWith(mes) && d.dia <= hoje);
  const doAnterior = dados.filter((d) => d.dia.startsWith(anterior));
  const total = hoteis.reduce((a, h) => a + somarHotel(doMes.filter((d) => d.hotel_id === h.id)).total, 0);
  return (
    <section className="tp-hoteis" aria-label="Faturamento dos hotéis">
      <div className="tp-titulo">
        <div>
          <h2>Hotéis</h2>
          <span className="tp-nota">
            {maiuscula(nomeMes(mes))} · {reais(total)} {hoteis.length === 1 ? "no hotel" : `nos ${hoteis.length} hotéis`} · tudo o que foi lançado nas contas do PMS (diárias, restaurante, spa e taxas), já descontados os estornos
          </span>
        </div>
      </div>
      <div className="tp-hoteis-grade">
        {hoteis.map((h) => (
          <CartaoHotel key={`${h.id}-${mes}`} h={h} mes={mes} hoje={hoje}
            ds={doMes.filter((d) => d.hotel_id === h.id)} anterior={doAnterior.filter((d) => d.hotel_id === h.id)} />
        ))}
      </div>
    </section>
  );
}
