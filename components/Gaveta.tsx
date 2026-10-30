"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------
// Gaveta lateral (painel por cima da página)
// ---------------------------------------------------------------------
export default function Gaveta({ titulo, sub, fechar, children, topo }: { titulo: string; sub?: string; fechar: () => void; children: React.ReactNode; topo?: React.ReactNode }) {
  // Esc fecha; a página por trás não rola enquanto o painel está aberto
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    const f = (ev: KeyboardEvent) => ev.key === "Escape" && fecharRef.current();
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, []);
  return (
    <div className="fx-fundo" onClick={fechar}>
      <aside className="fx-gaveta" role="dialog" aria-label={titulo} onClick={(ev) => ev.stopPropagation()}>
        <header className="fx-gaveta-topo">
          <div><h2>{titulo}</h2>{sub && <p>{sub}</p>}</div>
          <button className="fx-fechar" onClick={fechar} aria-label="Fechar">×</button>
        </header>
        {topo}
        <div className="fx-gaveta-corpo">{children}</div>
      </aside>
    </div>
  );
}

