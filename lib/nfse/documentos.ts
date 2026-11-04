// Lê o XML da NFS-e do padrão nacional (leiaute 1.00, xmlns http://www.sped.fazenda.gov.br/nfse) e dos eventos.
// NFSe > infNFSe (Id="NFS" + chave de 50 dígitos): número, emitente, valores calculados e a DPS com tomador e serviço.
// Evento > infEvento > pedRegEvento > infPedReg: chNFSe, dhEvento e o grupo e<código> (e101101 = cancelamento).
import { DOMParser, type Element } from "@xmldom/xmldom";

export type NotaServico = {
  chave: string; papel: "emitida" | "tomada" | "intermediada"; numero: string | null; emissao: string | null;
  competencia: string | null; emitente_cnpj: string | null; emitente_nome: string | null; emitente_municipio: string | null;
  tomador_doc: string | null; tomador_nome: string | null; local_incidencia: string | null; codigo_servico: string | null;
  descricao: string | null; valor_servico: number | null; base_calculo: number | null; aliquota: number | null;
  iss: number | null; iss_retido: boolean | null; valor_liquido: number | null; nsu: number; xml: string;
};
export type EventoServico = { chave: string; tipo: string; descricao: string | null; quando: string | null; nsu: number; xml: string };

const nome = (e: Element) => e.localName ?? e.nodeName.replace(/^.*:/, "");

// Primeiro elemento com o nome (sem prefixo), procurando nos descendentes
function achar(raiz: Element | null | undefined, n: string): Element | null {
  if (!raiz) return null;
  for (let c = raiz.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const e = c as Element;
    if (nome(e) === n) return e;
    const f = achar(e, n);
    if (f) return f;
  }
  return null;
}
function filho(raiz: Element | null | undefined, n: string): Element | null {
  for (let c = raiz?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && nome(c as Element) === n) return c as Element;
  return null;
}
const txt = (raiz: Element | null | undefined, n: string) => achar(raiz, n)?.textContent?.trim() || null;
const num = (s: string | null) => (s == null || s === "" || Number.isNaN(Number(s)) ? null : Number(s));
const doc = (raiz: Element | null) => txt(raiz, "CNPJ") ?? txt(raiz, "CPF") ?? txt(raiz, "NIF");

export function lerDocumento(xmlTexto: string, nsu: number, cnpjEmpresa: string): { nota?: NotaServico; evento?: EventoServico } {
  const d = new DOMParser().parseFromString(xmlTexto, "text/xml");
  const r = d.documentElement as unknown as Element | null;
  if (!r) return {};

  if (nome(r) === "NFSe" || achar(r, "infNFSe")) {
    const inf = nome(r) === "infNFSe" ? r : achar(r, "infNFSe");
    const chave = (inf?.getAttribute("Id") ?? "").replace(/^NFS/, "");
    const emit = achar(inf, "emit");
    const dps = achar(inf, "infDPS");
    const toma = achar(dps, "toma");
    // "valores" direto em infNFSe (os calculados pelo sistema); o de dentro da DPS é o informado
    const valoresNota = filho(inf, "valores");
    const emitente = doc(emit);
    const tomador = doc(toma);
    const ret = txt(dps, "tpRetISSQN");
    return {
      nota: {
        chave,
        papel: emitente === cnpjEmpresa ? "emitida" : tomador === cnpjEmpresa ? "tomada" : "intermediada",
        numero: txt(inf, "nNFSe"),
        emissao: txt(dps, "dhEmi") ?? txt(inf, "dhProc"),
        competencia: txt(dps, "dCompet"),
        emitente_cnpj: emitente,
        emitente_nome: txt(emit, "xNome"),
        emitente_municipio: txt(inf, "xLocEmi"),
        tomador_doc: tomador,
        tomador_nome: txt(toma, "xNome"),
        local_incidencia: txt(inf, "xLocIncid"),
        codigo_servico: txt(dps, "cTribNac"),
        descricao: txt(dps, "xDescServ") ?? txt(inf, "xTribNac"),
        valor_servico: num(txt(dps, "vServ")),
        base_calculo: num(txt(valoresNota, "vBC")),
        aliquota: num(txt(valoresNota, "pAliqAplic")),
        iss: num(txt(valoresNota, "vISSQN")),
        iss_retido: ret ? ret !== "1" : null,
        valor_liquido: num(txt(valoresNota, "vLiq")),
        nsu,
        xml: xmlTexto,
      },
    };
  }

  const ped = achar(r, "infPedReg") ?? r;
  const chave = txt(ped, "chNFSe");
  if (!chave) return {};
  let tipo = "";
  let descricao: string | null = null;
  for (let c = ped.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && /^e\d{6}$/.test(nome(c as Element))) {
      tipo = nome(c as Element).slice(1);
      descricao = txt(c as Element, "xDesc");
      break;
    }
  }
  return { evento: { chave, tipo: tipo || "?", descricao, quando: txt(ped, "dhEvento") ?? txt(r, "dhProc"), nsu, xml: xmlTexto } };
}
