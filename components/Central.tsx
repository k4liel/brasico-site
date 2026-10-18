"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { haQuanto } from "@/lib/tempo";
import Topo from "./Topo";

type Projeto = { id: string; name: string; created_at: string };
type Info = { capitulos: number; quando: string | null; quem: string | null; claude: boolean };

export default function Central({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = createClient();
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [temClaude, setTemClaude] = useState(true);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");

  async function carregar() {
    await supabase.rpc("accept_invites");
    const [{ data: ws }, { data: tk }] = await Promise.all([
      supabase.from("workspaces").select("id,name,created_at").order("created_at"),
      supabase.from("mcp_tokens").select("id").eq("user_id", userId).is("revoked_at", null).limit(1),
    ]);
    const lista = (ws as Projeto[]) ?? [];
    setProjetos(lista);
    setTemClaude(!!tk?.length);
    if (!lista.length) return;

    const ids = lista.map((p) => p.id);
    const [{ data: notas }, { data: log }, { data: membros }] = await Promise.all([
      supabase.from("notes").select("workspace_id").in("workspace_id", ids).is("archived_at", null),
      supabase.from("activity_log").select("workspace_id,user_id,created_at,source").in("workspace_id", ids)
        .order("created_at", { ascending: false }).limit(200),
      supabase.from("workspace_members").select("user_id").in("workspace_id", ids),
    ]);
    const uids = Array.from(new Set((membros ?? []).map((m: { user_id: string }) => m.user_id)));
    const { data: perfis } = await supabase.from("profiles").select("id,email,display_name").in("id", uids);
    const nomeDe = (id: string) => {
      const p = (perfis ?? []).find((x: { id: string }) => x.id === id) as
        | { email: string | null; display_name: string | null } | undefined;
      return id === userId ? "você" : p?.display_name || p?.email?.split("@")[0] || "alguém";
    };

    const r: Record<string, Info> = {};
    ids.forEach((id) => (r[id] = { capitulos: 0, quando: null, quem: null, claude: false }));
    (notas ?? []).forEach((n: { workspace_id: string }) => r[n.workspace_id].capitulos++);
    (log ?? []).forEach((l: { workspace_id: string; user_id: string | null; created_at: string; source: string }) => {
      const x = r[l.workspace_id];
      if (x && !x.quando) {
        x.quando = l.created_at;
        x.quem = l.user_id ? nomeDe(l.user_id) : null;
        x.claude = l.source === "claude";
      }
    });
    setInfo(r);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: nome.trim(), created_by: userId, doc_rodape: nome.trim() })
      .select("id")
      .single();
    if (error) return alert(error.message);
    window.location.href = `/projeto/${data.id}`;
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="projetos" />

      <main className="miolo">
        <div className="cabeca">
          <div>
            <h1>Projetos</h1>
            <p className="muted">Tudo o que vocês criam e editam pelo Claude aparece aqui.</p>
          </div>
          <div className="spacer" />
          {criando ? (
            <form onSubmit={criar} className="novo-form">
              <input autoFocus placeholder="Nome do projeto" value={nome} onChange={(e) => setNome(e.target.value)} />
              <button disabled={!nome.trim()}>Criar</button>
              <button type="button" className="ghost" onClick={() => setCriando(false)}>Cancelar</button>
            </form>
          ) : (
            <button className="ghost" onClick={() => setCriando(true)}>+ Novo projeto</button>
          )}
        </div>

        {!temClaude && (
          <a className="aviso-claude" href="/conectar">
            <b>Conecte seu Claude</b>
            <span>Leva um minuto. Depois é só pedir: “abra o projeto Carnaval 2027 no Brasico e atualize o cardápio”.</span>
          </a>
        )}

        {projetos === null ? (
          <p className="muted">Carregando…</p>
        ) : projetos.length === 0 ? (
          <div className="vazio">
            <p>Nenhum projeto ainda.</p>
            <p className="muted">Peça ao seu Claude: “crie um projeto chamado … no Brasico”.</p>
          </div>
        ) : (
          <div className="grade">
            {projetos.map((p) => {
              const i = info[p.id];
              return (
                <a key={p.id} className="projeto" href={`/projeto/${p.id}`}>
                  <span className="projeto-faixa" />
                  <span className="projeto-nome">{p.name}</span>
                  <span className="muted small">
                    {i ? `${i.capitulos} capítulo${i.capitulos === 1 ? "" : "s"}` : "…"}
                  </span>
                  {i?.quando && (
                    <span className="small projeto-mudanca">
                      Mudou {haQuanto(i.quando)}
                      {i.quem ? ` · ${i.quem}` : ""}
                      {i.claude && <span className="via">via Claude</span>}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
