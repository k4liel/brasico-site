"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { haQuanto } from "@/lib/tempo";
import { ehTraducao, semDuplicatas } from "@/lib/historico";
import Topo from "./Topo";

type Projeto = { id: string; name: string; created_at: string; removido_em: string | null };
// "22/10/2026 às 14:35"
const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

type Info ={ capitulos: number; quando: string | null; quem: string | null; claude: boolean };

export default function Central({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = createClient();
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [temClaude, setTemClaude] = useState(true);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [lixeira, setLixeira] = useState<Projeto[]>([]);
  const [verLixeira, setVerLixeira] = useState(false);

  async function carregar() {
    await supabase.rpc("accept_invites");
    const [{ data: ws }, { data: tk }] = await Promise.all([
      supabase.from("workspaces").select("id,name,created_at,removido_em").order("created_at"),
      supabase.from("mcp_tokens").select("id").eq("user_id", userId).is("revoked_at", null).limit(1),
    ]);
    const todos = (ws as Projeto[]) ?? [];
    const lista = todos.filter((p) => !p.removido_em).reverse();
    setProjetos(lista);
    setLixeira(
      todos.filter((p) => p.removido_em).sort((a, b) => (b.removido_em ?? "").localeCompare(a.removido_em ?? ""))
    );
    setTemClaude(!!tk?.length);
    if (!lista.length) return;

    const ids = lista.map((p) => p.id);
    // As últimas mudanças de cada projeto; as traduções são filtradas abaixo
    const ultimas = ids.map((id) =>
      supabase.from("activity_log").select("workspace_id,user_id,entity_id,created_at,source,details").eq("workspace_id", id)
        .order("created_at", { ascending: false }).limit(200));
    const [{ data: notas }, { data: membros }, ...logs] = await Promise.all([
      supabase.from("notes").select("workspace_id").in("workspace_id", ids).is("archived_at", null),
      supabase.from("workspace_members").select("user_id").in("workspace_id", ids),
      ...ultimas,
    ]);
    const log = logs.flatMap((l) => l.data ?? []).filter((x: { details: string | null }) => !ehTraducao(x));
    const uids = Array.from(new Set((membros ?? []).map((m: { user_id: string }) => m.user_id)));
    const { data: perfis } = await supabase.from("profiles").select("id,email,display_name").in("id", uids);
    const nomeDe = (id: string) => {
      const p = (perfis ?? []).find((x: { id: string }) => x.id === id) as
        | { email: string | null; display_name: string | null } | undefined;
      return p?.display_name || p?.email?.split("@")[0] || "Alguém";
    };

    const r: Record<string, Info> = {};
    ids.forEach((id) => (r[id] = { capitulos: 0, quando: null, quem: null, claude: false }));
    (notas ?? []).forEach((n: { workspace_id: string }) => r[n.workspace_id].capitulos++);
    semDuplicatas(log as { workspace_id: string; user_id: string | null; entity_id: string | null; created_at: string; source: string }[]).forEach((l) => {
      const x = r[l.workspace_id];
      if (x && !x.quando) {
        x.quando = l.created_at;
        x.quem = l.user_id ? nomeDe(l.user_id) : null;
        x.claude = l.source === "claude";
      }
    });
    setInfo(r);
    // Mais recentes primeiro: pela última edição (ou pela criação, se nunca foi editado)
    const recente = (p: Projeto) => r[p.id]?.quando ?? p.created_at;
    setProjetos([...lista].sort((a, b) => recente(b).localeCompare(recente(a))));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restaurar(p: Projeto) {
    const { error } = await supabase.rpc("restaurar_projeto", { p_projeto: p.id });
    if (error) return alert(error.message);
    carregar();
  }

  async function excluirParaSempre(p: Projeto) {
    const digitado = window.prompt(
      `Excluir "${p.name}" para sempre?

O projeto, os capítulos, as versões e o histórico serão apagados e não dá para desfazer (só pelo backup semanal).

Para confirmar, digite o nome do projeto:`
    );
    if (digitado === null) return;
    if (digitado.trim() !== p.name.trim()) return alert("O nome digitado não confere. Nada foi excluído.");
    const { error } = await supabase.rpc("excluir_projeto_para_sempre", { p_projeto: p.id, p_nome: digitado });
    if (error) return alert(error.message);
    carregar();
  }

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
                    <span className="projeto-mudanca">
                      <span className="projeto-avatar" aria-hidden>{i.quem ? i.quem.charAt(0).toUpperCase() : "↻"}</span>
                      <span className="projeto-quem">
                        <span className="projeto-autor">
                          {i.quem ? `${i.quem} editou` : "Atualizado automaticamente"}
                          {i.quem && i.claude && <span className="via">via Claude</span>}
                        </span>
                        <span className="projeto-data" title={haQuanto(i.quando)}>
                          {dataHora(i.quando)} · {haQuanto(i.quando)}
                        </span>
                      </span>
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}

        {lixeira.length > 0 && (
          <section className="lixeira">
            <button className="ghost lixeira-botao" onClick={() => setVerLixeira(!verLixeira)} aria-expanded={verLixeira}>
              Lixeira · {lixeira.length} projeto{lixeira.length === 1 ? "" : "s"} {verLixeira ? "▴" : "▾"}
            </button>
            {verLixeira && (
              <ul className="lixeira-lista">
                {lixeira.map((p) => (
                  <li key={p.id}>
                    <span className="lixeira-nome">
                      {p.name}
                      <span className="muted small"> · removido {haQuanto(p.removido_em!)}</span>
                    </span>
                    <span className="lixeira-acoes">
                      <button className="ghost" onClick={() => restaurar(p)}>Restaurar</button>
                      <button className="ghost danger" onClick={() => excluirParaSempre(p)}>Excluir para sempre</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
