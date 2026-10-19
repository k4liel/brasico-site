"use client";

// Página pública de um projeto: só o documento, sem menu, sem login e sem
// nenhum dado do sistema. Os dados vêm de documento_publico(slug), que só
// devolve o conteúdo se o link estiver ativo.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cssDoProjeto } from "@/lib/livre";
import DocView from "./DocView";
import Bandeira from "./Bandeira";
import VisorPdf from "./VisorPdf";
import { IDIOMAS, TEXTOS, type Idioma } from "@/lib/idioma";

type Cap = { titulo: string; conteudo: string; titulo_en: string | null; conteudo_en: string | null; titulo_pl: string | null; conteudo_pl: string | null };
type Doc = { nome: string; rodape: string | null; rodape_en: string | null; rodape_pl: string | null; css: string | null; abas: boolean; capitulos: Cap[] };

const semNumero = (t: string) => t.replace(/^\s*\d+\s*[·.\-–—]\s*/, "");
const numeroDe = (t: string) => t.match(/^\s*(\d+)\s*[·.\-–—]/)?.[1] ?? null;
// Documentos do projeto: no link público abrem pela rota /api/publico/<código>/..., que confere o código
const comLinkPublico = (md: string, slug: string) => md.replace(/^(\s*base:\s*)\/api\/arquivo\//gm, `$1/api/publico/${slug}/`);

const PAGINA = { pt: "Página", en: "Page", pl: "Strona" } as const;
const BAIXAR = { pt: "Baixar PDF", en: "Download PDF", pl: "Pobierz PDF" } as const;
const AVISO = {
  pt: ["Link indisponível", "Este link não existe ou foi desativado. Peça um novo link a quem compartilhou."],
  en: ["Link unavailable", "This link does not exist or has been turned off. Ask the person who shared it for a new link."],
  pl: ["Link niedostępny", "Ten link nie istnieje lub został wyłączony. Poproś osobę, która go udostępniła, o nowy link."],
} as const;

export default function Publico({ slug }: { slug: string }) {
  const [doc, setDoc] = useState<Doc | null | undefined>(undefined);
  const [idioma, setIdioma] = useState<Idioma>("pt");
  const [modo, setModo] = useState<"pagina" | "pdf">("pagina");
  const [aba, setAba] = useState(0);

  useEffect(() => {
    (async () => {
      const { data, error } = await createClient().rpc("documento_publico", { p_slug: slug });
      setDoc(error || !data ? null : (data as Doc));
    })();
  }, [slug]);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("ver") === "pdf") setModo("pdf");
      const l = q.get("lang") ?? localStorage.getItem("brasico-idioma");
      if (l === "pt" || l === "en" || l === "pl") setIdioma(l);
    } catch {}
    const ler = () => {
      const m = window.location.hash.match(/^#cap-(\d+)$/);
      setAba(m ? Number(m[1]) - 1 : 0);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  useEffect(() => {
    if (doc) document.title = doc.nome;
  }, [doc]);

  function trocarIdioma(l: Idioma) {
    setIdioma(l);
    try {
      localStorage.setItem("brasico-idioma", l);
    } catch {}
  }
  // Baixar PDF: mostra o documento inteiro em folhas A4 e abre a janela de impressão (Salvar como PDF)
  function baixarPdf() {
    setModo("pdf");
    setTimeout(() => {
      if (doc) document.title = doc.nome;
      window.print();
    }, 500);
  }
  function abrirAba(i: number) {
    setAba(i);
    try {
      history.replaceState(null, "", `#cap-${i + 1}`);
    } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const capitulos = useMemo(
    () =>
      (doc?.capitulos ?? []).map((c, i) => {
        const t = idioma === "en" ? [c.titulo_en, c.conteudo_en] : idioma === "pl" ? [c.titulo_pl, c.conteudo_pl] : [null, null];
        return { id: String(i + 1), titulo: t[0]?.trim() || c.titulo, conteudo: comLinkPublico(t[1]?.trim() || c.conteudo, slug) };
      }),
    [doc, idioma, slug]
  );

  if (doc === undefined) return <main className="center muted">…</main>;
  if (doc === null)
    return (
      <main className="center">
        <div className="card login">
          <h1>{AVISO[idioma][0]}</h1>
          <p className="muted">{AVISO[idioma][1]}</p>
        </div>
      </main>
    );

  const rodape = (idioma === "en" ? doc.rodape_en?.trim() : idioma === "pl" ? doc.rodape_pl?.trim() : null) || doc.rodape || null;
  const emAbas = modo === "pagina" && doc.abas && capitulos.length > 1;
  const i = Math.min(Math.max(aba, 0), Math.max(capitulos.length - 1, 0));
  const atual = capitulos[i];

  return (
    <div className={modo === "pagina" ? "pagina pagina-doc modo-pagina publico" : "pagina pagina-doc publico"}>
      <div className="proj-barra">
        <h1 className="proj-nome">{doc.nome}</h1>
        <div className="spacer" />
        <div className="proj-acoes">
          <div className="alternar alternar-idioma" role="group" aria-label="Idioma">
            {IDIOMAS.map((l) => (
              <button key={l.id} className={idioma === l.id ? "on" : ""} onClick={() => trocarIdioma(l.id)} title={l.nome} aria-label={l.nome} aria-pressed={idioma === l.id} lang={l.lang}>
                <Bandeira idioma={l.id} />
              </button>
            ))}
          </div>
          <div className="alternar" role="group" aria-label="Visualização">
            <button className={modo === "pagina" ? "on" : ""} onClick={() => setModo("pagina")}>{PAGINA[idioma]}</button>
            <button className={modo === "pdf" ? "on" : ""} onClick={() => setModo("pdf")}>PDF</button>
          </div>
          <button className="acao" onClick={baixarPdf}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
            {BAIXAR[idioma]}
          </button>
        </div>
      </div>

      {doc.css && <style dangerouslySetInnerHTML={{ __html: cssDoProjeto(doc.css, ".doc-escopo") }} />}
      <main className="proj-doc doc-escopo">
        {capitulos.length === 0 ? (
          <p className="muted">…</p>
        ) : emAbas && atual ? (
          <>
            <nav className="abas" aria-label="Capítulos">
              {capitulos.map((c, n) => {
                const num = numeroDe(c.titulo);
                return (
                  <button key={c.id} className={n === i ? "aba on" : "aba"} aria-current={n === i ? "page" : undefined} title={semNumero(c.titulo)} onClick={() => abrirAba(n)}>
                    {num && <span className="aba-num">{num}</span>}
                    <span className="aba-nome">{semNumero(c.titulo)}</span>
                  </button>
                );
              })}
            </nav>
            <DocView key={`${atual.id}-${idioma}`} capitulos={[atual]} modo="pagina" idioma={idioma} />
            <div className="abas-passo">
              {i > 0 ? (
                <button className="passo" onClick={() => abrirAba(i - 1)}>
                  <span className="muted small">{TEXTOS[idioma].anterior}</span>
                  <b>{semNumero(capitulos[i - 1].titulo)}</b>
                </button>
              ) : <span />}
              {i < capitulos.length - 1 ? (
                <button className="passo passo-prox" onClick={() => abrirAba(i + 1)}>
                  <span className="muted small">{TEXTOS[idioma].proximo}</span>
                  <b>{semNumero(capitulos[i + 1].titulo)}</b>
                </button>
              ) : <span />}
            </div>
            {rodape && <footer className="doc-pagina-rodape">{rodape}</footer>}
          </>
        ) : (
          <DocView capitulos={capitulos} rodape={rodape} modo={modo} idioma={idioma} />
        )}
      </main>
      <VisorPdf />
    </div>
  );
}
