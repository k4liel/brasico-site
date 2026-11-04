// Conversa com a API de distribuição dos contribuintes do Ambiente de Dados Nacional (ADN) da NFS-e:
// GET https://adn.nfse.gov.br/contribuintes/DFe/{NSU} com o certificado A1 (mTLS), resposta em JSON.
// Devolve as NFS-e e eventos em que o CNPJ é emitente, tomador ou intermediário, em ordem de NSU.
// Com o certificado da matriz, ?cnpjConsulta=<CNPJ> lê outra inscrição da mesma raiz (manual do ADN v1.0).
import https from "node:https";
import { gunzipSync } from "node:zlib";

const HOST = "adn.nfse.gov.br";
const TIMEOUT_MS = 25000;

export class ErroConexao extends Error {}

export type Documento = { nsu: number; chave: string | null; tipo: string | null; xml: string };
export type Resposta = {
  http: number;
  status: string | null;          // StatusProcessamento: DOCUMENTOS_LOCALIZADOS, NENHUM_DOCUMENTO_LOCALIZADO, REJEICAO...
  documentos: Documento[];
  erros: string[];
  chaves: string[];               // nomes dos campos da resposta (diagnóstico, sem conteúdo)
  bruto: string;                  // resposta sem o lote, para entender uma rejeição
};

// Campo do JSON sem depender de maiúsculas (a API já mudou o formato entre versões)
function campo(o: unknown, nome: string): unknown {
  if (!o || typeof o !== "object") return undefined;
  const k = Object.keys(o).find((x) => x.toLowerCase() === nome.toLowerCase());
  return k ? (o as Record<string, unknown>)[k] : undefined;
}

function abrir(conteudo: string): string {
  const buf = Buffer.from(conteudo, "base64");
  // gzip começa com 1f 8b; se não for, é o XML em base64 puro
  return buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

function mensagens(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const cod = campo(e, "Codigo") ?? campo(e, "codigo");
    const desc = campo(e, "Descricao") ?? campo(e, "descricao") ?? campo(e, "Mensagem");
    return [cod, desc].filter(Boolean).join(" ") || JSON.stringify(e).slice(0, 200);
  });
}

function get(caminho: string, cadeiaPem: string, chavePem: string): Promise<{ http: number; texto: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST, port: 443, method: "GET", path: caminho,
        cert: cadeiaPem, key: chavePem, minVersion: "TLSv1.2",
        headers: { Accept: "application/json" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => resolve({ http: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") }));
        res.on("error", (e) => reject(new ErroConexao(`conexão: ${e.message}`)));
      }
    );
    req.on("timeout", () => req.destroy(new ErroConexao("conexão: tempo esgotado")));
    req.on("error", (e) => reject(e instanceof ErroConexao ? e : new ErroConexao(`conexão: ${e.message}`)));
    req.end();
  });
}

// Um lote a partir do NSU (o ADN devolve até 50 documentos por chamada)
export async function distribuir(nsu: number, cnpjConsulta: string | null, cadeiaPem: string, chavePem: string, comLote = true): Promise<Resposta> {
  const q = new URLSearchParams(comLote ? { lote: "true" } : {});
  if (cnpjConsulta) q.set("cnpjConsulta", cnpjConsulta);
  const { http, texto } = await get(`/contribuintes/DFe/${nsu}?${q}`, cadeiaPem, chavePem);
  let json: unknown = null;
  try { json = JSON.parse(texto); } catch { /* resposta que não é JSON */ }
  if (!json) {
    if (http === 429) return { http, status: "LIMITE", documentos: [], erros: ["muitas consultas (429)"], chaves: [], bruto: "" };
    throw new ErroConexao(`o Portal Nacional respondeu HTTP ${http}${texto ? `: ${texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
  const lote = campo(json, "LoteDFe");
  const documentos: Documento[] = [];
  for (const d of Array.isArray(lote) ? lote : []) {
    const arquivo = String(campo(d, "ArquivoXml") ?? "");
    if (!arquivo) continue;
    try {
      documentos.push({
        nsu: Number(campo(d, "NSU")),
        chave: (campo(d, "ChaveAcesso") as string) ?? null,
        tipo: (campo(d, "TipoDocumento") as string) ?? null,
        xml: abrir(arquivo),
      });
    } catch {
      // Documento que não abre fica de fora; o NSU avança e ele não trava a leitura
    }
  }
  return {
    http,
    status: (campo(json, "StatusProcessamento") as string) ?? null,
    documentos,
    erros: [...mensagens(campo(json, "Erros")), ...mensagens(campo(json, "Alertas"))],
    chaves: Object.keys(json as object),
    bruto: JSON.stringify({ ...(json as object), LoteDFe: Array.isArray(lote) ? `${lote.length} documentos` : lote }).slice(0, 1500),
  };
}
