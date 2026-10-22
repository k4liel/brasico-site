// Serviços do Integra Contador usados pelo Brasico: Caixa Postal, situação fiscal (SITFIS) e pagamentos.
// Só CNPJ próprio: em produção a empresa é contratante, autora e contribuinte (não precisa de procuração).
// Na demonstração o SERPRO só aceita os dados exatos dos "Cenários de demonstração" da documentação,
// por isso cada serviço tem a sua identificação de mentira em DEMO.
import { Cliente, deuCerto, erroDe, type Endpoint, type Pedido } from "./serpro";

type Id = { numero: string; tipo: 1 | 2 };
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

  private pedido(idSistema: string, idServico: string, versao: string, dados: unknown): Pedido {
    const eu = pj(this.cnpj);
    const ident = this.cli.ambiente === "demonstracao"
      ? DEMO[idServico]
      : { contratante: eu, autorPedidoDados: eu, contribuinte: eu };
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

  private chamar(endpoint: Endpoint, idSistema: string, idServico: string, versao: string, dados: unknown) {
    return this.cli.chamar(endpoint, this.pedido(idSistema, idServico, versao, dados));
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
        return {
          status: "ok",
          resultado: { tamanho: Math.round((d.pdf.length * 3) / 4) },
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
