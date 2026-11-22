// DANFE NFC-e (documento auxiliar da nota fiscal de consumidor) em PDF, no formato de bobina de 80 mm,
// montado com os dados que a TOTVS manda de cada venda (supabase/nfce.sql): emitente, itens, totais,
// pagamentos, chave de acesso com código de barras, protocolo e tributos. O XML oficial não é liberado ao
// emitente (nem pela SEFAZ, nem pela API fiscal da TOTVS, que dá erro), então o rodapé diz de onde vêm os dados.
// Nota cancelada sai com a marca d'água; venda sem nota fiscal sai como "comprovante sem valor fiscal".
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { code128c, limpo } from "@/lib/notas/danfe";

export type ItemNfce = {
  n: number; codigo: number | null; nome: string; ncm: string | null; unidade: string | null; cfop: string | null; cst: string | null;
  quantidade: number; valor_unitario: number; desconto: number; acrescimo: number; valor_total: number; cancelado: boolean;
  icms?: { aliquota: number | null; valor: number | null } | null;
  ibscbs?: { cst: string | null; cclasstrib: string | null } | null;
};
export type NotaNfce = {
  chave: string | null; numero: number | null; serie: string | null; situacao: string; emissao: string | null; protocolo: string | null;
  cupom: number | null; caixa: number | null; consumidor_identificado: boolean;
  valor: number | null; subtotal: number | null; servico: number | null; desconto: number | null; acrescimo: number | null; troco: number | null;
  icms: number | null; pis: number | null; cofins: number | null; cbs: number | null; ibs: number | null;
  itens: ItemNfce[]; pagamentos: { descricao: string; valor: number; recebido?: number }[];
  cancelamento: { quando?: string | null; motivo?: string | null; protocolo?: string | null } | null;
};
export type Emitente = { nome: string; cnpj: string; ie?: string | null; endereco?: string | null; municipio?: string | null };

const W = 226.77; // 80 mm
const M = 8;
const L = W - 2 * M;
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.4, 0.4, 0.4);
export const CONSULTA_RN = "https://nfce.sefaz.rn.gov.br/portalDFE/NFCe/ConsultaNFCe.aspx";

