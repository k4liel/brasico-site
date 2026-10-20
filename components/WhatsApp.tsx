"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Grupo = { id: string; nome: string; ativo: boolean; total: number; ultima: string | null };
type Resumo = { id: string; grupo_id: string; dia: string; resumo: string; total_mensagens: number; updated_at: string };
type Mensagem = {
  grupo_id: string;
  id: string;
  autor_jid: string;
  autor_nome: string;
  de_nos: boolean;
  tipo: string;
  texto: string;
  enviada_em: string;
};
// O que está aberto à direita: mensagens (de um grupo ou de todos), o resumo de um dia ou a lista para gerenciar
type Vista = { tipo: "mensagens"; grupo: string | null } | { tipo: "resumo"; dia: string } | { tipo: "gerenciar" };

const LIMITE = 500;
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const nomeDia = (d: string) => {
  const [a, m, dia] = d.split("-").map((n) => parseInt(n, 10));
  return `${SEMANA[new Date(Date.UTC(a, m - 1, dia)).getUTCDay()]}, ${dia} ${MES[m - 1]}`;
};

// Datas sempre no horário de Brasília
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaDe = (iso: string) => fmtDia.format(new Date(iso));
const horaDe = (iso: string) => fmtHora.format(new Date(iso));

// "558487836518@s.whatsapp.net" -> "+55 84 8783-6518"
function telefone(jid: string) {
  const n = jid.split("@")[0].split(":")[0];
  if (!jid.endsWith("@s.whatsapp.net") || !/^\d+$/.test(n)) return "";
  if (n.startsWith("55") && (n.length === 12 || n.length === 13)) {
    const ddd = n.slice(2, 4);
    const resto = n.slice(4);
    return `+55 ${ddd} ${resto.slice(0, -4)}-${resto.slice(-4)}`;
  }
  return "+" + n;
}
const autor = (m: Mensagem) => (m.de_nos ? "Brasico" : m.autor_nome || telefone(m.autor_jid) || "Participante");

