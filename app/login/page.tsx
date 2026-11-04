"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Campo, CampoSenha, Entrada, Icone, conferirArea, paraEmail, traduzErro } from "@/components/Entrada";

// Login dos sócios: só e-mail e senha (o link por e-mail saiu em 04/11/2026, a pedido do dono).
// A equipe das casas entra só por /colaboradores: quem é dela é desconectado aqui (conferirArea).
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("erro") === "link") {
      setError("Esse link de acesso não vale mais. Entre com e-mail e senha.");
    }
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({ email: paraEmail(email), password });
    if (error) { setBusy(false); return setError(traduzErro(error.message)); }
    const aviso = await conferirArea("socios");
    if (aviso) { setBusy(false); return setError(aviso); }
    window.location.href = "/";
  }

  return (
    <Entrada tipo="socios">
      <h2 className="ent-titulo">Entrar</h2>
      <p className="ent-sub">Acesso dos sócios e da administração.</p>
      <form className="ent-form" onSubmit={entrar}>
        <Campo rotulo="E-mail" icone="email">
          <input type="text" required autoFocus placeholder="seu@email.com" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <CampoSenha valor={password} mudar={setPassword} />
        {error && <p className="ent-erro" role="alert">{error}</p>}
        <button className="ent-botao" disabled={busy}>{busy ? "Entrando…" : <>Entrar <Icone n="seta" tam={18} /></>}</button>
      </form>
      <p className="ent-nota">Acesso por convite. Esqueceu a senha? Fale com o outro sócio.</p>
    </Entrada>
  );
}
