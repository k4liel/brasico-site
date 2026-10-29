"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export default function Topo({ email, ativo }: { email: string; ativo?: "projetos" | "brainstorm" | "whatsapp" | "vendas" | "esocial" | "receita" | "certificados" | "conectar" | "notas" }) {
  const [tema, setTema] = useState<"light" | "dark">("dark");
  useEffect(() => {
    setTema(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  // Troca o tema com um círculo que se abre a partir do botão
  function trocarTema(e: React.MouseEvent<HTMLButtonElement>) {
    const t = tema === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("brasico-tema-v2", t);
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

  // Menu lateral retrátil (computador e celular)
  const [aberto, setAberto] = useState(false);
  const primeiro = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!aberto) return;
    primeiro.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aberto]);

  const inicial = (email || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <header className="topo">
        <button
          className={aberto ? "menu-botao aberto" : "menu-botao"}
          onClick={() => setAberto((a) => !a)}
          aria-label={aberto ? "Fechar menu" : "Abrir menu"}
          aria-expanded={aberto}
          aria-controls="menu-lateral"
        >
          <span /><span /><span />
        </button>
        <a className="marca" href="/">Brasico</a>
      </header>

      <div className={aberto ? "menu-fundo on" : "menu-fundo"} onClick={() => setAberto(false)} aria-hidden="true" />
      <aside id="menu-lateral" className={aberto ? "menu-lateral aberto" : "menu-lateral"} aria-hidden={!aberto} aria-label="Menu">
        <div className="menu-cabeca">
          <a className="marca" href="/" tabIndex={aberto ? 0 : -1}>Brasico</a>
          <button className="fechar" onClick={() => setAberto(false)} aria-label="Fechar menu" tabIndex={aberto ? 0 : -1}>×</button>
        </div>

        <nav className="menu-nav">
          <a ref={primeiro} className={ativo === "projetos" ? "ativo" : ""} href="/" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
            Projetos
          </a>
          <a className={ativo === "brainstorm" ? "ativo" : ""} href="/brainstorm" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z" /></svg>
            Brainstorm
          </a>
          <a className={ativo === "whatsapp" ? "ativo" : ""} href="/whatsapp" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" /></svg>
            WhatsApp
          </a>
          <a className={ativo === "vendas" ? "ativo" : ""} href="/vendas" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
            TOTVS
          </a>
          <a className={ativo === "esocial" ? "ativo" : ""} href="/esocial" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
            RH · eSocial
          </a>
          <a className={ativo === "receita" ? "ativo" : ""} href="/receita" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3Z" /></svg>
            Receita Federal
          </a>
          <a className={ativo === "certificados" ? "ativo" : ""} href="/certificados" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5" /><path d="M9 13.5 8 21l4-2 4 2-1-7.5" /></svg>
            Certificados digitais
          </a>
          <a className={ativo === "conectar" ? "ativo" : ""} href="/conectar" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 4.5a3 3 0 0 1 0 6M17.5 14.2A5 5 0 0 1 20.5 19" /></svg>
            Claude e equipe
          </a>

          {/* Operação: notas, compras, fichas, estoque e produção (uma página por fase) */}
          <span className="menu-grupo">Operação</span>
          <a className={ativo === "notas" ? "ativo" : ""} href="/notas" tabIndex={aberto ? 0 : -1}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V4a1 1 0 0 1 1-1Z" /><path d="M9 9h6M9 13h6" /></svg>
            Notas fiscais
          </a>
        </nav>

        <div className="menu-rodape">
          <div className="menu-tema">
            <span>{tema === "dark" ? "Modo escuro" : "Modo claro"}</span>
            <button
              className={tema === "dark" ? "tema-switch escuro" : "tema-switch"}
              onClick={trocarTema}
              role="switch"
              aria-checked={tema === "dark"}
              title={tema === "dark" ? "Modo claro" : "Modo escuro"}
              aria-label="Modo escuro"
              tabIndex={aberto ? 0 : -1}
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
          </div>
          <div className="menu-conta">
            <span className="menu-avatar" aria-hidden="true">{inicial}</span>
            <span className="menu-email" title={email}>{email}</span>
            <button className="menu-sair" onClick={sair} tabIndex={aberto ? 0 : -1}>Sair</button>
          </div>
        </div>
      </aside>
    </>
  );
}
