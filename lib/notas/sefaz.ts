// Conversa com os webservices nacionais da NF-e (Ambiente Nacional): SOAP 1.2 sobre HTTPS
// com o certificado A1 da empresa. Dois serviços:
//  - NFeDistribuicaoDFe (NT 2014.002): documentos recebidos pelo CNPJ, por NSU, até 50 por chamada
//  - NFeRecepcaoEvento4: eventos do destinatário (só a ciência da operação, 210210)
import https from "node:https";

const SERVICOS = {
  distribuicao: {
    host: "www1.nfe.fazenda.gov.br",
    caminho: "/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    ns: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe",
    acao: "nfeDistDFeInteresse",
  },
  evento: {
    host: "www.nfe.fazenda.gov.br",
    caminho: "/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
    ns: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4",
    acao: "nfeRecepcaoEvento",
  },
} as const;

export type Servico = keyof typeof SERVICOS;

export class ErroConexao extends Error {}

const TIMEOUT_MS = 25000;

// mensagem: o XML do serviço (distDFeInt ou envEvento), já assinado quando exigido
export function chamar(servico: Servico, mensagem: string, cadeiaPem: string, chavePem: string): Promise<string> {
  const s = SERVICOS[servico];
  // A distribuição embrulha nfeDadosMsg na operação; os serviços versão 4 recebem nfeDadosMsg direto
  const corpoSoap = servico === "distribuicao"
    ? `<${s.acao} xmlns="${s.ns}"><nfeDadosMsg>${mensagem}</nfeDadosMsg></${s.acao}>`
    : `<nfeDadosMsg xmlns="${s.ns}">${mensagem}</nfeDadosMsg>`;
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpoSoap}</soap12:Body></soap12:Envelope>`;
  const corpo = Buffer.from(envelope, "utf8");

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: s.host,
        port: 443,
        method: "POST",
        path: s.caminho,
        cert: cadeiaPem,
        key: chavePem,
        minVersion: "TLSv1.2",
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${s.ns}/${s.acao}"`,
          "Content-Length": corpo.length,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          if ((res.statusCode ?? 0) >= 400 && !texto.includes("cStat")) {
            reject(new ErroConexao(`conexão: a SEFAZ respondeu HTTP ${res.statusCode}`));
          } else resolve(texto);
        });
        res.on("error", (e) => reject(new ErroConexao(`conexão: ${e.message}`)));
      }
    );
    req.on("timeout", () => req.destroy(new ErroConexao("conexão: tempo esgotado")));
    req.on("error", (e) => reject(e instanceof ErroConexao ? e : new ErroConexao(`conexão: ${e.message}`)));
    req.end(corpo);
  });
}
