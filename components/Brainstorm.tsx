"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { haQuanto } from "@/lib/tempo";
import Topo from "./Topo";

type Status = "entrada" | "conversa" | "decidido" | "fazendo" | "feito" | "estacionado";
type Ideia = {
  id: string; titulo: string; descricao: string; status: Status; workspace_id: string | null;
  responsavel: string | null; prazo: string | null; rever_em: string | null; decisao: string | null;
  criado_por: string; origem: string; created_at: string; updated_at: string;
};
type Comentario = { id: string; ideia_id: string; autor: string; texto: string; origem: string; created_at: string };
type Perfil = { id: string; email: string | null; display_name: string | null };
type Projeto = { id: string; name: string };

const COLUNAS: { id: Status; nome: string; dica: string }[] = [
  { id: "entrada", nome: "Caixa de entrada", dica: "Anotado, ainda não pensado" },
  { id: "conversa", nome: "Em conversa", dica: "Discutindo, falta decidir" },
  { id: "decidido", nome: "Decidido", dica: "Vamos fazer" },
  { id: "fazendo", nome: "Fazendo", dica: "Alguém está tocando" },
  { id: "feito", nome: "Feito", dica: "Pronto" },
];
const NOME_STATUS: Record<Status, string> = {
  entrada: "Caixa de entrada", conversa: "Em conversa", decidido: "Decidido", fazendo: "Fazendo", feito: "Feito", estacionado: "Estacionado",
};

const hoje = () => new Date().toISOString().slice(0, 10);
const dataCurta = (d: string) => {
  const [, m, dia] = d.split("-");
  return `${dia}/${m}`;
};

