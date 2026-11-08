"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { moeda } from "./ui";

// Detalhes, observações, hóspedes e histórico de alterações de uma reserva do PMS (pms_reserva_detalhes,
// pms_reserva_hospedes, pms_reserva_historico). Usado na ficha do hóspede e no painel lateral da aba Reservas.

type Detalhes = {
  reserva_codigo: string | null; codigo: string | null; criada_por: string | null; criada_em: string | null; alterada_por: string | null; alterada_em: string | null;
  total: number | null; segmento: string | null; origem: string | null; tarifa: string | null; grupo: string | null; tipo_hospede: string | null;
  obs_internas: string | null; obs_externas: string | null; obs_item_internas: string | null; obs_item_externas: string | null; numero_externo: string | null;
  hospede_nome: string | null; hospede_email: string | null; hospede_telefone: string | null; hospede_celular: string | null;
  detalhes_em: string; historico_em: string | null;
};
type HospRes = { guest_item_id: number; guest_id: number | null; nome: string | null; principal: boolean; crianca: boolean; idade_crianca: number | null; vip: boolean };
type Evento = { evento_id: string; quando: string | null; usuario: string | null; tipo: string | null; acao: string | null; campos: { campo: string | null; nome: string | null; antes: string | null; depois: string | null }[] };

