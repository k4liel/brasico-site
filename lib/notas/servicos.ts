// Distribuição de documentos e ciência da operação, montadas sobre lib/notas/sefaz.ts
import { SignedXml } from "xml-crypto";
import { chamar, type Servico } from "./sefaz";
import { el, lerDocumento, txt, xml, type Evento, type Nota } from "./documentos";

export type Credencial = { certificado: string; cadeia: string; chave: string };

const UF_RN = "24"; // cUFAutor: UF da empresa (todas no Rio Grande do Norte)

export type Rodada = {
  cstat: number | null; motivo: string | null; ultNSU: string | null; maxNSU: string | null;
  notas: Nota[]; eventos: Evento[];
};

// Uma chamada da distribuição por NSU (até 50 documentos)
export async function distribuir(cred: Credencial, cnpj: string, ultNSU: string): Promise<Rodada> {
  const msg =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${UF_RN}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ultNSU}</ultNSU></distNSU></distDFeInt>`;
  const resposta = await chamar("distribuicao", msg, cred.cadeia, cred.chave);
  const doc = xml(resposta);
  const ret = el(doc, "retDistDFeInt");
  const notas: Nota[] = [];
  const eventos: Evento[] = [];
  const zips = ret ? ret.getElementsByTagNameNS("http://www.portalfiscal.inf.br/nfe", "docZip") : null;
  for (let k = 0; zips && k < zips.length; k++) {
    const z = zips[k];
    try {
      const r = lerDocumento(z.getAttribute("NSU") ?? "", z.getAttribute("schema") ?? "", z.textContent ?? "");
      if (r.nota?.chave) notas.push(r.nota);
      if (r.evento) eventos.push(r.evento);
    } catch {
      // Documento que não abre fica de fora; o NSU avança e ele não trava a rodada
    }
  }
  return {
    cstat: Number(txt(ret, "cStat")) || null,
    motivo: txt(ret, "xMotivo"),
    ultNSU: txt(ret, "ultNSU"),
    maxNSU: txt(ret, "maxNSU"),
    notas, eventos,
  };
}

// Hora de Brasília no formato da NF-e (AAAA-MM-DDThh:mm:ss-03:00)
function agora() {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 19) + "-03:00";
}

// Assinatura do padrão NF-e: RSA-SHA1, digest SHA1, C14N, referência ao Id de infEvento
function assinarEvento(evento: string, cred: Credencial) {
  const sig = new SignedXml({
    privateKey: cred.chave,
    publicCert: cred.certificado,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  sig.computeSignature(evento, { location: { reference: "//*[local-name(.)='infEvento']", action: "after" } });
  return sig.getSignedXml();
}

// Ciência da operação (210210) para até 20 notas, num lote só
export async function darCiencia(cred: Credencial, cnpj: string, chaves: string[]): Promise<{ cstat: number | null; motivo: string | null; eventos: Evento[] }> {
  if (!chaves.length) return { cstat: null, motivo: null, eventos: [] };
  const quando = agora();
  const eventos = chaves.slice(0, 20).map((ch) => {
    const id = `ID210210${ch}01`;
    const ev =
      `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>1</tpAmb>` +
      `<CNPJ>${cnpj}</CNPJ><chNFe>${ch}</chNFe><dhEvento>${quando}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento>` +
      `<verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento>`;
    return assinarEvento(ev, cred);
  });
  const lote = String(Date.now()).slice(-15);
  const msg = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${lote}</idLote>${eventos.join("")}</envEvento>`;
  const resposta = await chamar("evento" as Servico, msg, cred.cadeia, cred.chave);
  const doc = xml(resposta);
  const ret = el(doc, "retEnvEvento");
  const saida: Evento[] = [];
  const rets = doc.getElementsByTagNameNS("http://www.portalfiscal.inf.br/nfe", "retEvento");
  for (let k = 0; k < rets.length; k++) {
    const inf = el(rets[k], "infEvento");
    const ch = txt(inf, "chNFe");
    if (!ch) continue;
    saida.push({
      chave: ch, tipo: "210210", sentido: "enviado",
      cstat: Number(txt(inf, "cStat")) || null, motivo: txt(inf, "xMotivo"), protocolo: txt(inf, "nProt"),
      quando: txt(inf, "dhRegEvento") ?? quando, xml: "",
    });
  }
  return { cstat: Number(txt(ret, "cStat")) || null, motivo: txt(ret, "xMotivo"), eventos: saida };
}
