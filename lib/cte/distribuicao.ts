// Distribuição de CT-e de interesse do CNPJ (NT 2015.002, versão 1.00), sobre lib/notas/sefaz.ts.
// Mesmo jeito das NF-e: até 50 documentos por chamada, por NSU; 137 = nada novo (esperar 1 hora);
// 656 = consumo indevido (esperar 1 hora). Ambiente Nacional do CT-e, certificado A1 da empresa.
import { chamar } from "@/lib/notas/sefaz";
import { el, lerDocumento, todos, txt, xml, type Conhecimento, type EventoCte } from "./documentos";

const UF_RN = "24"; // cUFAutor: todas as empresas no Rio Grande do Norte

export type Ilegivel = { nsu: number; esquema: string; xml: string };
export type RodadaCte = {
  cstat: number | null; motivo: string | null; ultNSU: string | null; maxNSU: string | null;
  ctes: Conhecimento[]; eventos: EventoCte[]; ilegiveis: Ilegivel[];
};

export function distribuir(cadeia: string, chave: string, cnpj: string, ultNSU: string) {
  return rodada(cadeia, chave, cnpj, `<distNSU><ultNSU>${ultNSU}</ultNSU></distNSU>`);
}
export function consultarNSU(cadeia: string, chave: string, cnpj: string, nsu: string) {
  return rodada(cadeia, chave, cnpj, `<consNSU><NSU>${nsu}</NSU></consNSU>`);
}

async function rodada(cadeia: string, chavePem: string, cnpj: string, pedido: string): Promise<RodadaCte> {
  const msg =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00"><tpAmb>1</tpAmb><cUFAutor>${UF_RN}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>${pedido}</distDFeInt>`;
  const resposta = await chamar("cte", msg, cadeia, chavePem);
  const doc = xml(resposta);
  const ret = el(doc, "retDistDFeInt");
  const ctes: Conhecimento[] = [];
  const eventos: EventoCte[] = [];
  const ilegiveis: Ilegivel[] = [];
  for (const z of todos(ret, "docZip")) {
    const nsu = Number(z.getAttribute("NSU") ?? "0");
    const esquema = z.getAttribute("schema") ?? "";
    try {
      const r = lerDocumento(nsu, esquema, z.textContent ?? "", cnpj);
      if (r.cte) ctes.push(r.cte);
      else if (r.evento) eventos.push(r.evento);
      else ilegiveis.push({ nsu, esquema, xml: r.bruto });
    } catch {
      ilegiveis.push({ nsu, esquema, xml: z.textContent ?? "" });
    }
  }
  return {
    cstat: Number(txt(ret, "cStat")) || null,
    motivo: txt(ret, "xMotivo") ?? (ret ? null : resposta.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)),
    ultNSU: txt(ret, "ultNSU"),
    maxNSU: txt(ret, "maxNSU"),
    ctes, eventos, ilegiveis,
  };
}
