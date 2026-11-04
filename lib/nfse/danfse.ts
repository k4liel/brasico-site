// DANFSe (Documento Auxiliar da NFS-e) em PDF, montado a partir do XML oficial da NFS-e do padrão nacional.
// A API nacional de geração do DANFSe foi suspensa em 03/08/2026 (NT 008 v1.02), então o PDF é feito aqui,
// no leiaute da NT 008: cabeçalho com chave e QR code de consulta, emitente, tomador, intermediário, serviço,
// tributação municipal e federal, valor total, tributos aproximados e informações complementares.
// Nota cancelada ou substituída sai com a marca d'água. Reaproveita a Folha e as fontes do DANFE (lib/notas/danfe.ts).
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { Folha, limpo, type Fontes } from "@/lib/notas/danfe";
import { achar, filho, txt } from "./documentos";

const A4 = { w: 595.28, h: 841.89 };
const M = 20;
const LARG = A4.w - 2 * M;
const H = 22; // altura de uma linha de campos
const CINZA_CLARO = rgb(0.92, 0.92, 0.92);
const CONSULTA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

const SIMPLES: Record<string, string> = { "1": "Não optante", "2": "Optante - Microempreendedor Individual (MEI)", "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)" };
const REG_SN: Record<string, string> = {
  "1": "Tributos federais e municipal pelo Simples Nacional",
  "2": "Federais pelo Simples Nacional e ISSQN pela NFS-e",
  "3": "Federais e municipal pela NFS-e",
};
const REG_ESP: Record<string, string> = { "0": "Nenhum", "1": "Ato cooperado", "2": "Estimativa", "3": "Microempresa municipal", "4": "Notário ou registrador", "5": "Profissional autônomo", "6": "Sociedade de profissionais" };
const TRIB_ISS: Record<string, string> = { "1": "Operação tributável", "2": "Imunidade", "3": "Exportação de serviço", "4": "Não incidência" };
const RET_ISS: Record<string, string> = { "1": "Não retido", "2": "Retido pelo tomador", "3": "Retido pelo intermediário" };

