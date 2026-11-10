// PDF da escala da semana (09/11/2026, pedido do dono: "profissional, com cores bem marcantes e título").
// Montado no navegador com pdf-lib (a mesma biblioteca da DANFE), sem a impressão do navegador: sai um arquivo
// .pdf pronto para mandar no grupo. A4 deitado; cada casa (local) começa numa folha nova, com a logo e o título
// nas cores da marca; cabeçalho dos dias em todas as folhas; setores em faixas; cada dia é um bloquinho colorido —
// turno (manhã, tarde, noite) em tom claro com o horário e o descanso, folgas e ausências em cor forte;
// coluna de horas e folgas da semana; legenda e "página x de y" no rodapé.
// Usa só a Helvetica padrão do PDF, então o texto é limpo para o alfabeto WinAnsi.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { DiaPlano } from "./regras";

export type LinhaPdf = { nome: string; cargo?: string; local: string; setor: string; dias: Record<string, DiaPlano | undefined>; minutos: number };
// logo(arquivo) devolve o PNG da logo da casa (public/escala/logos/<arquivo>.png); sem logo, só o nome
export type EntradaPdf = { titulo?: string; periodo: string[]; linhas: LinhaPdf[]; feriados: Map<string, string>; logo?: (arquivo: string) => Promise<Uint8Array | null> };

const W = 841.89, H = 595.28, M = 24;
const LARG = W - 2 * M;
const COL_NOME = 156, COL_HORAS = 52;
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const BRANCO = rgb(1, 1, 1);
const TINTA = hex("#1d2230");
const CINZA = hex("#6b7184");
const LINHA = hex("#e3e6ee");
const ZEBRA = hex("#f6f7fa");

// Marca de cada casa (09/11/2026, logos enviadas pelo dono): a logo no topo e as cores tiradas dela —
// "tinta" = a cor escura da marca (título, cabeçalho dos dias, setores), "destaque" = a segunda cor (linhas e detalhes).
// Logos em public/escala/logos/ (recortadas das originais). A "Fundação Hello Pipa" ainda não tem local na escala.
export type Marca = { arquivo: string; tinta: string; destaque: string };
const MARCAS: [RegExp, Marca][] = [
  [/filha da lua/i, { arquivo: "filha-da-lua", tinta: "#4b7445", destaque: "#7fa275" }],
  [/sempre vivo/i, { arquivo: "sempre-vivo", tinta: "#7d5d26", destaque: "#b08a45" }],
  [/filho do vento/i, { arquivo: "filho-do-vento", tinta: "#1f4a9c", destaque: "#5f86d4" }],
  [/cicchetti/i, { arquivo: "cicchetti", tinta: "#283848", destaque: "#b89b5e" }],
  [/hello barra|vila da barra/i, { arquivo: "hello-barra", tinta: "#154848", destaque: "#7bc03c" }],
  [/fundac|fundaç/i, { arquivo: "fundacao-hello-pipa", tinta: "#13254a", destaque: "#1a7fc4" }],
  [/hello pipa/i, { arquivo: "hello-pipa", tinta: "#0a2c52", destaque: "#0a8ad0" }],
  [/fazenda|pachamama/i, { arquivo: "fazenda-pachamama", tinta: "#1c1c1c", destaque: "#7a7a7a" }],
];
export const marcaDoLocal = (local: string): Marca | null => MARCAS.find(([r]) => r.test(local))?.[1] ?? null;
const misturar = (c: RGB, f: number) => rgb(c.red + (1 - c.red) * f, c.green + (1 - c.green) * f, c.blue + (1 - c.blue) * f);

