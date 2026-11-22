// Lê os documentos que a distribuição do CT-e devolve (NT 2015.002): cada docZip vem em base64 + gzip,
// com o esquema dizendo o que é (CT-e autorizado procCTe / procCTeOS, ou evento procEventoCTe).
// Vale para o CT-e (modelo 57) e o CT-e OS (modelo 67), versão 4.00.
import { gunzipSync } from "node:zlib";
import { DOMParser, type Document as XDoc, type Element } from "@xmldom/xmldom";

const NS = "http://www.portalfiscal.inf.br/cte";

export type Componente = { nome: string; valor: number | null };
export type Quantidade = { unidade: string | null; tipo: string | null; quantidade: number | null };
export type Conhecimento = {
  chave: string; papeis: string[]; numero: string | null; serie: string | null; modelo: string | null; emissao: string | null;
  cfop: string | null; natureza: string | null; modal: string | null; tipo_cte: string | null; tipo_servico: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; emitente_uf: string | null;
  remetente_doc: string | null; remetente_nome: string | null; destinatario_doc: string | null; destinatario_nome: string | null;
  expedidor_doc: string | null; expedidor_nome: string | null; recebedor_doc: string | null; recebedor_nome: string | null;
  tomador_tipo: string | null; tomador_doc: string | null; tomador_nome: string | null;
  origem: string | null; destino: string | null;
  valor_prestacao: number | null; valor_receber: number | null; base_icms: number | null; icms: number | null; aliquota_icms: number | null;
  valor_carga: number | null; produto: string | null; componentes: Componente[]; quantidades: Quantidade[]; nfes: string[];
  protocolo: string | null; observacao: string | null; nsu: number; xml: string;
};
export type EventoCte = { chave: string; tipo: string; descricao: string | null; quando: string | null; protocolo: string | null; nsu: number; xml: string };

export function xml(texto: string) {
  return new DOMParser().parseFromString(texto, "text/xml");
}
export function el(raiz: Element | XDoc | null | undefined, nome: string): Element | null {
  if (!raiz) return null;
  const l = (raiz as Element).getElementsByTagNameNS(NS, nome);
  if (l.length) return l[0] as Element;
  const l2 = (raiz as Element).getElementsByTagName(nome);
  return l2.length ? (l2[0] as Element) : null;
}
export function todos(raiz: Element | XDoc | null | undefined, nome: string): Element[] {
  if (!raiz) return [];
  let l = (raiz as Element).getElementsByTagNameNS(NS, nome);
  if (!l.length) l = (raiz as Element).getElementsByTagName(nome);
  const r: Element[] = [];
  for (let k = 0; k < l.length; k++) r.push(l[k] as Element);
  return r;
}
// Filho direto (não procura dentro de outros grupos: CNPJ do emitente ≠ CNPJ do remetente)
function filho(raiz: Element | null, nome: string): Element | null {
  if (!raiz) return null;
  for (let k = 0; k < raiz.childNodes.length; k++) {
    const c = raiz.childNodes[k] as Element;
    if (c.nodeType === 1 && (c.localName ?? c.nodeName.replace(/^.*:/, "")) === nome) return c;
  }
  return null;
}
export function txt(raiz: Element | XDoc | null | undefined, nome: string): string | null {
  const t = el(raiz, nome)?.textContent?.trim();
  return t ? t : null;
}
const ftxt = (raiz: Element | null, nome: string) => filho(raiz, nome)?.textContent?.trim() || null;
const num = (s: string | null) => (s == null || s === "" ? null : Number(s));
const docDe = (g: Element | null) => ftxt(g, "CNPJ") ?? ftxt(g, "CPF");