export default function Brainstorm({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [ideias, setIdeias] = useState<Ideia[] | null>(null);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [nova, setNova] = useState("");
  const [filtroProjeto, setFiltroProjeto] = useState("");
  const [soMinhas, setSoMinhas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Status | null>(null);
  const [verEstacionado, setVerEstacionado] = useState(true);

  const carregar = useCallback(async () => {
    const [{ data: i }, { data: c }, { data: p }, { data: w }] = await Promise.all([
      supabase.from("ideias").select("*").is("arquivada_em", null).order("updated_at", { ascending: false }),
      supabase.from("ideia_comentarios").select("*").order("created_at"),
      supabase.from("profiles").select("id,email,display_name"),
      supabase.from("workspaces").select("id,name").is("removido_em", null).order("created_at"),
    ]);
    setIdeias((i as Ideia[]) ?? []);
    setComentarios((c as Comentario[]) ?? []);
    setPerfis((p as Perfil[]) ?? []);
    setProjetos((w as Projeto[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    carregar();
    const ch = supabase
      .channel("brainstorm")
      .on("postgres_changes", { event: "*", schema: "public", table: "ideias" }, () => carregar())
      .on("postgres_changes", { event: "*", schema: "public", table: "ideia_comentarios" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  // Fecha o painel com Esc
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && setAberta(null);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const nomeDe = (id: string | null) => {
    if (!id) return "";
    if (id === userId) return "Você";
    const p = perfis.find((x) => x.id === id);
    return p?.display_name || p?.email?.split("@")[0] || "Alguém";
  };
  const inicial = (id: string | null) => (nomeDe(id) || "?").charAt(0).toUpperCase();
  const nomeProjeto = (id: string | null) => projetos.find((p) => p.id === id)?.name ?? "";

  const visiveis = (ideias ?? []).filter(
    (i) => (!filtroProjeto || (filtroProjeto === "-" ? !i.workspace_id : i.workspace_id === filtroProjeto)) &&
      (!soMinhas || i.responsavel === userId || (!i.responsavel && i.criado_por === userId))
  );
  const nComent = (id: string) => comentarios.filter((c) => c.ideia_id === id).length;

  async function anotar(e: React.FormEvent) {
    e.preventDefault();
    const titulo = nova.trim();
    if (!titulo) return;
    setNova("");
    const ws = filtroProjeto && filtroProjeto !== "-" ? filtroProjeto : null;
    const { error } = await supabase.from("ideias").insert({ titulo, criado_por: userId, workspace_id: ws });
    if (error) {
      setNova(titulo);
      return alert(error.message);
    }
    carregar();
  }

  async function atualizar(id: string, campos: Partial<Ideia>) {
    setIdeias((lista) => (lista ?? []).map((i) => (i.id === id ? { ...i, ...campos } : i)));
    const { error } = await supabase.from("ideias").update(campos).eq("id", id);
    if (error) {
      alert(error.message);
      carregar();
    }
  }

  function soltar(status: Status) {
    if (arrastando) {
      const i = ideias?.find((x) => x.id === arrastando);
      if (i && i.status !== status) atualizar(arrastando, { status });
    }
    setArrastando(null);
    setSobre(null);
  }

  const cartao = (i: Ideia) => {
    const atrasada = !!i.prazo && i.prazo < hoje() && i.status !== "feito";
    const revisar = i.status === "estacionado" && !!i.rever_em && i.rever_em <= hoje();
    const n = nComent(i.id);
    return (
      <button
        key={i.id}
        className={arrastando === i.id ? "ideia arrastando" : "ideia"}
        draggable
        onDragStart={(e) => {
          setArrastando(i.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setArrastando(null);
          setSobre(null);
        }}
        onClick={() => setAberta(i.id)}
      >
        {i.workspace_id && <span className="ideia-projeto">{nomeProjeto(i.workspace_id)}</span>}
        <span className="ideia-titulo">{i.titulo}</span>
        <span className="ideia-rodape">
          {i.responsavel && <span className="ideia-quem" title={nomeDe(i.responsavel)}>{inicial(i.responsavel)}</span>}
          {i.prazo && <span className={atrasada ? "ideia-data atrasada" : "ideia-data"}>{atrasada ? "venceu " : ""}{dataCurta(i.prazo)}</span>}
          {i.status === "estacionado" && i.rever_em && (
            <span className={revisar ? "ideia-data atrasada" : "ideia-data"}>rever {dataCurta(i.rever_em)}</span>
          )}
          <span className="spacer" />
          {n > 0 && <span className="ideia-coment" title={`${n} comentário${n > 1 ? "s" : ""}`}>💬 {n}</span>}
          {i.origem === "claude" && <span className="via">via Claude</span>}
        </span>
      </button>
    );
  };

  const estacionadas = visiveis.filter((i) => i.status === "estacionado");
  const atual = ideias?.find((i) => i.id === aberta) ?? null;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="brainstorm" />
      <main className="brainstorm">
        <div className="bs-cabeca">
          <div>
            <h1>Brainstorm</h1>
            <p className="muted">Ideias e tarefas soltas da equipe. Anote aqui ou peça ao Claude: “anota no Brainstorm…”.</p>
          </div>
          <div className="spacer" />
          <div className="bs-filtros">
            <select value={filtroProjeto} onChange={(e) => setFiltroProjeto(e.target.value)} aria-label="Filtrar por projeto">
              <option value="">Todos os projetos</option>
              <option value="-">Sem projeto</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label className="bs-minhas">
              <input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} />
              Só as minhas
            </label>
          </div>
        </div>

        <form className="bs-nova" onSubmit={anotar}>
          <input
            id="nova-ideia"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Nova ideia ou tarefa… (Enter para anotar)"
            maxLength={200}
          />
          <button disabled={!nova.trim()}>Anotar</button>
        </form>

        {ideias === null ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            <div className="quadro">
              {COLUNAS.map((col) => {
                const itens = visiveis.filter((i) => i.status === col.id);
                return (
                  <section
                    key={col.id}
                    className={sobre === col.id ? "coluna sobre" : "coluna"}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setSobre(col.id);
                    }}
                    onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
                    onDrop={() => soltar(col.id)}
                  >
                    <header className="coluna-topo">
                      <b>{col.nome}</b>
                      <span className="coluna-n">{itens.length}</span>
                    </header>
                    <p className="coluna-dica">{col.dica}</p>
                    <div className="coluna-itens">
                      {itens.map(cartao)}
                      {!itens.length && <p className="coluna-vazia">Arraste uma ideia para cá</p>}
                    </div>
                  </section>
                );
              })}
            </div>

            <section
              className={sobre === "estacionado" ? "estacionado sobre" : "estacionado"}
              onDragOver={(e) => {
                e.preventDefault();
                setSobre("estacionado");
              }}
              onDragLeave={() => setSobre((s) => (s === "estacionado" ? null : s))}
              onDrop={() => soltar("estacionado")}
            >
              <button className="estacionado-topo" onClick={() => setVerEstacionado((v) => !v)} aria-expanded={verEstacionado}>
                <b>Estacionado</b>
                <span className="coluna-n">{estacionadas.length}</span>
                <span className="muted small">boas ideias para depois · cada uma com data para rever</span>
                <span className="spacer" />
                <span className="muted small">{verEstacionado ? "Esconder" : "Mostrar"}</span>
              </button>
              {verEstacionado && (
                <div className="estacionado-itens">
                  {estacionadas.map(cartao)}
                  {!estacionadas.length && <p className="coluna-vazia">Nada estacionado</p>}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {atual && (
        <Detalhe
          key={atual.id}
          ideia={atual}
          comentarios={comentarios.filter((c) => c.ideia_id === atual.id)}
          perfis={perfis}
          projetos={projetos}
          userId={userId}
          nomeDe={nomeDe}
          onFechar={() => setAberta(null)}
          onSalvar={(campos) => atualizar(atual.id, campos)}
          onComentar={async (texto) => {
            const { error } = await supabase.from("ideia_comentarios").insert({ ideia_id: atual.id, autor: userId, texto });
            if (error) return alert(error.message);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function Detalhe({
  ideia, comentarios, perfis, projetos, userId, nomeDe, onFechar, onSalvar, onComentar,
}: {
  ideia: Ideia; comentarios: Comentario[]; perfis: Perfil[]; projetos: Projeto[]; userId: string;
  nomeDe: (id: string | null) => string;
  onFechar: () => void; onSalvar: (c: Partial<Ideia>) => void; onComentar: (t: string) => Promise<void>;
}) {
  const [titulo, setTitulo] = useState(ideia.titulo);
  const [descricao, setDescricao] = useState(ideia.descricao);
  const [decisao, setDecisao] = useState(ideia.decisao ?? "");
  const [texto, setTexto] = useState("");

  const salvarTexto = () => {
    const c: Partial<Ideia> = {};
    if (titulo.trim() && titulo.trim() !== ideia.titulo) c.titulo = titulo.trim();
    if (descricao !== ideia.descricao) c.descricao = descricao;
    if ((decisao || null) !== ideia.decisao) c.decisao = decisao.trim() || null;
    if (Object.keys(c).length) onSalvar(c);
  };

  return (
    <>
      <div className="painel-fundo bs-fundo" onClick={() => { salvarTexto(); onFechar(); }} />
      <aside className="painel painel-dir aberto bs-detalhe" aria-label="Ideia">
        <div className="painel-topo">
          <span className="lado-titulo">{NOME_STATUS[ideia.status]}</span>
          <button className="fechar" onClick={() => { salvarTexto(); onFechar(); }} aria-label="Fechar">×</button>
        </div>

        <textarea
          id="ideia-titulo"
          className="bs-titulo"
          value={titulo}
          rows={2}
          maxLength={200}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={salvarTexto}
          aria-label="Título"
        />

        <div className="bs-mover" role="group" aria-label="Mover para">
          {(Object.keys(NOME_STATUS) as Status[]).map((s) => (
            <button key={s} className={ideia.status === s ? "on" : ""} onClick={() => onSalvar({ status: s })}>
              {NOME_STATUS[s]}
            </button>
          ))}
        </div>

        <div className="bs-campos">
          <label>
            <span>Responsável</span>
            <select value={ideia.responsavel ?? ""} onChange={(e) => onSalvar({ responsavel: e.target.value || null })}>
              <option value="">Ninguém</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.id === userId ? "Você" : p.display_name || p.email}</option>)}
            </select>
          </label>
          <label>
            <span>Prazo</span>
            <input type="date" value={ideia.prazo ?? ""} onChange={(e) => onSalvar({ prazo: e.target.value || null })} />
          </label>
          <label>
            <span>Projeto</span>
            <select value={ideia.workspace_id ?? ""} onChange={(e) => onSalvar({ workspace_id: e.target.value || null })}>
              <option value="">Sem projeto</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {ideia.status === "estacionado" && (
            <label>
              <span>Rever em</span>
              <input type="date" value={ideia.rever_em ?? ""} onChange={(e) => onSalvar({ rever_em: e.target.value || null })} />
            </label>
          )}
        </div>

        <label className="bs-bloco">
          <span>Descrição</span>
          <textarea id="ideia-descricao" rows={5} value={descricao} onChange={(e) => setDescricao(e.target.value)} onBlur={salvarTexto} placeholder="Contexto, links, o que já sabemos…" />
        </label>

        <label className="bs-bloco">
          <span>Decisão</span>
          <textarea id="ideia-decisao" rows={2} value={decisao} onChange={(e) => setDecisao(e.target.value)} onBlur={salvarTexto} placeholder="O que decidimos e por quê" />
        </label>

        <div className="bs-bloco">
          <span>Conversa</span>
          <ul className="bs-comentarios">
            {comentarios.map((c) => (
              <li key={c.id}>
                <div className="small">
                  <b>{nomeDe(c.autor)}</b> <span className="muted">· {haQuanto(c.created_at)}</span>
                  {c.origem === "claude" && <span className="via">via Claude</span>}
                </div>
                <p>{c.texto}</p>
              </li>
            ))}
            {!comentarios.length && <li className="muted small">Ninguém comentou ainda.</li>}
          </ul>
          <form
            className="bs-comentar"
            onSubmit={async (e) => {
              e.preventDefault();
              const t = texto.trim();
              if (!t) return;
              setTexto("");
              await onComentar(t);
            }}
          >
            <textarea id="ideia-comentario" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva um comentário…" />
            <button disabled={!texto.trim()}>Comentar</button>
          </form>
        </div>

        <div className="bs-rodape">
          <span className="muted small">
            Anotada por {nomeDe(ideia.criado_por)} {haQuanto(ideia.created_at)}{ideia.origem === "claude" ? " via Claude" : ""}
          </span>
          <button
            className="ghost small"
            onClick={() => {
              onSalvar({ arquivada_em: new Date().toISOString() } as Partial<Ideia>);
              onFechar();
            }}
          >
            Arquivar
          </button>
        </div>
      </aside>
    </>
  );
}
