"use client";

import { useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent as KeyboardEventReact } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTable } from "@/lib/useTable";
import { haQuanto } from "@/lib/tempo";
import { cssDoProjeto } from "@/lib/livre";
import { semDuplicatas } from "@/lib/historico";
import DocView from "./DocView";
import { chaveCelula } from "@/lib/markdown";
import Topo from "./Topo";
import VisorPdf from "./VisorPdf";
import Bandeira from "./Bandeira";
import Abas, { semNumero } from "./Abas";
import { IDIOMAS, TEXTOS, ehIdioma, type Idioma } from "@/lib/idioma";

type Info = { id: string; name: string; doc_rodape: string | null; doc_rodape_en: string | null; doc_rodape_pl: string | null; doc_rodape_fr: string | null; doc_rodape_de: string | null; doc_css: string | null; doc_abas: boolean | null; doc_abas_grupos: boolean | null; removido_em: string | null; is_public: boolean | null; public_slug: string | null };
type Nota = { id: string; title: string; content: string; title_en: string | null; content_en: string | null; title_pl: string | null; content_pl: string | null; title_fr: string | null; content_fr: string | null; title_de: string | null; content_de: string | null; archived_at: string | null };
type Log = { id: string; user_id: string | null; action: string; entity: string; entity_id: string | null; details: string | null; source: string; created_at: string };
type Perfil = { id: string; email: string | null; display_name: string | null };

const VERBO: Record<string, string> = {
  insert: "criou",
  update: "editou",
  archive: "removeu",
  restore: "restaurou",
  delete: "apagou",
  restore_version: "voltou a uma versão anterior:",
  rename: "renomeou",
  trash: "mandou para a Lixeira",
  untrash: "tirou da Lixeira",
};
const COISA: Record<string, string> = {
  notes: "o capítulo",
  metrics: "o indicador",
  files: "o arquivo",
  workspaces: "o projeto",
};


