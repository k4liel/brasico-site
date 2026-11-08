"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Estadia, antecedencia, canalNome, dataBr, faseDe, nomeStatus } from "@/lib/hotel-reservas";
import DetalheReserva from "./DetalheReserva";
import { grupoDe, valorHotel } from "./Transacoes";
import { Segmentos, moeda, num } from "./ui";

// Painel lateral com tudo de uma reserva: resumo, detalhes, observações, hóspedes, histórico de alterações e transações.
// Abre ao clicar numa reserva na aba Reservas e no Mapa de reservas.

type Tx = { chave: string; dia: string; grupo: string | null; descricao: string | null; valor: number; estornado: boolean };
type Parte = "resumo" | "transacoes";
const COR_FASE: Record<string, string> = { reservada: "var(--fase-reservada)", pendente: "var(--fase-pendente)", hospedada: "var(--fase-hospedada)",
  finalizada: "var(--fase-finalizada)", noshow: "var(--fase-noshow)", cancelada: "var(--fase-cancelada)" };

export default function GavetaReserva({ hotel, estadia: e, fechar }: { hotel: string; estadia: Estadia; fechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [parte, setParte] = useState<Parte>("resumo");

  useEffect(() => {
    setTxs(null); setParte("resumo");
    if (!e.codigo) { setTxs([]); return; }
    supabase.from("pms_transacoes").select("chave,dia,grupo,descricao,valor,estornado").eq("hotel_id", hotel).eq("reserva", e.codigo).order("dia").limit(500)
      .then((r) => setTxs(((r.data as Tx[]) ?? []).map((t) => ({ ...t, grupo: grupoDe(t) }))));
  }, [supabase, hotel, e.codigo, e.item_id]);
  useEffect(() => {
    const f = (ev: KeyboardEvent) => { if (ev.key === "Escape") fechar(); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [fechar]);

  const lancado = (txs ?? []).filter((t) => t.grupo !== "Pagamento").reduce((a, t) => a + valorHotel(t), 0);
  const pago = (txs ?? []).filter((t) => t.grupo === "Pagamento").reduce((a, t) => a + valorHotel(t), 0);

  return (
    <>
      <div className="hx-veu" onClick={fechar} />
      <aside className="hx-gaveta hx-gaveta-larga" role="dialog" aria-label={`Reserva ${e.codigo ?? ""}`}>
        <header>
          <div><span className="hx-sobre mono">{e.codigo}</span><h3>{e.vip ? "★ " : ""}{e.hospede || "Hóspede não informado"}</h3>
            <span className="hx-etiqueta" style={{ ["--c" as string]: COR_FASE[faseDe(e)] }}>{nomeStatus(e)}</span>
            {e.teve_noshow && e.status_id !== 5 && <span className="hx-etiqueta" style={{ ["--c" as string]: "var(--fase-noshow)", marginLeft: 6 }}>Passou por no-show</span>}</div>
          <button type="button" className="hx-fechar" aria-label="Fechar" onClick={fechar}>×</button>
        </header>
        <Segmentos valor={parte} mudar={setParte} rotulo="Parte da reserva"
          opcoes={[["resumo", "Reserva, observações e histórico"], ["transacoes", `Transações${txs?.length ? ` (${txs.length})` : ""}`]]} />

        {parte === "resumo" && (<>
          <div className="hx-gaveta-grade">
            <div><span>Chegada</span><b>{dataBr(e.checkin)}{e.checkin_original && e.checkin_original < (e.checkin ?? "") && <small>reservada para {dataBr(e.checkin_original)}</small>}</b></div>
            <div><span>Saída</span><b>{dataBr(e.checkout)}</b></div>
            <div><span>Noites</span><b>{num(e.noites)}</b></div>
            <div><span>Hóspedes</span><b>{e.adultos ?? 0} adultos{e.criancas ? ` · ${e.criancas} crianças` : ""}</b></div>
            <div><span>UH</span><b>{e.uh_numero ?? "sem UH"}</b></div>
            <div><span>Tipo</span><b>{e.tipo ?? "—"}</b></div>
            <div><span>Canal</span><b>{canalNome(e)}</b></div>
            <div><span>Tarifa</span><b>{e.tarifa ?? "—"}</b></div>
            {e.grupo_nome && <div><span>Grupo</span><b>{e.grupo_nome}</b></div>}
            {e.empresa && <div><span>Empresa</span><b>{e.empresa}</b></div>}
            <div><span>Criada em</span><b>{e.criada_em ? dataBr(e.criada_em.slice(0, 10)) : "—"}</b></div>
            <div><span>Antecedência</span><b>{antecedencia(e) == null ? "—" : `${Math.round(antecedencia(e)!)} dias`}</b></div>
          </div>
          <div className="hx-gaveta-somas">
            <div><span>Lançado na conta</span><b>{txs === null ? "…" : moeda(lancado)}</b></div>
            <div><span>Pago</span><b>{txs === null ? "…" : moeda(pago)}</b></div>
          </div>
          {e.valor_diarias != null && <div className="hx-gaveta-total"><span>Diárias informadas pelo canal</span><b>{moeda(Number(e.valor_diarias))}</b></div>}
          <DetalheReserva hotel={hotel} item={e.item_id} />
        </>)}

        {parte === "transacoes" && (
          txs === null ? <p className="muted">Carregando…</p> : txs.length === 0 ? <p className="muted">Nenhuma transação desta reserva no banco ainda.</p> : (<>
            <ul className="hx-gaveta-tx">
              {txs.map((t) => (
                <li key={t.chave} className={t.estornado ? "estornado" : ""}>
                  <span className="mono">{dataBr(t.dia).slice(0, 5)}</span><span>{t.descricao}<small>{t.grupo}{t.estornado ? " · estornado" : ""}</small></span>
                  <b className={valorHotel(t) < 0 ? "neg" : ""}>{moeda(valorHotel(t))}</b>
                </li>
              ))}
            </ul>
            <div className="hx-gaveta-somas">
              <div><span>Lançado</span><b>{moeda(lancado)}</b></div>
              <div><span>Pago</span><b>{moeda(pago)}</b></div>
            </div>
          </>)
        )}
      </aside>
    </>
  );
}