const ROTULO_TIPO: Record<string, string> = {
  imagem: "📷 Foto",
  video: "🎥 Vídeo",
  audio: "🎤 Áudio",
  documento: "📄 Documento",
  figurinha: "Figurinha",
  local: "📍 Localização",
  contato: "👤 Contato",
  enquete: "📊 Enquete",
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
  const [vista, setVista] = useState<Vista>({ tipo: "mensagens", grupo: null });
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  const carregar = useCallback(async () => {
    const [{ data: a }, { data: g }, { data: r }] = await Promise.all([
      supabase.from("wa_acesso").select("user_id").eq("user_id", userId),
      supabase.rpc("wa_painel_grupos"),
      supabase.from("wa_resumos").select("id,grupo_id,dia,resumo,total_mensagens,updated_at").order("dia", { ascending: false }).limit(600),
    ]);
    setAcesso(!!a?.length);
    setGrupos(((g as Grupo[]) ?? []).map((x) => ({ ...x, total: Number(x.total) })));
    setResumos((r as Resumo[]) ?? []);
  }, [supabase, userId]);

  const grupoAberto = vista.tipo === "mensagens" ? vista.grupo : null;
  const vendoMensagens = vista.tipo === "mensagens";

  const carregarMensagens = useCallback(async () => {
    let q = supabase
      .from("wa_mensagens")
      .select("grupo_id,id,autor_jid,autor_nome,de_nos,tipo,texto,enviada_em")
      .order("enviada_em", { ascending: false })
      .limit(LIMITE);
    if (grupoAberto) q = q.eq("grupo_id", grupoAberto);
    const b = buscaAtiva.replace(/[%,()*]/g, " ").trim();
    if (b) q = q.or(`texto.ilike.%${b}%,autor_nome.ilike.%${b}%`);
    const { data } = await q;
    setMensagens((data as Mensagem[]) ?? []);
  }, [supabase, grupoAberto, buscaAtiva]);

  // Recarrega quando chega mensagem nova, sem disparar várias vezes seguidas
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recarregarTudo = useRef<() => void>(() => {});
  recarregarTudo.current = () => {
    carregar();
    if (vendoMensagens) carregarMensagens();
  };

  useEffect(() => {
    carregar();
    const avisar = () => {
      if (espera.current) clearTimeout(espera.current);
      espera.current = setTimeout(() => recarregarTudo.current(), 800);
    };
    const ch = supabase
      .channel("whatsapp")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_resumos" }, avisar)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_grupos" }, avisar)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_mensagens" }, avisar)
      .subscribe();
    return () => {
      if (espera.current) clearTimeout(espera.current);
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  useEffect(() => {
    if (!vendoMensagens || !acesso) return;
    setMensagens(null);
    carregarMensagens();
  }, [vendoMensagens, acesso, carregarMensagens]);

  const dias = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resumos) m.set(r.dia, (m.get(r.dia) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [resumos]);
  const nomeGrupo = (id: string) => grupos.find((g) => g.id === id)?.nome || "Grupo sem nome";
  const totalGeral = grupos.reduce((s, g) => s + g.total, 0);

  // Mensagens separadas por dia (o mais recente primeiro)
  const porDia = useMemo(() => {
    const blocos: { dia: string; itens: Mensagem[] }[] = [];
    for (const m of mensagens ?? []) {
      const d = diaDe(m.enviada_em);
      if (blocos[blocos.length - 1]?.dia !== d) blocos.push({ dia: d, itens: [] });
      blocos[blocos.length - 1].itens.push(m);
    }
    return blocos;
  }, [mensagens]);

  async function alternar(g: Grupo) {
    if (g.ativo && !confirm(`Parar de acompanhar "${g.nome || g.id}"? O número continua no grupo, mas nada novo é gravado nem resumido.`)) return;
    setGrupos((gs) => gs.map((x) => (x.id === g.id ? { ...x, ativo: !g.ativo } : x)));
    const { error } = await supabase.from("wa_grupos").update({ ativo: !g.ativo }).eq("id", g.id);
    if (error) {
      alert("Não foi possível salvar: " + error.message);
      carregar();
    }
  }

  function abrir(v: Vista) {
    setVista(v);
    setBusca("");
    setBuscaAtiva("");
  }

  const ativos = grupos.filter((g) => g.ativo);
  const doDia = vista.tipo === "resumo" ? resumos.filter((r) => r.dia === vista.dia).sort((a, b) => b.total_mensagens - a.total_mensagens) : [];

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="whatsapp" />
      <main className="listas">
        <nav className="listas-lado" aria-label="Grupos e resumos">
          <span className="listas-rotulo">Mensagens</span>
          <button className={vendoMensagens && !grupoAberto ? "lista on" : "lista"} onClick={() => abrir({ tipo: "mensagens", grupo: null })}>
            <span>Todos os grupos</span>
            <span className="lista-n">{totalGeral || ""}</span>
          </button>
          {ativos.map((g) => (
            <button
              key={g.id}
              className={grupoAberto === g.id ? "lista on" : "lista"}
              onClick={() => abrir({ tipo: "mensagens", grupo: g.id })}
              title={g.nome || g.id}
            >
              <span>{g.nome || "Grupo sem nome"}</span>
              <span className="lista-n">{g.total || ""}</span>
            </button>
          ))}

          {dias.length > 0 && <span className="listas-rotulo wa-rotulo">Resumos</span>}
          {dias.map(([d, n]) => (
            <button key={d} className={vista.tipo === "resumo" && vista.dia === d ? "lista on" : "lista"} onClick={() => abrir({ tipo: "resumo", dia: d })}>
              <span>{nomeDia(d)}</span>
              <span className="lista-n">{n}</span>
            </button>
          ))}

          <button className={vista.tipo === "gerenciar" ? "lista on lista-nova" : "lista lista-nova"} onClick={() => abrir({ tipo: "gerenciar" })}>
            <span>Gerenciar grupos</span>
          </button>
        </nav>

        <section className="lista-corpo">
          {acesso === null ? (
            <p className="muted">Carregando…</p>
          ) : !acesso ? (
            <p className="vazio muted">Você ainda não tem acesso aos grupos de WhatsApp.</p>
          ) : vista.tipo === "gerenciar" ? (
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
                        <span className="muted small wa-grupo-n">{g.total} mensagens</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="vazio muted">Nenhum grupo ainda.</p>
              )}
            </>
          ) : vista.tipo === "resumo" ? (
            <>
              <header className="lista-cabeca">
                <h1>{nomeDia(vista.dia)}</h1>
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
          ) : (
            <>
              <header className="lista-cabeca">
                <h1>{grupoAberto ? nomeGrupo(grupoAberto) : "Todos os grupos"}</h1>
                <span className="muted small">
                  {mensagens === null
                    ? ""
                    : mensagens.length >= LIMITE
                      ? `últimas ${LIMITE} mensagens`
                      : `${mensagens.length} mensage${mensagens.length === 1 ? "m" : "ns"}`}
                </span>
              </header>
              <form
                className="wa-busca"
                onSubmit={(e) => {
                  e.preventDefault();
                  setBuscaAtiva(busca);
                }}
              >
                <input type="search" placeholder="Buscar por texto ou nome de quem mandou" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {buscaAtiva && (
                  <button type="button" className="acao" onClick={() => { setBusca(""); setBuscaAtiva(""); }}>
                    Limpar
                  </button>
                )}
              </form>
              {mensagens === null ? (
                <p className="muted">Carregando…</p>
              ) : !mensagens.length ? (
                <p className="vazio muted">
                  {buscaAtiva ? "Nada encontrado." : "Nenhuma mensagem ainda. As mensagens novas dos grupos aparecem aqui na hora."}
                </p>
              ) : (
                porDia.map((b) => (
                  <section key={b.dia} className="wa-dia">
                    <h2 className="wa-dia-titulo">{nomeDia(b.dia)}</h2>
                    <ul className="wa-msgs">
                      {b.itens.map((m) => (
                        <li key={m.grupo_id + m.id} className={m.de_nos ? "wa-msg wa-nos" : "wa-msg"}>
                          <div className="wa-msg-topo">
                            <strong>{autor(m)}</strong>
                            {m.autor_nome && telefone(m.autor_jid) && <span className="muted small">{telefone(m.autor_jid)}</span>}
                            {!grupoAberto && (
                              <button className="wa-msg-grupo" onClick={() => abrir({ tipo: "mensagens", grupo: m.grupo_id })}>
                                {nomeGrupo(m.grupo_id)}
                              </button>
                            )}
                            <span className="muted small wa-msg-hora">{horaDe(m.enviada_em)}</span>
                          </div>
                          {ROTULO_TIPO[m.tipo] && <span className="wa-msg-tipo">{ROTULO_TIPO[m.tipo]}</span>}
                          {m.texto && <p className="wa-msg-texto">{m.texto}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
