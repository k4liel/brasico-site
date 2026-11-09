"use client";

// A escala de uma casa (09/11/2026): a troca rápida entre Planejada (editável), Ponto (RHiD) e Comparar, só com
// os grupos da casa (lib/escala/casas.ts). Usada na aba Escala de cada hotel, nas páginas /escala/<casa>
// (Cicchetti Centro e Outras casas) e na página dos líderes. A escala do RH fica só para ver.
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import EscalaPlanejada, { ModosEscala } from "./EscalaPlanejada";
import type { ModoEscala } from "./PontoEscala";

export default function EscalaCasa({ supabase, casa }: { supabase: SupabaseClient; casa: string }) {
  const [modo, setModo] = useState<ModoEscala>("planejada");
  useEffect(() => {
    try {
      const m = localStorage.getItem("brasico-escala-casa-modo");
      if (m === "real" || m === "planejada" || m === "comparar") setModo(m);
    } catch {}
  }, []);
  function mudar(m: ModoEscala) {
    setModo(m);
    try { localStorage.setItem("brasico-escala-casa-modo", m); } catch {}
  }
  return (
    <div className="es ep-casa">
      <ModosEscala modo={modo} onMudar={mudar} />
      <EscalaPlanejada key={casa} supabase={supabase} modo={modo} casa={casa} />
    </div>
  );
}
