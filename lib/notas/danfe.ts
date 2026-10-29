// DANFE (Documento Auxiliar da NF-e) em PDF, montado a partir do XML oficial da nota (nfeProc),
// no leiaute de retrato do Manual de Orientação do Contribuinte: canhoto, emitente, chave com código de barras
// (Code 128 C), destinatário, cálculo do imposto, transportador, produtos (com continuação nas folhas seguintes)
// e dados adicionais. Usa só as fontes padrão do PDF (Helvetica), então o texto é limpo para o alfabeto WinAnsi.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { xml, el, txt } from "./documentos";
import type { Element } from "@xmldom/xmldom";

const A4 = { w: 595.28, h: 841.89 };
const M = 18; // margem
const LARG = A4.w - 2 * M;
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.35, 0.35, 0.35);

// Code 128: larguras de barra/espaço de cada símbolo (0 a 105) e o fim
const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
  "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
  "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
  "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
  "311141 411131 211412 211214 211232").split(" ");
const C128_FIM = "2331112";

/** Larguras (em módulos) do código de barras Code 128 C de uma sequência de dígitos de tamanho par. */
export function code128c(digitos: string): number[] {
  const pares = digitos.match(/\d\d/g) ?? [];
  const valores = pares.map(Number);
  const soma = valores.reduce((s, v, i) => s + v * (i + 1), 105);
  const simbolos = [105, ...valores, soma % 103];
  return [...simbolos.map((s) => C128[s]).join(""), ...C128_FIM].map(Number);
}

// Texto que a Helvetica padrão consegue escrever (WinAnsi)
const TROCA: Record<string, string> = { "≈": "~", "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "×": "x", " ": " " };
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function limpo(s: string | null | undefined): string {
  if (!s) return "";
  return [...s.normalize("NFC").replace(/[\r\n\t]+/g, " ")]
    .map((c) => {
      if (TROCA[c] !== undefined) return TROCA[c];
      const code = c.charCodeAt(0);
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WINANSI_EXTRA.has(c)) return c;
      const sem = c.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      return /^[\x20-\x7e]$/.test(sem) ? sem : "";
    })
    .join("");
}

const n2 = (v: string | null, casas = 2) =>
  v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const nq = (v: string | null) => (v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }));
const cnpj = (c: string | null) =>
  !c ? "" : c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c;
const cep = (c: string | null) => (c && c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c ?? "");
const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const hora = (iso: string | null) => (iso && iso.length >= 19 ? iso.slice(11, 19) : "");
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const MOD_FRETE: Record<string, string> = { "0": "0-Emitente", "1": "1-Destinatário", "2": "2-Terceiros", "3": "3-Próprio remetente", "4": "4-Próprio destinatário", "9": "9-Sem frete" };

type Fontes = { r: PDFFont; b: PDFFont };

class Folha {
  constructor(public page: PDFPage, public f: Fontes) {}
  // y medido de cima para baixo
  Y(y: number) { return A4.h - y; }
  rect(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x, y: this.Y(y + h), width: w, height: h, borderColor: PRETO, borderWidth: 0.5 });
  }
  texto(s: string, x: number, y: number, tam: number, negrito = false, maxW?: number, cor = PRETO) {
    const fonte = negrito ? this.f.b : this.f.r;
    let t = limpo(s);
    if (maxW) while (t && fonte.widthOfTextAtSize(t, tam) > maxW) t = t.slice(0, -1);
    if (t) this.page.drawText(t, { x, y: this.Y(y), size: tam, font: fonte, color: cor });
  }
  direita(s: string, xFim: number, y: number, tam: number, negrito = false) {
    const fonte = negrito ? this.f.b : this.f.r;
    const t = limpo(s);
    this.page.drawText(t, { x: xFim - fonte.widthOfTextAtSize(t, tam), y: this.Y(y), size: tam, font: fonte, color: PRETO });
  }
  centro(s: string, x: number, w: number, y: number, tam: number, negrito = false) {
    const fonte = negrito ? this.f.b : this.f.r;
    let t = limpo(s);
    while (t && fonte.widthOfTextAtSize(t, tam) > w - 4) t = t.slice(0, -1);
    this.page.drawText(t, { x: x + (w - fonte.widthOfTextAtSize(t, tam)) / 2, y: this.Y(y), size: tam, font: fonte, color: PRETO });
  }
  // Caixa com rótulo pequeno em cima e o valor embaixo
  campo(x: number, y: number, w: number, h: number, rotulo: string, valor: string, alinhar: "e" | "d" = "e", tam = 8) {
    this.rect(x, y, w, h);
    this.texto(rotulo.toUpperCase(), x + 2, y + 6, 5, false, w - 4, CINZA);
    if (alinhar === "d") this.direita(valor, x + w - 2, y + h - 3, tam);
    else this.texto(valor, x + 2, y + h - 3, tam, false, w - 4);
  }
  titulo(s: string, y: number) { this.texto(s, M, y - 2, 6.5, true); }
  linhas(s: string, x: number, y: number, w: number, tam: number, maxLinhas: number) {
    const palavras = limpo(s).split(" ");
    const out: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const t = atual ? `${atual} ${p}` : p;
      if (this.f.r.widthOfTextAtSize(t, tam) > w && atual) { out.push(atual); atual = p; } else atual = t;
    }
    if (atual) out.push(atual);
    out.slice(0, maxLinhas).forEach((l, i) => this.texto(l, x, y + i * (tam + 1.6), tam, false, w));
    return out.length;
  }
}

