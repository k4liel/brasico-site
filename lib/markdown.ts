// Renderizador de Markdown do Brasico (seguro: escapa todo HTML antes).
//
// Markdown comum: títulos (#, ##, ###), parágrafos, **negrito**, *itálico*,
// `código`, listas (- e 1.), citações (>), linha (---) e tabelas (| a | b |).
//
// Blocos especiais (visual do documento):
//   :::capa      capa azul. Linhas "chave: valor":
//                marca, sobretitulo, titulo (use " | " para quebrar linha),
//                subtitulo, info (Rótulo | Valor, uma por linha), lema
//   :::cards     cartões. Uma linha por cartão: Rótulo | Valor | Descrição
//                (comece com "!" para o cartão em destaque azul)
//   :::colunas   conteúdo em duas colunas (cardápios)
//   :::escala    grade de escala em quadradinhos coloridos (um dia por coluna):
//                titulo: Cozinha · novembro de 2026
//                dias: Dom 01 | Seg 02 | ...      (cabeçalho; "Dom" destaca o domingo)
//                ## Cozinha · manhã                (linha de grupo)
//                Nome | F | 08-17 | F | 09-13/17-21 | 19-07 | - | ...
//                (2ª coluna = sexo F/M, opcional; célula F = folga, - = descanso 12x36)
//   :::checks    checagens: status | título | detalhe (status ok ou alerta)
//   :::          fecha o bloco
//
// Convenções:
//   - 1ª linha "**N · SEÇÃO**" vira a etiqueta dourada do capítulo
//   - parágrafo todo em itálico (*...*) vira linha de abertura centralizada
//   - linha de tabela cuja 1ª célula está em negrito vira linha de total
//   - "### Título — valor" mostra o valor alinhado à direita

import { TEXTOS, type Idioma } from "./idioma";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
}

const cells = (row: string) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

const isTable = (l: string) => /^\s*\|/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const isUl = (l: string) => /^\s*[-*]\s+/.test(l);
const isOl = (l: string) => /^\s*\d+\.\s+/.test(l);
const isHeading = (l: string) => /^#{1,4}\s+/.test(l);
const isQuote = (l: string) => /^>\s?/.test(l);
const isHr = (l: string) => /^\s*---+\s*$/.test(l);
const isFence = (l: string) => /^:::/.test(l.trim());

// Célula numérica (valores, quantidades, percentuais) alinha à direita
const isNumeric = (c: string) => {
  const t = c.replace(/\*\*/g, "").trim();
  return t !== "" && t !== "—" && /^(≈\s*|~\s*)?(R\$\s*)?[\d.,]+(\s*(%|×|x|kg|L|un))?(\s*\/\s*R\$\s*[\d.,]+)?$/.test(t);
};

type Opts = { colunas?: boolean; idioma?: Idioma };

function renderCapa(body: string[]) {
  const kv: Record<string, string[]> = {};
  for (const l of body) {
    const m = l.match(/^\s*([a-zA-ZçÇãõáéíóúâêô]+)\s*:\s*(.*)$/);
    if (m) (kv[m[1].toLowerCase()] ??= []).push(m[2]);
  }
  const one = (k: string) => (kv[k]?.[0] ?? "");
  const titulo = one("titulo").split("|").map((t) => inline(t.trim())).join("<br />");
  const infos = (kv["info"] ?? []).map((i) => {
    const [r, ...v] = i.split("|");
    return `<div class="capa-info"><span>${inline(r.trim())}</span><b>${inline(v.join("|").trim())}</b></div>`;
  });
  return `<div class="capa">
  <div class="capa-marca">${inline(one("marca"))}</div>
  <div class="capa-centro">
    <div class="capa-sobre">${inline(one("sobretitulo"))}</div>
    <h1 class="capa-titulo">${titulo}</h1>
    <p class="capa-sub">${inline(one("subtitulo"))}</p>
    <div class="capa-grade">${infos.join("")}</div>
  </div>
  <div class="capa-lema">${inline(one("lema"))}</div>
</div>`;
}

function renderCards(body: string[]) {
  const items = body
    .filter((l) => l.trim())
    .map((l) => {
      const destaque = l.trim().startsWith("!");
      const [rotulo, valor, desc] = l.trim().replace(/^!\s*/, "").split("|").map((s) => (s ?? "").trim());
      return `<div class="card-doc${destaque ? " destaque" : ""}">
  <div class="card-rotulo">${inline(rotulo ?? "")}</div>
  <div class="card-valor">${inline(valor ?? "")}</div>
  ${desc ? `<div class="card-desc">${inline(desc)}</div>` : ""}
</div>`;
    });
  return `<div class="cards-doc cards-${Math.min(items.length, 4)}">${items.join("")}</div>`;
}