// Folgas e ausências: cor forte com o nome em branco
const CODIGO: Record<string, { cor: string; linhas: string[]; legenda: string }> = {
  F: { cor: "#23945a", linhas: ["FOLGA"], legenda: "Folga" },
  DM: { cor: "#6a3fc1", linhas: ["DOMINGO", "DO MÊS"], legenda: "Domingo do mês" },
  FC: { cor: "#0e8a7c", linhas: ["FOLGA", "COMPENSADA"], legenda: "Folga compensada" },
  BH: { cor: "#c48106", linhas: ["BANCO", "DE HORAS"], legenda: "Banco de horas" },
  FE: { cor: "#2f5bd3", linhas: ["FÉRIAS"], legenda: "Férias" },
  AT: { cor: "#c62839", linhas: ["ATESTADO"], legenda: "Atestado" },
  LIC: { cor: "#5b6273", linhas: ["LICENÇA"], legenda: "Licença" },
};
// Turnos de trabalho: tom claro com o horário na cor escura
const TURNOS = [
  { nome: "Manhã", ate: 11 * 60, fundo: "#fff0c2", tinta: "#7a4f00", barra: "#f0b400" },
  { nome: "Tarde", ate: 16 * 60, fundo: "#ffdcc7", tinta: "#8a3510", barra: "#ef6c2a" },
  { nome: "Noite", ate: 24 * 60, fundo: "#d9e0ff", tinta: "#24338c", barra: "#4a5fd9" },
];
const minutos = (h?: string | null) => (h && /^\d{1,2}:\d{2}/.test(h) ? Number(h.slice(0, h.indexOf(":"))) * 60 + Number(h.slice(h.indexOf(":") + 1, h.indexOf(":") + 3)) : null);
const turnoDe = (d: DiaPlano) => TURNOS.find((t) => (minutos(d.entrada) ?? 0) < t.ate) ?? TURNOS[0];

const SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
function faixaPorExtenso(a: string, b: string) {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = b.split("-").map(Number);
  if (ya !== yb) return `${da} de ${MESES[ma - 1]} de ${ya} a ${db} de ${MESES[mb - 1]} de ${yb}`;
  if (ma !== mb) return `${da} de ${MESES[ma - 1]} a ${db} de ${MESES[mb - 1]} de ${yb}`;
  return `${da} a ${db} de ${MESES[mb - 1]} de ${yb}`;
}
const horasTxt = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

// Texto que a Helvetica padrão escreve (WinAnsi)
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function limpo(s: string | null | undefined) {
  if (!s) return "";
  return [...s.normalize("NFC").replace(/[\r\n\t]+/g, " ").replace(/−/g, "-")]
    .map((c) => { const n = c.charCodeAt(0); return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || WINANSI_EXTRA.has(c) ? c : ""; })
    .join("");
}

type Fontes = { normal: PDFFont; negrito: PDFFont };