type Produto = { cod: string; desc: string; ncm: string; cst: string; cfop: string; un: string; q: string; vu: string; vt: string;
  bc: string; icms: string; ipi: string; picms: string; pipi: string };

// Colunas da tabela de produtos (largura em pt, rótulo, alinhamento)
const COLS: [keyof Produto, number, string, "e" | "d"][] = [
  ["cod", 46, "Código", "e"], ["desc", 177, "Descrição do produto / serviço", "e"], ["ncm", 34, "NCM/SH", "e"], ["cst", 20, "CST", "e"],
  ["cfop", 20, "CFOP", "e"], ["un", 18, "Un.", "e"], ["q", 36, "Quant.", "d"], ["vu", 38, "V. unit.", "d"], ["vt", 38, "V. total", "d"],
  ["bc", 34, "BC ICMS", "d"], ["icms", 30, "V. ICMS", "d"], ["ipi", 26, "V. IPI", "d"], ["picms", 22.28, "% ICMS", "d"], ["pipi", 20, "% IPI", "d"],
];

function produtos(nfe: Element): Produto[] {
  const dets = Array.from(nfe.getElementsByTagNameNS("http://www.portalfiscal.inf.br/nfe", "det")) as unknown as Element[];
  return dets.map((d) => {
    const p = el(d, "prod");
    const icms = el(d, "ICMS");
    // o grupo do ICMS (ICMS00, ICMS20, ICMSSN102…) é o primeiro elemento dentro de <ICMS>
    const grupoIcms = icms ? ((Array.from(icms.childNodes) as unknown as Element[]).find((c) => c.nodeType === 1) ?? null) : null;
    const orig = txt(grupoIcms, "orig") ?? "";
    const cst = txt(grupoIcms, "CST") ?? txt(grupoIcms, "CSOSN") ?? "";
    const ipi = el(d, "IPI");
    return {
      cod: txt(p, "cProd") ?? "", desc: txt(p, "xProd") ?? "", ncm: txt(p, "NCM") ?? "", cst: `${orig}${cst}`, cfop: txt(p, "CFOP") ?? "",
      un: txt(p, "uCom") ?? "", q: nq(txt(p, "qCom")), vu: n2(txt(p, "vUnCom"), 2), vt: n2(txt(p, "vProd")),
      bc: n2(txt(grupoIcms, "vBC")), icms: n2(txt(grupoIcms, "vICMS")), ipi: n2(txt(ipi, "vIPI")), picms: n2(txt(grupoIcms, "pICMS")),
      pipi: n2(txt(ipi, "pIPI")),
    };
  });
}

