"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./colaboradores.css";

// Login da equipe das casas (solicitantes, compras, câmara fria, produção): só usuário e senha.
// O usuário é o primeiro nome e vira <usuario>@usuarios.brasico por baixo (supabase/compras_acessos.sql).
const DOMINIO_EQUIPE = "usuarios.brasico";
const paraEmail = (v: string) => { const t = v.trim().toLowerCase(); return t.includes("@") ? t : `${t}@${DOMINIO_EQUIPE}`; };

const AREAS = [
  { icone: "🛒", nome: "Compras", texto: "Seus pedidos da semana, a lista sugerida e a aprovação." },
  { icone: "❄️", nome: "Câmara fria", texto: "Entradas, saídas e contagens do estoque." },
  { icone: "🍝", nome: "Produção", texto: "As tarefas do dia e o que já foi feito." },
];

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function LoginColaboradores() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [ola, setOla] = useState("Olá");

  useEffect(() => { setOla(saudacao()); }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    const { error } = await createClient().auth.signInWithPassword({ email: paraEmail(usuario), password: senha });
    if (error) {
      setBusy(false);
      setErro(/invalid login credentials/i.test(error.message) ? "Usuário ou senha incorretos. Confira e tente de novo."
        : /rate limit|too many/i.test(error.message) ? "Muitas tentativas. Espere um minuto e tente de novo."
        : "Não deu para entrar agora. Tente de novo em instantes.");
      return;
    }
    // A página inicial leva cada pessoa para a sua área (middleware)
    window.location.href = "/";
  }

  return (
    <main className="clb">
      <section className="clb-boas-vindas">
        <div className="clb-marca"><span className="clb-selo" aria-hidden="true">B</span><span>Brasico<small>Área dos colaboradores</small></span></div>
        <div className="clb-chamada">
          <h1>{ola}! <br />Que bom ter você na equipe.</h1>
          <p>Entre com o seu usuário para abrir a sua área de trabalho.</p>
        </div>
        <ul className="clb-areas">
          {AREAS.map((a) => (
            <li key={a.nome}>
              <span className="clb-icone" aria-hidden="true">{a.icone}</span>
              <span><b>{a.nome}</b><small>{a.texto}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="clb-lado-form">
        <form className="clb-cartao" onSubmit={entrar}>
          <h2>Entrar</h2>
          <p className="clb-sub">Use o usuário e a senha que você recebeu.</p>

          <label className="clb-campo">
            <span>Usuário</span>
            <span className="clb-entrada">
              <span className="clb-entrada-icone" aria-hidden="true">👤</span>
              <input type="text" required autoFocus placeholder="Seu primeiro nome" autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={usuario} onChange={(e) => setUsuario(e.target.value)} />
            </span>
          </label>

          <label className="clb-campo">
            <span>Senha</span>
            <span className="clb-entrada">
              <span className="clb-entrada-icone" aria-hidden="true">🔒</span>
              <input type={ver ? "text" : "password"} required minLength={8} placeholder="Sua senha" autoComplete="current-password"
                value={senha} onChange={(e) => setSenha(e.target.value)} />
              <button type="button" className="clb-ver" onClick={() => setVer(!ver)} aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}>
                {ver ? "Esconder" : "Mostrar"}
              </button>
            </span>
          </label>

          {erro && <p className="clb-erro" role="alert">{erro}</p>}

          <button className="clb-entrar" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>

          <p className="clb-ajuda">Esqueceu a senha ou ainda não tem acesso? Fale com o responsável da sua casa.</p>
        </form>
        <a className="clb-socios" href="/login">Sou sócio · entrar pela área principal</a>
      </section>
    </main>
  );
}
