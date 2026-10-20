"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Grupo = { id: string; nome: string; ativo: boolean };
type Resumo = { id: string; grupo_id: string; dia: string; resumo: string; total_mensagens: number; updated_at: string };

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const nomeDia = (d: string) => {
  const [a, m, dia] = d.split("-").map((n) => parseInt(n, 10));
  return `${SEMANA[new Date(Date.UTC(a, m - 1, dia)).getUTCDay()]}, ${dia} ${MES[m - 1]}`;
};

// O resumo vem do Claude a partir de mensagens de terceiros: mostrado como texto,
// com só títulos, listas e negrito (nada de HTML).
function negrito(t: string) {
  return t.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}
function Resumo({ md }: { md: string }) {
  const blocos: React.ReactNode[] = [];
  let itens: string[] = [];
  const fecharLista = () => {
    if (itens.length) blocos.push(<ul key={blocos.length}>{itens.map((t, i) => <li key={i}>{negrito(t)}</li>)}</ul>);
    itens = [];
  };
  for (const linha of md.replace(/\r/g, "").split("\n")) {
    const l = linha.trim();
    const item = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      itens.push(item[1]);
      continue;
    }
    fecharLista();
    if (!l) continue;
    const titulo = l.match(/^#{1,6}\s+(.*)$/);
    blocos.push(titulo ? <h3 key={blocos.length}>{titulo[1]}</h3> : <p key={blocos.length}>{negrito(l)}</p>);
  }
  fecharLista();
  return <div className="wa-resumo">{blocos}</div>;
}

export default function WhatsApp({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [resumos, setResumos] = useState<Resumo[]>([]);
  const [dia, setDia] = useState<string | null>(null);
  const [verGrupos, setVerGrupos] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: a }, { data: g }, { data: r }] = await Promise.all([
      supabase.from("wa_acesso").select("user_id").eq("user_id", userId),
      supabase.from("wa_grupos").select("id,nome,ativo").order("nome"),
      supabase.from("wa_resumos").select("id,grupo_id,dia,resumo,total_mensagens,updated_at").order("dia", { ascending: false }).limit(600),
    ]);
    setAcesso(!!a?.length);
    setGrupos((g as Grupo[]) ?? []);
    setResumos((r as Resumo[]) ?? []);
  }, [supabase, userId]);

  useEffect(() => {
    carregar();
    const ch = supabase
      .channel("whatsapp-resumos")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_resumos" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  const dias = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resumos) m.set(r.dia, (m.get(r.dia) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [resumos]);
  const atual = verGrupos ? null : dia ?? dias[0]?.[0] ?? null;
  const nomeGrupo = (id: string) => grupos.find((g) => g.id === id)?.nome || "Grupo sem nome";
  const doDia = resumos
    .filter((r) => r.dia === atual)
    .sort((a, b) => b.total_mensagens - a.total_mensagens);

  async function alternar(g: Grupo) {
    if (g.ativo && !confirm(`Parar de acompanhar "${g.nome || g.id}"? O número continua no grupo, mas nada novo é gravado nem resumido.`)) return;
    setGrupos((gs) => gs.map((x) => (x.id === g.id ? { ...x, ativo: !g.ativo } : x)));
    const { error } = await supabase.from("wa_grupos").update({ ativo: !g.ativo }).eq("id", g.id);
    if (error) {
      alert("Não foi possível salvar: " + error.message);
      carregar();
    }
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="whatsapp" />
      <main className="listas">
        <nav className="listas-lado" aria-label="Dias">
          <span className="listas-rotulo">Resumos</span>
          {dias.map(([d, n]) => (
            <button key={d} className={atual === d ? "lista on" : "lista"} onClick={() => { setDia(d); setVerGrupos(false); }}>
              <span>{nomeDia(d)}</span>
              <span className="lista-n">{n}</span>
            </button>
          ))}
          <button className={verGrupos ? "lista on lista-nova" : "lista lista-nova"} onClick={() => setVerGrupos(true)}>
            <span>Grupos</span>
            <span className="lista-n">{grupos.filter((g) => g.ativo).length || ""}</span>
          </button>
        </nav>

        <section className="lista-corpo">
          {acesso === null ? (
            <p className="muted">Carregando…</p>
          ) : !acesso ? (
            <p className="vazio muted">Você ainda não tem acesso aos grupos de WhatsApp.</p>
          ) : verGrupos ? (
            <>
              <header className="lista-cabeca">
                <h1>Grupos</h1>
                <span className="muted small">Desmarque para parar de acompanhar um grupo.</span>
              </header>
              {grupos.length ? (
                <ul className="wa-grupos">
                  {grupos.map((g) => (
                    <li key={g.id}>
                      <label>
                        <input type="checkbox" checked={g.ativo} onChange={() => alternar(g)} />
                        <span>{g.nome || g.id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="vazio muted">Nenhum grupo ainda. Eles aparecem aqui quando o número da Brasico recebe a primeira mensagem de cada um.</p>
              )}
            </>
          ) : !atual ? (
            <p className="vazio muted">Nenhum resumo ainda. O primeiro sai às 7h do dia seguinte à primeira mensagem nos grupos.</p>
          ) : (
            <>
              <header className="lista-cabeca">
                <h1>{nomeDia(atual)}</h1>
                <span className="muted small">
                  {doDia.length} grupo{doDia.length > 1 ? "s" : ""} · {doDia.reduce((s, r) => s + r.total_mensagens, 0)} mensagens
                </span>
              </header>
              {doDia.map((r) => (
                <article key={r.id} className="wa-cartao">
                  <header>
                    <h2>{nomeGrupo(r.grupo_id)}</h2>
                    <span className="muted small">{r.total_mensagens} mensagens</span>
                  </header>
                  <Resumo md={r.resumo} />
                </article>
              ))}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
