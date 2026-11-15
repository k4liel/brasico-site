"use client";

// Criar ou trocar a senha pelo link que um administrador gerou na página Usuários (função acessos-convidar).
// O código vem depois do "#" (não vai para o servidor nem para a prévia do WhatsApp) e só é usado ao clicar em
// Salvar: verifyOtp (recuperação) abre a sessão e updateUser grava a senha. Ninguém além da pessoa vê a senha.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icone, Vitrine } from "@/components/Entrada";

export default function CriarSenha() {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [repete, setRepete] = useState("");
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    document.title = "Criar senha · Brasico";
    const t = new URLSearchParams(window.location.hash.slice(1)).get("t");
    setCodigo(t ?? "");
  }, []);

  const curta = senha.length > 0 && senha.length < 8;
  const diferente = repete.length > 0 && repete !== senha;
  const pronto = !!codigo && senha.length >= 8 && senha === repete && !ocupado;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto || !codigo) return;
    setOcupado(true); setErro("");
    const sb = createClient();
    const { error: e1 } = await sb.auth.verifyOtp({ type: "recovery", token_hash: codigo });
    if (e1) {
      setOcupado(false);
      return setErro("Este link já foi usado ou venceu (vale 1 hora). Peça um novo a um administrador.");
    }
    const { error: e2 } = await sb.auth.updateUser({ password: senha });
    if (e2) {
      setOcupado(false);
      return setErro(/different|same/i.test(e2.message) ? "Escolha uma senha diferente da anterior." : "Não consegui salvar a senha. Tente de novo.");
    }
    window.history.replaceState(null, "", "/auth/senha");
    window.location.href = "/";
  }

  return (
    <main className="ent ent-socios">
      <section className="ent-esq">
        <header className="ent-topo"><span className="ent-marca"><i aria-hidden="true">B</i>Brasico</span></header>
        <div className="ent-form-area">
          <h1 className="ent-titulo">Criar sua senha</h1>
          <p className="ent-sub">Escolha a senha que você vai usar para entrar no Brasico. Só você fica sabendo dela.</p>

          {codigo === "" ? (
            <p className="ent-erro" role="alert"><Icone n="alerta" /><span>Este link está incompleto. Peça um novo a um administrador.</span></p>
          ) : (
            <form className="ent-form" onSubmit={salvar} noValidate>
              <div className="ent-campo">
                <label htmlFor="cs-senha">Nova senha</label>
                <div className="ent-senha">
                  <input id="cs-senha" type={ver ? "text" : "password"} autoComplete="new-password" value={senha}
                    onChange={(e) => { setSenha(e.target.value); setErro(""); }} aria-invalid={curta} />
                  <button type="button" className="ent-ver" onClick={() => setVer(!ver)}
                    aria-label={ver ? "Ocultar a senha" : "Mostrar a senha"}>{ver ? "Ocultar" : "Mostrar"}</button>
                </div>
                {curta && <p className="ent-dica" role="status"><Icone n="info" /><span>Use 8 caracteres ou mais.</span></p>}
              </div>
              <div className="ent-campo">
                <label htmlFor="cs-repete">Repita a senha</label>
                <input id="cs-repete" type={ver ? "text" : "password"} autoComplete="new-password" value={repete}
                  onChange={(e) => { setRepete(e.target.value); setErro(""); }} aria-invalid={diferente} />
                {diferente && <p className="ent-dica" role="status"><Icone n="info" /><span>As duas senhas não são iguais.</span></p>}
              </div>
              {erro && <p className="ent-erro" role="alert"><Icone n="alerta" /><span>{erro}</span></p>}
              <button className="ent-botao" disabled={!pronto} aria-busy={ocupado}>
                {ocupado ? <><span className="ent-gira" aria-hidden="true" />Salvando…</> : "Salvar e entrar"}
              </button>
            </form>
          )}
          <p className="ent-troca">Já tem senha? <a href="/login">Entrar<Icone n="seta" tam={14} /></a></p>
        </div>
      </section>
      <Vitrine tipo="socios" />
    </main>
  );
}