const TIPO: Record<string, string> = {
  Reservation: "Reserva", ReservationItem: "Quarto da reserva", GuestReservationItem: "Hóspede", GuestRegistration: "Ficha do hóspede (FNRH)",
  ReservationConfirmation: "Confirmação", ReservationBudget: "Valores", BillingAccount: "Conta",
};
const ACAO: Record<string, string> = { Created: "criado", Updated: "alterado", Deleted: "excluído" };
export const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default function DetalheReserva({ hotel, item, abrirHospede }: { hotel: string; item: number; abrirHospede?: (guestId: number) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<Detalhes | null | undefined>(undefined);
  const [hosp, setHosp] = useState<HospRes[]>([]);
  const [hist, setHist] = useState<Evento[]>([]);
  const [tudo, setTudo] = useState(false);

  useEffect(() => {
    setD(undefined); setHosp([]); setHist([]); setTudo(false);
    if (!item || item < 0) { setD(null); return; }
    (async () => {
      const [a, b, c] = await Promise.all([
        supabase.from("pms_reserva_detalhes").select("*").eq("hotel_id", hotel).eq("item_id", item).maybeSingle(),
        supabase.from("pms_reserva_hospedes").select("guest_item_id,guest_id,nome,principal,crianca,idade_crianca,vip").eq("hotel_id", hotel).eq("item_id", item).order("principal", { ascending: false }),
        supabase.from("pms_reserva_historico").select("evento_id,quando,usuario,tipo,acao,campos").eq("hotel_id", hotel).eq("item_id", item).order("quando", { ascending: false }).limit(300),
      ]);
      setD((a.data as Detalhes) ?? null); setHosp((b.data as HospRes[]) ?? []); setHist((c.data as Evento[]) ?? []);
    })();
  }, [supabase, hotel, item]);

  if (d === undefined) return <p className="muted">Carregando detalhes…</p>;
  if (d === null) return <p className="muted">Os detalhes desta reserva ainda não foram lidos do PMS. O robô traz aos poucos (as reservas ativas primeiro).</p>;
  const obs = [["Observação interna", d.obs_internas], ["Observação externa", d.obs_externas], ["Observação interna do quarto", d.obs_item_internas], ["Observação externa do quarto", d.obs_item_externas]]
    .filter(([, v]) => v) as [string, string][];
  const vis = tudo ? hist : hist.slice(0, 8);

  return (
    <div className="hx-detalhe">
      <div className="hx-gaveta-grade">
        <div><span>Reserva</span><b className="mono">{d.reserva_codigo ?? "—"}</b></div>
        <div><span>Nº no canal</span><b className="mono">{d.numero_externo ?? "—"}</b></div>
        <div><span>Criada por</span><b>{d.criada_por ?? "—"}<small>{quando(d.criada_em)}</small></b></div>
        <div><span>Última alteração</span><b>{d.alterada_por ?? "—"}<small>{quando(d.alterada_em)}</small></b></div>
        <div><span>Origem</span><b>{d.origem ?? "—"}</b></div>
        <div><span>Segmento</span><b>{d.segmento ?? "—"}</b></div>
        <div><span>Tarifa</span><b>{d.tarifa ?? "—"}</b></div>
        <div><span>Total da reserva</span><b>{d.total == null ? "—" : moeda(Number(d.total))}</b></div>
        {d.grupo && <div><span>Grupo</span><b>{d.grupo}</b></div>}
        {d.tipo_hospede && <div><span>Tipo de hóspede</span><b>{d.tipo_hospede}</b></div>}
      </div>

      {(d.hospede_email || d.hospede_telefone || d.hospede_celular) && (<>
        <h4>Contato do hóspede principal</h4>
        <div className="hx-gaveta-grade">
          {d.hospede_nome && <div><span>Nome</span><b>{d.hospede_nome}</b></div>}
          <div><span>E-mail</span><b>{d.hospede_email ?? "—"}</b></div>
          <div><span>Celular</span><b>{d.hospede_celular ?? "—"}</b></div>
          <div><span>Telefone</span><b>{d.hospede_telefone ?? "—"}</b></div>
        </div>
      </>)}

      <h4>Observações</h4>
      {obs.length ? obs.map(([t, v]) => <div key={t} className="hx-obs"><span>{t}</span><p>{v}</p></div>) : <p className="muted">Sem observações.</p>}

      {hosp.length > 0 && (<>
        <h4>Hóspedes da reserva</h4>
        <ul className="hx-lista-hosp">
          {hosp.map((g) => (
            <li key={g.guest_item_id}>
              {g.guest_id && abrirHospede ? <button type="button" className="hx-link" onClick={() => abrirHospede(g.guest_id!)}>{g.vip ? "★ " : ""}{g.nome ?? "—"}</button> : <b>{g.vip ? "★ " : ""}{g.nome ?? "—"}</b>}
              <small>{g.principal ? "principal" : g.crianca ? `criança${g.idade_crianca != null ? ` · ${g.idade_crianca} anos` : ""}` : "acompanhante"}</small>
            </li>
          ))}
        </ul>
      </>)}

      <h4>Histórico da reserva {hist.length > 0 && <small className="muted">· {hist.length} registros</small>}</h4>
      {hist.length === 0 ? <p className="muted">{d.historico_em ? "Sem alterações registradas." : "O histórico ainda não foi lido do PMS."}</p> : (
        <ol className="hx-linha-tempo">
          {vis.map((e) => (
            <li key={e.evento_id}>
              <div className="hx-lt-topo"><b>{TIPO[e.tipo ?? ""] ?? e.tipo ?? "Registro"} {ACAO[e.acao ?? ""] ?? e.acao ?? ""}</b><span>{quando(e.quando)} · {e.usuario ?? "sistema"}</span></div>
              {e.campos.length > 0 && (
                <ul>
                  {e.campos.slice(0, 14).map((c, i) => (
                    <li key={i}><span>{c.nome ?? c.campo}</span>{c.antes != null && <><del>{c.antes}</del> → </>}<b>{c.depois ?? "(vazio)"}</b></li>
                  ))}
                  {e.campos.length > 14 && <li className="muted">+ {e.campos.length - 14} campos</li>}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {hist.length > 8 && <button type="button" className="hx-mais" onClick={() => setTudo(!tudo)}>{tudo ? "Mostrar menos" : `Ver todo o histórico (${hist.length})`}</button>}
    </div>
  );
}
