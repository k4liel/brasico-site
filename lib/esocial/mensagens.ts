// Mensagens dos webservices do eSocial (Pacote de Comunicação v1.6 / v1.6-Alfa) e leitura das respostas.
// Consulta de identificadores e download exigem a mensagem assinada (MOD 7.7 e 7.8); consulta de lote não.
import { DOMParser, XMLSerializer, type Element, type Node } from "@xmldom/xmldom";
import { assinar } from "./assinatura";
import { chamar, ErroConexao, type Ambiente } from "./soap";

export type { Element };

const NS = {
  consultaLote: "http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0",
  envioLote: "http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1",
  idEmpregador: "http://www.esocial.gov.br/schema/consulta/identificadores-eventos/empregador/v1_0_0",
  idTabela: "http://www.esocial.gov.br/schema/consulta/identificadores-eventos/tabela/v1_0_0",
  idTrabalhador: "http://www.esocial.gov.br/schema/consulta/identificadores-eventos/trabalhador/v1_0_0",
  downloadId: "http://www.esocial.gov.br/schema/download/solicitacao/id/v1_0_0",
  downloadRecibo: "http://www.esocial.gov.br/schema/download/solicitacao/nrRecibo/v1_0_0",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Credencial = { certificado: string; cadeia: string; chave: string };
export type Empregador = { tpInsc: 1 | 2; nrInsc: string }; // CNPJ: raiz de 8 posições

const ideEmpregador = (e: Empregador) => `<ideEmpregador><tpInsc>${e.tpInsc}</tpInsc><nrInsc>${esc(e.nrInsc)}</nrInsc></ideEmpregador>`;

// ---------------------------------------------------------------------
// Leitura de XML (ignora prefixos e namespaces)
// ---------------------------------------------------------------------
export function lerXml(xml: string) {
  return new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml");
}

export function filhos(el: Element | null | undefined, nome: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS("*", nome)) as unknown as Element[];
}

export function primeiro(el: Element | null | undefined, nome: string): Element | null {
  return filhos(el, nome)[0] ?? null;
}

export function texto(el: Element | null | undefined, nome: string): string | null {
  const t = primeiro(el, nome)?.textContent;
  return t == null ? null : t.trim();
}

export function serializar(no: Node) {
  return new XMLSerializer().serializeToString(no);
}

// Primeiro elemento filho (pula texto e comentários)
export function primeiroElemento(el: Element | null): Element | null {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) return n as unknown as Element;
  return null;
}

export type Status = { cdResposta: number | null; descResposta: string };

function status(raiz: Element, onde = "status"): Status {
  const s = primeiro(raiz, onde);
  const cd = texto(s, "cdResposta");
  return { cdResposta: cd == null ? null : Number(cd), descResposta: texto(s, "descResposta") ?? "" };
}

