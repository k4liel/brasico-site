"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/app/entrada.css";

// Telas de entrada do Brasico: uma para os sócios (/login) e outra para a equipe das casas (/colaboradores),
// no mesmo desenho. Cada uma só deixa entrar quem é dela (a outra pessoa é desconectada na hora).

export type TipoEntrada = "socios" | "colaboradores";

// Equipe das casas entra com usuário (o primeiro nome), sem e-mail: vira <usuario>@usuarios.brasico (supabase/compras_acessos.sql)
const DOMINIO_EQUIPE = "usuarios.brasico";
export const paraEmail = (v: string) => { const t = v.trim().toLowerCase(); return t.includes("@") ? t : `${t}@${DOMINIO_EQUIPE}`; };

// Papéis da equipe das casas (operacao_papel); sócio = 'socio'
// "lider" = quem só monta a escala (abre só /escala); entra pela área dos colaboradores
const PAPEIS_EQUIPE = ["solicitante", "compras", "estoque", "lider"];

/** Depois de entrar: confere se a pessoa é desta tela. Se não for, desconecta e devolve o aviso. */
export async function conferirArea(tipo: TipoEntrada): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "Não deu para entrar agora. Tente de novo em instantes.";
  const { data: papel } = await supabase.rpc("operacao_papel", { p_user: user.id });
  const equipe = PAPEIS_EQUIPE.includes(String(papel ?? ""));
  if (tipo === "socios" && equipe) {
    await supabase.auth.signOut();
    return "Este acesso é da equipe das casas. Entre pela área dos colaboradores.";
  }
  if (tipo === "colaboradores" && !equipe) {
    await supabase.auth.signOut();
    return "Este usuário não é da equipe das casas. Entre pela área dos sócios.";
  }
  return null;
}

export function traduzErro(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Usuário ou senha incorretos. Confira e tente de novo.";
  if (/rate limit|too many/i.test(msg)) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
  if (/signups not allowed|user not found/i.test(msg)) return "Este e-mail não tem acesso. Peça o convite a um dos sócios.";
  return "Não deu para entrar agora. Tente de novo em instantes.";
}

/* ---------- Ícones (traço fino, herdam a cor) ---------- */
const I = {
  doc: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  caixa: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  grafico: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  carrinho: <path d="M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z" />,
  floco: <path d="M12 2v20M4.9 6l14.2 12M19.1 6L4.9 18M9 4l3 2 3-2M9 20l3-2 3 2" />,
  panela: <path d="M4 10h16v6a4 4 0 01-4 4H8a4 4 0 01-4-4zM2 10h20M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2" />,
  usuario: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />,
  cadeado: <path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 017 0V11" />,
  olho: <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
  olhoFechado: <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.1 3.9M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 004.4-1M9.9 9.9a3 3 0 004.2 4.2" />,
  seta: <path d="M5 12h14M13 6l6 6-6 6" />,
  escudo: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />,
  email: <path d="M3 5h18v14H3zM3 6l9 7 9-7" />,
};
export function Icone({ n, tam = 20 }: { n: keyof typeof I; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>
  );
}

const CONTEUDO: Record<TipoEntrada, { selo: string; titulo: string; texto: string }> = {
  socios: {
    selo: "Área dos sócios",
    titulo: "A gestão do grupo num lugar só.",
    texto: "Projetos, operação das casas, pessoas e fiscal, com os dados lidos direto das fontes.",
  },
  colaboradores: {
    selo: "Área dos colaboradores",
    titulo: "Sua área de trabalho nas casas.",
    texto: "Entre com o usuário e a senha que você recebeu para abrir a sua área.",
  },
};

// Logos das casas do grupo, com as cores originais, sobre cartões claros (public/marcas; das logos que o dono mandou em 13/11/2026:
// "não tire as cores das logos, tem que mostrar original").
// O Filho do Vento saiu do grupo em 10/11/2026 e não entra.
const CASAS: { arq: string; nome: string; w: number; h: number }[] = [
  { arq: "cicchetti", nome: "Cicchetti", w: 294, h: 260 },
  { arq: "filha-da-lua", nome: "Filha da Lua Ecolodge", w: 577, h: 260 },
  { arq: "sempre-vivo", nome: "Sempre Vivo", w: 166, h: 260 },
  { arq: "hello-pipa", nome: "Hello Pipa", w: 558, h: 260 },
  { arq: "hello-barra", nome: "Hello Barra", w: 569, h: 260 },
  { arq: "fazenda-pachamama", nome: "Fazenda Pachamama", w: 261, h: 260 },
  { arq: "fundacao-hello-pipa", nome: "Fundação Hello Pipa", w: 640, h: 184 },
];

// Altura de cada logo na tela: as largas ficam mais baixas, as redondas e altas mais altas (para pesarem igual)
const altura = (c: { w: number; h: number }, base: number) => {
  const r = c.w / c.h;
  return `${Math.round(base * (r > 3 ? 0.62 : r > 1.8 ? 0.74 : r < 0.8 ? 1.15 : 1.05))}px`;
};

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Faixa das logos das casas, rolando devagar (para ao passar o mouse). */
function FaixaCasas() {
  const lista = [...CASAS, ...CASAS];
  return (
    <div className="ent-casas" aria-label="Casas do grupo">
      <div className="ent-casas-trilho">
        {lista.map((c, i) => (
          <span className="ent-casa" key={i} aria-hidden={i >= CASAS.length} style={{ "--h": altura(c, 54) } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/marcas/${c.arq}.png`} alt={i < CASAS.length ? c.nome : ""} width={c.w} height={c.h}
              draggable={false} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Grade das logos (área dos colaboradores): aparecem uma a uma. */
function GradeCasas() {
  return (
    <ul className="ent-grade" aria-label="Casas do grupo">
      {CASAS.map((c, i) => (
        <li key={c.arq} style={{ "--i": i, "--h": altura(c, 48) } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/marcas/${c.arq}.png`} alt={c.nome} width={c.w} height={c.h} draggable={false} />
        </li>
      ))}
    </ul>
  );
}

