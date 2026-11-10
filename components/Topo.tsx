"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createClient } from "@/lib/supabase/client";

const OPERACAO = ["notas", "compras", "fichas", "estoque", "producao"];
const RH = ["esocial", "escala"];
// Hotéis: uma página por hotel (/hoteis/<id>, tabela hoteis)
const HOTEIS = [
  { id: "filha-da-lua", nome: "Filha da Lua", icone: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /> },
  { id: "sempre-vivo", nome: "Sempre Vivo", icone: <path d="M12 21c0-6 0-9 5-13-6 0-9 3-9 7M12 21c0-4-1-6-5-8 3-.5 5 1 5 3" /> },
];

export default function Topo({ email, ativo }: { email: string; ativo?: "projetos" | "brainstorm" | "whatsapp" | "vendas" | "esocial" | "escala" | "receita" | "certificados" | "conectar" | "usuarios" | "notas" | "compras" | "fichas" | "estoque" | "producao" | `hotel:${string}` }) {
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
  // Operação começa fechada, a não ser quando a página aberta é uma das dela
  const [opAberta, setOpAberta] = useState(OPERACAO.includes(ativo ?? ""));
  const [rhAberta, setRhAberta] = useState(RH.includes(ativo ?? ""));
  const [hotAberta, setHotAberta] = useState((ativo ?? "").startsWith("hotel:"));
  const primeiro = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!aberto) return;
    primeiro.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aberto]);

  // Áreas que a pessoa vê no menu (usuario_areas; null = todas, como os sócios). Até chegar, nada aparece.
  const [areas, setAreas] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    createClient().rpc("minhas_areas").then(({ data, error }) => setAreas(error ? null : ((data as string[] | null) ?? null)));
  }, []);
  const ve = (a: string) => areas === null || (areas !== undefined && areas.includes(a));

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

        {/* A lista rola sozinha: a marca em cima e a conta embaixo ficam presas */}
        <nav className="menu-nav">
          {ve("projetos") && <Item ref={primeiro} href="/" on={ativo === "projetos"} vis={aberto} icone={I.projetos}>Projetos</Item>}
          {ve("brainstorm") && <Item href="/brainstorm" on={ativo === "brainstorm"} vis={aberto} icone={I.brainstorm}>Brainstorm</Item>}
          {ve("whatsapp") && <Item href="/whatsapp" on={ativo === "whatsapp"} vis={aberto} icone={I.whatsapp}>WhatsApp</Item>}

          {ve("totvs") && <Item href="/vendas" on={ativo === "vendas"} vis={aberto} icone={I.vendas}>Vendas · TOTVS</Item>}
          {ve("rh") && (<>
            {/* RH: um item que abre e fecha (começa fechado), com o RH · eSocial e a Escala dentro */}
            <Pasta id="menu-rh" on={RH.includes(ativo ?? "")} aberta={rhAberta} alternar={() => setRhAberta((o) => !o)} vis={aberto} icone={I.rh}>RH</Pasta>
            <div id="menu-rh" className={rhAberta ? "menu-sub aberto" : "menu-sub"}><div>
              <Item href="/esocial" on={ativo === "esocial"} vis={aberto && rhAberta} icone={I.rh}>RH · eSocial</Item>
              <Item href="/escala" on={ativo === "escala"} vis={aberto && rhAberta} icone={I.escala}>Escala</Item>
            </div></div>
          </>)}
          {ve("receita") && <Item href="/receita" on={ativo === "receita"} vis={aberto} icone={I.receita}>Receita Federal</Item>}

          {/* Hotéis: um item que abre e fecha, com uma página por hotel */}
          {ve("hoteis") && (<>
            <Pasta id="menu-hoteis" on={(ativo ?? "").startsWith("hotel:")} aberta={hotAberta} alternar={() => setHotAberta((o) => !o)} vis={aberto} icone={I.hoteis}>Hotéis</Pasta>
            <div id="menu-hoteis" className={hotAberta ? "menu-sub aberto" : "menu-sub"}><div>
              {HOTEIS.map((h) => (
                <Item key={h.id} href={`/hoteis/${h.id}`} on={ativo === `hotel:${h.id}`} vis={aberto && hotAberta} icone={h.icone}>{h.nome}</Item>
              ))}
            </div></div>
          </>)}
          {/* Operação: notas, compras, fichas e câmara fria */}
          {ve("operacao") && (<>
            <Pasta id="menu-operacao" on={OPERACAO.includes(ativo ?? "")} aberta={opAberta} alternar={() => setOpAberta((o) => !o)} vis={aberto} icone={I.operacao}>Operação</Pasta>
            <div id="menu-operacao" className={opAberta ? "menu-sub aberto" : "menu-sub"}><div>
              <Item href="/notas" on={ativo === "notas"} vis={aberto && opAberta} icone={I.notas}>Notas fiscais</Item>
              <Item href="/compras" on={ativo === "compras"} vis={aberto && opAberta} icone={I.compras}>Compras</Item>
              <Item href="/fichas" on={ativo === "fichas"} vis={aberto && opAberta} icone={I.fichas}>Fichas técnicas</Item>
              <Item href="/estoque" on={ativo === "estoque"} vis={aberto && opAberta} icone={I.estoque}>Câmara fria</Item>
            </div></div>
          </>)}

          {ve("certificados") && <Item href="/certificados" on={ativo === "certificados"} vis={aberto} icone={I.certificados}>Certificados digitais</Item>}
          {ve("usuarios") && <Item href="/usuarios" on={ativo === "usuarios"} vis={aberto} icone={I.usuarios}>Usuários</Item>}
          {ve("conectar") && <Item href="/conectar" on={ativo === "conectar"} vis={aberto} icone={I.conectar}>Claude e equipe</Item>}
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

