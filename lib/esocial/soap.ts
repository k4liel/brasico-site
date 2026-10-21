// Conversa com os webservices do eSocial: SOAP 1.1 sobre HTTPS com certificado do cliente.
// O servidor (IIS do Serpro) só pede o certificado depois do pedido HTTP, por renegociação TLS 1.2.
// O Node (OpenSSL) faz isso; o Deno das Edge Functions do Supabase não. Por isso este código roda no site.
import https from "node:https";

export type Ambiente = 1 | 2; // 1 = produção, 2 = produção restrita (testes)

export type Servico = "envio" | "consulta" | "identificadores" | "download";

const HOSTS: Record<Ambiente, Record<Servico, string>> = {
  1: {
    envio: "webservices.envio.esocial.gov.br",
    consulta: "webservices.consulta.esocial.gov.br",
    identificadores: "webservices.download.esocial.gov.br",
    download: "webservices.download.esocial.gov.br",
  },
  2: {
    envio: "webservices.producaorestrita.esocial.gov.br",
    consulta: "webservices.producaorestrita.esocial.gov.br",
    identificadores: "webservices.producaorestrita.esocial.gov.br",
    download: "webservices.producaorestrita.esocial.gov.br",
  },
};

// Pacote de Comunicação v1.6 (e v1.6-Alfa, CNPJ alfanumérico): caminhos, namespaces e versões dos WSDL
export const WS: Record<Servico, { caminho: string; ns: string; servico: string }> = {
  envio: {
    caminho: "/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc",
    ns: "http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0",
    servico: "ServicoEnviarLoteEventos",
  },
  consulta: {
    caminho: "/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc",
    ns: "http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0",
    servico: "ServicoConsultarLoteEventos",
  },
  identificadores: {
    caminho: "/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc",
    ns: "http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0",
    servico: "ServicoConsultarIdentificadoresEventos",
  },
  download: {
    caminho: "/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc",
    ns: "http://www.esocial.gov.br/servicos/empregador/download/solicitacao/v1_0_0",
    servico: "ServicoSolicitarDownloadEventos",
  },
};

export class ErroConexao extends Error {}

const TIMEOUT_MS = 45000;

// metodo: ex. "ConsultarIdentificadoresEventosTrabalhador"; parametro: o elemento que envolve a mensagem
// (ex. "consultaEventosTrabalhador"); mensagem: o XML <eSocial ...> já assinado quando exigido.
export function chamar(opts: {
  ambiente: Ambiente;
  servico: Servico;
  metodo: string;
  parametro: string;
  mensagem: string;
  cadeiaPem: string;
  chavePem: string;
}): Promise<{ status: number; corpo: string }> {
  const ws = WS[opts.servico];
  const envelope =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="${ws.ns}">` +
    `<soapenv:Header/><soapenv:Body><v1:${opts.metodo}><v1:${opts.parametro}>${opts.mensagem}</v1:${opts.parametro}>` +
    `</v1:${opts.metodo}></soapenv:Body></soapenv:Envelope>`;
  const corpo = Buffer.from(envelope, "utf8");
  if (corpo.length > 750 * 1024) return Promise.reject(new Error("Mensagem maior que 750 KB (limite do eSocial)."));

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOSTS[opts.ambiente][opts.servico],
        port: 443,
        method: "POST",
        path: ws.caminho,
        cert: opts.cadeiaPem,
        key: opts.chavePem,
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.2",
        headers: {
          "Content-Type": "text/xml;charset=UTF-8",
          SOAPAction: `"${ws.ns}/${ws.servico}/${opts.metodo}"`,
          "Content-Length": corpo.length,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
        res.on("error", (e) => reject(new ErroConexao(`conexão: ${e.message}`)));
      }
    );
    req.on("timeout", () => req.destroy(new ErroConexao("conexão: tempo esgotado")));
    req.on("error", (e) => reject(e instanceof ErroConexao ? e : new ErroConexao(`conexão: ${e.message}`)));
    req.end(corpo);
  });
}
