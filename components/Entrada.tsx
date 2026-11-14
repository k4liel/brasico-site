"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/app/entrada.css";

// Telas de entrada do Brasico: uma para os sócios (/login) e outra para a equipe das casas (/colaboradores).
// Cada uma só deixa entrar quem é dela (a outra pessoa é desconectada na hora).
// Desenho (14/11/2026, escolhido pelo dono entre 3 prévias: "B · dividida"; escuro como padrão, como o site): formulário à esquerda,
// à direita, painel escuro com a vitrine do sistema; embaixo, faixa com as logos das casas (originais) em movimento
// (desenho do painel, sem número nenhum: a página abre sem login). Recursos de uso: lembra quem entrou neste aparelho,
// avisa Caps Lock, percebe quem está na tela errada, botão só libera com os dois campos, mostrar senha, "esqueci a senha".

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
  alerta: <path d="M12 8v5M12 16.5v.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
  info: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.01" />,
  caps: <path d="M12 4l7 7h-4v4H9v-4H5zM9 19h6" />,
  seta: <path d="M5 12h14M13 6l6 6-6 6" />,
  cadeado: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3" />,
};
function Icone({ n, tam = 16 }: { n: keyof typeof I; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>
  );
}

// Logos das casas, sempre com as cores originais e fundo transparente (public/marcas; das logos que o dono mandou em
// 13/11/2026: "não tire as cores das logos" e "tirar as logos desses quadrados brancos"). Sem o Filho do Vento (saiu em 10/11/2026).
const CASAS: { arq: string; nome: string; w: number; h: number }[] = [
  { arq: "cicchetti", nome: "Cicchetti", w: 293, h: 260 },
  { arq: "filha-da-lua", nome: "Filha da Lua Ecolodge", w: 577, h: 260 },
  { arq: "sempre-vivo", nome: "Sempre Vivo", w: 166, h: 260 },
  { arq: "hello-pipa", nome: "Hello Pipa", w: 558, h: 260 },
  { arq: "hello-barra", nome: "Hello Barra", w: 569, h: 260 },
  { arq: "fazenda-pachamama", nome: "Fazenda Pachamama", w: 262, h: 260 },
  { arq: "fundacao-hello-pipa", nome: "Fundação Hello Pipa", w: 640, h: 184 },
];
// Altura de cada logo na faixa: as redondas e altas maiores que as largas, para pesarem igual
const alturaLogo = (c: { w: number; h: number }) => { const r = c.w / c.h; return r > 3 ? 44 : r > 1.8 ? 50 : r < 0.8 ? 70 : 64; };

const TEXTOS: Record<TipoEntrada, {
  titulo: string; sub: string; rotulo: string; dicaVazia: string; esqueci: string;
  outra: { texto: string; href: string; link: string };
}> = {
  socios: {
    titulo: "Entrar", sub: "Acesso dos sócios e da administração.", rotulo: "E-mail", dicaVazia: "voce@email.com",
    esqueci: "A senha é trocada por um dos sócios. Fale com o outro sócio para receber uma nova.",
    outra: { texto: "É da equipe das casas?", href: "/colaboradores", link: "Área dos colaboradores" },
  },
  colaboradores: {
    titulo: "Entrar", sub: "Use o usuário e a senha que você recebeu.", rotulo: "Usuário", dicaVazia: "Seu primeiro nome",
    esqueci: "Fale com o responsável da sua casa. Ele pede uma senha nova para você.",
    outra: { texto: "É sócio?", href: "/login", link: "Área dos sócios" },
  },
};

const guardado = (tipo: TipoEntrada) => `brasico-ultimo-login-${tipo}`;
const lerGuardado = (tipo: TipoEntrada) => { try { return localStorage.getItem(guardado(tipo)) ?? ""; } catch { return ""; } };
const gravarGuardado = (tipo: TipoEntrada, v: string) => { try { if (v) localStorage.setItem(guardado(tipo), v); else localStorage.removeItem(guardado(tipo)); } catch { /* aparelho sem armazenamento */ } };
const iniciais = (v: string) => {
  const nome = v.split("@")[0].replace(/[._-]+/g, " ").trim();
  const p = nome.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase();
};

