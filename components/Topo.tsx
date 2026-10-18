"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export default function Topo({ email, ativo }: { email: string; ativo?: "projetos" | "conectar" }) {
  const [tema, setTema] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTema(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  // Troca o tema com um círculo que se abre a partir do botão
  function trocarTema(e: React.MouseEvent<HTMLButtonElement>) {
    const t = tema === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("brasico-tema", t);
    } catch {}
    const aplicar = () => {
      document.documentElement.dataset.theme = t;
      setTema(t);
    };
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || semMovimento) return aplicar();

    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const vt = doc.startViewTransition(() => flushSync(aplicar));
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(.65,0,.35,1)", pseudoElement: "::view-transition-new(root)" }
      );
    });
  }

  async function sair() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <header className="topo">
      <a className="marca" href="/">Brasico</a>
      <nav className="topo-nav">
        <a className={ativo === "projetos" ? "ativo" : ""} href="/">Projetos</a>
        <a className={ativo === "conectar" ? "ativo" : ""} href="/conectar">Claude e equipe</a>
      </nav>
      <div className="spacer" />
      <span className="topo-email">{email}</span>
      <button
        className={tema === "dark" ? "tema-switch escuro" : "tema-switch"}
        onClick={trocarTema}
        role="switch"
        aria-checked={tema === "dark"}
        title={tema === "dark" ? "Modo claro" : "Modo escuro"}
        aria-label="Modo escuro"
      >
        <span className="tema-estrelas" aria-hidden>
          <i /><i /><i /><i />
        </span>
        <span className="tema-nuvens" aria-hidden>
          <i /><i />
        </span>
        <span className="tema-bola" aria-hidden>
          <span className="tema-sol" />
          <span className="tema-lua">
            <i /><i /><i />
          </span>
        </span>
      </button>
      <button className="ghost small" onClick={sair}>Sair</button>
    </header>
  );
}