const brl = (v: number | null | undefined) => (v == null ? "-" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const cnpjFmt = (c: string) => (c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c);
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const dataHora = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Desenha de cima para baixo numa página de altura livre: primeiro mede (desenhar = false), depois desenha
class Bobina {
  y = M;
  constructor(public f: { r: PDFFont; b: PDFFont }, public page: PDFPage | null, public altura: number) {}
  private Y(y: number) { return this.altura - y; }
  private fonte(neg: boolean) { return neg ? this.f.b : this.f.r; }
  private cortar(s: string, tam: number, neg: boolean, w: number) {
    let t = limpo(s);
    while (t && this.fonte(neg).widthOfTextAtSize(t, tam) > w) t = t.slice(0, -1);
    return t;
  }
  texto(s: string, tam = 7, neg = false, alinhar: "e" | "c" | "d" = "e", x = M, w = L, cor = PRETO) {
    const t = this.cortar(s, tam, neg, w);
    const larg = this.fonte(neg).widthOfTextAtSize(t, tam);
    const px = alinhar === "c" ? x + (w - larg) / 2 : alinhar === "d" ? x + w - larg : x;
    if (this.page && t) this.page.drawText(t, { x: px, y: this.Y(this.y + tam), size: tam, font: this.fonte(neg), color: cor });
  }
  linha(s: string, tam = 7, neg = false, alinhar: "e" | "c" | "d" = "e", cor = PRETO) { this.texto(s, tam, neg, alinhar, M, L, cor); this.y += tam + 2.5; }
  // Texto que quebra em várias linhas
  paragrafo(s: string, tam = 6.5, neg = false, alinhar: "e" | "c" = "c", cor = PRETO) {
    const palavras = limpo(s).split(" ");
    let atual = "";
    const out: string[] = [];
    for (const p of palavras) {
      const t = atual ? `${atual} ${p}` : p;
      if (this.fonte(neg).widthOfTextAtSize(t, tam) > L && atual) { out.push(atual); atual = p; } else atual = t;
    }
    if (atual) out.push(atual);
    for (const l of out) this.linha(l, tam, neg, alinhar, cor);
  }
  par(esq: string, dir: string, tam = 7, neg = false) {
    this.texto(esq, tam, neg, "e", M, L * 0.65);
    this.texto(dir, tam, neg, "d", M + L * 0.35, L * 0.65);
    this.y += tam + 2.5;
  }
  traco() {
    if (this.page) for (let x = M; x < W - M; x += 4) this.page.drawLine({ start: { x, y: this.Y(this.y + 2) }, end: { x: x + 2, y: this.Y(this.y + 2) }, thickness: 0.4, color: CINZA });
    this.y += 6;
  }
  barras(chave: string) {
    const b = code128c(chave);
    const mod = L / b.reduce((s, x) => s + x, 0);
    let x = M;
    if (this.page) b.forEach((w, i) => { if (i % 2 === 0) this.page!.drawRectangle({ x, y: this.Y(this.y + 26), width: w * mod, height: 26, color: PRETO }); x += w * mod; });
    this.y += 30;
  }
}

function desenhar(b: Bobina, n: NotaNfce, e: Emitente) {
  const temNota = !!n.chave;
  b.paragrafo(e.nome, 8, true);
  b.linha(`CNPJ ${cnpjFmt(e.cnpj)}${e.ie ? `  IE ${e.ie}` : ""}`, 6.5, false, "c");
  if (e.endereco) b.paragrafo(e.endereco, 6.5);
  if (e.municipio) b.linha(e.municipio, 6.5, false, "c");
  b.traco();
  if (temNota) {
    b.paragrafo("DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica", 7, true);
  } else {
    b.paragrafo("COMPROVANTE DE VENDA - SEM VALOR FISCAL", 7.5, true);
    b.paragrafo(n.situacao === "pendente" ? "A NFC-e desta venda ainda não foi autorizada pela SEFAZ." : "Esta venda não emitiu nota fiscal no caixa (ex.: assinada, que vai para a conta do quarto).", 6.2, false, "c", CINZA);
  }
  b.traco();

  // Itens
  b.texto("#  CÓDIGO  DESCRIÇÃO", 5.8, true);
  b.texto("QTD UN  VL UNIT  VL TOTAL", 5.8, true, "d");
  b.y += 8.5;
  for (const it of n.itens) {
    const nome = `${String(it.n).padStart(3, "0")} ${it.codigo ?? ""} ${it.nome}${it.cancelado ? " (CANCELADO)" : ""}`;
    b.paragrafo(nome, 6.2, false, "e", it.cancelado ? CINZA : PRETO);
    b.texto(`${qtd(it.quantidade)} ${it.unidade ?? ""} x ${brl(it.valor_unitario)}`, 6.2, false, "e", M + 12, L - 12, it.cancelado ? CINZA : PRETO);
    b.texto(brl(it.valor_total), 6.2, false, "d", M, L, it.cancelado ? CINZA : PRETO);
    b.y += 8.7;
  }
  b.traco();
  const ativos = n.itens.filter((i) => !i.cancelado);
  b.par("Qtd. total de itens", String(ativos.length));
  b.par("Valor total R$", brl(n.subtotal ?? ativos.reduce((s, i) => s + i.valor_total, 0)));
  if (n.desconto) b.par("Descontos R$", brl(n.desconto));
  if (n.acrescimo) b.par("Acréscimos R$", brl(n.acrescimo));
  if (n.servico) b.par("Taxa de serviço R$", brl(n.servico));
  b.par("Valor a pagar R$", brl(n.valor), 8, true);
  b.y += 2;
  b.par("FORMA DE PAGAMENTO", "VALOR PAGO R$", 6.2, true);
  for (const p of n.pagamentos) b.par(p.descricao, brl(p.recebido ?? p.valor), 6.5);
  if (n.troco) b.par("Troco R$", brl(n.troco));
  b.traco();

  if (temNota) {
    b.paragrafo("Consulte pela chave de acesso em", 6.2);
    b.paragrafo(CONSULTA_RN, 5.8, false, "c", CINZA);
    b.paragrafo(chaveFmt(n.chave!), 6.8, true);
    b.y += 2;
    b.barras(n.chave!);
    b.traco();
    b.paragrafo(n.consumidor_identificado ? "CONSUMIDOR IDENTIFICADO (CPF na nota; o número não é guardado no Brasico)" : "CONSUMIDOR NÃO IDENTIFICADO", 6.5, true);
    b.traco();
    b.paragrafo(`NFC-e nº ${n.numero ?? "-"}  Série ${n.serie ?? "-"}  ${dataHora(n.emissao)}`, 6.8, true);
    b.paragrafo(n.protocolo ? `Protocolo de autorização: ${n.protocolo}` : "Sem protocolo de autorização (emitida em contingência ou pendente)", 6.5);
  } else {
    b.paragrafo(`Cupom ${n.cupom ?? "-"}  Caixa ${n.caixa ?? "-"}  ${dataHora(n.emissao)}`, 6.8, true);
  }
  b.traco();
  b.paragrafo("Tributos da venda (informados pelo caixa)", 6.2, true);
  b.par("ICMS R$", brl(n.icms), 6.5);
  b.par("PIS R$", brl(n.pis), 6.5);
  b.par("Cofins R$", brl(n.cofins), 6.5);
  if (n.cbs || n.ibs) { b.par("CBS R$", brl(n.cbs), 6.5); b.par("IBS R$", brl(n.ibs), 6.5); }
  if (n.situacao === "cancelada") {
    b.traco();
    b.paragrafo("NFC-e CANCELADA", 9, true);
    if (n.cancelamento?.motivo) b.paragrafo(`Motivo: ${n.cancelamento.motivo}`, 6.5);
    if (n.cancelamento?.protocolo) b.paragrafo(`Protocolo do cancelamento: ${n.cancelamento.protocolo}`, 6.5);
  }
  b.traco();
  b.paragrafo("Documento montado pelo Brasico com os dados que o caixa TOTVS mandou desta venda. O documento fiscal é o XML autorizado pela SEFAZ-RN.", 5.5, false, "c", CINZA);
  b.y += M;
}

export async function danfcePdf(n: NotaNfce, e: Emitente): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(n.chave ? `NFC-e ${n.numero ?? ""} - ${limpo(e.nome)}` : `Venda ${n.cupom ?? ""} - ${limpo(e.nome)}`);
  pdf.setCreator("Brasico");
  const f = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold) };
  // 1) mede a altura; 2) desenha numa página do tamanho certo
  const medida = new Bobina(f, null, 0);
  desenhar(medida, n, e);
  const altura = Math.max(280, medida.y);
  const page = pdf.addPage([W, altura]);
  desenhar(new Bobina(f, page, altura), n, e);
  if (n.situacao === "cancelada") {
    page.drawText("CANCELADA", { x: 30, y: altura / 2 - 40, size: 42, font: f.b, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(60) });
  }
  return pdf.save();
}