export async function danfePdf(xmlTexto: string): Promise<Uint8Array> {
  const doc = xml(xmlTexto);
  const nfe = el(doc, "infNFe");
  if (!nfe) throw new Error("O XML não tem a nota completa (infNFe).");
  const ide = el(nfe, "ide"), emit = el(nfe, "emit"), dest = el(nfe, "dest"), tot = el(nfe, "ICMSTot");
  const ende = el(emit, "enderEmit"), endd = el(dest, "enderDest"), transp = el(nfe, "transp"), transporta = el(transp, "transporta");
  const vol = el(transp, "vol"), prot = el(doc, "infProt"), cobr = el(nfe, "cobr"), adic = el(nfe, "infAdic");
  const chave = (nfe.getAttribute("Id") ?? "").replace(/^NFe/, "");
  const nNF = (txt(ide, "nNF") ?? "").padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
  const serie = (txt(ide, "serie") ?? "").padStart(3, "0");

  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFE ${nNF} - ${limpo(txt(emit, "xNome"))}`);
  pdf.setCreator("Brasico");
  const f: Fontes = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const itens = produtos(nfe);

  // Cabeçalho (canhoto só na 1ª folha) e quadro do emitente / DANFE / chave
  function cabecalho(fl: Folha, folha: number, total: number, canhoto: boolean): number {
    let y = M;
    if (canhoto) {
      fl.rect(M, y, LARG - 110, 22);
      fl.texto(`RECEBEMOS DE ${txt(emit, "xNome") ?? ""} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`, M + 2, y + 7, 5.5, false, LARG - 116);
      fl.texto(`EMISSÃO: ${data(txt(ide, "dhEmi"))}   VALOR TOTAL: R$ ${n2(txt(tot, "vNF"))}   DESTINATÁRIO: ${txt(dest, "xNome") ?? ""}`, M + 2, y + 16, 5.5, false, LARG - 116);
      fl.campo(M, y + 22, 110, 22, "Data de recebimento", "");
      fl.campo(M + 110, y + 22, LARG - 220, 22, "Identificação e assinatura do recebedor", "");
      fl.rect(M + LARG - 110, y, 110, 44);
      fl.centro("NF-e", M + LARG - 110, 110, y + 14, 11, true);
      fl.centro(`Nº ${nNF}`, M + LARG - 110, 110, y + 27, 8, true);
      fl.centro(`SÉRIE ${serie}`, M + LARG - 110, 110, y + 38, 8, true);
      y += 44;
      for (let x = M; x < M + LARG; x += 6) fl.page.drawLine({ start: { x, y: fl.Y(y + 5) }, end: { x: x + 3, y: fl.Y(y + 5) }, thickness: 0.4, color: CINZA });
      y += 10;
    }
    const hq = 92;
    const wEmit = 230, wDanfe = 100, wChave = LARG - wEmit - wDanfe;
    fl.rect(M, y, wEmit, hq);
    fl.texto("IDENTIFICAÇÃO DO EMITENTE", M + 2, y + 7, 5, false, wEmit - 4, CINZA);
    const usadas = fl.linhas(txt(emit, "xNome") ?? "", M + 6, y + 22, wEmit - 12, 10, 2);
    const yEnd = y + 22 + usadas * 11.6 + 4;
    fl.texto(`${txt(ende, "xLgr") ?? ""}, ${txt(ende, "nro") ?? ""} ${txt(ende, "xCpl") ?? ""}`, M + 6, yEnd, 7, false, wEmit - 12);
    fl.texto(`${txt(ende, "xBairro") ?? ""} - ${cep(txt(ende, "CEP"))}`, M + 6, yEnd + 9, 7, false, wEmit - 12);
    fl.texto(`${txt(ende, "xMun") ?? ""} - ${txt(ende, "UF") ?? ""}${txt(ende, "fone") ? `   Fone: ${txt(ende, "fone")}` : ""}`, M + 6, yEnd + 18, 7, false, wEmit - 12);

    const xd = M + wEmit;
    fl.rect(xd, y, wDanfe, hq);
    fl.centro("DANFE", xd, wDanfe, y + 14, 13, true);
    fl.centro("DOCUMENTO AUXILIAR DA", xd, wDanfe, y + 23, 5.5);
    fl.centro("NOTA FISCAL ELETRÔNICA", xd, wDanfe, y + 30, 5.5);
    fl.texto("0 - ENTRADA", xd + 8, y + 42, 6);
    fl.texto("1 - SAÍDA", xd + 8, y + 50, 6);
    fl.rect(xd + 70, y + 37, 16, 16);
    fl.centro(txt(ide, "tpNF") ?? "", xd + 70, 16, y + 49, 10, true);
    fl.centro(`Nº ${nNF}`, xd, wDanfe, y + 66, 8, true);
    fl.centro(`SÉRIE ${serie}`, xd, wDanfe, y + 76, 8, true);
    fl.centro(`FOLHA ${folha}/${total}`, xd, wDanfe, y + 86, 7);

    const xc = xd + wDanfe;
    fl.rect(xc, y, wChave, hq);
    const barras = code128c(chave);
    const mod = (wChave - 16) / barras.reduce((s, b) => s + b, 0);
    let bx = xc + 8;
    barras.forEach((b, i) => {
      if (i % 2 === 0) fl.page.drawRectangle({ x: bx, y: fl.Y(y + 38), width: b * mod, height: 30, color: PRETO });
      bx += b * mod;
    });
    fl.texto("CHAVE DE ACESSO", xc + 4, y + 46, 5, false, wChave - 8, CINZA);
    fl.centro(chaveFmt(chave), xc, wChave, y + 56, 8, true);
    fl.centro("Consulta de autenticidade no portal nacional da NF-e", xc, wChave, y + 70, 6.5);
    fl.centro("www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora", xc, wChave, y + 79, 6.5);
    y += hq;

    fl.campo(M, y, wEmit + wDanfe, 20, "Natureza da operação", txt(ide, "natOp") ?? "");
    fl.campo(xc, y, wChave, 20, "Protocolo de autorização de uso", prot ? `${txt(prot, "nProt") ?? ""} - ${data(txt(prot, "dhRecbto"))} ${hora(txt(prot, "dhRecbto"))}` : "", "e");
    y += 20;
    const w3 = LARG / 3;
    fl.campo(M, y, w3, 20, "Inscrição estadual", txt(emit, "IE") ?? "");
    fl.campo(M + w3, y, w3, 20, "Inscr. estadual do subst. tributário", txt(emit, "IEST") ?? "");
    fl.campo(M + 2 * w3, y, w3, 20, "CNPJ / CPF", cnpj(txt(emit, "CNPJ") ?? txt(emit, "CPF")));
    return y + 20;
  }

  // Cabeçalho da tabela de produtos
  function cabProdutos(fl: Folha, y: number): number {
    fl.titulo("DADOS DOS PRODUTOS / SERVIÇOS", y + 8);
    y += 10;
    let x = M;
    for (const [, w, rotulo] of COLS) { fl.rect(x, y, w, 14); fl.centro(rotulo.toUpperCase(), x, w, y + 9, 4.8, true); x += w; }
    return y + 14;
  }
  // Uma linha de produto (a descrição pode quebrar em até 3 linhas)
  function linhaProduto(fl: Folha, p: Produto, y: number, medir = false): number {
    const wDesc = COLS[1][1] - 4;
    const palavras = limpo(p.desc).split(" ");
    const linhasDesc: string[] = [];
    let atual = "";
    for (const w of palavras) {
      const t = atual ? `${atual} ${w}` : w;
      if (f.r.widthOfTextAtSize(t, 6) > wDesc && atual) { linhasDesc.push(atual); atual = w; } else atual = t;
    }
    if (atual) linhasDesc.push(atual);
    const h = Math.max(1, Math.min(3, linhasDesc.length)) * 7.4 + 3;
    if (medir) return h;
    let x = M;
    for (const [k, w, , al] of COLS) {
      fl.page.drawLine({ start: { x, y: fl.Y(y) }, end: { x, y: fl.Y(y + h) }, thickness: 0.4, color: CINZA });
      if (k === "desc") linhasDesc.slice(0, 3).forEach((l, i) => fl.texto(l, x + 2, y + 7 + i * 7.4, 6, false, wDesc));
      else if (al === "d") fl.direita(String(p[k]), x + w - 2, y + 7, 6);
      else fl.texto(String(p[k]), x + 2, y + 7, 6, false, w - 3);
      x += w;
    }
    fl.page.drawLine({ start: { x, y: fl.Y(y) }, end: { x, y: fl.Y(y + h) }, thickness: 0.4, color: CINZA });
    fl.page.drawLine({ start: { x: M, y: fl.Y(y + h) }, end: { x: M + LARG, y: fl.Y(y + h) }, thickness: 0.2, color: CINZA });
    return h;
  }

  // Quantas folhas: a 1ª leva os quadros todos e os dados adicionais; as outras só o cabeçalho e produtos
  const ALTURA_DADOS_ADIC = 92;
  const fimUtil = A4.h - M;
  const fl0 = new Folha(pdf.addPage([A4.w, A4.h]), f);
  let y = cabecalho(fl0, 1, 1, true);

  // Destinatário
  fl0.titulo("DESTINATÁRIO / REMETENTE", y + 8); y += 10;
  const wd = [LARG - 200, 120, 80];
  fl0.campo(M, y, wd[0], 20, "Nome / razão social", txt(dest, "xNome") ?? "");
  fl0.campo(M + wd[0], y, wd[1], 20, "CNPJ / CPF", cnpj(txt(dest, "CNPJ") ?? txt(dest, "CPF")));
  fl0.campo(M + wd[0] + wd[1], y, wd[2], 20, "Data da emissão", data(txt(ide, "dhEmi")));
  y += 20;
  fl0.campo(M, y, LARG - 300, 20, "Endereço", `${txt(endd, "xLgr") ?? ""}, ${txt(endd, "nro") ?? ""} ${txt(endd, "xCpl") ?? ""}`);
  fl0.campo(M + LARG - 300, y, 140, 20, "Bairro / distrito", txt(endd, "xBairro") ?? "");
  fl0.campo(M + LARG - 160, y, 80, 20, "CEP", cep(txt(endd, "CEP")));
  fl0.campo(M + LARG - 80, y, 80, 20, "Data da saída / entrada", data(txt(ide, "dhSaiEnt")));
  y += 20;
  fl0.campo(M, y, LARG - 300, 20, "Município", txt(endd, "xMun") ?? "");
  fl0.campo(M + LARG - 300, y, 90, 20, "Fone / fax", txt(endd, "fone") ?? "");
  fl0.campo(M + LARG - 210, y, 30, 20, "UF", txt(endd, "UF") ?? "");
  fl0.campo(M + LARG - 180, y, 100, 20, "Inscrição estadual", txt(dest, "IE") ?? "");
  fl0.campo(M + LARG - 80, y, 80, 20, "Hora da saída", hora(txt(ide, "dhSaiEnt")));
  y += 20;

  // Fatura / duplicatas
  const dups = cobr ? (Array.from(cobr.getElementsByTagNameNS("http://www.portalfiscal.inf.br/nfe", "dup")) as unknown as Element[]) : [];
  if (dups.length) {
    fl0.titulo("FATURA / DUPLICATAS", y + 8); y += 10;
    const wDup = LARG / 6;
    const linhasDup = Math.ceil(Math.min(dups.length, 12) / 6);
    fl0.rect(M, y, LARG, linhasDup * 22);
    dups.slice(0, 12).forEach((d, i) => {
      const x = M + (i % 6) * wDup + 3, yy = y + Math.floor(i / 6) * 22;
      fl0.texto(`Nº ${txt(d, "nDup") ?? ""}   Venc. ${data(txt(d, "dVenc"))}`, x, yy + 8, 6, false, wDup - 6);
      fl0.texto(`R$ ${n2(txt(d, "vDup"))}`, x, yy + 17, 7, true, wDup - 6);
    });
    y += linhasDup * 22;
  }

  // Cálculo do imposto
  fl0.titulo("CÁLCULO DO IMPOSTO", y + 8); y += 10;
  const w5 = LARG / 6;
  const l1: [string, string][] = [["Base de cálc. do ICMS", "vBC"], ["Valor do ICMS", "vICMS"], ["Base de cálc. ICMS ST", "vBCST"], ["Valor do ICMS ST", "vST"], ["Valor aprox. dos tributos", "vTotTrib"], ["Valor total dos produtos", "vProd"]];
  const l2: [string, string][] = [["Valor do frete", "vFrete"], ["Valor do seguro", "vSeg"], ["Desconto", "vDesc"], ["Outras despesas", "vOutro"], ["Valor total do IPI", "vIPI"], ["Valor total da nota", "vNF"]];
  l1.forEach(([r, k], i) => fl0.campo(M + i * w5, y, w5, 20, r, n2(txt(tot, k)), "d"));
  y += 20;
  l2.forEach(([r, k], i) => fl0.campo(M + i * w5, y, w5, 20, r, n2(txt(tot, k)), "d", k === "vNF" ? 9 : 8));
  y += 20;

  // Transportador
  fl0.titulo("TRANSPORTADOR / VOLUMES TRANSPORTADOS", y + 8); y += 10;
  const veic = el(transp, "veicTransp");
  fl0.campo(M, y, LARG - 330, 20, "Nome / razão social", txt(transporta, "xNome") ?? "");
  fl0.campo(M + LARG - 330, y, 90, 20, "Frete por conta", MOD_FRETE[txt(transp, "modFrete") ?? ""] ?? "");
  fl0.campo(M + LARG - 240, y, 60, 20, "Código ANTT", txt(veic, "RNTC") ?? "");
  fl0.campo(M + LARG - 180, y, 60, 20, "Placa do veículo", txt(veic, "placa") ?? "");
  fl0.campo(M + LARG - 120, y, 20, 20, "UF", txt(veic, "UF") ?? "");
  fl0.campo(M + LARG - 100, y, 100, 20, "CNPJ / CPF", cnpj(txt(transporta, "CNPJ") ?? txt(transporta, "CPF")));
  y += 20;
  fl0.campo(M, y, LARG - 230, 20, "Endereço", txt(transporta, "xEnder") ?? "");
  fl0.campo(M + LARG - 230, y, 110, 20, "Município", txt(transporta, "xMun") ?? "");
  fl0.campo(M + LARG - 120, y, 20, 20, "UF", txt(transporta, "UF") ?? "");
  fl0.campo(M + LARG - 100, y, 100, 20, "Inscrição estadual", txt(transporta, "IE") ?? "");
  y += 20;
  const w6 = LARG / 6;
  [["Quantidade", txt(vol, "qVol") ?? ""], ["Espécie", txt(vol, "esp") ?? ""], ["Marca", txt(vol, "marca") ?? ""], ["Numeração", txt(vol, "nVol") ?? ""],
    ["Peso bruto", n2(txt(vol, "pesoB"), 3)], ["Peso líquido", n2(txt(vol, "pesoL"), 3)]].forEach(([r, v], i) => fl0.campo(M + i * w6, y, w6, 20, r, v, i >= 4 ? "d" : "e"));
  y += 20;

  // Produtos: na 1ª folha até o espaço dos dados adicionais; o resto continua nas próximas
  const folhas: Folha[] = [fl0];
  let fl = fl0;
  y = cabProdutos(fl, y);
  let limite = fimUtil - ALTURA_DADOS_ADIC;
  for (const p of itens) {
    const h = linhaProduto(fl, p, y, true);
    if (y + h > limite) {
      fl.page.drawLine({ start: { x: M, y: fl.Y(y) }, end: { x: M + LARG, y: fl.Y(y) }, thickness: 0.5, color: PRETO });
      fl = new Folha(pdf.addPage([A4.w, A4.h]), f);
      folhas.push(fl);
      y = cabProdutos(fl, cabecalho(fl, folhas.length, 0, false));
      limite = fimUtil;
    }
    y += linhaProduto(fl, p, y);
  }
  fl.page.drawLine({ start: { x: M, y: fl.Y(y) }, end: { x: M + LARG, y: fl.Y(y) }, thickness: 0.5, color: PRETO });

  // Dados adicionais (rodapé da 1ª folha)
  const ya = fimUtil - ALTURA_DADOS_ADIC + 10;
  fl0.titulo("DADOS ADICIONAIS", ya - 2);
  fl0.rect(M, ya, LARG * 0.65, ALTURA_DADOS_ADIC - 10);
  fl0.texto("INFORMAÇÕES COMPLEMENTARES", M + 2, ya + 6, 5, false, 200, CINZA);
  const info = [txt(adic, "infAdFisco"), txt(adic, "infCpl")].filter(Boolean).join(" ");
  fl0.linhas(info, M + 3, ya + 14, LARG * 0.65 - 6, 6, 10);
  fl0.rect(M + LARG * 0.65, ya, LARG * 0.35, ALTURA_DADOS_ADIC - 10);
  fl0.texto("RESERVADO AO FISCO", M + LARG * 0.65 + 2, ya + 6, 5, false, 200, CINZA);

  // Número de folhas no cabeçalho de cada folha (só se sabe no fim)
  if (folhas.length > 1) {
    folhas.forEach((x, i) => {
      const yFolha = i === 0 ? M + 54 + 86 : M + 86;
      const xd = M + 230;
      x.page.drawRectangle({ x: xd + 1, y: x.Y(yFolha + 3), width: 98, height: 9, color: rgb(1, 1, 1) });
      x.centro(`FOLHA ${i + 1}/${folhas.length}`, xd, 100, yFolha, 7);
    });
  }
  return pdf.save();
}