const brl = (v: string | number | null | undefined) =>
  v == null || v === "" ? "-" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: string | null) => (v == null || v === "" ? "-" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`);
const doc = (c: string | null) =>
  !c ? "-" : c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c;
const cep = (c: string | null) => (c && c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c ?? "-");
const fone = (f: string | null) => (!f ? "-" : f.length === 11 ? `(${f.slice(0, 2)}) ${f.slice(2, 7)}-${f.slice(7)}` : f.length === 10 ? `(${f.slice(0, 2)}) ${f.slice(2, 6)}-${f.slice(6)}` : f);
const dataHora = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}${iso.length >= 16 ? ` ${iso.slice(11, 19)}` : ""}` : "-");
const dataSo = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "-");
const soma = (...v: (string | null)[]) => v.reduce((s, x) => s + (x ? Number(x) : 0), 0);
const cod6 = (c: string | null) => (c && c.length === 6 ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4)}` : c ?? "-");

// Endereço em uma linha: logradouro, número, complemento, bairro
function endereco(e: Element | null) {
  if (!e) return "-";
  return [txt(e, "xLgr"), txt(e, "nro"), txt(e, "xCpl"), txt(e, "xBairro")].filter(Boolean).join(", ") || "-";
}

export async function danfsePdf(xmlTexto: string, situacao: "normal" | "cancelada" | "substituida" = "normal"): Promise<Uint8Array> {
  const d = new DOMParser().parseFromString(xmlTexto, "text/xml");
  const raiz = d.documentElement as unknown as Element | null;
  const inf = raiz ? (achar(raiz, "infNFSe") ?? null) : null;
  if (!inf) throw new Error("O XML não é de uma NFS-e do padrão nacional (infNFSe).");
  const chave = (inf.getAttribute("Id") ?? "").replace(/^NFS/, "");
  const emit = filho(inf, "emit");
  const valN = filho(inf, "valores");
  const dps = achar(inf, "infDPS");
  const prest = achar(dps, "prest");
  const toma = achar(dps, "toma");
  const interm = achar(dps, "interm");
  const serv = achar(dps, "serv");
  const valD = dps ? filho(dps, "valores") : null;
  const tribMun = achar(valD, "tribMun");
  const tribFed = achar(valD, "tribFed");
  const totTrib = achar(valD, "totTrib");
  const regTrib = achar(prest, "regTrib");
  const tpRet = txt(tribMun, "tpRetISSQN");

  // Nome do município pelo código IBGE: o XML só traz o nome do local de emissão, da prestação e da incidência
  const nomes: Record<string, string> = {};
  const cEmit = txt(achar(emit, "enderNac"), "cMun");
  if (cEmit) nomes[cEmit] = txt(inf, "xLocEmi") ?? "";
  const cPrest = txt(serv, "cLocPrestacao");
  if (cPrest) nomes[cPrest] = txt(inf, "xLocPrestacao") ?? "";
  const cIncid = txt(inf, "cLocIncid");
  if (cIncid) nomes[cIncid] = txt(inf, "xLocIncid") ?? "";
  const municipio = (c: string | null, uf?: string | null) => (!c ? "-" : `${nomes[c] || `IBGE ${c}`}${uf ? ` - ${uf}` : ""}`);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFSe ${txt(inf, "nNFSe") ?? ""} - ${limpo(txt(emit, "xNome"))}`);
  pdf.setCreator("Brasico");
  const f: Fontes = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const fl = new Folha(pdf.addPage([A4.w, A4.h]), f);

  // Faixa de título de cada bloco
  function bloco(titulo: string, y: number) {
    fl.page.drawRectangle({ x: M, y: fl.Y(y + 12), width: LARG, height: 12, color: CINZA_CLARO, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
    fl.texto(titulo, M + 4, y + 8.8, 7, true);
    return y + 12;
  }
  // Uma linha de campos com larguras proporcionais
  function linha(y: number, campos: [string, string, number?][], alt = H) {
    const total = campos.reduce((s, c) => s + (c[2] ?? 1), 0);
    let x = M;
    for (const [rot, val, peso] of campos) {
      const w = (LARG * (peso ?? 1)) / total;
      fl.campo(x, y, w, alt, rot, val, "e", 7.5);
      x += w;
    }
    return y + alt;
  }
  // Caixa de texto corrido com várias linhas
  function texto(y: number, rotulo: string, conteudo: string, maxLinhas: number) {
    const tam = 7;
    const medida = fl.linhas(conteudo || "-", M + 3, -1000, LARG - 6, tam, 0); // só conta as linhas
    const n = Math.max(1, Math.min(medida, maxLinhas));
    const alt = 11 + n * (tam + 1.6) + 3;
    fl.rect(M, y, LARG, alt);
    fl.texto(rotulo.toUpperCase(), M + 2, y + 6, 5, false, LARG - 4, rgb(0.35, 0.35, 0.35));
    fl.linhas(conteudo || "-", M + 3, y + 14, LARG - 6, tam, maxLinhas);
    if (medida > maxLinhas) fl.texto("(texto continua no XML da nota)", M + LARG - 120, y + alt - 2, 5, false, 118, rgb(0.35, 0.35, 0.35));
    return y + alt;
  }

  // ---- Cabeçalho: título, município, ambiente e QR code
  let y = M;
  const hCab = 74;
  fl.rect(M, y, LARG, hCab);
  fl.texto("DANFSe v1.0", M + 8, y + 22, 16, true);
  fl.texto("Documento Auxiliar da NFS-e", M + 8, y + 34, 8);
  fl.texto("Nota Fiscal de Serviço eletrônica - padrão nacional", M + 8, y + 45, 6.5);
  fl.centro(`Emitida em ${txt(inf, "xLocEmi") ?? "-"}`, M + 190, 210, y + 22, 9, true);
  fl.centro(txt(dps, "tpAmb") === "2" ? "AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL" : "Ambiente de produção", M + 190, 210, y + 34, 7);
  fl.centro(situacao === "normal" ? "Consulte a autenticidade pelo QR code" : situacao === "cancelada" ? "NFS-e CANCELADA" : "NFS-e SUBSTITUÍDA", M + 190, 210, y + 46, 7, situacao !== "normal");
  const qr = QRCode.create(CONSULTA + chave, { errorCorrectionLevel: "M" });
  const lado = 62, mod = lado / qr.modules.size, qx = M + LARG - lado - 6, qy = y + 6;
  for (let r = 0; r < qr.modules.size; r++)
    for (let c = 0; c < qr.modules.size; c++)
      if (qr.modules.get(r, c)) fl.page.drawRectangle({ x: qx + c * mod, y: fl.Y(qy + (r + 1) * mod), width: mod + 0.05, height: mod + 0.05, color: rgb(0, 0, 0) });
  y += hCab;

  y = linha(y, [["Chave de acesso da NFS-e", (chave.match(/.{1,5}/g) ?? []).join(" ")]]);
  y = linha(y, [["Número da NFS-e", txt(inf, "nNFSe") ?? "-"], ["Competência da NFS-e", dataSo(txt(dps, "dCompet"))], ["Data e hora da emissão da NFS-e", dataHora(txt(inf, "dhProc"))]]);
  y = linha(y, [["Número da DPS", txt(dps, "nDPS") ?? "-"], ["Série da DPS", txt(dps, "serie") ?? "-"], ["Data e hora da emissão da DPS", dataHora(txt(dps, "dhEmi"))]]);

  // ---- Emitente (prestador)
  y = bloco("EMITENTE DA NFS-e · PRESTADOR DO SERVIÇO", y);
  const endE = achar(emit, "enderNac");
  y = linha(y, [["CNPJ / CPF / NIF", doc(txt(emit, "CNPJ") ?? txt(emit, "CPF") ?? txt(emit, "NIF"))], ["Inscrição municipal", txt(emit, "IM") ?? "-"], ["Telefone", fone(txt(emit, "fone"))]]);
  y = linha(y, [["Nome / nome empresarial", txt(emit, "xNome") ?? "-", 2], ["E-mail", txt(emit, "email") ?? "-"]]);
  y = linha(y, [["Endereço", endereco(endE), 2], ["Município", municipio(txt(endE, "cMun"), txt(endE, "UF"))], ["CEP", cep(txt(endE, "CEP")), 0.5]]);
  y = linha(y, [["Simples Nacional na data de competência", SIMPLES[txt(regTrib, "opSimpNac") ?? ""] ?? "-"], ["Regime de apuração tributária pelo SN", REG_SN[txt(regTrib, "regApTribSN") ?? ""] ?? "-"]]);

  // ---- Tomador
  y = bloco("TOMADOR DO SERVIÇO", y);
  if (toma) {
    const endT = achar(toma, "end");
    const cT = txt(achar(toma, "endNac"), "cMun");
    y = linha(y, [["CNPJ / CPF / NIF", doc(txt(toma, "CNPJ") ?? txt(toma, "CPF") ?? txt(toma, "NIF"))], ["Inscrição municipal", txt(toma, "IM") ?? "-"], ["Telefone", fone(txt(toma, "fone"))]]);
    y = linha(y, [["Nome / nome empresarial", txt(toma, "xNome") ?? "-", 2], ["E-mail", txt(toma, "email") ?? "-"]]);
    y = linha(y, [["Endereço", endereco(endT), 2], ["Município", municipio(cT)], ["CEP", cep(txt(achar(toma, "endNac"), "CEP")), 0.5]]);
  } else {
    fl.rect(M, y, LARG, 14);
    fl.centro("TOMADOR DO SERVIÇO NÃO IDENTIFICADO NA NFS-e", M, LARG, y + 9.5, 6.5, true);
    y += 14;
  }

  // ---- Intermediário
  y = bloco("INTERMEDIÁRIO DO SERVIÇO", y);
  if (interm) {
    y = linha(y, [["CNPJ / CPF / NIF", doc(txt(interm, "CNPJ") ?? txt(interm, "CPF") ?? txt(interm, "NIF"))], ["Nome / nome empresarial", txt(interm, "xNome") ?? "-", 2]]);
  } else {
    fl.rect(M, y, LARG, 14);
    fl.centro("INTERMEDIÁRIO DO SERVIÇO NÃO IDENTIFICADO NA NFS-e", M, LARG, y + 9.5, 6.5, true);
    y += 14;
  }

  // ---- Serviço prestado
  y = bloco("SERVIÇO PRESTADO", y);
  const cServ = achar(serv, "cServ");
  y = texto(y, "Código de tributação nacional", `${cod6(txt(cServ, "cTribNac"))} - ${txt(inf, "xTribNac") ?? ""}`, 3);
  y = linha(y, [["Código de tributação municipal", txt(cServ, "cTribMun") ?? "-"], ["Código NBS", txt(cServ, "cNBS") ?? "-"], ["Local da prestação", municipio(cPrest)], ["País da prestação", txt(serv, "cPaisPrestacao") ?? "Brasil"]]);
  y = texto(y, "Descrição do serviço", txt(cServ, "xDescServ") ?? "-", 10);

  // ---- Tributação municipal
  y = bloco("TRIBUTAÇÃO MUNICIPAL", y);
  const vServ = txt(valD, "vServ");
  const vDescInc = txt(valD, "vDescIncond");
  const vDed = txt(achar(valD, "vDedRed"), "vDR") ?? txt(valN, "vCalcDR");
  y = linha(y, [["Tributação do ISSQN", TRIB_ISS[txt(tribMun, "tribISSQN") ?? ""] ?? "-"], ["Município de incidência do ISSQN", municipio(cIncid)], ["Regime especial de tributação", REG_ESP[txt(regTrib, "regEspTrib") ?? ""] ?? "-"], ["Retenção do ISSQN", RET_ISS[tpRet ?? ""] ?? "-"]]);
  y = linha(y, [["Valor do serviço", brl(vServ)], ["Desconto incondicionado", brl(vDescInc)], ["Total deduções / reduções", brl(vDed)], ["Cálculo do benefício municipal", brl(txt(valN, "vCalcBM"))]]);
  y = linha(y, [["Base de cálculo do ISSQN", brl(txt(valN, "vBC"))], ["Alíquota aplicada", pct(txt(valN, "pAliqAplic"))], ["Suspensão da exigibilidade", txt(achar(tribMun, "exigSusp"), "tpSusp") ? "Sim" : "Não"], ["ISSQN apurado", brl(txt(valN, "vISSQN"))]]);

  // ---- Tributação federal
  y = bloco("TRIBUTAÇÃO FEDERAL", y);
  const pc = achar(tribFed, "piscofins");
  y = linha(y, [["IRRF", brl(txt(tribFed, "vRetIRRF"))], ["Contribuição previdenciária - retida", brl(txt(tribFed, "vRetCP"))], ["CSLL - retida", brl(txt(tribFed, "vRetCSLL"))], ["PIS", brl(txt(pc, "vPis"))], ["COFINS", brl(txt(pc, "vCofins"))]]);

  // ---- Valor total
  y = bloco("VALOR TOTAL DA NFS-e", y);
  const issRet = tpRet && tpRet !== "1" ? txt(valN, "vISSQN") : null;
  const retFed = soma(txt(tribFed, "vRetIRRF"), txt(tribFed, "vRetCP"), txt(tribFed, "vRetCSLL"));
  y = linha(y, [["Valor do serviço", brl(vServ)], ["Desconto condicionado", brl(txt(valD, "vDescCond"))], ["Desconto incondicionado", brl(vDescInc)], ["ISSQN retido", brl(issRet)]]);
  y = linha(y, [["Total das retenções federais", brl(retFed || null)], ["Total das retenções (ISSQN + federais)", brl(txt(valN, "vTotalRet"))], ["Valor líquido da NFS-e", brl(txt(valN, "vLiq")), 2]]);
  // valor líquido em destaque
  fl.page.drawRectangle({ x: M + LARG / 2, y: fl.Y(y), width: LARG / 2, height: H, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });

  // ---- Totais aproximados dos tributos
  y = bloco("TOTAIS APROXIMADOS DOS TRIBUTOS", y);
  const vt = achar(totTrib, "vTotTrib"), pt = achar(totTrib, "pTotTrib");
  const aprox = (v: string, p: string) => (txt(vt, v) ? brl(txt(vt, v)) : txt(pt, p) ? pct(txt(pt, p)) : "-");
  y = txt(totTrib, "pTotTribSN")
    ? linha(y, [["Percentual aproximado dos tributos (Simples Nacional)", pct(txt(totTrib, "pTotTribSN"))]])
    : linha(y, [["Federais", aprox("vTotTribFed", "pTotTribFed")], ["Estaduais", aprox("vTotTribEst", "pTotTribEst")], ["Municipais", aprox("vTotTribMun", "pTotTribMun")]]);

  // ---- Informações complementares
  y = bloco("INFORMAÇÕES COMPLEMENTARES", y);
  const compl = [txt(serv, "xInfComp") ?? txt(inf, "xOutInf"), txt(achar(serv, "infoCompl"), "xPed") ? `Pedido ${txt(achar(serv, "infoCompl"), "xPed")}` : ""]
    .filter(Boolean).join("  ");
  y = texto(y, "", compl || "-", Math.max(2, Math.floor((A4.h - M - 30 - y) / 8.6) - 1));

  fl.texto(`Documento gerado pelo Brasico a partir do XML oficial da NFS-e. Consulta: ${CONSULTA}${chave}`, M, A4.h - M + 6, 5.5, false, LARG, rgb(0.4, 0.4, 0.4));

  // Marca d'água de cancelada ou substituída
  if (situacao !== "normal") {
    const marca = situacao === "cancelada" ? "CANCELADA" : "SUBSTITUÍDA";
    const tam = 90;
    const w = f.b.widthOfTextAtSize(limpo(marca), tam);
    fl.page.drawText(limpo(marca), {
      x: A4.w / 2 - (w / 2) * Math.cos(Math.PI / 5), y: A4.h / 2 - (w / 2) * Math.sin(Math.PI / 5),
      size: tam, font: f.b, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(36),
    });
  }
  return pdf.save();
}