// Ícones do menu (traço fino, 24×24)
const I = {
  projetos: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  brainstorm: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z" /></>,
  whatsapp: <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" />,
  vendas: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  rh: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  escala: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h4M14 13h3M14 17h3" /></>,
  receita: <path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3Z" />,
  hoteis: <><path d="M3 21V9l9-5 9 5v12" /><path d="M9 21v-6h6v6M3 21h18" /></>,
  operacao: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5M16 4v5" /></>,
  notas: <><path d="M6 3h9l4 4v14l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V4a1 1 0 0 1 1-1Z" /><path d="M9 9h6M9 13h6" /></>,
  compras: <><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></>,
  fichas: <><path d="M6 3h12v18H6z" /><path d="M9 7h6M9 11h6M9 15h4" /></>,
  estoque: <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />,
  certificados: <><circle cx="12" cy="9" r="5" /><path d="M9 13.5 8 21l4-2 4 2-1-7.5" /></>,
  usuarios: <><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  conectar: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 4.5a3 3 0 0 1 0 6M17.5 14.2A5 5 0 0 1 20.5 19" /></>,
};

function Icone({ d }: { d: React.ReactNode }) {
  return (
    <span className="menu-icone" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
    </span>
  );
}

function Item({ href, on, vis, icone, children, ref }: {
  href: string; on: boolean; vis: boolean; icone: React.ReactNode; children: React.ReactNode; ref?: React.Ref<HTMLAnchorElement>;
}) {
  return (
    <a ref={ref} className={on ? "menu-item ativo" : "menu-item"} href={href} tabIndex={vis ? 0 : -1} aria-current={on ? "page" : undefined}>
      <Icone d={icone} />
      <span className="menu-texto">{children}</span>
    </a>
  );
}

function Pasta({ id, on, aberta, alternar, vis, icone, children }: {
  id: string; on: boolean; aberta: boolean; alternar: () => void; vis: boolean; icone: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button className={on ? "menu-item menu-pasta ativo-grupo" : "menu-item menu-pasta"} onClick={alternar}
      aria-expanded={aberta} aria-controls={id} tabIndex={vis ? 0 : -1}>
      <Icone d={icone} />
      <span className="menu-texto">{children}</span>
      <span className={aberta ? "menu-pasta-seta aberta" : "menu-pasta-seta"} aria-hidden="true" />
    </button>
  );
}
