"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

// Cabeçalho das páginas dos hotéis: nome, situação ao vivo (última leitura do PMS em pms_horas) e as abas.

export type Vista = "gerencial" | "reservas" | "mapa" | "hospedes" | "transacoes" | "relatorios";
type Hora = { lido_em: string; ocupacao: number | null; ocupadas: number | null; livres: number | null; bloqueadas: number | null;
  checkins: number | null; checkouts: number | null; checkins_previstos: number | null; checkouts_previstos: number | null };

const ICONES: Record<Vista, ReactNode> = {
  gerencial: <path d="M4 19V10M10 19V5M16 19v-7M22 19H2" />,
  reservas: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h3M8 17h6" /></>,
  mapa: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
  hospedes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.6 5.2" /></>,
  transacoes: <><path d="M7 7h13l-3-3M17 17H4l3 3" /></>,
  relatorios: <><path d="M4 20V4h11l5 5v11z" /><path d="M8 13h3v4H8zM13 10h3v7h-3z" /></>,
};
const ABAS: [Vista, string][] = [["gerencial", "Visão geral"], ["reservas", "Reservas"], ["mapa", "Mapa de reservas"], ["hospedes", "Hóspedes"], ["transacoes", "Transações"], ["relatorios", "Relatórios"]];

function ha(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
}

export default function Cabecalho({ hotel, nome, vista, mudar, acoes }: { hotel: string; nome: string; vista: Vista; mudar: (v: Vista) => void; acoes?: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [hora, setHora] = useState<Hora | null>(null);
  const [, setTique] = useState(0);
  useEffect(() => {
    const ler = () => supabase.from("pms_horas").select("*").eq("hotel_id", hotel).order("lido_em", { ascending: false }).limit(1).maybeSingle()
      .then((r) => setHora((r.data as Hora) ?? null));
    ler();
    const t = setInterval(() => { ler(); setTique((x) => x + 1); }, 60000);
    return () => clearInterval(t);
  }, [supabase, hotel]);
  const total = hora ? (hora.ocupadas ?? 0) + (hora.livres ?? 0) + (hora.bloqueadas ?? 0) : 0;
  const recente = hora && Date.now() - Date.parse(hora.lido_em) < 2.5 * 3600000;

  return (
    <header className="hx-cab">
      <div className="hx-cab-topo">
        <div className="hx-cab-titulo">
          <span className="hx-sobre">Hotel · PMS TOTVS Hospitalidade</span>
          <h1>{nome}</h1>
          {hora && <span className={`hx-vivo${recente ? "" : " parado"}`}><i />{recente ? "Ao vivo" : "Leitura atrasada"} · atualizado {ha(hora.lido_em)}</span>}
        </div>
        {hora && (
          <div className="hx-cab-numeros">
            <div><span>Ocupação agora</span><b>{(hora.ocupacao ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>
              <i className="hx-cab-barra"><em style={{ width: `${Math.min(100, hora.ocupacao ?? 0)}%` }} /></i></div>
            <div><span>UHs ocupadas</span><b>{hora.ocupadas ?? 0}<small>/{total}</small></b><em>{hora.livres ?? 0} livres · {hora.bloqueadas ?? 0} bloq.</em></div>
            <div><span>Check-ins</span><b>{hora.checkins ?? 0}<small>/{hora.checkins_previstos ?? 0}</small></b><em>feitos / previstos</em></div>
            <div><span>Check-outs</span><b>{hora.checkouts ?? 0}<small>/{hora.checkouts_previstos ?? 0}</small></b><em>feitos / previstos</em></div>
          </div>
        )}
      </div>
      <nav className="hx-abas" aria-label="Seções do hotel">
        {ABAS.map(([v, t]) => (
          <button key={v} type="button" className={vista === v ? "on" : ""} aria-current={vista === v ? "page" : undefined} onClick={() => mudar(v)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONES[v]}</svg>
            {t}
          </button>
        ))}
        {acoes && <div className="hx-abas-acoes">{acoes}</div>}
      </nav>
    </header>
  );
}
