"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/app/entrada.css";

// Telas de entrada do Brasico: uma para os sócios (/login) e outra para a equipe das casas (/colaboradores),
// no mesmo desenho. Cada uma só deixa entrar quem é dela (a outra pessoa é desconectada na hora).

export type TipoEntrada = "socios" | "colaboradores";

// Equipe das casas entra com usuário (o primeiro nome), sem e-mail: vira <usuario>@usuarios.brasico (supabase/compras_acessos.sql)
const DOMINIO_EQUIPE = "usuarios.brasico";
export const paraEmail = (v: string) => { const t = v.trim().toLowerCase(); return t.includes("@") ? t : `${t}@${DOMINIO_EQUIPE}`; };

// Papéis da equipe das casas (operacao_papel); sócio = 'socio'
const PAPEIS_EQUIPE = ["solicitante", "compras", "estoque"];

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

const CONTEUDO: Record<TipoEntrada, { selo: string; titulo: string; texto: string; itens: { i: keyof typeof I; t: string; d: string }[] }> = {
  socios: {
    selo: "Área dos sócios",
    titulo: "A gestão do grupo num lugar só.",
    texto: "Projetos, operação das casas, pessoas e fiscal, com os dados lidos direto das fontes.",
    itens: [
      { i: "doc", t: "Projetos", d: "Documentos, propostas e o brainstorm da equipe" },
      { i: "caixa", t: "Operação", d: "Notas, compras, fichas técnicas e câmara fria" },
      { i: "grafico", t: "Gestão", d: "Vendas, RH, ponto e situação fiscal" },
    ],
  },
  colaboradores: {
    selo: "Área dos colaboradores",
    titulo: "Sua área de trabalho nas casas.",
    texto: "Entre com o usuário e a senha que você recebeu para abrir a sua área.",
    itens: [
      { i: "carrinho", t: "Compras", d: "Seus pedidos da semana, a lista sugerida e a aprovação" },
      { i: "floco", t: "Câmara fria", d: "Entradas, saídas e contagens do estoque" },
      { i: "panela", t: "Produção", d: "As tarefas do dia e o que já foi feito" },
    ],
  },
};

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Moldura das duas telas: o painel da marca à esquerda e o formulário à direita. */
export function Entrada({ tipo, children }: { tipo: TipoEntrada; children: React.ReactNode }) {
  const c = CONTEUDO[tipo];
  const [ola, setOla] = useState("");
  useEffect(() => { setOla(saudacao()); }, []);
  const outra = tipo === "socios"
    ? { href: "/colaboradores", texto: "É da equipe das casas?", link: "Área dos colaboradores" }
    : { href: "/login", texto: "É sócio?", link: "Área dos sócios" };

  return (
    <main className={`ent ent-${tipo}`}>
      <aside className="ent-marca">
        <div className="ent-logo">
          <span className="ent-monograma" aria-hidden="true">B</span>
          <span className="ent-nome">Brasico</span>
        </div>

        <div className="ent-chamada">
          <span className="ent-selo">{c.selo}</span>
          <h1>{c.titulo}</h1>
          <p>{c.texto}</p>
        </div>

        <ul className="ent-itens">
          {c.itens.map((x) => (
            <li key={x.t}>
              <span className="ent-item-icone"><Icone n={x.i} /></span>
              <span><b>{x.t}</b><small>{x.d}</small></span>
            </li>
          ))}
        </ul>

        <p className="ent-rodape"><Icone n="escudo" tam={14} /> Acesso restrito · conexão protegida</p>
      </aside>

      <section className="ent-lado">
        <div className="ent-form-area">
          <p className="ent-ola">{ola ? `${ola}!` : " "}</p>
          {children}
        </div>
        <p className="ent-troca">{outra.texto} <a href={outra.href}>{outra.link} <Icone n="seta" tam={14} /></a></p>
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