// ---------------------------------------------------------------------
// :::escala — grade mensal de escala, um quadradinho por dia
// ---------------------------------------------------------------------
type TipoTurno = "folga" | "descanso" | "dia" | "abertura" | "manha" | "inter" | "tarde" | "noite" | "partido" | "plantao";
type Turno = { tipo: TipoTurno; linhas: string[]; horario: string; intervalo: string; entrada: number | null };

const dois = (n: number) => String(n).padStart(2, "0");

// Cor do turno pelo horário de entrada
function tipoPorEntrada(a: number, b: number): TipoTurno {
  const duracao = (b <= a ? b + 24 : b) - a;
  if (b <= a && duracao >= 11 && a >= 17) return "plantao";
  if (a <= 7) return "abertura";
  if (a <= 10) return "manha";
  if (a <= 13) return "inter";
  if (a <= 15) return "tarde";
  return "noite";
}

function lerTurno(raw: string): Turno {
  let t = raw.trim().replace(/[–—]/g, "-").replace(/h/gi, "");
  const vazio = { horario: "", intervalo: "", entrada: null };
  if (/^(f|folga)$/i.test(t)) return { tipo: "folga", linhas: ["F"], ...vazio, horario: "Folga" };
  if (t === "" || /^(-|·|descanso)$/i.test(t)) return { tipo: "descanso", linhas: ["·"], ...vazio, horario: "Descanso" };
  // Intervalo opcional entre parênteses: "07-16 (11-12)" → aparece no balão ao passar o mouse
  let intervalo = "";
  const mi = t.match(/^(.*?)\s*[([]\s*(\d{1,2})\s*-\s*(\d{1,2})\s*[)\]]\s*$/);
  if (mi) {
    t = mi[1];
    intervalo = `${dois(parseInt(mi[2], 10))}h–${dois(parseInt(mi[3], 10))}h`;
  }
  const partes = t.split("/").map((p) => p.trim()).filter(Boolean);
  const horas = partes.map((p) => p.split("-").map((h) => parseInt(h, 10)));
  const ok = horas.every((h) => h.length === 2 && h.every((n) => !Number.isNaN(n)));
  if (!ok) return { tipo: "dia", linhas: [raw.trim()], ...vazio, horario: raw.trim() };
  const horario = horas.map(([a, b]) => `${dois(a)}h–${dois(b)}h`).join(" / ");
  if (horas.length > 1) {
    return { tipo: "partido", linhas: horas.map(([a, b]) => `${dois(a)}·${dois(b)}`), horario, intervalo, entrada: horas[0][0] };
  }
  const [a, b] = horas[0];
  return { tipo: tipoPorEntrada(a, b), linhas: [dois(a), dois(b)], horario, intervalo, entrada: a };
}