/** Tela de entrada completa (formulário, logos e vitrine). As páginas /login e /colaboradores só a chamam. */
export function TelaEntrada({ tipo }: { tipo: TipoEntrada }) {
  const t = TEXTOS[tipo];
  const [usuario, setUsuario] = useState("");
  const [lembrado, setLembrado] = useState("");       // quem já entrou neste aparelho
  const [lembrar, setLembrar] = useState(true);
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [caps, setCaps] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [esqueci, setEsqueci] = useState(false);
  const campoSenha = useRef<HTMLInputElement>(null);
  const campoUsuario = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tipo === "colaboradores") document.title = "Área dos colaboradores";
    const q = new URLSearchParams(window.location.search).get("erro");
    if (q === "link") setErro("Esse link de acesso não vale mais. Entre com e-mail e senha.");
    if (q === "area") setErro("A equipe das casas entra só por aqui, com usuário e senha.");
    const v = lerGuardado(tipo);
    if (v) { setLembrado(v); setUsuario(v); setTimeout(() => campoSenha.current?.focus(), 0); }
    else setTimeout(() => campoUsuario.current?.focus(), 0);
  }, [tipo]);

  // Quem está na tela errada: nome sem "@" na tela dos sócios, ou e-mail na tela da equipe
  const valor = usuario.trim();
  const telaErrada = tipo === "socios"
    ? valor.length >= 2 && !valor.includes("@")
    : valor.includes("@") && !valor.toLowerCase().endsWith("@" + DOMINIO_EQUIPE);
  const pronto = valor.length > 0 && senha.length > 0 && !ocupado;

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") setCaps(e.getModifierState("CapsLock"));
  }

  function trocarConta() {
    setLembrado(""); setUsuario(""); setSenha(""); setErro("");
    gravarGuardado(tipo, "");
    setTimeout(() => campoUsuario.current?.focus(), 0);
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setOcupado(true); setErro("");
    const falhou = (msg: string) => {
      setOcupado(false); setErro(msg);
      setTimeout(() => { campoSenha.current?.focus(); campoSenha.current?.select(); }, 0);
    };
    const { error } = await createClient().auth.signInWithPassword({ email: paraEmail(usuario), password: senha });
    if (error) return falhou(traduzErro(error.message));
    const aviso = await conferirArea(tipo);
    if (aviso) return falhou(aviso);
    gravarGuardado(tipo, lembrar ? valor : "");
    // A página inicial leva cada pessoa para a sua área (middleware)
    window.location.href = "/";
  }

  return (
    <main className={`ent ent-${tipo}`}>
      <section className="ent-esq">
        <header className="ent-topo">
          {/* Equipe: sem a marca Brasico (pedido do dono, 04/11/2026); o nome da área fica no painel escuro */}
          {tipo === "socios" && <span className="ent-marca"><i aria-hidden="true">B</i>Brasico</span>}
        </header>

        <div className="ent-form-area">
          <h1 className="ent-titulo">{lembrado ? "Bem-vindo de volta" : t.titulo}</h1>
          <p className="ent-sub">{t.sub}</p>

          <form className="ent-form" onSubmit={entrar} noValidate>
            {lembrado ? (
              <div className="ent-conta">
                <span className="ent-avatar" aria-hidden="true">{iniciais(lembrado)}</span>
                <span className="ent-conta-nome"><small>{t.rotulo}</small>{lembrado}</span>
                <button type="button" className="ent-link" onClick={trocarConta}>Trocar</button>
              </div>
            ) : (
              <div className="ent-campo">
                <label htmlFor="ent-usuario">{t.rotulo}</label>
                <input id="ent-usuario" ref={campoUsuario} type="text" inputMode={tipo === "socios" ? "email" : "text"}
                  autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={t.dicaVazia}
                  value={usuario} onChange={(e) => { setUsuario(e.target.value); setErro(""); }} />
                {telaErrada && (
                  <p className="ent-dica" role="status">
                    <Icone n="info" />
                    {tipo === "socios"
                      ? <span>“{valor}” parece um usuário da equipe das casas. <a href={t.outra.href}>Entrar na área dos colaboradores</a></span>
                      : <span>Isso parece um e-mail de sócio. <a href={t.outra.href}>Entrar na área dos sócios</a></span>}
                  </p>
                )}
              </div>
            )}

            <div className="ent-campo">
              <div className="ent-rotulo-linha">
                <label htmlFor="ent-senha">Senha</label>
                <button type="button" className="ent-link" onClick={() => setEsqueci(!esqueci)} aria-expanded={esqueci}>Esqueci a senha</button>
              </div>
              <div className="ent-senha">
                <input id="ent-senha" ref={campoSenha} type={verSenha ? "text" : "password"} autoComplete="current-password"
                  value={senha} onChange={(e) => { setSenha(e.target.value); setErro(""); }}
                  onKeyDown={teclas} onKeyUp={teclas} onBlur={() => setCaps(false)} aria-invalid={!!erro} />
                <button type="button" className="ent-ver" onClick={() => setVerSenha(!verSenha)}
                  aria-label={verSenha ? "Ocultar a senha" : "Mostrar a senha"}>{verSenha ? "Ocultar" : "Mostrar"}</button>
              </div>
              {caps && <p className="ent-caps" role="status"><Icone n="caps" /> Caps Lock está ligado</p>}
              {esqueci && <p className="ent-esqueci">{t.esqueci}</p>}
            </div>

            <label className="ent-lembrar">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
              <span>Lembrar {tipo === "socios" ? "meu e-mail" : "meu usuário"} neste aparelho</span>
            </label>

            {erro && <p className="ent-erro" role="alert"><Icone n="alerta" /><span>{erro}</span></p>}

            <button className="ent-botao" disabled={!pronto} aria-busy={ocupado}>
              {ocupado ? <><span className="ent-gira" aria-hidden="true" />Entrando…</> : "Entrar"}
            </button>
          </form>

          {tipo === "socios" && <p className="ent-troca">{t.outra.texto} <a href={t.outra.href}>{t.outra.link}<Icone n="seta" tam={14} /></a></p>}
        </div>

      </section>

      <Vitrine tipo={tipo} />

      {/* Faixa das casas, de ponta a ponta: logos originais passando devagar (param ao passar o mouse).
          O tom da faixa (--faixa em entrada.css) deixa ler as logos escuras sem mudar as cores delas. */}
      <footer className="ent-casas" aria-label="Casas do grupo">
        <div className="ent-casas-trilho">
          {[0, 1].map((volta) => (
            <ul key={volta} aria-hidden={volta === 1}>
              {CASAS.map((c) => (
                <li key={c.arq} title={c.nome}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/marcas/${c.arq}.png`} alt={volta === 0 ? c.nome : ""} width={c.w} height={c.h}
                    style={{ "--h": `${alturaLogo(c)}px` } as React.CSSProperties} draggable={false} />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </footer>
    </main>
  );
}

/** Painel escuro da direita: desenho do sistema (sem dado nenhum), em camadas. Com o mouse, a luz acompanha,
 *  o painel inclina de leve e os cartões flutuantes se deslocam em profundidades diferentes. */
function Vitrine({ tipo }: { tipo: TipoEntrada }) {
  const ref = useRef<HTMLElement>(null);
  function mover(e: React.PointerEvent<HTMLElement>) {
    const el = ref.current; if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--px", x.toFixed(3));
    el.style.setProperty("--py", y.toFixed(3));
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.classList.add("com-luz");
  }
  function sair() {
    const el = ref.current; if (!el) return;
    el.style.setProperty("--px", "0"); el.style.setProperty("--py", "0"); el.classList.remove("com-luz");
  }
  const barras = [38, 52, 46, 64, 58, 72, 66, 84, 76, 90, 82, 96];
  // Linha do gráfico passando pelo alto das barras (coordenadas 0-100)
  const linha = barras.map((h, i) => `${(i + 0.5) * (100 / barras.length)},${100 - h * 0.92}`).join(" ");
  return (
    <aside className="ent-dir" ref={ref} onPointerMove={mover} onPointerLeave={sair} aria-hidden="true">
      <span className="ent-luz" />
      {tipo === "socios" ? (
        <div className="ent-dir-texto">
          <h2>A operação do grupo, num painel só.</h2>
          <p>Vendas, hotéis, pessoas, compras e fiscal lidos direto das fontes e atualizados ao longo do dia.</p>
        </div>
      ) : (
        // Equipe: sem informações do sistema (pedido do dono, 04/11/2026)
        <div className="ent-dir-texto"><h2>Área dos colaboradores</h2></div>
      )}
      <div className="ent-cena">
        <div className="ent-app">
          <div className="ent-app-barra"><i /><i /><i /><span /><b className="ent-vivo" /></div>
          <div className="ent-app-corpo">
            <nav><span className="on" /><span /><span /><span style={{ width: "80%" }} /><span /><span style={{ width: "60%" }} /><span /></nav>
            <div className="ent-app-area">
              <div className="ent-app-cards">
                {[0, 1, 2].map((i) => <div key={i} style={{ "--i": i } as React.CSSProperties}><span /><b /><em /></div>)}
              </div>
              <div className="ent-app-grafico">
                {barras.map((h, i) => <i key={i} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />)}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={linha} pathLength={1} /></svg>
              </div>
              <div className="ent-app-linhas"><span /><span /><span /></div>
            </div>
          </div>
        </div>
        {/* Cartões flutuantes: dão profundidade (só formas, sem dado) */}
        <div className="ent-flutua ent-flutua-a">
          <span className="ent-flutua-icone"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
          <span className="ent-flutua-linhas"><i /><i /></span>
        </div>
        <div className="ent-flutua ent-flutua-b">
          <svg className="ent-anel" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" /><circle className="arco" cx="18" cy="18" r="14" pathLength={1} /></svg>
          <span className="ent-flutua-linhas"><i /><i /><i /></span>
        </div>
      </div>
    </aside>
  );
}
