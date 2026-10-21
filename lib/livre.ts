// =====================================================================
// Conteúdo livre: blocos :::html dentro dos capítulos e CSS por projeto.
// Permite ao Claude criar qualquer layout (grades, faixas, gráficos em
// SVG, linhas do tempo…) sem precisar mudar o código do site.
// Tudo passa por uma lista de permissões: nada de script, iframe,
// formulário, eventos (onclick…) ou links javascript:.
// =====================================================================
import type { Idioma } from "./idioma";
import { renderMarkdown } from "./markdown";

const TAGS = new Set(
  (
    "div span p a b strong i em u s small mark sub sup br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd " +
    "table thead tbody tfoot tr th td caption colgroup col img figure figcaption blockquote pre code " +
    "section article header footer aside nav details summary progress meter time abbr " +
    "svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop title desc"
  ).split(" ")
);

const ATRIBUTOS = new Set(
  (
    "class style id title colspan rowspan href src alt width height align valign open value max min low high optimum datetime " +
    "viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity stroke-opacity " +
    "x y x1 y1 x2 y2 cx cy r rx ry points transform font-size font-weight font-family text-anchor dominant-baseline " +
    "offset stop-color stop-opacity gradientunits preserveaspectratio xmlns role"
  ).split(" ")
);

function urlSegura(v: string, img: boolean) {
  const s = v.trim().toLowerCase();
  if (s.startsWith("#") || s.startsWith("https://") || s.startsWith("http://") || s.startsWith("mailto:")) return true;
  if (img && s.startsWith("data:image/") && !s.startsWith("data:image/svg")) return true;
  return false;
}

function estiloSeguro(v: string) {
  return !/javascript:|expression\s*\(|behavior\s*:|-moz-binding|url\s*\(\s*['"]?\s*(?!https?:|data:image\/(?!svg))/i.test(v);
}

function limpar(no: Element) {
  for (const filho of Array.from(no.children)) {
    const tag = filho.tagName.toLowerCase();
    if (!TAGS.has(tag)) {
      filho.remove();
      continue;
    }
    for (const at of Array.from(filho.attributes)) {
      const nome = at.name.toLowerCase();
      const ok =
        (ATRIBUTOS.has(nome) || nome.startsWith("aria-") || nome.startsWith("data-")) &&
        !nome.startsWith("on") &&
        (nome !== "href" || urlSegura(at.value, false)) &&
        (nome !== "src" || urlSegura(at.value, true)) &&
        (nome !== "style" || estiloSeguro(at.value));
      if (!ok) filho.removeAttribute(at.name);
    }
    if (tag === "a") {
      filho.setAttribute("target", "_blank");
      filho.setAttribute("rel", "noopener noreferrer");
    }
    limpar(filho);
  }
}

/** Limpa um trecho de HTML. Só roda no navegador; no servidor não mostra nada. */
export function limparHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const raiz = doc.body.firstElementChild;
  if (!raiz) return "";
  limpar(raiz);
  return raiz.innerHTML;
}

/** Limpa o CSS do projeto e o prende dentro do documento (não afeta o resto do site). */
export function cssDoProjeto(css: string | null | undefined, escopo: string): string {
  if (!css) return "";
  const limpo = css
    .slice(0, 60000)
    .replace(/<\/?\s*style/gi, "")
    .replace(/</g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@charset[^;]*;?/gi, "")
    .replace(/javascript:|expression\s*\(|behavior\s*:|-moz-binding/gi, "")
    .replace(/url\s*\(\s*['"]?\s*(?!https?:|data:image\/(?!svg))[^)]*\)/gi, "none");
  // CSS aninhado: tudo vale só dentro do documento deste projeto
  return `${escopo} {\n${limpo}\n}`;
}

/** Markdown com os blocos do Brasico + blocos :::html livres. */
export function renderConteudo(md: string, idioma: Idioma = "pt", extra: { celulas?: Record<string, string>; editavel?: boolean } = {}): string {
  const partes = md.replace(/\r/g, "").split(/^:::html[^\n]*\n([\s\S]*?)^:::[ \t]*$/m);
  // split com grupo: [md, html, md, html, md...]
  return partes
    .map((p, i) => (i % 2 === 1 ? `<div class="bloco-livre">${limparHtml(p)}</div>` : p.trim() ? renderMarkdown(p, { idioma, ...extra }) : ""))
    .join("");
}
