"use client";

import { useEffect, useState } from "react";
import Topo from "./Topo";
import HotelMapa from "./HotelMapa";
import Cabecalho, { type Vista } from "./hotel/Cabecalho";
import VisaoGeral from "./hotel/VisaoGeral";
import Reservas from "./hotel/Reservas";
import Transacoes from "./hotel/Transacoes";
import Hospedes from "./hotel/Hospedes";
import Relatorios from "./hotel/Relatorios";

// Página de um hotel (grupo Hotéis do menu, /hoteis/<hotel>): só os dados do PMS, nas abas.
// Os documentos das festas (cardápios, fichas, compras) voltaram para a área de projetos em 13/11/2026
// ("Filha da Lua Ecolodge" e "Sempre vivo fim do ano"); hoteis_capitulos ficou só como cópia antiga.

export default function Hotel({ hotel, nome, userEmail }: { hotel: string; nome: string; userEmail: string }) {
  // Visão geral, Reservas, Mapa de reservas, Hóspedes, Transações e Relatórios (dados do PMS)
  const [vista, setVista] = useState<Vista>("gerencial");

  useEffect(() => {
    const h = window.location.hash;
    if (h === "#reservas") setVista("reservas");
    else if (h === "#mapa") setVista("mapa");
    else if (h === "#transacoes") setVista("transacoes");
    else if (h === "#hospedes") setVista("hospedes");
    else if (h === "#relatorios") setVista("relatorios");
  }, []);
  function trocarVista(v: Vista) {
    setVista(v);
    try { history.replaceState(null, "", v === "gerencial" ? window.location.pathname : `#${v}`); } catch {}
  }

  return (
    <div className="pagina pagina-doc modo-pagina">
      <Topo email={userEmail} ativo={`hotel:${hotel}`} />

      <Cabecalho hotel={hotel} nome={nome} vista={vista} mudar={trocarVista} />

      {vista === "gerencial" ? (
        <main className="hx-pagina"><VisaoGeral hotel={hotel} /></main>
      ) : vista === "reservas" ? (
        <main className="hx-pagina"><Reservas hotel={hotel} nome={nome} /></main>
      ) : vista === "mapa" ? (
        <main className="hx-pagina hx-largo"><HotelMapa hotel={hotel} /></main>
      ) : vista === "relatorios" ? (
        <main className="hx-pagina"><Relatorios hotel={hotel} nome={nome} /></main>
      ) : vista === "hospedes" ? (
        <main className="hx-pagina"><Hospedes hotel={hotel} nome={nome} /></main>
      ) : (
        <main className="hx-pagina"><Transacoes hotel={hotel} nome={nome} /></main>
      )}
    </div>
  );
}
