// Serviços do Integra Contador usados pelo Brasico: Caixa Postal, situação fiscal (SITFIS) e pagamentos.
// Só CNPJ próprio: em produção a empresa é contratante, autora e contribuinte (não precisa de procuração).
// Na demonstração o SERPRO só aceita os dados exatos dos "Cenários de demonstração" da documentação,
// por isso cada serviço tem a sua identificação de mentira em DEMO.
import { Cliente, deuCerto, erroDe, type Endpoint, type Pedido } from "./serpro";
import { textoDoPdf } from "./pdf";

type Id = { numero: string; tipo: 1 | 2 | 3 | 4 };
type Ident = { contratante: Id; autorPedidoDados: Id; contribuinte: Id };

const pj = (n: string): Id => ({ numero: n, tipo: 2 });
const pf = (n: string): Id => ({ numero: n, tipo: 1 });
const Z = "00000000000000";
const N = "99999999999999";

const DEMO: Record<string, Ident> = {
  INNOVAMSG63: { contratante: pj(Z), autorPedidoDados: pj(Z), contribuinte: pf("99999999999") },
  MSGCONTRIBUINTE61: { contratante: pj(N), autorPedidoDados: pj(N), contribuinte: pj(N) },
  MSGDETALHAMENTO62: { contratante: pj(Z), autorPedidoDados: pj(Z), contribuinte: pj(Z) },
  SOLICITARPROTOCOLO91: { contratante: pj(Z), autorPedidoDados: pj(Z), contribuinte: pf("99999999999") },
  RELATORIOSITFIS92: { contratante: pj(Z), autorPedidoDados: pj(Z), contribuinte: pf("99999999999") },
  PAGAMENTOS71: { contratante: pj(N), autorPedidoDados: pj(N), contribuinte: pj(N) },
};
const DEMO_ISN_DETALHE = "0000082838";
// Eventos de atualização: DCTFWeb, Caixa Postal e Pagamentos
const EVENTOS = ["E0301", "E0601", "E0701"];

// Serviços de leitura liberados para o pedido em lote (tipo "servico"). Declarar e transmitir nunca:
// isso é do contador. O formato de "dados" de cada um segue o catálogo do Integra Contador.
export const LIBERADOS: Record<string, { endpoint: Endpoint; sistema: string; servico: string; versao: string }> = {
  "DCTFWEB/CONSRECIBO32": { endpoint: "Consultar", sistema: "DCTFWEB", servico: "CONSRECIBO32", versao: "1.0" },
  "DCTFWEB/CONSDECCOMPLETA33": { endpoint: "Consultar", sistema: "DCTFWEB", servico: "CONSDECCOMPLETA33", versao: "1.0" },
  "MIT/LISTAAPURACOES317": { endpoint: "Consultar", sistema: "MIT", servico: "LISTAAPURACOES317", versao: "1.0" },
  "MIT/CONSAPURACAO316": { endpoint: "Consultar", sistema: "MIT", servico: "CONSAPURACAO316", versao: "1.0" },
  "PGDASD/CONSDECLARACAO13": { endpoint: "Consultar", sistema: "PGDASD", servico: "CONSDECLARACAO13", versao: "1.0" },
  "PGDASD/CONSEXTRATO16": { endpoint: "Consultar", sistema: "PGDASD", servico: "CONSEXTRATO16", versao: "1.0" },
  "PARCSN/PEDIDOSPARC163": { endpoint: "Consultar", sistema: "PARCSN", servico: "PEDIDOSPARC163", versao: "1.0" },
  "PARCSN/OBTERPARC164": { endpoint: "Consultar", sistema: "PARCSN", servico: "OBTERPARC164", versao: "1.0" },
  "PARCSN-ESP/PEDIDOSPARC173": { endpoint: "Consultar", sistema: "PARCSN-ESP", servico: "PEDIDOSPARC173", versao: "1.0" },
  "PERTSN/PEDIDOSPARC183": { endpoint: "Consultar", sistema: "PERTSN", servico: "PEDIDOSPARC183", versao: "1.0" },
  "RELPSN/PEDIDOSPARC193": { endpoint: "Consultar", sistema: "RELPSN", servico: "PEDIDOSPARC193", versao: "1.0" },
  "DTE/CONSULTASITUACAODTE111": { endpoint: "Consultar", sistema: "DTE", servico: "CONSULTASITUACAODTE111", versao: "1.0" },
  "DEFIS/CONSDECLARACAO142": { endpoint: "Consultar", sistema: "DEFIS", servico: "CONSDECLARACAO142", versao: "1.0" },
  "REGIMEAPURACAO/CONSULTAROPCAOREGIME103": { endpoint: "Consultar", sistema: "REGIMEAPURACAO", servico: "CONSULTAROPCAOREGIME103", versao: "1.0" },
};
// Campos muito grandes (PDF e XML em base64) não vão para o banco: fica só o tamanho
// PDFs (recibos, declarações, extratos) ficam inteiros até ~300 mil caracteres; outros textos grandes saem
const CAMPOS_PDF = /pdf/i;
function enxugar(v: unknown, chave = ""): unknown {
  if (typeof v === "string") return v.length > (CAMPOS_PDF.test(chave) ? 300000 : 20000) ? `[${v.length} caracteres omitidos]` : v;
  if (Array.isArray(v)) return v.map((x) => enxugar(x, chave));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enxugar(x, k)]));
  return v;
}
// O "dados" do pedido de eventos às vezes vem como JSON sem a última chave: lê do jeito que der
function lerDados(d: unknown): Record<string, unknown> {
  if (d && typeof d === "object") return d as Record<string, unknown>;
  const s = String(d ?? "");
  for (const t of [s, `${s}}`]) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  const protocolo = s.match(/"protocolo"\s*:\s*"([^"]+)"/i)?.[1];
  const tempo = s.match(/"TempoEsperaMedioEmMs"\s*:\s*(\d+)/i)?.[1];
  return { Protocolo: protocolo, TempoEsperaMedioEmMs: tempo };
}