// O servidor web do eSocial devolve de vez em quando uma página HTML "Configuration Error" (HTTP 500) antes
// de o pedido chegar ao serviço: não é resposta do eSocial e não conta no limite diário. Repete até 3 vezes,
// com 8 s de espera, enquanto couber nos 60 s da rota. Erros de conexão também. Códigos do governo não se repetem.
const PAGINA_ERRO = /devolveu uma página de erro \(HTTP 5/;
async function comRepeticao<T>(fazer: () => Promise<T>): Promise<T> {
  const inicio = Date.now();
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fazer();
    } catch (e) {
      const repetivel = e instanceof ErroConexao || (e instanceof Error && PAGINA_ERRO.test(e.message));
      if (!repetivel || tentativa >= 3 || Date.now() - inicio > 30_000) {
        if (e instanceof Error && tentativa > 1) e.message = `${e.message} (${tentativa} tentativas)`.slice(0, 500);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
}

// Resposta HTTP → documento SOAP. Falha clara quando o IIS recusa o certificado (403) ou o SOAP traz Fault.
function abrirResposta(r: { status: number; corpo: string }) {
  if (r.status === 403) throw new Error("O eSocial recusou o certificado (HTTP 403). Confira se é um e-CNPJ ICP-Brasil válido.");
  // Página HTML em vez de SOAP (erro do servidor web): guarda o código e o título para o diagnóstico
  if (/^\s*(<!DOCTYPE html|<html)/i.test(r.corpo)) {
    const titulo = (r.corpo.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? r.corpo.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? "")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const detalhe = (r.corpo.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(`O servidor do eSocial devolveu uma página de erro (HTTP ${r.status}): ${[titulo, detalhe].filter(Boolean).join(" · ")}`.slice(0, 500));
  }
  const doc = lerXml(r.corpo);
  const raiz = doc.documentElement as unknown as Element | null;
  const fault = primeiro(raiz, "Fault");
  if (fault) throw new Error(`O eSocial devolveu erro SOAP: ${texto(fault, "faultstring") ?? texto(fault, "Text") ?? "sem descrição"}`.slice(0, 500));
  if (!raiz || r.status >= 400) throw new Error(`Resposta inesperada do eSocial (HTTP ${r.status}).`);
  return raiz;
}

// ---------------------------------------------------------------------
// Consulta de lote (também serve de teste de conexão: protocolo falso → erro do próprio eSocial)
// ---------------------------------------------------------------------
export async function consultarLote(amb: Ambiente, cred: Credencial, protocolo: string) {
  const mensagem = `<eSocial xmlns="${NS.consultaLote}"><consultaLoteEventos><protocoloEnvio>${esc(protocolo)}</protocoloEnvio></consultaLoteEventos></eSocial>`;
  const r = await chamar({ ambiente: amb, servico: "consulta", metodo: "ConsultarLoteEventos", parametro: "consulta", mensagem,
    cadeiaPem: cred.cadeia, chavePem: cred.chave });
  const raiz = abrirResposta(r);
  const ret = primeiro(raiz, "retornoProcessamentoLoteEventos") ?? raiz;
  const eventos = filhos(ret, "evento").map((ev) => {
    const re = primeiro(ev, "retornoEvento");
    return {
      id: ev.getAttribute("Id"),
      cdResposta: Number(texto(primeiro(re, "processamento"), "cdResposta") ?? 0) || null,
      descResposta: texto(primeiro(re, "processamento"), "descResposta") ?? "",
      nrRecibo: texto(primeiro(re, "recibo"), "nrRecibo"),
      hash: texto(primeiro(re, "recibo"), "hash"),
      ocorrencias: ocorrencias(re),
      xmlRetorno: re ? serializar(re) : null,
    };
  });
  return { ...status(ret), tempoEstimado: Number(texto(ret, "tempoEstimadoConclusao") ?? 0) || null, ocorrencias: ocorrencias(primeiro(ret, "status")), eventos };
}

function ocorrencias(el: Element | null) {
  return filhos(el, "ocorrencia").map((o) => ({
    tipo: texto(o, "tipo"), codigo: texto(o, "codigo"), descricao: texto(o, "descricao"), localizacao: texto(o, "localizacao"),
  }));
}

// ---------------------------------------------------------------------
// Envio de lote (estrutura pronta para o futuro; eventos já assinados, até 50, mesmo grupo)
// ---------------------------------------------------------------------
export async function enviarLote(amb: Ambiente, cred: Credencial, opts: {
  grupo: 1 | 2 | 3; empregador: Empregador; transmissor: { tpInsc: 1 | 2; nrInsc: string }; eventos: { id: string; xml: string }[];
}) {
  if (!opts.eventos.length || opts.eventos.length > 50) throw new Error("Um lote leva de 1 a 50 eventos.");
  const eventos = opts.eventos.map((e) => `<evento Id="${esc(e.id)}">${e.xml.replace(/^\s*<\?xml[^>]*\?>\s*/, "")}</evento>`).join("");
  const mensagem = `<eSocial xmlns="${NS.envioLote}"><envioLoteEventos grupo="${opts.grupo}">${ideEmpregador(opts.empregador)}` +
    `<ideTransmissor><tpInsc>${opts.transmissor.tpInsc}</tpInsc><nrInsc>${esc(opts.transmissor.nrInsc)}</nrInsc></ideTransmissor>` +
    `<eventos>${eventos}</eventos></envioLoteEventos></eSocial>`;
  const r = await chamar({ ambiente: amb, servico: "envio", metodo: "EnviarLoteEventos", parametro: "loteEventos", mensagem,
    cadeiaPem: cred.cadeia, chavePem: cred.chave });
  const raiz = abrirResposta(r);
  const ret = primeiro(raiz, "retornoEnvioLoteEventos") ?? raiz;
  return { ...status(ret), protocolo: texto(primeiro(ret, "dadosRecepcaoLote"), "protocoloEnvio"), ocorrencias: ocorrencias(primeiro(ret, "status")) };
}

// ---------------------------------------------------------------------
// Consulta de identificadores (MOD 7.7): até 50 por resposta
// ---------------------------------------------------------------------
export type Identificadores = Status & { total: number; ultimo: string | null; ids: { id: string; nrRec: string }[] };

async function identificadores(amb: Ambiente, cred: Credencial, metodo: string, parametro: string, mensagem: string): Promise<Identificadores> {
  const assinada = assinar(mensagem, cred.certificado, cred.chave);
  const raiz = await comRepeticao(async () => abrirResposta(await chamar({ ambiente: amb, servico: "identificadores", metodo, parametro,
    mensagem: assinada, cadeiaPem: cred.cadeia, chavePem: cred.chave })));
  const ret = primeiro(raiz, "retornoConsultaIdentificadoresEvts") ?? raiz;
  const dados = primeiro(ret, "retornoIdentificadoresEvts");
  return {
    ...status(ret),
    total: Number(texto(dados, "qtdeTotEvtsConsulta") ?? 0),
    ultimo: texto(dados, "dhUltimoEvtRetornado"),
    ids: filhos(dados, "identificadorEvt").map((i) => ({ id: texto(i, "id") ?? "", nrRec: texto(i, "nrRec") ?? "" })).filter((i) => i.id),
  };
}

export function idsEmpregador(amb: Ambiente, cred: Credencial, emp: Empregador, tpEvt: string, perApur: string) {
  const m = `<eSocial xmlns="${NS.idEmpregador}"><consultaIdentificadoresEvts>${ideEmpregador(emp)}` +
    `<consultaEvtsEmpregador><tpEvt>${esc(tpEvt)}</tpEvt><perApur>${esc(perApur)}</perApur></consultaEvtsEmpregador></consultaIdentificadoresEvts></eSocial>`;
  return identificadores(amb, cred, "ConsultarIdentificadoresEventosEmpregador", "consultaEventosEmpregador", m);
}

export function idsTabela(amb: Ambiente, cred: Credencial, emp: Empregador, tpEvt: string, chEvt?: string, dtIni?: string, dtFim?: string) {
  const m = `<eSocial xmlns="${NS.idTabela}"><consultaIdentificadoresEvts>${ideEmpregador(emp)}<consultaEvtsTabela><tpEvt>${esc(tpEvt)}</tpEvt>` +
    (chEvt ? `<chEvt>${esc(chEvt)}</chEvt>` : "") + (dtIni ? `<dtIni>${esc(dtIni)}</dtIni>` : "") + (dtFim ? `<dtFim>${esc(dtFim)}</dtFim>` : "") +
    `</consultaEvtsTabela></consultaIdentificadoresEvts></eSocial>`;
  return identificadores(amb, cred, "ConsultarIdentificadoresEventosTabela", "consultaEventosTabela", m);
}

export function idsTrabalhador(amb: Ambiente, cred: Credencial, emp: Empregador, cpf: string, dtIni: string, dtFim: string) {
  const m = `<eSocial xmlns="${NS.idTrabalhador}"><consultaIdentificadoresEvts>${ideEmpregador(emp)}<consultaEvtsTrabalhador>` +
    `<cpfTrab>${esc(cpf)}</cpfTrab><dtIni>${esc(dtIni)}</dtIni><dtFim>${esc(dtFim)}</dtFim></consultaEvtsTrabalhador></consultaIdentificadoresEvts></eSocial>`;
  return identificadores(amb, cred, "ConsultarIdentificadoresEventosTrabalhador", "consultaEventosTrabalhador", m);
}

// ---------------------------------------------------------------------
// Download (MOD 7.8): até 50 eventos por pedido, cada um com o XML do evento e do recibo
// ---------------------------------------------------------------------
export type Arquivo = { cdResposta: number | null; descResposta: string; id: string | null; xmlEvento: string | null; xmlRecibo: string | null };

export async function baixar(amb: Ambiente, cred: Credencial, emp: Empregador, por: "id" | "recibo", chaves: string[]) {
  if (!chaves.length || chaves.length > 50) throw new Error("O download leva de 1 a 50 eventos por vez.");
  const m = por === "id"
    ? `<eSocial xmlns="${NS.downloadId}"><download>${ideEmpregador(emp)}<solicDownloadEvtsPorId>${chaves.map((c) => `<id>${esc(c)}</id>`).join("")}</solicDownloadEvtsPorId></download></eSocial>`
    : `<eSocial xmlns="${NS.downloadRecibo}"><download>${ideEmpregador(emp)}<solicDownloadEvtsPorNrRecibo>${chaves.map((c) => `<nrRec>${esc(c)}</nrRec>`).join("")}</solicDownloadEvtsPorNrRecibo></download></eSocial>`;
  const metodo = por === "id" ? "SolicitarDownloadEventosPorId" : "SolicitarDownloadEventosPorNrRecibo";
  const assinada = assinar(m, cred.certificado, cred.chave);
  const raiz = await comRepeticao(async () => abrirResposta(await chamar({ ambiente: amb, servico: "download", metodo, parametro: "solicitacao",
    mensagem: assinada, cadeiaPem: cred.cadeia, chavePem: cred.chave })));
  const dl = primeiro(raiz, "download") ?? raiz;
  const geral = status(dl);
  const arquivos: Arquivo[] = filhos(dl, "arquivo").map((a) => {
    const st = status(a);
    const evt = primeiroElemento(primeiro(a, "evt"));
    const rec = primeiroElemento(primeiro(a, "rec"));
    const evtXml = evt ? serializar(evt) : null;
    return { ...st, id: evtXml?.match(/\bId="(ID[0-9A-Z]{34})"/)?.[1] ?? null, xmlEvento: evtXml, xmlRecibo: rec ? serializar(rec) : null };
  });
  return { ...geral, arquivos };
}
