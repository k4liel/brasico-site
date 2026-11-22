// DACTE (documento auxiliar do CT-e) em PDF, retrato A4, montado com o CT-e autorizado guardado em cte_notas
// (lido do XML oficial por lib/cte/documentos.ts): transportadora, chave com código de barras, protocolo,
// tipo e modal, origem e destino, remetente, destinatário, expedidor, recebedor, tomador, carga, componentes
// do valor, ICMS, documentos transportados (NF-e) e observações. CT-e cancelado sai com a marca d'água.
// Reaproveita a Folha, o Code 128 C e as fontes do DANFE (lib/notas/danfe.ts).
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { Folha, code128c, limpo, type Fontes } from "@/lib/notas/danfe";

export type CteLinha = {
  chave: string; numero: string | null; serie: string | null; modelo: string | null; emissao: string | null; cfop: string | null;
  natureza: string | null; modal: string | null; tipo_cte: string | null; tipo_servico: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; emitente_uf: string | null;
  remetente_doc: string | null; remetente_nome: string | null; destinatario_doc: string | null; destinatario_nome: string | null;
  expedidor_doc: string | null; expedidor_nome: string | null; recebedor_doc: string | null; recebedor_nome: string | null;
  tomador_tipo: string | null; tomador_doc: string | null; tomador_nome: string | null; origem: string | null; destino: string | null;
  valor_prestacao: number | null; valor_receber: number | null; base_icms: number | null; icms: number | null; aliquota_icms: number | null;
  valor_carga: number | null; produto: string | null; componentes: { nome: string; valor: number | null }[];
  quantidades: { unidade: string | null; tipo: string | null; quantidade: number | null }[]; nfes: string[];
  protocolo: string | null; observacao: string | null; situacao: string;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 18;
const LARG = A4.w - 2 * M;
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.35, 0.35, 0.35);

export const MODAL: Record<string, string> = { "01": "Rodoviário", "02": "Aéreo", "03": "Aquaviário", "04": "Ferroviário", "05": "Dutoviário", "06": "Multimodal" };
export const TIPO_CTE: Record<string, string> = { "0": "Normal", "1": "Complemento de valores", "2": "Anulação", "3": "Substituto" };
const TIPO_SERV: Record<string, string> = { "0": "Normal", "1": "Subcontratação", "2": "Redespacho", "3": "Redespacho intermediário", "4": "Serviço vinculado a multimodal", "6": "Transporte de pessoas", "7": "Transporte de valores", "8": "Excesso de bagagem" };
export const TOMADOR: Record<string, string> = { remetente: "Remetente", expedidor: "Expedidor", recebedor: "Recebedor", destinatario: "Destinatário", outros: "Outros" };
const UNID: Record<string, string> = { "00": "M3", "01": "KG", "02": "TON", "03": "UNIDADE", "04": "LITROS", "05": "MMBTU" };

const brl = (v: number | null | undefined) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const doc = (c: string | null) =>
  !c ? "" : c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c;
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }) : "");
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");

