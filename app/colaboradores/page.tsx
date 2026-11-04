"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Campo, CampoSenha, Entrada, Icone, conferirArea, paraEmail, traduzErro } from "@/components/Entrada";

// Login da equipe das casas (solicitantes, compras, câmara fria, produção): só usuário e senha.
// Sócio que tentar entrar aqui é desconectado e mandado para /login (conferirArea).
export default function LoginColaboradores() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("erro") === "area") {
      setErro("A equipe das casas entra só por aqui, com usuário e senha.");
    }
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    const { error } = await createClient().auth.signInWithPassword({ email: paraEmail(usuario), password: senha });
    if (error) { setBusy(false); return setErro(traduzErro(error.message)); }
    const aviso = await conferirArea("colaboradores");
    if (aviso) { setBusy(false); return setErro(aviso); }
    // A página inicial leva cada pessoa para a sua área (middleware)
    window.location.href = "/";
  }

  return (
    <Entrada tipo="colaboradores">
      <h2 className="ent-titulo">Entrar</h2>
      <p className="ent-sub">Use o usuário e a senha que você recebeu.</p>
      <form className="ent-form" onSubmit={entrar}>
        <Campo rotulo="Usuário" icone="usuario">
          <input type="text" required autoFocus placeholder="Seu primeiro nome" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        </Campo>
        <CampoSenha valor={senha} mudar={setSenha} />
        {erro && <p className="ent-erro" role="alert">{erro}</p>}
        <button className="ent-botao" disabled={busy}>{busy ? "Entrando…" : <>Entrar <Icone n="seta" tam={18} /></>}</button>
      </form>
      <p className="ent-nota">Esqueceu a senha ou ainda não tem acesso? Fale com o responsável da sua casa.</p>
    </Entrada>
  );
}
