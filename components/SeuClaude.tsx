"use client";

// Seu Claude (página Usuários): gera o link do conector Brasico da própria pessoa e mostra os links ativos.
// Só administradores e editores conseguem gerar (política de mcp_tokens, supabase/acessos.sql).
import { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { haQuanto } from "@/lib/tempo";

type Token = { id: string; label: string; created_at: string; last_used_at: string | null };

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function novoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "br_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SeuClaude({ supabase, userId, userEmail }: { supabase: ReturnType<typeof createClient>; userId: string; userEmail: string }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [projeto, setProjeto] = useState<string | null | undefined>(undefined);
  const [link, setLink] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const [{ data: t }, { data: w }] = await Promise.all([
      supabase.from("mcp_tokens").select("id,label,created_at,last_used_at")
        .eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }),
      supabase.from("workspaces").select("id").is("removido_em", null).order("created_at").limit(1),
    ]);
    setTokens((t as Token[]) ?? []);
    setProjeto(w?.[0]?.id ?? null);
  }, [supabase, userId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function gerar() {
    if (!projeto) return;
    setErro("");
    const token = novoToken();
    const { error } = await supabase.from("mcp_tokens").insert({
      user_id: userId, workspace_id: projeto, label: `Claude de ${userEmail.split("@")[0]}`, token_hash: await sha256Hex(token),
    });
    if (error) return setErro(error.message.includes("row-level security") ? "Seu acesso não permite conectar o Claude. Peça a um administrador." : error.message);
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

  const ativos = (tokens ?? []).length > 0;
  return (
    <section className="es-bloco sc">
      <div className="ac-cabeca">
        <div>
          <h2>Seu Claude</h2>
          <p className="muted">O seu Claude entra no Brasico por um link só seu. Ele pode o mesmo que você.</p>
        </div>
        <span className={ativos ? "estado ok" : "estado"}>{ativos ? "Conectado" : "Não conectado"}</span>
      </div>
      {projeto === null ? (
        <p className="muted">Você ainda não tem acesso a nenhum projeto.</p>
      ) : link ? (
        <ol className="sc-passos">
          <li>Copie o link (ele só aparece agora; guarde como uma senha):
            <div className="link-caixa"><code>{link}</code><button onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button></div>
          </li>
          <li>No Claude, abra <b>Configurações → Conectores → Adicionar conector personalizado</b>.</li>
          <li>Nome: <b>Brasico</b>. URL: cole o link. Salve.</li>
          <li>Numa conversa, peça: <i>“liste meus projetos no Brasico”</i>.</li>
        </ol>
      ) : (
        <button onClick={gerar} disabled={projeto === undefined}>{ativos ? "Gerar outro link" : "Gerar meu link"}</button>
      )}
      {erro && <p className="tv-alerta">{erro}</p>}
      {ativos && (
        <ul className="lista sc-links">
          {tokens!.map((t) => (
            <li key={t.id}>
              <span><b>{t.label}</b><span className="muted small"> · {t.last_used_at ? `usado ${haQuanto(t.last_used_at)}` : "ainda não usado"}</span></span>
              <button className="ghost small danger" onClick={() => revogar(t.id)}>Desconectar</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
