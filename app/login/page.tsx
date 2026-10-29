"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "senha" | "link";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("senha");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("erro") === "link") {
      setError("O link de acesso expirou ou já foi usado. Entre com senha ou peça um novo link.");
    }
  }, []);

  function traduz(msg: string) {
    if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
    if (/already registered/i.test(msg)) return "Este e-mail já tem conta. Use “Entrar”.";
    if (/rate limit/i.test(msg)) return "Limite de e-mails atingido. Entre com senha ou tente o link mais tarde.";
    if (/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 8 caracteres.";
    if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
    if (/signups not allowed|user not found/i.test(msg)) return "Este e-mail não tem acesso. Peça o convite a um dos sócios.";
    return msg;
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(traduz(error.message));
    window.location.href = "/";
  }

  // Contas novas só por convite dos sócios: o login não cria conta
  async function enviarLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(traduz(error.message));
    setInfo(`Link enviado para ${email.trim()}. Abra seu e-mail e clique nele.`);
  }

  return (
    <main className="center">
      <div className="card login">
        <h1>Brasico</h1>
        <div className="row segmented">
          <button type="button" className={mode === "senha" ? "tab active" : "tab"} onClick={() => setMode("senha")}>
            E-mail e senha
          </button>
          <button type="button" className={mode === "link" ? "tab active" : "tab"} onClick={() => setMode("link")}>
            Link por e-mail
          </button>
        </div>

        {mode === "senha" ? (
          <form onSubmit={entrar} className="stack">
            <input type="email" required placeholder="seu@email.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" required placeholder="Senha (mín. 8 caracteres)" autoComplete="current-password"
              minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy}>{busy ? "Aguarde..." : "Entrar"}</button>
            <p className="muted small">Acesso por convite. Peça o seu a um dos sócios.</p>
          </form>
        ) : (
          <form onSubmit={enviarLink} className="stack">
            <p className="muted small">Enviamos um link de acesso para o seu e-mail.</p>
            <input type="email" required placeholder="seu@email.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            <button disabled={busy}>{busy ? "Enviando..." : "Receber link de acesso"}</button>
          </form>
        )}

        {error && <p className="err">{error}</p>}
        {info && <p className="ok">{info}</p>}
      </div>
    </main>
  );
}
