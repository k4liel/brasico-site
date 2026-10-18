"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { haQuanto } from "@/lib/tempo";
import Topo from "./Topo";

type Token = { id: string; label: string; created_at: string; last_used_at: string | null };
type Equipe = { pessoas: { id: string; email: string | null; nome: string | null }[]; convites: string[] };

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function novoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "br_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Conectar({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = createClient();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [primeiroProjeto, setPrimeiroProjeto] = useState<string | null | undefined>(undefined);
  const [link, setLink] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [equipe, setEquipe] = useState<Equipe>({ pessoas: [], convites: [] });
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  async function carregar() {
    await supabase.rpc("accept_invites");
    const [{ data: t }, { data: w }, { data: e }] = await Promise.all([
      supabase.from("mcp_tokens").select("id,label,created_at,last_used_at")
        .eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }),
      supabase.from("workspaces").select("id").order("created_at").limit(1),
      supabase.rpc("minha_equipe"),
    ]);
    setTokens((t as Token[]) ?? []);
    setPrimeiroProjeto(w?.[0]?.id ?? null);
    if (e) setEquipe(e as Equipe);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function gerar() {
    if (!primeiroProjeto) return;
    const token = novoToken();
    const { error } = await supabase.from("mcp_tokens").insert({
      user_id: userId,
      workspace_id: primeiroProjeto,
      label: `Claude de ${userEmail.split("@")[0]}`,
      token_hash: await sha256Hex(token),
    });
    if (error) return alert(error.message);
    setLink(`${window.location.origin}/api/mcp?key=${token}`);
    carregar();
  }

  async function revogar(id: string) {
    if (!confirm("Desconectar? O Claude que usa esse link perde o acesso.")) return;
    await supabase.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    carregar();
  }

  async function copiar() {
    await navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function convidar(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const { error } = await supabase.rpc("convidar_equipe", { p_email: email });
    if (error) return setMsg(error.message);
    setMsg(`Pronto. Quando ${email.trim()} entrar no Brasico com esse e-mail, já vê todos os projetos.`);
    setEmail("");
    carregar();
  }

  const ativos = tokens.length > 0;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="conectar" />

      <main className="miolo estreito">
        <h1>Claude e equipe</h1>
        <p className="muted">
          Cada pessoa conecta o próprio Claude. Os dois Claudes enxergam e editam os mesmos projetos.
        </p>

        <section className="bloco">
          <div className="bloco-topo">
            <h2>Seu Claude</h2>
            <span className={ativos ? "estado ok" : "estado"}>{ativos ? "Conectado" : "Não conectado"}</span>
          </div>

          {primeiroProjeto === null ? (
            <p className="muted">Crie um projeto primeiro (na página Projetos) e volte aqui.</p>
          ) : link ? (
            <>
              <p><b>1.</b> Copie seu link (ele só aparece agora; guarde como uma senha):</p>
              <div className="link-caixa">
                <code>{link}</code>
                <button onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button>
              </div>
              <p><b>2.</b> No Claude, abra <b>Configurações → Conectores → Adicionar conector personalizado</b>.</p>
              <p><b>3.</b> Nome: <b>Brasico</b>. URL: cole o link. Salve.</p>
              <p><b>4.</b> Numa conversa, peça: <i>“liste meus projetos no Brasico”</i>.</p>
            </>
          ) : (
            <>
              <p className="muted">
                Gere um link e cole no Claude como conector. Um link vale para todos os projetos.
              </p>
              <button onClick={gerar} disabled={primeiroProjeto === undefined}>
                {ativos ? "Gerar outro link" : "Gerar meu link"}
              </button>
            </>
          )}

          {ativos && (
            <ul className="lista">
              {tokens.map((t) => (
                <li key={t.id}>
                  <span>
                    <b>{t.label}</b>
                    <span className="muted small">
                      {" "}· {t.last_used_at ? `usado ${haQuanto(t.last_used_at)}` : "ainda não usado"}
                    </span>
                  </span>
                  <button className="ghost small danger" onClick={() => revogar(t.id)}>Desconectar</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bloco">
          <div className="bloco-topo">
            <h2>Equipe</h2>
          </div>
          <p className="muted">Quem está na equipe vê e edita todos os projetos, inclusive os novos.</p>
          <ul className="lista">
            {equipe.pessoas.map((p) => (
              <li key={p.id}>
                <span>
                  <b>{p.nome || p.email}</b>
                  {p.id === userId && <span className="muted small"> · você</span>}
                </span>
              </li>
            ))}
            {equipe.convites.map((c) => (
              <li key={c}>
                <span>{c}</span>
                <span className="muted small">convite enviado, ainda não entrou</span>
              </li>
            ))}
          </ul>
          <form onSubmit={convidar} className="convite">
            <input type="email" required placeholder="E-mail do seu sócio" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button disabled={!email.trim()}>Convidar</button>
          </form>
          {msg && <p className="small">{msg}</p>}
          <p className="muted small">
            O convite não manda e-mail: avise a pessoa para abrir {typeof window !== "undefined" ? window.location.host : "o site"} e criar a conta com esse e-mail.
          </p>
        </section>
      </main>
    </div>
  );
}