function cabe(f: PDFFont, s: string, tam: number, larg: number) {
  let t = limpo(s);
  if (f.widthOfTextAtSize(t, tam) <= larg) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, tam) > larg) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function texto(p: PDFPage, s: string, x: number, y: number, tam: number, f: PDFFont, cor: RGB, opcoes: { larg?: number; alinhar?: "esq" | "centro" | "dir"; espaco?: number } = {}) {
  const t = opcoes.larg ? cabe(f, s, tam, opcoes.larg - 2) : limpo(s);
  const esp = opcoes.espaco ?? 0;
  const w = f.widthOfTextAtSize(t, tam) + esp * Math.max(0, t.length - 1);
  const xx = opcoes.alinhar === "centro" ? x + ((opcoes.larg ?? 0) - w) / 2 : opcoes.alinhar === "dir" ? x - w : x;
  if (!esp) p.drawText(t, { x: xx, y, size: tam, font: f, color: cor });
  else {
    let cx = xx;
    for (const c of t) { p.drawText(c, { x: cx, y, size: tam, font: f, color: cor }); cx += f.widthOfTextAtSize(c, tam) + esp; }
  }
}
// Retângulo de cantos arredondados (x, y = canto de baixo à esquerda)
function caixa(p: PDFPage, x: number, y: number, w: number, h: number, r: number, cor: RGB, borda?: RGB) {
  const rr = Math.min(r, w / 2, h / 2);
  const d = `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} Q ${w} ${h} ${w - rr} ${h} H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
  p.drawSvgPath(d, { x, y: y + h, color: cor, borderColor: borda, borderWidth: borda ? 0.6 : 0 });
}

export async function gerarPdfEscala(e: EntradaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fontes = { normal: await doc.embedFont(StandardFonts.Helvetica), negrito: await doc.embedFont(StandardFonts.HelveticaBold) };
  const dias = e.periodo;
  const colDia = (LARG - COL_NOME - COL_HORAS) / dias.length;
  const xDia = (i: number) => M + COL_NOME + i * colDia;
  const faixa = dias.length ? faixaPorExtenso(dias[0], dias[dias.length - 1]) : "";
  const agora = new Date();
  const gerada = `${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const usados = new Set<string>();

  // Locais na ordem da grade; casa sem nada planejado na semana não entra
  const locais = [...new Set(e.linhas.map((l) => l.local))].filter((loc) => e.linhas.some((l) => l.local === loc && dias.some((d) => l.dias[d]?.codigo)));
  if (!locais.length) locais.push(...new Set(e.linhas.map((l) => l.local)));

  for (const local of locais) {
    const marca = marcaDoLocal(local);
    const cor = hex(marca?.tinta ?? "#2a3550");
    const destaque = hex(marca?.destaque ?? "#8a93ad");
    let logo: PDFImage | null = null;
    if (marca && e.logo) {
      try { const b = await e.logo(marca.arquivo); if (b) logo = await doc.embedPng(b); } catch { logo = null; }
    }
    const doLocal = e.linhas.filter((l) => l.local === local);
    // Setor sem nada planejado na semana fica de fora
    const setores = [...new Set(doLocal.map((l) => l.setor))].filter((s) => doLocal.some((l) => l.setor === s && dias.some((d) => l.dias[d]?.codigo)));
    const linhas = doLocal.filter((l) => setores.includes(l.setor));
    const altLinha = linhas.some((l) => dias.some((d) => l.dias[d]?.codigo === "T" && l.dias[d]?.posto)) ? 38 : 30;
    const ALT_SETOR = 20, ALT_CAB = 32, RODAPE = 40;
    let p!: PDFPage, y = 0, cont = false;

    const novaFolha = () => {
      p = doc.addPage([W, H]);
      // Topo: faixa fina na cor da marca, a logo, o título na cor da marca e a semana à direita
      p.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: cor });
      p.drawRectangle({ x: 0, y: H - 8, width: W, height: 2, color: destaque });
      const altLogo = cont ? 26 : 58;
      const topo = H - 8 - (cont ? 10 : 14);
      let xt = M;
      if (logo) {
        const esc = Math.min(altLogo / logo.height, (cont ? 110 : 190) / logo.width);
        const lw = logo.width * esc, lh = logo.height * esc;
        p.drawImage(logo, { x: M, y: topo - altLogo + (altLogo - lh) / 2, width: lw, height: lh });
        xt = M + lw + 16;
        p.drawLine({ start: { x: xt - 8, y: topo - altLogo + 4 }, end: { x: xt - 8, y: topo - 4 }, thickness: 1, color: misturar(destaque, 0.35) });
      }
      if (!cont) {
        texto(p, "ESCALA DE TRABALHO", xt + 4, topo - 16, 8.5, f.negrito, destaque, { espaco: 1.6 });
        // Um setor só: o setor vai no título, ao lado da casa
        const so = setores.length === 1 && setores[0] && setores[0] !== local ? setores[0] : "";
        texto(p, so ? `${local} · ${so}` : local || e.titulo || "Escala", xt + 4, topo - 44, 26, f.negrito, cor, { larg: LARG * 0.6 - (xt - M) });
        texto(p, `Semana de ${faixa}`, W - M, topo - 24, 13, f.negrito, cor, { alinhar: "dir" });
        const n = linhas.length;
        texto(p, `${n} ${n === 1 ? "pessoa" : "pessoas"} · ${setores.length} ${setores.length === 1 ? "setor" : "setores"}`, W - M, topo - 40, 9, f.normal, CINZA, { alinhar: "dir" });
      } else {
        texto(p, `${local}${setores.length === 1 && setores[0] && setores[0] !== local ? ` · ${setores[0]}` : ""}  ·  continuação`, xt + 4, topo - 18, 13, f.negrito, cor);
        texto(p, `Semana de ${faixa}`, W - M, topo - 18, 10, f.negrito, cor, { alinhar: "dir" });
      }
      y = topo - altLogo - 8;
      p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: destaque });
      y -= 10;
      // Cabeçalho dos dias
      const yc = y - ALT_CAB;
      caixa(p, M, yc, LARG, ALT_CAB, 5, cor);
      texto(p, "COLABORADOR", M + 10, yc + 13, 8, f.negrito, misturar(cor, 0.62), { espaco: 0.8 });
      dias.forEach((d, i) => {
        const fer = e.feriados.get(d);
        const x = xDia(i);
        if (fer || dow(d) === 0) caixa(p, x + 2, yc + 3, colDia - 4, ALT_CAB - 6, 4, fer ? hex("#d32f2f") : misturar(cor, 0.16));
        texto(p, SEMANA[dow(d)], x, yc + (fer ? 19 : 17), 8.5, f.negrito, BRANCO, { larg: colDia, alinhar: "centro", espaco: 0.4 });
        texto(p, fer ? `${br(d)} · FERIADO` : br(d), x, yc + (fer ? 8 : 7), fer ? 6.8 : 8, fer ? f.negrito : f.normal, fer ? BRANCO : misturar(cor, 0.7), { larg: colDia, alinhar: "centro" });
      });
      texto(p, "SEMANA", M + LARG - COL_HORAS, yc + 13, 7.5, f.negrito, misturar(cor, 0.62), { larg: COL_HORAS, alinhar: "centro", espaco: 0.5 });
      y = yc - 6;
      cont = true;
    };
    const cabeAte = (alt: number) => y - alt >= M + RODAPE;

    novaFolha();
    for (const setor of setores) {
      const doSetor = linhas.filter((l) => l.setor === setor);
      // Faixa do setor (não deixa a faixa sozinha no fim da folha)
      if (!cabeAte(ALT_SETOR + altLinha)) novaFolha();
      const faixaSetor = (cont_: boolean) => {
        y -= ALT_SETOR;
        caixa(p, M, y + 2, LARG, ALT_SETOR - 4, 3, misturar(cor, 0.86));
        p.drawRectangle({ x: M, y: y + 2, width: 4, height: ALT_SETOR - 4, color: cor });
        const nome = (setor || "Equipe").toUpperCase() + (cont_ ? " (continuação)" : "");
        texto(p, nome, M + 12, y + 8, 8.5, f.negrito, cor, { espaco: 0.7 });
        const w = f.negrito.widthOfTextAtSize(limpo(nome), 8.5) + 0.7 * (limpo(nome).length - 1);
        texto(p, `${doSetor.length} ${doSetor.length === 1 ? "pessoa" : "pessoas"}`, M + 12 + w + 10, y + 8, 7.5, f.normal, misturar(cor, 0.25));
      };
      faixaSetor(false);
      doSetor.forEach((l, i) => {
        if (!cabeAte(altLinha)) { novaFolha(); faixaSetor(true); }
        y -= altLinha;
        if (i % 2 === 1) p.drawRectangle({ x: M, y, width: LARG, height: altLinha, color: ZEBRA });
        p.drawLine({ start: { x: M, y }, end: { x: M + LARG, y }, thickness: 0.5, color: LINHA });
        // Nome e cargo
        const temCargo = !!l.cargo;
        texto(p, l.nome, M + 10, y + altLinha / 2 + (temCargo ? 1.5 : -3.5), 10, f.negrito, TINTA, { larg: COL_NOME - 14 });
        if (temCargo) texto(p, l.cargo!, M + 10, y + altLinha / 2 - 9, 7, f.normal, CINZA, { larg: COL_NOME - 14 });
        // Dias
        dias.forEach((d, j) => {
          const x = xDia(j) + 2.5, w = colDia - 5, yy = y + 3, h = altLinha - 6;
          const dd = l.dias[d];
          if (!dd?.codigo) {
            p.drawLine({ start: { x: x + w / 2 - 5, y: yy + h / 2 }, end: { x: x + w / 2 + 5, y: yy + h / 2 }, thickness: 0.8, color: hex("#c9cdd8") });
            return;
          }
          if (dd.codigo === "T") {
            const t = turnoDe(dd);
            usados.add(t.nome);
            caixa(p, x, yy, w, h, 4, hex(t.fundo));
            p.drawRectangle({ x, y: yy + 3, width: 3, height: h - 6, color: hex(t.barra) });
            const linhasT: { s: string; tam: number; f: PDFFont; cor: RGB; esp?: number }[] = [
              { s: dd.entrada && dd.saida ? `${dd.entrada} – ${dd.saida}` : "Trabalho", tam: 9.5, f: f.negrito, cor: hex(t.tinta) },
            ];
            if (dd.intervalo) linhasT.push({ s: `desc. ${dd.intervalo.replace("-", "–")}`, tam: 7, f: f.normal, cor: hex(t.tinta) });
            if (dd.posto) linhasT.push({ s: dd.posto.toUpperCase(), tam: 6.5, f: f.negrito, cor: hex(t.barra), esp: 0.5 });
            const total = linhasT.reduce((s, x) => s + x.tam + 2, -2);
            let ty = yy + h / 2 + total / 2 - linhasT[0].tam * 0.78;
            for (const lt of linhasT) {
              texto(p, lt.s, x + 2, ty, lt.tam, lt.f, lt.cor, { larg: w - 2, alinhar: "centro", espaco: lt.esp });
              ty -= lt.tam + 2.5;
            }
            return;
          }
          const c = CODIGO[dd.codigo];
          if (!c) return;
          usados.add(dd.codigo);
          caixa(p, x, yy, w, h, 4, hex(c.cor));
          const n = c.linhas.length;
          c.linhas.forEach((s, k) => {
            const tam = n > 1 ? 7.2 : 8.5;
            const ty = yy + h / 2 + ((n - 1) / 2 - k) * (tam + 1.5) - tam * 0.36;
            texto(p, s, x, ty, tam, f.negrito, BRANCO, { larg: w, alinhar: "centro", espaco: 0.5 });
          });
        });
        // Horas e folgas da semana
        const folgas = dias.filter((d) => ["F", "DM", "FC", "BH"].includes(l.dias[d]?.codigo ?? "")).length;
        const xh = M + LARG - COL_HORAS;
        texto(p, l.minutos ? horasTxt(l.minutos) : "—", xh, y + altLinha / 2 + 1, 9.5, f.negrito, TINTA, { larg: COL_HORAS, alinhar: "centro" });
        texto(p, `${folgas} ${folgas === 1 ? "folga" : "folgas"}`, xh, y + altLinha / 2 - 9, 7, f.normal, CINZA, { larg: COL_HORAS, alinhar: "centro" });
      });
      y -= 6;
    }
  }

  // Rodapé de todas as folhas: legenda, data e página
  const folhas = doc.getPages();
  const legenda: { nome: string; fundo: RGB; barra?: RGB }[] = [
    ...TURNOS.filter((t) => usados.has(t.nome)).map((t) => ({ nome: `${t.nome}`, fundo: hex(t.fundo), barra: hex(t.barra) })),
    ...Object.entries(CODIGO).filter(([k]) => usados.has(k)).map(([, c]) => ({ nome: c.legenda, fundo: hex(c.cor) })),
  ];
  folhas.forEach((p, i) => {
    const yb = M + 6;
    p.drawLine({ start: { x: M, y: yb + 18 }, end: { x: W - M, y: yb + 18 }, thickness: 0.6, color: LINHA });
    const direita = `Gerada no Brasico em ${gerada}  ·  Página ${i + 1} de ${folhas.length}`;
    const limite = W - M - f.normal.widthOfTextAtSize(limpo(direita), 7.5) - 16;
    let x = M, ly = yb + 2.5;
    const itens = [...legenda.map((l) => ({ ...l, w: 18 + f.normal.widthOfTextAtSize(limpo(l.nome), 7.5) })),
      ...(legenda.some((l) => l.barra) ? [{ nome: "desc. = horário de descanso", fundo: undefined, barra: undefined, w: f.normal.widthOfTextAtSize("desc. = horário de descanso", 7.5) }] : [])];
    for (const l of itens) {
      if (x + l.w > limite && x > M) { x = M; ly -= 11; }
      if (l.fundo) {
        caixa(p, x, ly - 1.5, 14, 9, 2, l.fundo);
        if (l.barra) p.drawRectangle({ x, y: ly - 0.5, width: 2, height: 7, color: l.barra });
        texto(p, l.nome, x + 18, ly, 7.5, f.normal, TINTA);
      } else texto(p, l.nome, x, ly, 7.5, f.normal, CINZA);
      x += l.w + 12;
    }
    texto(p, direita, W - M, yb + 2.5, 7.5, f.normal, CINZA, { alinhar: "dir" });
  });

  doc.setTitle(limpo(`Escala ${e.titulo ?? locais.join(", ")} · ${faixa}`));
  doc.setAuthor("Brasico");
  doc.setCreator("Brasico");
  return doc.save();
}