export function descompactar(base64: string): string {
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

const TOMADOR: Record<string, string> = { "0": "remetente", "1": "expedidor", "2": "recebedor", "3": "destinatario", "4": "outros" };

function conhecimento(doc: XDoc, nsu: number, bruto: string, cnpj: string): Conhecimento | null {
  const inf = el(doc, "infCte");
  if (!inf) return null;
  const chave = (inf.getAttribute("Id") ?? "").replace(/^CTe/, "") || (txt(doc, "chCTe") ?? "");
  if (!/^\d{44}$/.test(chave)) return null;
  const ide = filho(inf, "ide");
  const emit = filho(inf, "emit");
  const rem = filho(inf, "rem"), dest = filho(inf, "dest"), exped = filho(inf, "exped"), receb = filho(inf, "receb");
  // Tomador: toma3 (um dos atores) ou toma4 (outro); no CT-e OS o grupo se chama toma
  const toma3 = filho(ide, "toma3") ?? filho(ide, "toma03");
  const toma4 = filho(ide, "toma4") ?? filho(ide, "toma04");
  const tomaOS = filho(inf, "toma");
  let tomadorTipo = ftxt(toma3, "toma") ?? ftxt(toma4, "toma") ?? (tomaOS ? "4" : null);
  const atores: Record<string, Element | null> = { "0": rem, "1": exped, "2": receb, "3": dest };
  const tomadorGrupo = toma4 ?? tomaOS ?? (tomadorTipo ? atores[tomadorTipo] ?? null : null);
  if (tomaOS && !tomadorTipo) tomadorTipo = "4";
  const vPrest = filho(inf, "vPrest");
  const icmsGrupo = el(filho(inf, "imp"), "ICMS");
  const icmsDet = icmsGrupo ? (Array.from({ length: icmsGrupo.childNodes.length }, (_, k) => icmsGrupo.childNodes[k] as Element).find((c) => c.nodeType === 1) ?? null) : null;
  const norm = filho(inf, "infCTeNorm");
  const carga = filho(norm, "infCarga");
  const prot = el(doc, "infProt");
  const compl = filho(inf, "compl");

  const papeis: string[] = [];
  if (docDe(emit) === cnpj) papeis.push("emitente");
  if (docDe(rem) === cnpj) papeis.push("remetente");
  if (docDe(dest) === cnpj) papeis.push("destinatario");
  if (docDe(exped) === cnpj) papeis.push("expedidor");
  if (docDe(receb) === cnpj) papeis.push("recebedor");
  if (docDe(tomadorGrupo) === cnpj) papeis.push("tomador");
  if (!papeis.length && todos(inf, "autXML").some((a) => docDe(a) === cnpj)) papeis.push("autorizado");
  if (!papeis.length) papeis.push("interessado");

  const local = (m: string | null, uf: string | null) => (m ? `${m}${uf ? `/${uf}` : ""}` : uf);
  return {
    chave, papeis,
    numero: ftxt(ide, "nCT"), serie: ftxt(ide, "serie"), modelo: ftxt(ide, "mod"),
    emissao: ftxt(ide, "dhEmi"), cfop: ftxt(ide, "CFOP"), natureza: ftxt(ide, "natOp"), modal: ftxt(ide, "modal"),
    tipo_cte: ftxt(ide, "tpCTe"), tipo_servico: ftxt(ide, "tpServ"),
    emitente_cnpj: docDe(emit), emitente_nome: ftxt(emit, "xNome"), emitente_uf: txt(filho(emit, "enderEmit"), "UF"),
    remetente_doc: docDe(rem), remetente_nome: ftxt(rem, "xNome"),
    destinatario_doc: docDe(dest), destinatario_nome: ftxt(dest, "xNome"),
    expedidor_doc: docDe(exped), expedidor_nome: ftxt(exped, "xNome"),
    recebedor_doc: docDe(receb), recebedor_nome: ftxt(receb, "xNome"),
    tomador_tipo: tomadorTipo ? TOMADOR[tomadorTipo] ?? tomadorTipo : null,
    tomador_doc: docDe(tomadorGrupo), tomador_nome: ftxt(tomadorGrupo, "xNome"),
    origem: local(ftxt(ide, "xMunIni"), ftxt(ide, "UFIni")), destino: local(ftxt(ide, "xMunFim"), ftxt(ide, "UFFim")),
    valor_prestacao: num(ftxt(vPrest, "vTPrest")), valor_receber: num(ftxt(vPrest, "vRec")),
    base_icms: num(txt(icmsDet, "vBC")), icms: num(txt(icmsDet, "vICMS") ?? txt(icmsDet, "vICMSOutraUF")), aliquota_icms: num(txt(icmsDet, "pICMS")),
    valor_carga: num(ftxt(carga, "vCarga")), produto: ftxt(carga, "proPred"),
    componentes: todos(vPrest, "Comp").map((c) => ({ nome: ftxt(c, "xNome") ?? "?", valor: num(ftxt(c, "vComp")) })),
    quantidades: todos(carga, "infQ").map((q) => ({ unidade: ftxt(q, "cUnid"), tipo: ftxt(q, "tpMed"), quantidade: num(ftxt(q, "qCarga")) })),
    nfes: todos(norm, "infNFe").map((x) => ftxt(x, "chave") ?? "").filter((c) => /^\d{44}$/.test(c)),
    protocolo: txt(prot, "nProt"),
    observacao: ftxt(compl, "xObs"),
    nsu, xml: bruto,
  };
}

function evento(doc: XDoc, nsu: number, bruto: string): EventoCte | null {
  const inf = el(doc, "infEvento");
  const chave = txt(inf, "chCTe");
  const tipo = txt(inf, "tpEvento");
  if (!chave || !tipo) return null;
  const ret = el(doc, "retEventoCTe");
  return {
    chave, tipo,
    descricao: txt(inf, "descEvento") ?? txt(ret, "xEvento") ?? txt(ret, "xMotivo"),
    quando: txt(inf, "dhEvento"),
    protocolo: txt(el(ret, "infEvento"), "nProt") ?? txt(inf, "nProt"),
    nsu, xml: bruto,
  };
}

// Um docZip da distribuição → conhecimento ou evento (o que não abrir volta vazio e fica guardado como ilegível)
export function lerDocumento(nsu: number, esquema: string, base64: string, cnpj: string): { cte?: Conhecimento; evento?: EventoCte; bruto: string } {
  const bruto = descompactar(base64);
  const doc = xml(bruto);
  if (/^procEvento/i.test(esquema) || el(doc, "eventoCTe")) {
    const e = evento(doc, nsu, bruto);
    return e ? { evento: e, bruto } : { bruto };
  }
  const c = conhecimento(doc, nsu, bruto, cnpj);
  return c ? { cte: c, bruto } : { bruto };
}
