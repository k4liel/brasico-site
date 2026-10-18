"use client";

import { useEffect, useRef, useState } from "react";
import { TEXTOS, type Idioma } from "@/lib/idioma";

type Dica = { x: number; y: number; acima: boolean; quem: string; dia: string; h: string; t: string; i: string };

// Balão das escalas (:::escala): mostra o horário e o intervalo do quadradinho
// sob o mouse — ou tocado, no celular.
export default function EscalaDica({ idioma = "pt" }: { idioma?: Idioma }) {
  const [dica, setDica] = useState<Dica | null>(null);
  const ativo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function limpar() {
      ativo.current?.classList.remove("esc-ativo");
      ativo.current = null;
      setDica(null);
    }
    function mostrar(td: HTMLElement) {
      if (ativo.current === td) return;
      ativo.current?.classList.remove("esc-ativo");
      ativo.current = td;
      td.classList.add("esc-ativo");
      const linha = td.closest("tr");
      const tabela = td.closest("table");
      const col = Array.from(linha?.children ?? []).indexOf(td);
      const th = tabela?.querySelectorAll("thead th")[col] as HTMLElement | undefined;
      const quem = linha?.querySelector(".esc-pessoa")?.textContent ?? "";
      const dia = th ? `${th.querySelector("span")?.textContent ?? ""} ${th.querySelector("b")?.textContent ?? ""}`.trim() : "";
      const r = td.getBoundingClientRect();
      const acima = r.top > 130;
      setDica({
        x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140),
        y: acima ? r.top - 10 : r.bottom + 10,
        acima,
        quem,
        dia,
        h: td.dataset.h ?? "",
        t: td.dataset.t ?? "",
        i: td.dataset.i ?? "",
      });
    }
    const alvo = (e: Event) => (e.target as HTMLElement | null)?.closest?.("td.esc-c[data-h]") as HTMLElement | null;
    const over = (e: MouseEvent) => {
      const td = alvo(e);
      if (td) mostrar(td);
      else if (ativo.current) limpar();
    };
    const toque = (e: Event) => {
      const td = alvo(e);
      if (td) mostrar(td);
      else limpar();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("click", toque);
    window.addEventListener("scroll", limpar, true);
    window.addEventListener("resize", limpar);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("click", toque);
      window.removeEventListener("scroll", limpar, true);
      window.removeEventListener("resize", limpar);
    };
  }, []);

  if (!dica) return null;
  return (
    <div
      className="esc-dica on"
      role="tooltip"
      style={{ left: dica.x, top: dica.y, transform: `translate(-50%, ${dica.acima ? "-100%" : "0"})` }}
    >
      {(dica.quem || dica.dia) && <div className="esc-dica-top">{[dica.quem, dica.dia].filter(Boolean).join(" · ")}</div>}
      <div className="esc-dica-h">
        {dica.h}
        {dica.t && <span className="esc-dica-tipo">{dica.t}</span>}
      </div>
      {dica.i && (
        <div className="esc-dica-i">
          <span>{TEXTOS[idioma].intervalo}</span>
          <b>{dica.i}</b>
        </div>
      )}
    </div>
  );
}