export async function dactePdf(c: CteLinha): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DACTE ${c.numero ?? ""} - ${limpo(c.emitente_nome)}`);
  pdf.setCreator("Brasico");
  const f: Fontes = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const page = pdf.addPage([A4.w, A4.h]);
  const fl = new Folha(page, f);
  let y = M;

  // Cabeçalho: transportadora | DACTE | chave
  const hq = 96, wEmit = 220, wDacte = 110, wChave = LARG - wEmit - wDacte;
  fl.rect(M, y, wEmit, hq);
  fl.texto("EMITENTE (TRANSPORTADORA)", M + 2, y + 7, 5, false, wEmit - 4, CINZA);
  const usadas = fl.linhas(c.emitente_nome ?? "", M + 6, y + 22, wEmit - 12, 10, 3);
  fl.texto(`CNPJ ${doc(c.emitente_cnpj)}`, M + 6, y + 22 + usadas * 11.6 + 6, 7.5);
  if (c.emitente_uf) fl.texto(`UF ${c.emitente_uf}`, M + 6, y + 22 + usadas * 11.6 + 16, 7.5);
  const xd = M + wEmit;
  fl.rect(xd, y, wDacte, hq);
  fl.centro("DACTE", xd, wDacte, y + 16, 14, true);
  fl.centro("DOCUMENTO AUXILIAR DO", xd, wDacte, y + 26, 5.5);
  fl.centro(c.modelo === "67" ? "CONHECIMENTO DE TRANSPORTE OS" : "CONHECIMENTO DE TRANSPORTE", xd, wDacte, y + 33, 5.5);
  fl.centro("ELETRÔNICO", xd, wDacte, y + 40, 5.5);
  fl.centro(`MODELO ${c.modelo ?? "57"}  SÉRIE ${c.serie ?? ""}`, xd, wDacte, y + 56, 7, true);
  fl.centro(`Nº ${c.numero ?? ""}`, xd, wDacte, y + 68, 9, true);
  fl.centro("FOLHA 1/1", xd, wDacte, y + 80, 6.5);
  fl.centro(dataHora(c.emissao), xd, wDacte, y + 90, 6.5);
  const xc = xd + wDacte;
  fl.rect(xc, y, wChave, hq);
  const barras = code128c(c.chave);
  const mod = (wChave - 16) / barras.reduce((s, b) => s + b, 0);
  let bx = xc + 8;
  barras.forEach((b, i) => { if (i % 2 === 0) page.drawRectangle({ x: bx, y: fl.Y(y + 38), width: b * mod, height: 30, color: PRETO }); bx += b * mod; });
  fl.texto("CHAVE DE ACESSO", xc + 4, y + 47, 5, false, wChave - 8, CINZA);
  fl.centro(chaveFmt(c.chave), xc, wChave, y + 57, 7.5, true);
  fl.centro("Consulta em www.cte.fazenda.gov.br/portal", xc, wChave, y + 70, 6.5);
  fl.texto("PROTOCOLO DE AUTORIZAÇÃO", xc + 4, y + 82, 5, false, wChave - 8, CINZA);
  fl.centro(c.protocolo ?? "", xc, wChave, y + 92, 7.5, true);
  y += hq;

  const w4 = LARG / 4;
  fl.campo(M, y, w4, 20, "Tipo do CT-e", TIPO_CTE[c.tipo_cte ?? ""] ?? c.tipo_cte ?? "");
  fl.campo(M + w4, y, w4, 20, "Tipo do serviço", TIPO_SERV[c.tipo_servico ?? ""] ?? c.tipo_servico ?? "");
  fl.campo(M + 2 * w4, y, w4, 20, "Modal", MODAL[c.modal ?? ""] ?? c.modal ?? "");
  fl.campo(M + 3 * w4, y, w4, 20, "Tomador do serviço", TOMADOR[c.tomador_tipo ?? ""] ?? c.tomador_tipo ?? "");
  y += 20;
  fl.campo(M, y, LARG, 20, "CFOP - natureza da prestação", `${c.cfop ?? ""} - ${c.natureza ?? ""}`);
  y += 20;
  fl.campo(M, y, LARG / 2, 20, "Início da prestação", c.origem ?? "");
  fl.campo(M + LARG / 2, y, LARG / 2, 20, "Término da prestação", c.destino ?? "");
  y += 26;

  // Atores
  const ator = (x: number, yy: number, w: number, rotulo: string, nome: string | null, d: string | null) => {
    fl.rect(x, yy, w, 30);
    fl.texto(rotulo.toUpperCase(), x + 2, yy + 6, 5, false, w - 4, CINZA);
    fl.texto(nome ?? "-", x + 4, yy + 17, 7.5, true, w - 8);
    fl.texto(d ? `CNPJ/CPF ${doc(d)}` : "", x + 4, yy + 26, 6.5, false, w - 8);
  };
  ator(M, y, LARG / 2, "Remetente", c.remetente_nome, c.remetente_doc);
  ator(M + LARG / 2, y, LARG / 2, "Destinatário", c.destinatario_nome, c.destinatario_doc);
  y += 30;
  ator(M, y, LARG / 2, "Expedidor", c.expedidor_nome, c.expedidor_doc);
  ator(M + LARG / 2, y, LARG / 2, "Recebedor", c.recebedor_nome, c.recebedor_doc);
  y += 30;
  ator(M, y, LARG, "Tomador do serviço (quem paga o frete)", c.tomador_nome, c.tomador_doc);
  y += 36;

  // Carga
  fl.campo(M, y, LARG * 0.5, 20, "Produto predominante", c.produto ?? "");
  fl.campo(M + LARG * 0.5, y, LARG * 0.5, 20, "Valor total da carga (R$)", brl(c.valor_carga), "d");
  y += 20;
  const qs = c.quantidades.slice(0, 4);
  if (qs.length) {
    const wq = LARG / qs.length;
    qs.forEach((q, i) => fl.campo(M + i * wq, y, wq, 20, `${q.tipo ?? "Quantidade"} (${UNID[q.unidade ?? ""] ?? q.unidade ?? ""})`,
      q.quantidade == null ? "" : Number(q.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 4 }), "d"));
    y += 20;
  }
  y += 6;

  // Componentes do valor
  fl.titulo("COMPONENTES DO VALOR DA PRESTAÇÃO DO SERVIÇO", y + 8);
  y += 10;
  const comps = c.componentes.length ? c.componentes : [{ nome: "Valor da prestação", valor: c.valor_prestacao }];
  const porLinha = 4, wc = LARG / porLinha;
  comps.forEach((cp, i) => {
    const xx = M + (i % porLinha) * wc, yy = y + Math.floor(i / porLinha) * 20;
    fl.campo(xx, yy, wc, 20, cp.nome, brl(cp.valor), "d");
  });
  y += Math.ceil(comps.length / porLinha) * 20;
  fl.campo(M, y, LARG / 2, 22, "Valor total do serviço (R$)", brl(c.valor_prestacao), "d", 10);
  fl.campo(M + LARG / 2, y, LARG / 2, 22, "Valor a receber (R$)", brl(c.valor_receber), "d", 10);
  y += 28;

  // ICMS
  fl.titulo("INFORMAÇÕES RELATIVAS AO IMPOSTO", y + 8);
  y += 10;
  fl.campo(M, y, LARG / 3, 20, "Base de cálculo (R$)", brl(c.base_icms), "d");
  fl.campo(M + LARG / 3, y, LARG / 3, 20, "Alíquota do ICMS (%)", c.aliquota_icms == null ? "" : Number(c.aliquota_icms).toLocaleString("pt-BR"), "d");
  fl.campo(M + 2 * LARG / 3, y, LARG / 3, 20, "Valor do ICMS (R$)", brl(c.icms), "d");
  y += 26;

  // Documentos transportados
  fl.titulo("DOCUMENTOS ORIGINÁRIOS (NF-e TRANSPORTADAS)", y + 8);
  y += 10;
  const nfes = c.nfes.slice(0, 24);
  const linhas = Math.max(1, Math.ceil(nfes.length / 2));
  fl.rect(M, y, LARG, linhas * 11 + 6);
  if (!nfes.length) fl.texto("Nenhuma NF-e informada neste CT-e.", M + 4, y + 11, 7);
  nfes.forEach((k, i) => fl.texto(`NF-e ${chaveFmt(k)}`, M + 4 + (i % 2) * (LARG / 2), y + 11 + Math.floor(i / 2) * 11, 6.8));
  y += linhas * 11 + 12;
  if (c.nfes.length > nfes.length) { fl.texto(`… e mais ${c.nfes.length - nfes.length} NF-e`, M, y, 6.5); y += 10; }

  // Observações
  fl.titulo("OBSERVAÇÕES", y + 8);
  y += 10;
  const altObs = Math.min(A4.h - M - y - 14, 120);
  fl.rect(M, y, LARG, Math.max(30, altObs));
  fl.linhas(c.observacao ?? "", M + 4, y + 10, LARG - 8, 6.8, Math.max(3, Math.floor(altObs / 8.4)));
  fl.texto("PDF montado pelo Brasico a partir do XML oficial do CT-e baixado da SEFAZ (Ambiente Nacional do CT-e).", M, A4.h - M + 6, 5.5, false, LARG, CINZA);

  if (c.situacao === "cancelada") {
    page.drawText("CANCELADO", { x: 130, y: 300, size: 90, font: f.b, color: rgb(0.85, 0.2, 0.2), opacity: 0.15, rotate: degrees(45) });
  }
  return pdf.save();
}