function renderEscala(body: string[], idioma: Idioma = "pt") {
  const T = TEXTOS[idioma];
  const rotulo = (t: TipoTurno) => T.turnos[t];
  let titulo = "";
  let dias: { nome: string; num: string; dom: boolean }[] = [];
  type Linha = { grupo: string } | { nome: string; sexo: string; turnos: Turno[] };
  const linhas: Linha[] = [];
  for (const l of body) {
    const s = l.trim();
    if (!s) continue;
    const kv = s.match(/^(titulo|dias)\s*:\s*(.*)$/i);
    if (kv && kv[1].toLowerCase() === "titulo") { titulo = kv[2]; continue; }
    if (kv && kv[1].toLowerCase() === "dias") {
      dias = kv[2].split("|").map((d) => {
        const [nome, ...resto] = d.trim().split(/\s+/);
        return { nome, num: resto.join(" "), dom: /^(dom|sun|nd|niedz)/i.test(nome) };
      });
      continue;
    }
    const g = s.match(/^#{1,4}\s+(.*)$/);
    if (g) { linhas.push({ grupo: g[1] }); continue; }
    const c = cells(s);
    if (c.length < 2) continue;
    const temSexo = /^(f|m|—|-|\?)$/i.test(c[1] ?? "") && c.length - 2 >= dias.length;
    const sexo = temSexo ? c[1].toUpperCase() : "";
    const turnos = c.slice(temSexo ? 2 : 1).map(lerTurno);
    linhas.push({ nome: c[0], sexo, turnos });
  }
  const n = dias.length || Math.max(0, ...linhas.map((l) => ("turnos" in l ? l.turnos.length : 0)));
  const pessoas = linhas.filter((l): l is { nome: string; sexo: string; turnos: Turno[] } => "turnos" in l);
  const usados = new Map<TipoTurno, Set<number>>();
  pessoas.forEach((p) =>
    p.turnos.forEach((t) => {
      if (!usados.has(t.tipo)) usados.set(t.tipo, new Set());
      if (t.entrada !== null) usados.get(t.tipo)!.add(t.entrada);
    })
  );
  const temIntervalo = pessoas.some((p) => p.turnos.some((t) => t.intervalo));

  // Cabeçalho
  let html = `<div class="escala">`;
  if (titulo) html += `<div class="escala-titulo">${inline(titulo)}</div>`;
  html += `<div class="escala-wrap"><table class="escala-grade"><colgroup><col class="esc-col-nome" />`;
  for (let d = 0; d < n; d++) html += `<col />`;
  html += `<col class="esc-col-tot" /><col class="esc-col-tot" /></colgroup><thead><tr><th class="esc-nome">${T.equipe}</th>`;
  for (let d = 0; d < n; d++) {
    const dia = dias[d] ?? { nome: "", num: String(d + 1), dom: false };
    html += `<th class="esc-dia${dia.dom ? " dom" : ""}"><span>${inline(dia.nome)}</span><b>${inline(dia.num)}</b></th>`;
  }
  html += `<th class="esc-tot">${T.dias}</th><th class="esc-tot">${T.domFolga}</th></tr></thead><tbody>`;

  // Linhas
  for (const l of linhas) {
    if ("grupo" in l) {
      html += `<tr class="esc-grupo"><td colspan="${n + 3}">${inline(l.grupo)}</td></tr>`;
      continue;
    }
    const sx = l.sexo === "F" ? "f" : l.sexo === "M" ? "m" : "";
    html += `<tr><td class="esc-nome"><span class="esc-pessoa">${inline(l.nome)}</span>${sx ? `<i class="esc-sx ${sx}">${l.sexo}</i>` : ""}</td>`;
    let trab = 0;
    let domFolga = 0;
    for (let d = 0; d < n; d++) {
      const t = l.turnos[d] ?? lerTurno("-");
      const dom = dias[d]?.dom;
      if (t.tipo !== "folga" && t.tipo !== "descanso") trab++;
      else if (dom && t.tipo === "folga") domFolga++;
      const trabalha = t.tipo !== "folga" && t.tipo !== "descanso";
      const dica = trabalha
        ? ` data-h="${esc(t.horario)}" data-t="${esc(rotulo(t.tipo))}"${t.intervalo ? ` data-i="${esc(t.intervalo)}"` : ""} aria-label="${esc(t.horario + (t.intervalo ? `, ${T.intervaloAria} ${t.intervalo}` : ""))}"`
        : ` aria-label="${esc(rotulo(t.tipo))}"`;
      html += `<td class="esc-c t-${t.tipo}${dom ? " dom" : ""}"${dica}>${t.linhas.map((x) => `<span>${esc(x)}</span>`).join("")}</td>`;
    }
    html += `<td class="esc-tot">${trab}</td><td class="esc-tot">${l.turnos.some((t) => t.tipo === "plantao") ? "—" : domFolga}</td></tr>`;
  }
  html += `</tbody>`;

  // Rodapé: pessoas trabalhando por dia, com os dias mais vazios em destaque
  if (pessoas.length > 1) {
    const tot = Array.from({ length: n }, (_, d) =>
      pessoas.filter((p) => { const t = p.turnos[d]; return t && t.tipo !== "folga" && t.tipo !== "descanso"; }).length
    );
    const min = Math.min(...tot);
    const max = Math.max(...tot);
    const corte = min + (max - min) * 0.25;
    html += `<tfoot><tr><td class="esc-nome">${T.trabalhando}</td>${tot
      .map((v, d) => `<td class="esc-c${max > min && v <= corte ? " baixo" : ""}${dias[d]?.dom ? " dom" : ""}">${v}</td>`)
      .join("")}<td class="esc-tot"></td><td class="esc-tot"></td></tr></tfoot>`;
  }
  html += `</table></div>`;

  // Legenda só com os tipos que aparecem
  const ordem: TipoTurno[] = ["abertura", "manha", "inter", "tarde", "noite", "dia", "partido", "plantao", "folga", "descanso"];
  const entra = (t: TipoTurno) => {
    const hs = Array.from(usados.get(t) ?? []).sort((x, y) => x - y);
    if (!hs.length || t === "partido" || t === "dia") return "";
    return `<em>${T.entra} ${hs.map((h) => `${dois(h)}h`).join(hs.length > 2 ? ", " : ` ${T.ou} `).replace(/, ([^,]*)$/, ` ${T.ou} $1`)}</em>`;
  };
  html += `<div class="escala-legenda">${ordem
    .filter((t) => usados.has(t))
    .map((t) => `<span><i class="esc-chip t-${t}"></i><b>${rotulo(t)}</b>${entra(t)}</span>`)
    .join("")}${dias.some((d) => d.dom) ? `<span><i class="esc-chip dom-chip"></i><b>${T.domingo}</b></span>` : ""}${
    temIntervalo ? `<span class="esc-dica-aviso nao-imprimir">${T.dicaIntervalo}</span>` : ""
  }</div>`;
  return html + `</div>`;
}

// :::checks — cartões de checagem (✓ ou !)
function renderChecks(body: string[]) {
  const items = body
    .filter((l) => l.trim())
    .map((l) => {
      const [status, titulo, detalhe] = l.split("|").map((s) => (s ?? "").trim());
      const ok = !/^(alerta|!|x|nao|não|pendente)$/i.test(status);
      return `<div class="check-doc ${ok ? "ok" : "alerta"}"><span class="check-ic">${ok ? "✓" : "!"}</span><div><b>${inline(titulo ?? "")}</b>${detalhe ? `<span>${inline(detalhe)}</span>` : ""}</div></div>`;
    });
  return `<div class="checks-doc">${items.join("")}</div>`;
}

// ---------------------------------------------------------------------
// Arquivos (:::arquivos): biblioteca de PDFs do projeto. Clicar abre o PDF
// numa janela por cima da página (o site cuida do clique pelo data-pdf).
//   base: /api/arquivo/<projeto>/<pasta>
//   estilo: capas | lista
//   CÓDIGO | Título | Descrição | arquivo (sem .pdf) | 4 págs. | interno|restrito
// ---------------------------------------------------------------------
const BASE_ARQ = /^\/api\/arquivo\/[0-9a-f-]{36}\/[a-z0-9_-]+$/;
function renderArquivos(body: string[], idioma: Idioma = "pt") {
  const T = TEXTOS[idioma];
  let base = "";
  let estilo = "capas";
  const itens: string[] = [];
  for (const l of body) {
    const t = l.trim();
    if (!t) continue;
    const kv = t.match(/^(base|estilo):\s*(.+)$/i);
    if (kv) {
      if (kv[1].toLowerCase() === "base") base = kv[2].trim();
      else estilo = kv[2].trim().toLowerCase();
      continue;
    }
    const [codigo, titulo, desc, arq, paginas, classe] = t.split("|").map((x) => (x ?? "").trim());
    if (!BASE_ARQ.test(base) || !/^[a-z0-9][a-z0-9_-]*$/.test(arq ?? "")) continue;
    const pdf = `${base}/${arq}.pdf`;
    const restrito = /restrit/i.test(classe ?? "");
    const tag = `<span class="arq-tag${restrito ? " restrito" : ""}">${restrito ? T.restrito : T.interno}</span>`;
    const meta = `<span class="arq-meta">${paginas ? `<span>${esc(paginas)}</span>` : ""}${tag}</span>`;
    const capa =
      estilo === "lista"
        ? `<span class="arq-ic" aria-hidden="true">PDF</span>`
        : `<span class="arq-capa"><img src="${esc(`${base}/capas/${arq}.jpg`)}" alt="" loading="lazy" /></span>`;
    itens.push(
      `<button type="button" class="arq" data-pdf="${esc(pdf)}" data-titulo="${esc(titulo ?? "")}" data-codigo="${esc(codigo ?? "")}">` +
        capa +
        `<span class="arq-info"><span class="arq-cod">${esc(codigo ?? "")}</span><b>${inline(titulo ?? "")}</b>` +
        (desc ? `<span class="arq-desc">${inline(desc)}</span>` : "") +
        meta +
        `</span><span class="arq-abrir" aria-hidden="true">${T.abrir}</span></button>`
    );
  }
  return `<div class="arqs arqs-${estilo === "lista" ? "lista" : "capas"}">${itens.join("")}</div>`;
}

export function renderMarkdown(md: string, opts: Opts = {}): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  let first = true;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // Blocos especiais
    if (isFence(line)) {
      const kind = line.trim().slice(3).trim().toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) body.push(lines[i++]);
      i++; // fecha :::
      if (kind === "capa") out.push(renderCapa(body));
      else if (kind === "cards") out.push(renderCards(body));
      else if (kind === "escala") out.push(renderEscala(body, opts.idioma));
      else if (kind === "checks") out.push(renderChecks(body));
      else if (kind === "arquivos") out.push(renderArquivos(body, opts.idioma));
      else if (kind === "colunas") out.push(`<div class="colunas">${renderMarkdown(body.join("\n"), { colunas: true })}</div>`);
      else out.push(renderMarkdown(body.join("\n"), opts));
      first = false;
      continue;
    }

    // Etiqueta da seção: "**N · SEÇÃO**" no início
    const rot = line.trim().match(/^\*\*([^*]+)\*\*$/);
    if (first && rot) {
      out.push(`<div class="rotulo">${inline(rot[1])}</div>`);
      i++;
      first = false;
      continue;
    }
    first = false;

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      const text = h[2];
      const parts = text.split(/\s+—\s+/);
      if (n === 2 && opts.colunas && parts.length > 1) {
        out.push(`<h2>${inline(parts[0])}<small>${inline(parts.slice(1).join(" — "))}</small></h2>`);
      } else if (n === 3 && parts.length > 1) {
        out.push(`<h3 class="h3-valor"><span>${inline(parts[0])}</span><span>${inline(parts.slice(1).join(" — "))}</span></h3>`);
      } else {
        out.push(`<h${n}>${inline(text)}</h${n}>`);
      }
      i++;
      continue;
    }

    if (isHr(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (isTable(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTable(lines[i])) rows.push(lines[i++]);
      let html = '<div class="table-wrap"><table>';
      if (rows.length > 1 && isSep(rows[1])) {
        const head = cells(rows[0]);
        const body = rows.slice(2).map(cells);
        const numCol = head.map((_, c) => body.length > 0 && body.every((r) => !r[c] || isNumeric(r[c]) || r[c] === "—"));
        html +=
          "<thead><tr>" +
          head.map((c, k) => `<th${numCol[k] && k > 0 ? ' class="num"' : ""}>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map((r) => {
              const total = /^\*\*.+\*\*$/.test(r[0] ?? "");
              return (
                `<tr${total ? ' class="total"' : ""}>` +
                r.map((c, k) => `<td${(numCol[k] || isNumeric(c)) && k > 0 ? ' class="num"' : ""}>${inline(c)}</td>`).join("") +
                "</tr>"
              );
            })
            .join("") +
          "</tbody>";
      } else {
        html += "<tbody>" + rows.map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody>";
      }
      out.push(html + "</table></div>");
      continue;
    }

    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        items.push(lines[i++].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""));
      }
      const tag = ordered ? "ol" : "ul";
      const lis = items.map((t) => {
        const m = t.match(/^\*\*(.+?)\*\*\s+—\s+(.*)$/);
        if (m) return `<li class="item"><strong>${inline(m[1])}</strong><span>${inline(m[2])}</span></li>`;
        return `<li>${inline(t)}</li>`;
      });
      out.push(`<${tag}>${lis.join("")}</${tag}>`);
      continue;
    }

    if (isQuote(line)) {
      const parts: string[] = [];
      while (i < lines.length && isQuote(lines[i])) parts.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(parts.join(" "))}</blockquote>`);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isHeading(lines[i]) &&
      !isTable(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i]) &&
      !isQuote(lines[i]) &&
      !isHr(lines[i]) &&
      !isFence(lines[i])
    ) {
      para.push(lines[i++]);
    }
    const raw = para.join(" ").trim();
    if (/^\*[^*].*[^*]\*$/.test(raw)) {
      out.push(`<p class="abertura">${inline(raw.slice(1, -1))}</p>`);
    } else {
      out.push(`<p>${para.map(inline).join("<br />")}</p>`);
    }
  }

  return out.join("\n");
}

/** O capítulo começa com a capa? (renderizado em página azul inteira) */
export function temCapa(md: string) {
  return /^\s*:::capa/m.test(md);
}
