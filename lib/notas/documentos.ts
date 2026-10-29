// Lê os documentos que a distribuição da SEFAZ devolve: cada docZip vem em base64 + gzip,
// com o esquema dizendo o que é (resumo da nota, nota completa, resumo de evento ou evento completo).
import { gunzipSync } from "node:zlib";
import { DOMParser, type Document as XDoc, type Element } from "@xmldom/xmldom";

export type Item = {
  n_item: number; codigo: string | null; descricao: string; ncm: string | null; cfop: string | null;
  unidade: string | null; quantidade: number | null; valor_unitario: number | null; valor_total: number | null;
  desconto: number; frete: number;
};
export type Nota = {
  chave: string; emitente_cnpj: string | null; emitente_nome: string | null; emissao: string | null;
  valor: number | null; situacao: string; completa: boolean; nsu: string; resumo: Record<string, unknown>;
  xml: string; itens: Item[];
};
export type Evento = {
  chave: string; tipo: string; sentido: "recebido" | "enviado"; cstat: number | null; motivo: string | null;
  protocolo: string | null; quando: string | null; xml: string;
};

const NS = "http://www.portalfiscal.inf.br/nfe";

export function xml(texto: string) {
  return new DOMParser().parseFromString(texto, "text/xml");
}

// Primeiro elemento com o nome (sem prefixo) dentro de um nó
export function el(raiz: Element | XDoc | null | undefined, nome: string): Element | null {
  if (!raiz) return null;
  const l = (raiz as Element).getElementsByTagNameNS(NS, nome);
  if (l.length) return l[0] as Element;
  const l2 = (raiz as Element).getElementsByTagName(nome);
  return l2.length ? (l2[0] as Element) : null;
}
export function txt(raiz: Element | XDoc | null | undefined, nome: string): string | null {
  const e = el(raiz, nome);
  const t = e?.textContent?.trim();
  return t ? t : null;
}
const num = (s: string | null) => (s == null || s === "" ? null : Number(s));
const SIT: Record<string, string> = { "1": "autorizada", "2": "denegada", "3": "cancelada" };

export function descompactar(base64: string): string {
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

function resumoNota(doc: XDoc, nsu: string, bruto: string): Nota {
  const r = doc.documentElement as unknown as Element;
  return {
    chave: txt(r, "chNFe") ?? "",
    emitente_cnpj: txt(r, "CNPJ") ?? txt(r, "CPF"),
    emitente_nome: txt(r, "xNome"),
    emissao: txt(r, "dhEmi"),
    valor: num(txt(r, "vNF")),
    situacao: SIT[txt(r, "cSitNFe") ?? "1"] ?? "autorizada",
    completa: false,
    nsu,
    resumo: { ie: txt(r, "IE"), tipo_nf: txt(r, "tpNF"), protocolo: txt(r, "nProt"), recebida: txt(r, "dhRecbto") },
    xml: bruto,
    itens: [],
  };
}

function notaCompleta(doc: XDoc, nsu: string, bruto: string): Nota | null {
  const inf = el(doc, "infNFe");
  if (!inf) return null;
  const chave = (inf.getAttribute("Id") ?? "").replace(/^NFe/, "") || (txt(doc, "chNFe") ?? "");
  const emit = el(inf, "emit");
  const tot = el(inf, "ICMSTot");
  const prot = el(doc, "infProt");
  const cstat = txt(prot, "cStat");
  const itens: Item[] = [];
  const dets = inf.getElementsByTagNameNS(NS, "det");
  for (let k = 0; k < dets.length; k++) {
    const d = dets[k] as Element;
    const p = el(d, "prod");
    itens.push({
      n_item: Number(d.getAttribute("nItem") ?? k + 1),
      codigo: txt(p, "cProd"),
      descricao: txt(p, "xProd") ?? "?",
      ncm: txt(p, "NCM"),
      cfop: txt(p, "CFOP"),
      unidade: txt(p, "uCom"),
      quantidade: num(txt(p, "qCom")),
      valor_unitario: num(txt(p, "vUnCom")),
      valor_total: num(txt(p, "vProd")),
      desconto: num(txt(p, "vDesc")) ?? 0,
      frete: num(txt(p, "vFrete")) ?? 0,
    });
  }
  return {
    chave,
    emitente_cnpj: txt(emit, "CNPJ") ?? txt(emit, "CPF"),
    emitente_nome: txt(emit, "xNome"),
    emissao: txt(el(inf, "ide"), "dhEmi") ?? txt(el(inf, "ide"), "dEmi"),
    valor: num(txt(tot, "vNF")),
    situacao: cstat === "110" || cstat === "301" || cstat === "302" ? "denegada" : "autorizada",
    completa: true,
    nsu,
    resumo: { protocolo: txt(prot, "nProt"), natureza: txt(el(inf, "ide"), "natOp"), numero: txt(el(inf, "ide"), "nNF"), serie: txt(el(inf, "ide"), "serie") },
    xml: bruto,
    itens,
  };
}

function evento(doc: XDoc, bruto: string): Evento | null {
  const inf = el(doc, "infEvento") ?? (doc.documentElement as unknown as Element);
  const chave = txt(inf, "chNFe");
  const tipo = txt(inf, "tpEvento");
  if (!chave || !tipo) return null;
  const ret = el(doc, "retEvento");
  return {
    chave, tipo, sentido: "recebido",
    cstat: num(txt(ret, "cStat")),
    motivo: txt(inf, "xEvento") ?? txt(inf, "descEvento") ?? txt(ret, "xMotivo"),
    protocolo: txt(inf, "nProt") ?? txt(ret, "nProt"),
    quando: txt(inf, "dhEvento"),
    xml: bruto,
  };
}

// Um docZip da distribuição → nota ou evento
export function lerDocumento(nsu: string, esquema: string, base64: string): { nota?: Nota; evento?: Evento } {
  const bruto = descompactar(base64);
  const doc = xml(bruto);
  if (esquema.startsWith("resNFe")) return { nota: resumoNota(doc, nsu, bruto) };
  if (esquema.startsWith("procNFe")) {
    const n = notaCompleta(doc, nsu, bruto);
    return n ? { nota: n } : {};
  }
  if (esquema.startsWith("resEvento") || esquema.startsWith("procEventoNFe")) {
    const e = evento(doc, bruto);
    return e ? { evento: e } : {};
  }
  return {};
}
