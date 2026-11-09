"use client";

import { useEffect, useMemo, useState } from "react";
import { renderConteudo } from "@/lib/livre";
import { agrupar, semNumero } from "../Abas";
import { TEXTOS, type Idioma } from "@/lib/idioma";

// Aba Réveillon das páginas dos hotéis: os capítulos de hoteis_capitulos (cardápios, fichas, compras, produção)
// num desenho próprio, editorial, sem o visual de "projeto". A capa (:::capa) vira a abertura da aba, o índice
// fica numa coluna à esquerda (no celular, uma faixa que rola) e cada capítulo abre sozinho.
// Na impressão (Baixar PDF) saem a abertura e todos os capítulos, um por página.
// Visual num bloco só em globals.css: "Hotéis · Réveillon" (classes rv-*).

export type CapRv = { id: string; titulo: string; conteudo: string };

type Capa = { marca: string; sobre: string; titulo: string[]; sub: string; infos: [string, string][]; lema: string };

function lerCapa(md: string): Capa | null {
  const m = md.match(/^\s*:::capa\s*\n([\s\S]*?)\n:::/);
  if (!m) return null;
  const c: Capa = { marca: "", sobre: "", titulo: [], sub: "", infos: [], lema: "" };
  for (const l of m[1].split("\n")) {
    const [k, ...r] = l.split(":");
    const v = r.join(":").trim();
    const chave = k.trim().toLowerCase();
    if (chave === "marca") c.marca = v;
    else if (chave === "sobretitulo") c.sobre = v;
    else if (chave === "titulo") c.titulo = v.split("|").map((s) => s.trim());
    else if (chave === "subtitulo") c.sub = v;
    else if (chave === "lema") c.lema = v;
    else if (chave === "info") {
      const [a, b] = v.split("|").map((s) => s.trim());
      c.infos.push([a ?? "", b ?? ""]);
    }
  }
  return c;
}