export default function Projeto({ projectId, userId, userEmail }: { projectId: string; userId: string; userEmail: string }) {
  const supabase = createClient();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [perfis, setPerfis] = useState<Record<string, Perfil>>({});
  const [modo, setModo] = useState<"pagina" | "pdf">("pagina");
  const [painel, setPainel] = useState<"sumario" | "mudancas" | "compartilhar" | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("pt");
  // Tabelas editáveis (:::editavel): o que os sócios digitam no site
  const [celulas, setCelulas] = useState<Record<string, string>>({});

  // Fecha o painel com Esc
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && setPainel(null);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // Lembra a visualização escolhida neste navegador
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("ver") ?? localStorage.getItem("brasico-ver");
      if (v === "pdf" || v === "pagina") setModo(v);
      const l = new URLSearchParams(window.location.search).get("lang") ?? localStorage.getItem("brasico-idioma");
      if (ehIdioma(l)) setIdioma(l);
    } catch {}
  }, []);
  function trocarIdioma(l: Idioma) {
    setIdioma(l);
    try {
      localStorage.setItem("brasico-idioma", l);
    } catch {}
  }
  function trocarModo(m: "pagina" | "pdf") {
    setModo(m);
    try {
      localStorage.setItem("brasico-ver", m);
    } catch {}
  }

  const { rows: notas, loading } = useTable<Nota>("notes", projectId, { orderBy: "title", ascending: true, limit: 500 });
  const { rows: logTodo } = useTable<Log>("activity_log", projectId, { orderBy: "created_at", ascending: false, limit: 40 });
  const log = semDuplicatas(logTodo).filter((l) => l.entity === "notes" || l.entity === "workspaces").slice(0, 15);

  useEffect(() => {
    (async () => {
      await supabase.rpc("accept_invites");
      const { data } = await supabase.from("workspaces").select("id,name,doc_rodape,doc_rodape_en,doc_rodape_pl,doc_rodape_fr,doc_rodape_de,doc_css,doc_abas,doc_abas_grupos,removido_em,is_public,public_slug").eq("id", projectId).maybeSingle();
      setInfo((data as Info) ?? null);
      const { data: m } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", projectId);
      const ids = (m ?? []).map((x: { user_id: string }) => x.user_id);
      if (!ids.length) return;
      const { data: p } = await supabase.from("profiles").select("id,email,display_name").in("id", ids);
      const map: Record<string, Perfil> = {};
      (p ?? []).forEach((x: Perfil) => (map[x.id] = x));
      setPerfis(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("celulas_editaveis").select("bloco,linha,coluna,valor").eq("workspace_id", projectId);
      const map: Record<string, string> = {};
      (data ?? []).forEach((c: { bloco: string; linha: number; coluna: number; valor: string }) => (map[chaveCelula(c.bloco, c.linha, c.coluna)] = c.valor));
      setCelulas(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Salva a célula ao sair dela (Enter também salva; Esc desfaz)
  async function salvarCelula(e: FocusEvent<HTMLElement>) {
    const td = e.target as HTMLElement;
    const pos = td?.dataset?.ed;
    const bloco = td?.closest<HTMLElement>("[data-editavel]")?.dataset.editavel;
    if (!pos || !bloco) return;
    const [linha, coluna] = pos.split(":").map(Number);
    const valor = (td.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (td.innerText !== valor) td.innerText = valor;
    if (valor === (td.dataset.atual ?? "")) return;
    const { error } = await supabase.from("celulas_editaveis").upsert(
      { workspace_id: projectId, bloco, linha, coluna, valor, atualizado_por: userId },
      { onConflict: "workspace_id,bloco,linha,coluna" }
    );
    if (error) {
      alert("Não foi possível salvar: " + error.message);
      td.innerText = td.dataset.atual ?? "";
      return;
    }
    td.dataset.atual = valor;
    setCelulas((c) => ({ ...c, [chaveCelula(bloco, linha, coluna)]: valor }));
  }
  function teclaCelula(e: KeyboardEventReact<HTMLElement>) {
    const td = e.target as HTMLElement;
    if (!td?.dataset?.ed) return;
    if (e.key === "Enter") {
      e.preventDefault();
      td.blur();
    } else if (e.key === "Escape") {
      td.innerText = td.dataset.atual ?? "";
      td.blur();
    }
  }

  // O nome do projeto também atualiza ao vivo quando o Claude renomeia
  useEffect(() => {
    const ch = supabase
      .channel(`ws-${projectId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspaces", filter: `id=eq.${projectId}` },
        (p) => setInfo((i) => (i ? { ...i, ...(p.new as Info) } : i)))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Traduções: cada idioma só aparece no seletor quando algum capítulo tem versão nele.
  // Capítulo sem tradução continua em português.
  // Todos os projetos oferecem PT | EN | PL | FR | DE; capítulo ainda sem tradução aparece em português.
  const idiomas = IDIOMAS;
  const lingua: Idioma = idiomas.some((l) => l.id === idioma) ? idioma : "pt";
  const capitulos = useMemo(
    () =>
      notas
        .filter((n) => !n.archived_at)
        .map((n) => {
          const t = lingua === "en" ? [n.title_en, n.content_en] : lingua === "pl" ? [n.title_pl, n.content_pl] : lingua === "fr" ? [n.title_fr, n.content_fr] : lingua === "de" ? [n.title_de, n.content_de] : [null, null];
          return { id: n.id, titulo: t[0]?.trim() || n.title, conteudo: t[1]?.trim() || n.content };
        }),
    [notas, lingua]
  );
  const rodape =
    (lingua === "en" ? info?.doc_rodape_en?.trim() : lingua === "pl" ? info?.doc_rodape_pl?.trim() : lingua === "fr" ? info?.doc_rodape_fr?.trim() : lingua === "de" ? info?.doc_rodape_de?.trim() : null) || info?.doc_rodape || null;
  const ultimaMudanca = log[0]?.created_at;

  // Abas: no modo página cada capítulo abre sozinho. A aba fica no endereço (#cap-…).
  const [aba, setAba] = useState<string | null>(null);
  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.match(/^#cap-(.+)$/);
      setAba(h ? decodeURIComponent(h[1]) : null);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);
  // Só os projetos que escolheram abas (doc_abas) mostram um capítulo por vez.
  const emAbas = modo === "pagina" && !!info?.doc_abas;
  const abaAtual = capitulos.find((c) => c.id === aba) ?? capitulos[0];
  const idxAtual = abaAtual ? capitulos.indexOf(abaAtual) : -1;
  function abrirAba(id: string | undefined) {
    if (!id) return;
    setAba(id);
    try {
      history.replaceState(null, "", `#cap-${id}`);
    } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  // Mantém a aba ativa visível na faixa rolável (celular)
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".abas").forEach((nav) => {
      const on = nav.querySelector<HTMLElement>(".aba.on");
      if (on && nav.scrollWidth > nav.clientWidth)
        nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: "smooth" });
    });
  }, [abaAtual?.id, emAbas]);

  const nomeDe = (id: string | null) => {
    if (!id) return "Alguém";
    if (id === userId) return "Você";
    const p = perfis[id];
    return p?.display_name || p?.email?.split("@")[0] || "Alguém";
  };

  // Renomear o projeto direto no título
  const [editandoNome, setEditandoNome] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  function comecarRenomear() {
    if (!info) return;
    setNovoNome(info.name);
    setEditandoNome(true);
  }
  async function salvarNome() {
    if (!info || salvandoNome) return;
    const nome = novoNome.trim();
    if (!nome) return alert("Informe o nome do projeto.");
    if (nome === info.name) return setEditandoNome(false);
    setSalvandoNome(true);
    const { error } = await supabase.rpc("renomear_projeto", { p_projeto: projectId, p_nome: nome });
    setSalvandoNome(false);
    if (error) return alert(error.message);
    setInfo((i) => (i ? { ...i, name: nome } : i));
    setEditandoNome(false);
  }

  async function excluir() {
    if (!info) return;
    if (!window.confirm(`Mandar "${info.name}" para a Lixeira?

Ele some da lista da equipe, mas fica guardado e pode ser restaurado na página de projetos.`)) return;
    const { error } = await supabase.rpc("remover_projeto", { p_projeto: projectId });
    if (error) return alert(error.message);
    window.location.href = "/";
  }

  // Link público (só leitura, sem login)
  const [compartilhando, setCompartilhando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const linkPublico = info?.is_public && info.public_slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/p/${info.public_slug}` : null;
  async function compartilhar(ativo: boolean, novo = false) {
    if (!info || compartilhando) return;
    if (ativo && !info.is_public && !window.confirm(`Gerar um link público de "${info.name}"?

Quem tiver o link vê o documento deste projeto, sem login. Não vê outros projetos nem nada do Brasico. Você pode desativar o link quando quiser.`)) return;
    if (novo && !window.confirm("Gerar um link novo? O link atual para de funcionar na hora.")) return;
    if (!ativo && !window.confirm("Desativar o link? Quem tiver o link não consegue mais abrir o projeto.")) return;
    setCompartilhando(true);
    const { data, error } = await supabase.rpc("compartilhar_projeto", { p_projeto: projectId, p_ativo: ativo, p_novo: novo });
    setCompartilhando(false);
    if (error) return alert(error.message);
    const slug = String((data as { caminho: string }).caminho).replace("/p/", "");
    setInfo((i) => (i ? { ...i, is_public: ativo, public_slug: slug } : i));
    setCopiado(false);
  }
  async function copiarLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt("Copie o link:", link);
    }
  }

  // Baixar PDF: mostra as folhas A4 e abre "Salvar como PDF"; o arquivo sai com o nome do projeto
  function baixarPdf() {
    if (!info) return;
    setModo("pdf");
    const antes = document.title;
    const voltar = () => {
      document.title = antes;
      window.removeEventListener("afterprint", voltar);
    };
    window.addEventListener("afterprint", voltar);
    setTimeout(() => {
      document.title = info.name;
      window.print();
    }, 500);
  }

  async function restaurar() {
    const { error } = await supabase.rpc("restaurar_projeto", { p_projeto: projectId });
    if (error) return alert(error.message);
    setInfo((i) => (i ? { ...i, removido_em: null } : i));
  }

  if (info === undefined) return <main className="center muted">Carregando…</main>;
  if (info === null)
    return (
      <main className="center">
        <div className="card login">
          <h1>Projeto não encontrado</h1>
          <p className="muted">Ele não existe ou você ainda não faz parte da equipe dele.</p>
          <a href="/"><button>Ver projetos</button></a>
        </div>
      </main>
    );

  return (
    <div className={modo === "pagina" ? "pagina pagina-doc modo-pagina" : "pagina pagina-doc"}>
      <Topo email={userEmail} ativo="projetos" />

      <div className="proj-barra">
        <a href="/" className="voltar">← Projetos</a>
        {editandoNome ? (
          <form
            className="renomear"
            onSubmit={(e) => {
              e.preventDefault();
              salvarNome();
            }}
          >
            <input
              autoFocus
              value={novoNome}
              maxLength={120}
              aria-label="Nome do projeto"
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditandoNome(false)}
            />
            <button type="submit" disabled={salvandoNome}>{salvandoNome ? "Salvando…" : "Salvar"}</button>
            <button type="button" className="botao-painel" onClick={() => setEditandoNome(false)}>Cancelar</button>
          </form>
        ) : (
          <h1 className="proj-nome">
            {info.name}
            <button className="editar-nome" onClick={comecarRenomear} title="Renomear projeto" aria-label="Renomear projeto">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
          </h1>
        )}
        <div className="spacer" />
        <div className="proj-acoes">
          {/* Projetos com abas já mostram os capítulos nas abas: sem botão Sumário */}
          {!info.doc_abas && (
            <button
              className={painel === "sumario" ? "acao on" : "acao"}
              onClick={() => setPainel(painel === "sumario" ? null : "sumario")}
            >
              Sumário
            </button>
          )}
          <button
            className={painel === "mudancas" ? "acao on" : "acao"}
            onClick={() => setPainel(painel === "mudancas" ? null : "mudancas")}
            title="Últimas mudanças"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Mudanças{ultimaMudanca ? <span className="acao-quando"> · {haQuanto(ultimaMudanca)}</span> : null}
          </button>
          <button
            className={painel === "compartilhar" ? "acao on" : info.is_public ? "acao acao-publico" : "acao"}
            onClick={() => setPainel(painel === "compartilhar" ? null : "compartilhar")}
            title="Link para mostrar o projeto a alguém"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            Compartilhar{info.is_public ? <span className="acao-quando"> · ativo</span> : null}
          </button>
          {capitulos.length > 0 && (
            <div className="alternar alternar-idioma" role="group" aria-label="Idioma do documento">
              {idiomas.map((l) => (
                <button
                  key={l.id}
                  className={lingua === l.id ? "on" : ""}
                  onClick={() => trocarIdioma(l.id)}
                  title={l.nome}
                  aria-label={l.nome}
                  aria-pressed={lingua === l.id}
                  lang={l.lang}
                >
                  <Bandeira idioma={l.id} />
                </button>
              ))}
            </div>
          )}
          <div className="alternar" role="group" aria-label="Visualização">
            <button className={modo === "pagina" ? "on" : ""} onClick={() => trocarModo("pagina")}>Página</button>
            <button className={modo === "pdf" ? "on" : ""} onClick={() => trocarModo("pdf")}>PDF</button>
          </div>
          {capitulos.length > 0 && (
            <button className="acao" onClick={baixarPdf} title="Gerar o arquivo PDF do documento para enviar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
              Baixar PDF
            </button>
          )}
          {!info.removido_em && (
            <button className="acao acao-icone acao-excluir" onClick={excluir} title="Mandar para a Lixeira" aria-label="Excluir projeto">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
            </button>
          )}
        </div>
      </div>

      {info.removido_em && (
        <div className="aviso-lixeira">
          <span>Este projeto está na <b>Lixeira</b> desde {haQuanto(info.removido_em)}. Ele não aparece na lista da equipe.</span>
          <button onClick={restaurar}>Restaurar</button>
        </div>
      )}

      {info.doc_css && (
        <style dangerouslySetInnerHTML={{ __html: cssDoProjeto(info.doc_css, ".doc-escopo") }} />
      )}
      <main className="proj-doc doc-escopo" onBlur={salvarCelula} onKeyDown={teclaCelula}>
        {loading ? (
          <p className="muted">Carregando…</p>
        ) : capitulos.length === 0 ? (
          <div className="vazio">
            <p>Este projeto ainda está vazio.</p>
            <p className="muted">
              Peça ao seu Claude: “no projeto {info.name} do Brasico, crie a capa e o primeiro capítulo com …”.
            </p>
          </div>
        ) : (
          emAbas && abaAtual ? (
            <>
              <Abas capitulos={capitulos} atual={abaAtual.id} grupos={!!info.doc_abas_grupos} abrir={abrirAba} />
              <DocView key={`${abaAtual.id}-${lingua}`} capitulos={[abaAtual]} modo="pagina" idioma={lingua} celulas={celulas} editavel />
              <div className="abas-passo">
                {idxAtual > 0 ? (
                  <button className="passo" onClick={() => abrirAba(capitulos[idxAtual - 1].id)}>
                    <span className="muted small">{TEXTOS[lingua].anterior}</span>
                    <b>{semNumero(capitulos[idxAtual - 1].titulo)}</b>
                  </button>
                ) : <span />}
                {idxAtual < capitulos.length - 1 ? (
                  <button className="passo passo-prox" onClick={() => abrirAba(capitulos[idxAtual + 1].id)}>
                    <span className="muted small">{TEXTOS[lingua].proximo}</span>
                    <b>{semNumero(capitulos[idxAtual + 1].titulo)}</b>
                  </button>
                ) : <span />}
              </div>
              {rodape && <footer className="doc-pagina-rodape">{rodape}</footer>}
            </>
          ) : (
            <DocView capitulos={capitulos} rodape={rodape} modo={modo} idioma={lingua} celulas={celulas} editavel={modo === "pagina"} />
          )
        )}
      </main>

      <VisorPdf />

      {painel && <div className="painel-fundo" onClick={() => setPainel(null)} />}

      <aside className={painel === "sumario" ? "painel painel-esq aberto" : "painel painel-esq"} aria-hidden={painel !== "sumario"}>
        <div className="painel-topo">
          <span className="lado-titulo">Sumário</span>
          <button className="fechar" onClick={() => setPainel(null)} aria-label="Fechar">×</button>
        </div>
        <ol className="sumario">
          {capitulos.map((c) => (
            <li key={c.id}>
              <a
                href={`#cap-${c.id}`}
                className={emAbas && c.id === abaAtual?.id ? "on" : undefined}
                onClick={(e) => {
                  setPainel(null);
                  if (emAbas) {
                    e.preventDefault();
                    abrirAba(c.id);
                  }
                }}
              >
                {semNumero(c.titulo)}
              </a>
            </li>
          ))}
        </ol>
      </aside>

      <aside className={painel === "compartilhar" ? "painel painel-dir aberto" : "painel painel-dir"} aria-hidden={painel !== "compartilhar"}>
        <div className="painel-topo">
          <span className="lado-titulo">Compartilhar</span>
          <button className="fechar" onClick={() => setPainel(null)} aria-label="Fechar">×</button>
        </div>
        <div className="compartilhar">
          {linkPublico ? (
            <>
              <p className="estado ok">Link ativo</p>
              <p className="muted small">Quem tiver este link vê o documento deste projeto, sem login, em PT, EN e PL. Vê também os documentos (PDFs) do projeto. Não vê outros projetos, a equipe nem as mudanças.</p>
              <input className="link-publico" readOnly value={linkPublico} onFocus={(e) => e.currentTarget.select()} aria-label="Link da página" />
              <div className="compartilhar-acoes">
                <button onClick={() => copiarLink(linkPublico)}>{copiado ? "Copiado ✓" : "Copiar link"}</button>
                <a className="acao" href={linkPublico} target="_blank" rel="noopener noreferrer">Abrir</a>
              </div>
              <p className="muted small">Para mandar o PDF, use o botão Baixar PDF no topo do projeto e envie o arquivo.</p>
              <div className="compartilhar-acoes">
                <button className="botao-painel" disabled={compartilhando} onClick={() => compartilhar(true, true)}>Gerar novo link</button>
                <button className="botao-painel perigo" disabled={compartilhando} onClick={() => compartilhar(false)}>Desativar link</button>
              </div>
              <p className="muted small">Gerar um novo link desliga o atual. Desativar tira o acesso na hora.</p>
            </>
          ) : (
            <>
              <p className="muted small">Gere um link para mostrar este projeto a alguém de fora. A pessoa abre sem login e vê só o documento deste projeto, sem acesso a mais nada do Brasico.</p>
              <button disabled={compartilhando || !!info.removido_em} onClick={() => compartilhar(true)}>{compartilhando ? "Gerando…" : "Gerar link"}</button>
              {info.removido_em && <p className="muted small">Projeto na Lixeira não pode ser compartilhado.</p>}
            </>
          )}
        </div>
      </aside>

      <aside className={painel === "mudancas" ? "painel painel-dir aberto" : "painel painel-dir"} aria-hidden={painel !== "mudancas"}>
        <div className="painel-topo">
          <span className="lado-titulo">Últimas mudanças</span>
          <button className="fechar" onClick={() => setPainel(null)} aria-label="Fechar">×</button>
        </div>
        <ul className="mudancas">
          {log.map((l) => (
            <li key={l.id}>
              <span>
                <b>{nomeDe(l.user_id)}</b> {VERBO[l.action] ?? l.action} {COISA[l.entity] ?? l.entity}
                {l.details ? <> <i>{semNumero(l.details)}</i></> : null}
              </span>
              <span className="muted small">
                {haQuanto(l.created_at)}
                {l.source === "claude" && <span className="via">via Claude</span>}
              </span>
            </li>
          ))}
          {!log.length && <li className="muted small">Nenhuma mudança ainda.</li>}
        </ul>
      </aside>
    </div>
  );
}