/** Monograma do Brasico: o anel dourado se desenha ao abrir. */
function Monograma() {
  return (
    <span className="ent-monograma" aria-hidden="true">
      <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" /></svg>
      <b>B</b>
    </span>
  );
}

/** Moldura das duas telas: o painel da marca à esquerda e o formulário à direita. */
export function Entrada({ tipo, children }: { tipo: TipoEntrada; children: React.ReactNode }) {
  const c = CONTEUDO[tipo];
  const [ola, setOla] = useState("");
  const painel = useRef<HTMLElement>(null);
  useEffect(() => { setOla(saudacao()); if (tipo === "colaboradores") document.title = "Área dos colaboradores"; }, [tipo]);
  const outra = tipo === "socios"
    ? { href: "/colaboradores", texto: "É da equipe das casas?", link: "Área dos colaboradores" }
    : { href: "/login", texto: "É sócio?", link: "Área dos sócios" };

  // Luz suave que acompanha o mouse no painel escuro (só CSS vars, sem redesenhar)
  function mover(e: React.PointerEvent<HTMLElement>) {
    const el = painel.current; if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.classList.add("com-luz");
  }

  return (
    <main className={`ent ent-${tipo}`}>
      {tipo === "colaboradores" ? (
        // Equipe: só o nome da área e as logos das casas, sem a marca Brasico nem informações (pedido do dono, 04/11/2026)
        <aside className="ent-marca ent-marca-so-titulo" ref={painel} onPointerMove={mover} onPointerLeave={() => painel.current?.classList.remove("com-luz")}>
          <span className="ent-luz" aria-hidden="true" />
          <h1 className="ent-anima" style={{ "--d": "80ms" } as React.CSSProperties}>Área dos{" "}<br />colaboradores</h1>
          <GradeCasas />
        </aside>
      ) : (
      <aside className="ent-marca" ref={painel} onPointerMove={mover} onPointerLeave={() => painel.current?.classList.remove("com-luz")}>
        <span className="ent-luz" aria-hidden="true" />
        <div className="ent-logo ent-anima">
          <Monograma />
          <span className="ent-nome">Brasico</span>
        </div>

        <div className="ent-chamada">
          <span className="ent-selo ent-anima" style={{ "--d": "120ms" } as React.CSSProperties}>{c.selo}</span>
          <h1 className="ent-anima" style={{ "--d": "200ms" } as React.CSSProperties}>{c.titulo}</h1>
          <p className="ent-anima" style={{ "--d": "300ms" } as React.CSSProperties}>{c.texto}</p>
        </div>

        <div className="ent-casas-bloco ent-anima" style={{ "--d": "420ms" } as React.CSSProperties}>
          <span className="ent-casas-titulo">As casas do grupo</span>
          <FaixaCasas />
        </div>

        <p className="ent-rodape ent-anima" style={{ "--d": "520ms" } as React.CSSProperties}><Icone n="escudo" tam={14} /> Acesso restrito · conexão protegida</p>
      </aside>
      )}

      <section className="ent-lado">
        <div className="ent-form-area ent-anima" style={{ "--d": "160ms" } as React.CSSProperties}>
          <p className="ent-ola">{ola ? `${ola}!` : " "}</p>
          {children}
        </div>
        {tipo === "socios" && <p className="ent-troca ent-anima" style={{ "--d": "360ms" } as React.CSSProperties}>{outra.texto} <a href={outra.href}>{outra.link} <Icone n="seta" tam={14} /></a></p>}
      </section>
    </main>
  );
}

/** Campo com ícone e rótulo em cima */
export function Campo({ rotulo, icone, children, extra }: { rotulo: string; icone: keyof typeof I; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <label className="ent-campo">
      <span className="ent-rotulo">{rotulo}</span>
      <span className="ent-entrada">
        <span className="ent-entrada-icone"><Icone n={icone} tam={18} /></span>
        {children}
        {extra}
      </span>
    </label>
  );
}

/** Senha com o botão de mostrar e esconder */
export function CampoSenha({ valor, mudar }: { valor: string; mudar: (v: string) => void }) {
  const [ver, setVer] = useState(false);
  return (
    <Campo rotulo="Senha" icone="cadeado" extra={
      <button type="button" className="ent-ver" onClick={() => setVer(!ver)} aria-label={ver ? "Esconder a senha" : "Mostrar a senha"} title={ver ? "Esconder a senha" : "Mostrar a senha"}>
        <Icone n={ver ? "olhoFechado" : "olho"} tam={18} />
      </button>
    }>
      <input type={ver ? "text" : "password"} required minLength={8} placeholder="Sua senha" autoComplete="current-password"
        value={valor} onChange={(e) => mudar(e.target.value)} />
    </Campo>
  );
}
