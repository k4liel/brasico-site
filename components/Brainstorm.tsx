"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Lista = { id: string; nome: string; ordem: number; criado_por: string; created_at: string };
type Item = {
  id: string; lista_id: string; texto: string; nota: string; feito: boolean; feito_em: string | null;
  responsavel: string | null; prazo: string | null; ordem: number; criado_por: string; origem: string; created_at: string;
};
type Perfil = { id: string; email: string | null; display_name: string | null };

const hoje = () => new Date().toISOString().slice(0, 10);
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataCurta = (d: string) => {
  const [, m, dia] = d.split("-");
  return `${parseInt(dia, 10)} ${MES[parseInt(m, 10) - 1]}`;
};

export default function Brainstorm({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [listas, setListas] = useState<Lista[] | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [atual, setAtual] = useState<string | null>(null);
  const [novoItem, setNovoItem] = useState("");
  const [novaLista, setNovaLista] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verFeitos, setVerFeitos] = useState(false);
  const campoItem = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: l }, { data: i }, { data: p }] = await Promise.all([
      supabase.from("listas").select("id,nome,ordem,criado_por,created_at").is("arquivada_em", null).order("ordem").order("created_at"),
      supabase.from("lista_itens").select("*").is("arquivado_em", null).order("ordem"),
      supabase.from("profiles").select("id,email,display_name"),
    ]);
    setListas((l as Lista[]) ?? []);
    setItens((i as Item[]) ?? []);
    setPerfis((p as Perfil[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    carregar();
    try {
      const salvo = localStorage.getItem("brasico-lista");
      if (salvo) setAtual(salvo);
    } catch {}
    const ch = supabase
      .channel("brainstorm-listas")
      .on("postgres_changes", { event: "*", schema: "public", table: "listas" }, () => carregar())
      .on("postgres_changes", { event: "*", schema: "public", table: "lista_itens" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  const lista = listas?.find((l) => l.id === atual) ?? listas?.[0] ?? null;
  function abrirLista(id: string) {
    setAtual(id);
    setAberto(null);
    setVerFeitos(false);
    try {
      localStorage.setItem("brasico-lista", id);
    } catch {}
  }

  const nomeDe = (id: string | null) => {
    if (!id) return "";
    if (id === userId) return "Você";
    const p = perfis.find((x) => x.id === id);
    return p?.display_name || p?.email?.split("@")[0] || "Alguém";
  };

  const daLista = itens.filter((i) => i.lista_id === lista?.id);
  const abertos = daLista.filter((i) => !i.feito);
  const feitos = daLista.filter((i) => i.feito).sort((a, b) => (b.feito_em ?? "").localeCompare(a.feito_em ?? ""));
  const contar = (id: string) => itens.filter((i) => i.lista_id === id && !i.feito).length;

  async function salvarItem(id: string, campos: Partial<Item>) {
    setItens((l) => l.map((i) => (i.id === id ? { ...i, ...campos } : i)));
    const { error } = await supabase.from("lista_itens").update(campos).eq("id", id);
    if (error) {
      alert(error.message);
      carregar();
    }
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const texto = novoItem.trim();
    if (!texto || !lista) return;
    setNovoItem("");
    const { error } = await supabase.from("lista_itens").insert({ lista_id: lista.id, texto, criado_por: userId });
    if (error) {
      setNovoItem(texto);
      return alert(error.message);
    }
    carregar();
  }

  async function criarLista(e: React.FormEvent) {
    e.preventDefault();
    const nome = (novaLista ?? "").trim();
    if (!nome) return setNovaLista(null);
    const ordem = Math.max(0, ...(listas ?? []).map((l) => l.ordem)) + 1;
    const { data, error } = await supabase.from("listas").insert({ nome, ordem, criado_por: userId }).select("id").single();
    if (error) return alert(error.message);
    setNovaLista(null);
    await carregar();
    if (data) abrirLista((data as { id: string }).id);
    setTimeout(() => campoItem.current?.focus(), 50);
  }

  async function renomear(id: string, nome: string) {
    setRenomeando(null);
    const n = nome.trim();
    if (!n || n === listas?.find((l) => l.id === id)?.nome) return;
    const { error } = await supabase.from("listas").update({ nome: n }).eq("id", id);
    if (error) return alert(error.message);
    carregar();
  }

  async function arquivarLista(l: Lista) {
    if (!window.confirm(`Arquivar a lista "${l.nome}"? Ela some daqui, mas nada é apagado.`)) return;
    const { error } = await supabase.from("listas").update({ arquivada_em: new Date().toISOString() }).eq("id", l.id);
    if (error) return alert(error.message);
    setAtual(null);
    carregar();
  }

  const linha = (i: Item) => {
    const atrasado = !!i.prazo && !i.feito && i.prazo < hoje();
    const estaAberto = aberto === i.id;
    return (
      <li key={i.id} className={i.feito ? "item feito" : "item"}>
        <div className="item-linha">
          <button
            className={i.feito ? "check on" : "check"}
            onClick={() => salvarItem(i.id, { feito: !i.feito })}
            aria-label={i.feito ? "Desmarcar" : "Marcar como feito"}
            aria-pressed={i.feito}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.6 2.5L12 5.5" /></svg>
          </button>
          <button className="item-texto" onClick={() => setAberto(estaAberto ? null : i.id)} aria-expanded={estaAberto}>
            <span>{i.texto}</span>
            {(i.responsavel || i.prazo || i.nota) && (
              <span className="item-meta">
                {i.responsavel && <span>{nomeDe(i.responsavel)}</span>}
                {i.prazo && <span className={atrasado ? "atrasado" : ""}>{dataCurta(i.prazo)}</span>}
                {i.nota && <span>nota</span>}
              </span>
            )}
          </button>
        </div>
        {estaAberto && (
          <Editor
            key={i.id}
            item={i}
            listas={listas ?? []}
            perfis={perfis}
            userId={userId}
            onSalvar={(c) => salvarItem(i.id, c)}
            onArquivar={() => {
              salvarItem(i.id, { arquivado_em: new Date().toISOString() } as Partial<Item>);
              setAberto(null);
            }}
            onFechar={() => setAberto(null)}
          />
        )}
      </li>
    );
  };

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="brainstorm" />
      <main className="listas">
        <nav className="listas-lado" aria-label="Listas">
          <span className="listas-rotulo">Listas</span>
          {(listas ?? []).map((l) =>
            renomeando === l.id ? (
              <input
                key={l.id}
                autoFocus
                className="lista-renomear"
                defaultValue={l.nome}
                maxLength={80}
                onBlur={(e) => renomear(l.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenomeando(null);
                }}
              />
            ) : (
              <button
                key={l.id}
                className={lista?.id === l.id ? "lista on" : "lista"}
                onClick={() => abrirLista(l.id)}
                onDoubleClick={() => setRenomeando(l.id)}
              >
                <span>{l.nome}</span>
                <span className="lista-n">{contar(l.id) || ""}</span>
              </button>
            )
          )}
          {novaLista !== null ? (
            <form onSubmit={criarLista}>
              <input
                autoFocus
                className="lista-renomear"
                placeholder="Nome da lista"
                value={novaLista}
                maxLength={80}
                onChange={(e) => setNovaLista(e.target.value)}
                onBlur={(e) => (e.target.value.trim() ? criarLista(e as unknown as React.FormEvent) : setNovaLista(null))}
                onKeyDown={(e) => e.key === "Escape" && setNovaLista(null)}
              />
            </form>
          ) : (
            <button className="lista lista-nova" onClick={() => setNovaLista("")}>+ Nova lista</button>
          )}
        </nav>

        <section className="lista-corpo">
          {listas === null ? (
            <p className="muted">Carregando…</p>
          ) : !lista ? (
            <p className="muted">Crie a primeira lista em “+ Nova lista”.</p>
          ) : (
            <>
              <header className="lista-cabeca">
                <h1>{lista.nome}</h1>
                <span className="muted small">{abertos.length ? `${abertos.length} aberto${abertos.length > 1 ? "s" : ""}` : "Tudo feito"}</span>
                <span className="spacer" />
                <button className="acao" onClick={() => setRenomeando(lista.id)}>Renomear</button>
                <button className="acao" onClick={() => arquivarLista(lista)}>Arquivar lista</button>
              </header>

              <form className="item-novo" onSubmit={adicionar}>
                <span className="check fantasma" aria-hidden="true" />
                <input
                  ref={campoItem}
                  id="novo-item"
                  value={novoItem}
                  onChange={(e) => setNovoItem(e.target.value)}
                  placeholder="Adicionar item"
                  maxLength={300}
                />
              </form>

              <ul className="itens">{abertos.map(linha)}</ul>

              {feitos.length > 0 && (
                <div className="feitos">
                  <button className="feitos-botao" onClick={() => setVerFeitos((v) => !v)} aria-expanded={verFeitos}>
                    {verFeitos ? "Esconder" : "Mostrar"} concluídos ({feitos.length})
                  </button>
                  {verFeitos && <ul className="itens">{feitos.map(linha)}</ul>}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Editor({
  item, listas, perfis, userId, onSalvar, onArquivar, onFechar,
}: {
  item: Item; listas: Lista[]; perfis: Perfil[]; userId: string;
  onSalvar: (c: Partial<Item>) => void; onArquivar: () => void; onFechar: () => void;
}) {
  const [texto, setTexto] = useState(item.texto);
  const [nota, setNota] = useState(item.nota);
  const guardar = () => {
    const c: Partial<Item> = {};
    if (texto.trim() && texto.trim() !== item.texto) c.texto = texto.trim();
    if (nota !== item.nota) c.nota = nota;
    if (Object.keys(c).length) onSalvar(c);
  };
  return (
    <div className="item-editor">
      <input id={`texto-${item.id}`} value={texto} maxLength={300} onChange={(e) => setTexto(e.target.value)} onBlur={guardar} aria-label="Texto" />
      <div className="item-campos">
        <label>
          <span>Quem</span>
          <select value={item.responsavel ?? ""} onChange={(e) => onSalvar({ responsavel: e.target.value || null })}>
            <option value="">Ninguém</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>{p.id === userId ? "Você" : p.display_name || p.email}</option>)}
          </select>
        </label>
        <label>
          <span>Data</span>
          <input type="date" value={item.prazo ?? ""} onChange={(e) => onSalvar({ prazo: e.target.value || null })} />
        </label>
        <label>
          <span>Lista</span>
          <select value={item.lista_id} onChange={(e) => onSalvar({ lista_id: e.target.value })}>
            {listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </label>
      </div>
      <textarea id={`nota-${item.id}`} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} onBlur={guardar} placeholder="Nota (opcional)" />
      <div className="item-acoes">
        <button className="acao acao-excluir" onClick={onArquivar}>Arquivar</button>
        <span className="spacer" />
        <button className="acao" onClick={() => { guardar(); onFechar(); }}>Fechar</button>
      </div>
    </div>
  );
}
