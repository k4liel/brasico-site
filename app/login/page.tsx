"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Campo, CampoSenha, Entrada, Icone, conferirArea, paraEmail, traduzErro } from "@/components/Entrada";

type Mode = "senha" | "link";

// Login dos sócios. A equipe das casas entra só por /colaboradores: quem é dela é desconectado aqui (conferirArea).
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

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const { error } = await createClient().auth.signInWithPassword({ email: paraEmail(email), password });
    if (error) { setBusy(false); return setError(traduzErro(error.message)); }
    const aviso = await conferirArea("socios");
    if (aviso) { setBusy(false); return setError(aviso); }
    window.location.href = "/";
  }

  // Contas novas só por convite dos sócios: o login não cria conta
  async function enviarLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(traduzErro(error.message));
    setInfo(`Link enviado para ${email.trim()}. Abra o seu e-mail e clique nele.`);
  }

  function trocar(m: Mode) { setMode(m); setError(""); setInfo(""); }

  return (
    <Entrada tipo="socios">
      <h2 className="ent-titulo">Entrar</h2>
      <p className="ent-sub">Acesso dos sócios e da administração.</p>

      <div className="ent-modos" role="tablist" aria-label="Forma de entrar">
        <button type="button" role="tab" aria-selected={mode === "senha"} className={mode === "senha" ? "on" : ""} onClick={() => trocar("senha")}>Senha</button>
        <button type="button" role="tab" aria-selected={mode === "link"} className={mode === "link" ? "on" : ""} onClick={() => trocar("link")}>Link por e-mail</button>
      </div>

      {mode === "senha" ? (
        <form className="ent-form" onSubmit={entrar}>
          <Campo rotulo="E-mail" icone="email">
            <input type="text" required autoFocus placeholder="seu@email.com" autoComplete="username" autoCapitalize="none" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <CampoSenha valor={password} mudar={setPassword} />
          {error && <p className="ent-erro" role="alert">{error}</p>}
          <button className="ent-botao" disabled={busy}>{busy ? "Entrando…" : <>Entrar <Icone n="seta" tam={18} /></>}</button>
        </form>
      ) : (
        <form className="ent-form" onSubmit={enviarLink}>
          <Campo rotulo="E-mail" icone="email">
            <input type="email" required autoFocus placeholder="seu@email.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          {error && <p className="ent-erro" role="alert">{error}</p>}
          {info && <p className="ent-ok" role="status">{info}</p>}
          <button className="ent-botao" disabled={busy}>{busy ? "Enviando…" : <>Receber o link de acesso <Icone n="seta" tam={18} /></>}</button>
        </form>
      )}
      <p className="ent-nota">Acesso por convite. Peça o seu a um dos sócios.</p>
    </Entrada>
  );
}
