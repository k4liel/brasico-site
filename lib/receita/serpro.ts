// Conversa com o Integra Contador (SERPRO), a API oficial da Receita que faz o que se faz no e-CAC.
// Produção: OAuth2 com as chaves do contrato + certificado e-CNPJ A1 na conexão (mTLS).
// Demonstração: ambiente de testes do SERPRO, com chave pública e dados de mentira (sem custo).
// Nada de certificado, chave ou token nos logs.
import https from "node:https";

export type Ambiente = "demonstracao" | "producao";
export type Endpoint = "Apoiar" | "Consultar" | "Declarar" | "Emitir" | "Monitorar";

export type Credenciais = {
  key: string;
  secret: string;
  certificado: string; // certificado + cadeia, em PEM
  chave: string; // chave privada, em PEM
};

type Identificacao = { numero: string; tipo: 1 | 2 }; // 1 = CPF, 2 = CNPJ
export type Pedido = {
  contratante: Identificacao;
  autorPedidoDados: Identificacao;
  contribuinte: Identificacao;
  pedidoDados: { idSistema: string; idServico: string; versaoSistema: string; dados: string };
};

// Registro de cada chamada, para o custo (receita_chamadas)
export type Chamada = {
  endpoint: Endpoint;
  id_sistema: string;
  id_servico: string;
  http_status: number | null;
  codigo: string;
  duracao_ms: number;
};

export type Resposta = {
  http: number;
  status: number | null;
  dados: unknown; // o campo "dados" já convertido de texto JSON, quando possível
  mensagens: { codigo: string; texto: string }[];
};

export class ErroSerpro extends Error {}

const HOST_AUTENTICACAO = "autenticacao.sapi.serpro.gov.br";
const HOST_GATEWAY = "gateway.apiserpro.serpro.gov.br";
const CAMINHO: Record<Ambiente, string> = {
  producao: "/integra-contador/v1/",
  demonstracao: "/integra-contador-trial/v1/",
};
// Chave pública do ambiente de demonstração, publicada na documentação do SERPRO
const CHAVE_DEMONSTRACAO = "06aef429-a981-3ec5-a1f8-71d38d86481e";
const TIMEOUT_MS = 40000;

function post(opts: {
  host: string;
  path: string;
  headers: Record<string, string>;
  corpo: string;
  cert?: string;
  key?: string;
}): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: opts.host,
        port: 443,
        method: "POST",
        path: opts.path,
        headers: { ...opts.headers, "Content-Length": Buffer.byteLength(opts.corpo) },
        ...(opts.cert && opts.key ? { cert: opts.cert, key: opts.key } : {}),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (d: Buffer) => partes.push(d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new ErroSerpro("conexão: o SERPRO demorou demais para responder")));
    req.on("error", (e) => reject(e instanceof ErroSerpro ? e : new ErroSerpro(`conexão: ${e.message}`)));
    req.end(opts.corpo);
  });
}

// Tokens de produção ficam em memória enquanto a função da Vercel estiver viva (vale ~30 min)
const tokens = new Map<string, { access: string; jwt: string; vence: number }>();

async function autenticar(cred: Credenciais, renovar = false) {
  const guardado = tokens.get(cred.key);
  if (guardado && !renovar && guardado.vence > Date.now()) return guardado;
  const r = await post({
    host: HOST_AUTENTICACAO,
    path: "/authenticate",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cred.key}:${cred.secret}`).toString("base64")}`,
      "Role-Type": "TERCEIROS",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    corpo: "grant_type=client_credentials",
    cert: cred.certificado,
    key: cred.chave,
  });
  if (r.status !== 200) {
    throw new ErroSerpro(`O SERPRO recusou a autenticação (HTTP ${r.status}). Confira as chaves do contrato e o certificado.`);
  }
  const j = JSON.parse(r.corpo) as { access_token: string; jwt_token: string; expires_in: number };
  // Renova 2 minutos antes de vencer
  const t = { access: j.access_token, jwt: j.jwt_token, vence: Date.now() + Math.max(60, (j.expires_in ?? 0) - 120) * 1000 };
  tokens.set(cred.key, t);
  return t;
}

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export class Cliente {
  readonly chamadas: Chamada[] = [];

  constructor(readonly ambiente: Ambiente, private cred: Credenciais | null) {
    if (ambiente === "producao" && !cred) throw new ErroSerpro("Faltam o certificado ou as chaves do SERPRO para a produção.");
  }

  async chamar(endpoint: Endpoint, pedido: Pedido): Promise<Resposta> {
    const corpo = JSON.stringify(pedido);
    const inicio = Date.now();
    let r: { status: number; corpo: string };
    for (let tentativa = 0; ; tentativa++) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (this.ambiente === "producao") {
        const t = await autenticar(this.cred!, tentativa > 0);
        headers.Authorization = `Bearer ${t.access}`;
        headers.jwt_token = t.jwt;
      } else {
        headers.Authorization = `Bearer ${CHAVE_DEMONSTRACAO}`;
      }
      r = await post({ host: HOST_GATEWAY, path: CAMINHO[this.ambiente] + endpoint, headers, corpo });
      // Produção: token vencido → autentica de novo uma vez
      if (r.status === 401 && this.ambiente === "producao" && tentativa === 0) continue;
      // Demonstração: o SERPRO limita a quantidade de chamadas por minuto
      if (this.ambiente === "demonstracao" && /throttled|quota/i.test(r.corpo) && tentativa < 3) {
        await espera(4000 * (tentativa + 1));
        continue;
      }
      break;
    }

    let j: { status?: number; dados?: unknown; mensagens?: { codigo: string; texto: string }[] } = {};
    try {
      j = JSON.parse(r.corpo);
    } catch {
      // resposta que não é JSON (erro do gateway)
    }
    let dados = j.dados ?? null;
    if (typeof dados === "string" && dados.trim()) {
      try {
        dados = JSON.parse(dados);
      } catch {
        // fica como texto
      }
    }
    const mensagens = Array.isArray(j.mensagens) ? j.mensagens : [];
    this.chamadas.push({
      endpoint,
      id_sistema: pedido.pedidoDados.idSistema,
      id_servico: pedido.pedidoDados.idServico,
      http_status: r.status,
      codigo: mensagens[0]?.codigo ?? "",
      duracao_ms: Date.now() - inicio,
    });
    return { http: r.status, status: typeof j.status === "number" ? j.status : null, dados, mensagens };
  }
}

// Texto curto do erro devolvido pelo SERPRO, para mostrar na tela
export function erroDe(r: Resposta): string {
  const m = r.mensagens.map((x) => x.texto).filter(Boolean).join(" ");
  return m || `O SERPRO respondeu HTTP ${r.http}.`;
}

export function deuCerto(r: Resposta): boolean {
  return r.http === 200 && (r.status === null || r.status === 200);
}