// Separa a etiqueta (**N · SEÇÃO**), o título (# ...) e a linha de abertura (*...*) do resto do capítulo.
function partes(md: string) {
  let resto = md.replace(/\r/g, "").trimStart();
  let etiqueta = "", titulo = "", abertura = "";
  const e = resto.match(/^\*\*([^*\n]+)\*\*\s*\n/);
  if (e) { etiqueta = e[1].replace(/^\s*\d+\s*·\s*/, "").trim(); resto = resto.slice(e[0].length).trimStart(); }
  const t = resto.match(/^#\s+(.+)\n/);
  if (t) { titulo = t[1].trim(); resto = resto.slice(t[0].length).trimStart(); }
  const a = resto.match(/^\*([^*\n][^\n]*?)\*\s*(\n|$)/);
  if (a) { abertura = a[1].trim(); resto = resto.slice(a[0].length); }
  return { etiqueta, titulo, abertura, resto };
}

const inline = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

export default function Reveillon({ hotel, capitulos, idioma, nome, rodape }: { hotel: string; capitulos: CapRv[]; idioma: Idioma; nome: string; rodape: string | null }) {
  // A capa sai da lista: vira a abertura da aba
  const capaCap = capitulos.find((c) => /^\s*:::capa/.test(c.conteudo));
  const capa = capaCap ? lerCapa(capaCap.conteudo) : null;
  const lista = useMemo(() => capitulos.filter((c) => c !== capaCap), [capitulos, capaCap]);
  const grupos = useMemo(() => agrupar(lista), [lista]);

  const [atual, setAtual] = useState<string | null>(null);
  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.match(/^#cap-(.+)$/);
      if (h) setAtual(decodeURIComponent(h[1]));
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);
  const cap = lista.find((c) => c.id === atual) ?? lista[0];
  const idx = cap ? lista.indexOf(cap) : -1;
  function abrir(id: string) {
    setAtual(id);
    try { history.replaceState(null, "", `#cap-${id}`); } catch {}
    document.getElementById("rv-conteudo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Mantém o capítulo aberto visível na faixa do celular
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".rv-indice");
    const on = nav?.querySelector<HTMLElement>(".on");
    if (nav && on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - 16, behavior: "smooth" });
  }, [cap?.id]);

  // O HTML livre (:::html) só é limpo no navegador: monta o texto depois de abrir a página
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const html = useMemo(() => {
    const m = new Map<string, { etiqueta: string; titulo: string; abertura: string; corpo: string }>();
    for (const c of lista) {
      const p = partes(c.conteudo);
      m.set(c.id, { etiqueta: p.etiqueta, titulo: p.titulo || semNumero(c.titulo), abertura: p.abertura, corpo: montado ? renderConteudo(p.resto, idioma) : "" });
    }
    return m;
  }, [lista, idioma, montado]);

  if (lista.length === 0 && !capa) {
    return (
      <div className="rv-vazio">
        <p>O Réveillon de {nome} ainda não tem conteúdo.</p>
        <p className="muted">Peça ao seu Claude: “na página {nome} do Brasico, monte o cardápio do Réveillon com …”.</p>
      </div>
    );
  }

  return (
    <div className="rv" data-hotel={hotel}>
      {capa && (
        <section className="rv-abertura">
          <div className="rv-abertura-texto">
            {capa.marca && <span className="rv-marca">{capa.marca}</span>}
            {capa.sobre && <span className="rv-sobre">{capa.sobre}</span>}
            <h2 className="rv-titulo">
              {capa.titulo.map((t, i) => <span key={i} className={i > 0 ? "rv-titulo-2" : undefined}>{t}</span>)}
            </h2>
            {capa.sub && <p className="rv-sub">{capa.sub}</p>}
            {capa.lema && <p className="rv-lema">“{capa.lema}”</p>}
          </div>
          {capa.infos.length > 0 && (
            <dl className="rv-fatos">
              {capa.infos.map(([r, v], i) => (
                <div key={i}><dt>{r}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
        </section>
      )}

      {lista.length > 0 && (
        <div className="rv-corpo-grade" id="rv-conteudo">
          <nav className="rv-indice" aria-label="Capítulos">
            {grupos.map((g) => (
              <div key={g.nome + g.caps[0].cap.id} className="rv-indice-grupo">
                {g.caps.length > 1 && <span className="rv-indice-titulo">{g.nome}</span>}
                {g.caps.map(({ cap: c, nome: n }) => {
                  const i = lista.findIndex((x) => x.id === c.id);
                  const on = c.id === cap?.id;
                  return (
                    <button key={c.id} type="button" className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => abrir(c.id)}>
                      <span className="rv-n">{String(i + 1).padStart(2, "0")}</span>
                      <span className="rv-nome">{g.caps.length > 1 ? n : g.nome}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="rv-leitura">
            {lista.map((c) => {
              const h = html.get(c.id)!;
              const grupo = grupos.find((g) => g.caps.some((x) => x.cap.id === c.id));
              // Uma linha só acima do título: o grupo do índice (Cardápios, Fichas técnicas…) ou, sem grupo, a etiqueta do capítulo
              const sobre = grupo && grupo.caps.length > 1 ? grupo.nome : h.etiqueta;
              return (
                <article key={c.id} className={c.id === cap?.id ? "rv-cap on" : "rv-cap"} aria-hidden={c.id !== cap?.id}>
                  <header className="rv-cap-topo">
                    {sobre && <span className="rv-cap-sobre">{sobre}</span>}
                    <h2 dangerouslySetInnerHTML={{ __html: inline(h.titulo) }} />
                    {h.abertura && <p className="rv-cap-abertura" dangerouslySetInnerHTML={{ __html: inline(h.abertura) }} />}
                  </header>
                  <div className="rv-texto" dangerouslySetInnerHTML={{ __html: h.corpo }} />
                </article>
              );
            })}

            <div className="rv-passos">
              {idx > 0 ? (
                <button type="button" onClick={() => abrir(lista[idx - 1].id)}>
                  <span>{TEXTOS[idioma].anterior}</span><b>{html.get(lista[idx - 1].id)?.titulo}</b>
                </button>
              ) : <span />}
              {idx >= 0 && idx < lista.length - 1 ? (
                <button type="button" className="prox" onClick={() => abrir(lista[idx + 1].id)}>
                  <span>{TEXTOS[idioma].proximo}</span><b>{html.get(lista[idx + 1].id)?.titulo}</b>
                </button>
              ) : <span />}
            </div>
            {rodape && <footer className="rv-rodape">{rodape}</footer>}
          </div>
        </div>
      )}
    </div>
  );
}