export type Conclusao = {
  status: "ok" | "sem_dados" | "falha";
  resultado: Record<string, unknown>;
  erro?: string;
  mensagens?: Record<string, unknown>[];
  relatorios?: { tipo: string; pdf_base64: string }[];
  pagamentos?: Record<string, unknown>[];
};

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export class Receita {
  constructor(private cli: Cliente, private cnpj: string) {}

  private pedido(idSistema: string, idServico: string, versao: string, dados: unknown, contribuinte?: Id): Pedido {
    const eu = pj(this.cnpj);
    const ident = this.cli.ambiente === "demonstracao"
      ? DEMO[idServico]
      : { contratante: eu, autorPedidoDados: eu, contribuinte: contribuinte ?? eu };
    return {
      ...ident,
      pedidoDados: {
        idSistema,
        idServico,
        versaoSistema: versao,
        dados: dados === "" ? "" : JSON.stringify(dados),
      },
    };
  }

  private chamar(endpoint: Endpoint, idSistema: string, idServico: string, versao: string, dados: unknown, contribuinte?: Id) {
    return this.cli.chamar(endpoint, this.pedido(idSistema, idServico, versao, dados, contribuinte));
  }

  // Leitura em lote: vários serviços liberados numa execução só (até ~45 s). Cada item volta com o que a Receita respondeu.
  async lote(itens: { servico: string; dados?: unknown }[]): Promise<Conclusao> {
    const limite = Date.now() + 45000;
    const respostas: Record<string, unknown>[] = [];
    for (const it of itens.slice(0, 40)) {
      const s = LIBERADOS[it.servico];
      if (!s) { respostas.push({ servico: it.servico, dados_pedido: it.dados ?? null, ok: false, erro: "Serviço não liberado para leitura." }); continue; }
      if (Date.now() > limite) { respostas.push({ servico: it.servico, dados_pedido: it.dados ?? null, ok: false, erro: "Ficou para o próximo pedido (tempo)." }); continue; }
      const r = await this.chamar(s.endpoint, s.sistema, s.servico, s.versao, it.dados === undefined ? "" : it.dados);
      // Declaração completa da DCTFWeb vem em PDF: guarda também o texto, para ler os valores
      let dados = r.dados;
      const pdf = dados && typeof dados === "object" ? (dados as Record<string, unknown>).PDFByteArrayBase64 : null;
      if (it.servico === "DCTFWEB/CONSDECCOMPLETA33" && typeof pdf === "string") {
        try {
          dados = { ...(dados as Record<string, unknown>), texto: await textoDoPdf(pdf) };
        } catch {
          // sem texto, fica só o PDF
        }
      }
      respostas.push({
        servico: it.servico, dados_pedido: it.dados ?? null, ok: deuCerto(r), http: r.http,
        dados: enxugar(dados), mensagens: r.mensagens.map((m) => `${m.codigo} ${m.texto}`.trim()),
      });
    }
    const ok = respostas.filter((x) => x.ok).length;
    return { status: ok ? "ok" : "falha", resultado: { respostas, ok, total: respostas.length }, ...(ok ? {} : { erro: "Nenhum serviço do lote respondeu certo." }) };
  }

  // Eventos de atualização (Monitorar, grátis): a Receita diz em que dia mudou algo na DCTFWeb (E0301),
  // na Caixa Postal (E0601) e nos pagamentos (E0701) da empresa. É o que decide se vale gastar uma consulta.
  // Duas etapas: pede (devolve um protocolo e o tempo de espera) e depois lê. Se a espera for longa,
  // devolve os protocolos pendentes e a rotina lê na próxima passada.
  async eventos(p: { pendentes?: { evento: string; protocolo: string }[] }): Promise<Conclusao> {
    if (this.cli.ambiente === "demonstracao") return { status: "falha", resultado: {}, erro: "Os eventos de atualização só existem no modo real." };
    // Este serviço só aceita o contribuinte como lista de CNPJs (tipo 4), mesmo com um CNPJ só
    const lista4: Id = { numero: this.cnpj, tipo: 4 };
    let pendentes = p.pendentes ?? [];
    if (!pendentes.length) {
      const pedidos = await Promise.all(EVENTOS.map(async (evento) => {
        const r = await this.chamar("Monitorar", "EVENTOSATUALIZACAO", "SOLICEVENTOSPJ132", "1.0", { evento }, lista4);
        const d = lerDados(r.dados);
        return {
          evento, ok: deuCerto(r) && !!(d.Protocolo ?? d.protocolo), protocolo: String(d.Protocolo ?? d.protocolo ?? ""),
          espera: Number(d.TempoEsperaMedioEmMs ?? d.tempoEsperaMedioEmMs ?? 5000), erro: erroDe(r),
          amostra: JSON.stringify(r.dados ?? null).slice(0, 300),
        };
      }));
      const falhas = pedidos.filter((x) => !x.ok);
      // A amostra (só protocolo e tempos) ajuda a entender um formato de resposta novo
      if (falhas.length === pedidos.length) return { status: "falha", resultado: { amostra: falhas[0].amostra }, erro: falhas[0].erro };
      pendentes = pedidos.filter((x) => x.ok).map((x) => ({ evento: x.evento, protocolo: x.protocolo }));
      const maior = Math.max(...pedidos.filter((x) => x.ok).map((x) => x.espera));
      if (maior > 35000) return { status: "ok", resultado: { pendentes, esperaMs: maior } };
      await espera(Math.max(maior, 2000));
    }

    const eventos: { evento: string; data: string | null; bruto: string | null }[] = [];
    const ainda: { evento: string; protocolo: string }[] = [];
    const erros: string[] = [];
    for (const x of pendentes) {
      let r = await this.chamar("Monitorar", "EVENTOSATUALIZACAO", "OBTEREVENTOSPJ134", "1.0", { protocolo: x.protocolo, evento: x.evento }, lista4);
      // Se a leitura recusar o tipo 4, tenta o CNPJ "zerado" (tipo 2), como fazem outras implementações
      if (!deuCerto(r) && r.http !== 202) r = await this.chamar("Monitorar", "EVENTOSATUALIZACAO", "OBTEREVENTOSPJ134", "1.0", { protocolo: x.protocolo, evento: x.evento }, pj(Z));
      const lista = Array.isArray(r.dados) ? (r.dados as unknown[]) : null;
      if (deuCerto(r) && lista) {
        const minha = lista.find((l) => Array.isArray(l) && String(l[0]) === this.cnpj) as unknown[] | undefined;
        const bruto = minha && minha[1] && minha[1] !== "x" ? String(minha[1]) : null;
        eventos.push({ evento: x.evento, bruto, data: bruto && /^\d{6}/.test(bruto) ? `20${bruto.slice(0, 2)}-${bruto.slice(2, 4)}-${bruto.slice(4, 6)}` : null });
      } else if (r.http === 202 || /process|aguard/i.test(erroDe(r))) {
        ainda.push(x);
      } else {
        erros.push(`${x.evento}: ${erroDe(r)}`);
      }
    }
    if (!eventos.length && !ainda.length) return { status: "falha", resultado: {}, erro: erros.join(" · ") };
    return { status: "ok", resultado: { eventos, ...(ainda.length ? { pendentes: ainda } : {}), ...(erros.length ? { erros } : {}) } };
  }

  // Caixa Postal: pergunta (grátis) se há mensagem nova; se houver, lista e lê o texto das que ainda não temos.
  async caixaPostal(p: { forcar?: boolean; maxDetalhes?: number }, jaDetalhadas: Set<string>): Promise<Conclusao> {
    const ind = await this.chamar("Monitorar", "CAIXAPOSTAL", "INNOVAMSG63", "1.0", "");
    if (!deuCerto(ind)) return { status: "falha", resultado: {}, erro: erroDe(ind) };
    const conteudo = (ind.dados as { conteudo?: { indicadorMensagensNovas?: string }[] })?.conteudo ?? [];
    // 0 = nenhuma nova; 1 = uma; 2 = mais de uma
    const novas = String(conteudo[0]?.indicadorMensagensNovas ?? "0");
    if (novas === "0" && !p.forcar) return { status: "sem_dados", resultado: { mensagensNovas: false } };

    const lista = await this.chamar("Consultar", "CAIXAPOSTAL", "MSGCONTRIBUINTE61", "1.0",
      { statusLeitura: "0", indicadorPagina: "0" });
    if (!deuCerto(lista)) return { status: "falha", resultado: { mensagensNovas: novas !== "0" }, erro: erroDe(lista) };
    type Msg = Record<string, string>;
    const itens = ((lista.dados as { conteudo?: { listaMensagens?: Msg[] }[] })?.conteudo?.[0]?.listaMensagens ?? []);
    const mensagens: Record<string, unknown>[] = itens.map((m) => ({
      isn: m.isn,
      assunto: (m.assuntoModelo ?? "").replace("++VARIAVEL++", m.valorParametroAssunto ?? "").trim(),
      remetente: m.descricaoOrigem ?? "",
      enviada_em: m.dataEnvio,
      relevancia: m.relevancia ?? "",
      lida: m.indicadorLeitura === "1",
      ciencia_em: m.dataCiencia,
    }));

    // Texto completo: só das que ainda não temos, no máximo algumas por vez (cada uma é uma consulta cobrada)
    const max = Math.max(0, Math.min(Number(p.maxDetalhes ?? 5), 20));
    const faltam = this.cli.ambiente === "demonstracao"
      ? [DEMO_ISN_DETALHE].filter((i) => !jaDetalhadas.has(i))
      : mensagens.map((m) => String(m.isn)).filter((i) => i && !jaDetalhadas.has(i));
    let detalhadas = 0;
    for (const isn of faltam.slice(0, max)) {
      const d = await this.chamar("Consultar", "CAIXAPOSTAL", "MSGDETALHAMENTO62", "1.0", { isn });
      if (!deuCerto(d)) continue;
      const det = (d.dados as { conteudo?: Msg[] })?.conteudo?.[0];
      if (!det) continue;
      const corpo = (det.corpoModelo ?? "").replace("++VARIAVEL++", det.valorParametroAssunto ?? "");
      const existente = mensagens.find((m) => m.isn === isn);
      const extra = {
        corpo,
        detalhe: det,
        ...(existente ? {} : {
          assunto: (det.assuntoModelo ?? "").replace("++VARIAVEL++", det.valorParametroAssunto ?? "").trim(),
          enviada_em: det.dataEnvio,
          lida: !!det.dataLeitura,
          ciencia_em: det.dataCiencia,
        }),
      };
      if (existente) Object.assign(existente, extra);
      else mensagens.push({ isn, ...extra });
      detalhadas++;
    }

    return {
      status: mensagens.length ? "ok" : "sem_dados",
      resultado: { mensagensNovas: novas !== "0", listadas: itens.length, detalhadas, faltamDetalhar: Math.max(0, faltam.length - detalhadas) },
      mensagens,
    };
  }

  // Situação fiscal (o relatório de pendências do e-CAC): pede o protocolo (grátis), espera e baixa o PDF.
  async situacaoFiscal(): Promise<Conclusao> {
    const sol = await this.chamar("Apoiar", "SITFIS", "SOLICITARPROTOCOLO91", "2.0", "");
    if (!deuCerto(sol)) return { status: "falha", resultado: {}, erro: erroDe(sol) };
    const s = sol.dados as { protocoloRelatorio?: string; tempoEspera?: number };
    if (!s?.protocoloRelatorio) return { status: "falha", resultado: {}, erro: "O SERPRO não devolveu o protocolo do relatório." };

    let aguardar = Number(s.tempoEspera ?? 3000);
    const limite = Date.now() + 45000;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      await espera(Math.min(Math.max(aguardar, 1000), 15000));
      const rel = await this.chamar("Emitir", "SITFIS", "RELATORIOSITFIS92", "2.0", { protocoloRelatorio: s.protocoloRelatorio });
      const d = rel.dados as { pdf?: string; tempoEspera?: number } | null;
      if (deuCerto(rel) && d?.pdf) {
        // O texto vai junto no resultado: é dele que saem as pendências mostradas na tela (fiscal_pendencias)
        let texto = "";
        let erroTexto = "";
        try {
          texto = await textoDoPdf(d.pdf);
        } catch (e) {
          // sem texto, fica só o PDF (e o motivo, para corrigir)
          erroTexto = e instanceof Error ? e.message.slice(0, 200) : "erro";
        }
        return {
          status: "ok",
          resultado: { tamanho: Math.round((d.pdf.length * 3) / 4), texto, ...(erroTexto ? { erroTexto } : {}) },
          relatorios: [{ tipo: "situacao_fiscal", pdf_base64: d.pdf }],
        };
      }
      // Ainda gerando: o SERPRO devolve um novo tempo de espera
      if (d?.tempoEspera && Date.now() + d.tempoEspera < limite) {
        aguardar = d.tempoEspera;
        continue;
      }
      return { status: "falha", resultado: {}, erro: erroDe(rel) };
    }
    return { status: "falha", resultado: {}, erro: "O relatório não ficou pronto a tempo. Tente de novo em alguns minutos." };
  }

  // Pagamentos registrados na Receita, por data de arrecadação (padrão: últimos 90 dias)
  async pagamentos(p: { dataInicial?: string; dataFinal?: string }): Promise<Conclusao> {
    const hoje = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const filtro: Record<string, unknown> = this.cli.ambiente === "demonstracao"
      ? {
          intervaloDataArrecadacao: { dataInicial: "2022-01-01", dataFinal: "2022-01-31" },
          intervaloValorTotalDocumento: { valorInicial: 6000, valorFinal: 13000 },
        }
      : {
          intervaloDataArrecadacao: {
            dataInicial: p.dataInicial ?? iso(new Date(hoje.getTime() - 90 * 86400000)),
            dataFinal: p.dataFinal ?? iso(hoje),
          },
        };

    type Pag = Record<string, unknown> & {
      numeroDocumento: string;
      tipo?: { descricaoAbreviada?: string };
      receitaPrincipal?: { codigo?: string; descricao?: string };
      periodoApuracao?: string;
      dataArrecadacao?: string;
      dataVencimento?: string;
      valorTotal?: number;
    };
    const todos: Pag[] = [];
    const TAM = 100;
    for (let pagina = 0; pagina < 5; pagina++) {
      const r = await this.chamar("Consultar", "PAGTOWEB", "PAGAMENTOS71", "1.0",
        { ...filtro, primeiroDaPagina: pagina * TAM, tamanhoDaPagina: TAM });
      if (!deuCerto(r)) {
        if (pagina === 0) return { status: "falha", resultado: {}, erro: erroDe(r) };
        break;
      }
      const lista = Array.isArray(r.dados) ? (r.dados as Pag[]) : [];
      todos.push(...lista);
      if (lista.length < TAM || this.cli.ambiente === "demonstracao") break;
    }

    return {
      status: todos.length ? "ok" : "sem_dados",
      resultado: { pagamentos: todos.length, filtro: filtro.intervaloDataArrecadacao },
      pagamentos: todos.map((x) => ({
        numero_documento: x.numeroDocumento,
        tipo_documento: x.tipo?.descricaoAbreviada ?? "",
        codigo_receita: x.receitaPrincipal?.codigo ?? "",
        descricao_receita: x.receitaPrincipal?.descricao ?? "",
        periodo_apuracao: x.periodoApuracao,
        data_arrecadacao: x.dataArrecadacao,
        data_vencimento: x.dataVencimento,
        valor_total: x.valorTotal,
        dados: x,
      })),
    };
  }
}
