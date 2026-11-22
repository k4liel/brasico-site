// Puxa um dia de vendas de uma unidade na TOTVS Chef Web API e grava o resumo em totvs_dias.
// Chamada pelo banco (totvs_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em totvs_execucoes>" }. Responde na hora e trabalha em segundo plano.
// Usuário, senha e seriais ficam no Vault (totvs_usuario, totvs_senha, totvs_serial_<unidade>).
// Regras (documento técnico da integração): token novo a cada chamada e a cada tentativa,
// data de movimento define o dia, HTTP 200 com Sucesso=false é falha, nada de segredo nos logs.
//
// NFC-e (22/11/2026, supabase/nfce.sql): cada venda da CapaVenda traz a nota fiscal de consumidor (chave,
// protocolo, número, série e os impostos por item). Toda leitura grava as notas por nfce_gravar. A execução
// com origem "nfce" (histórico das notas, nfce_historico_passo) só lê a CapaVenda e grava as notas: não mexe
// em totvs_dias, sangrias nem fechamentos.
//
// Tempo: a função é encerrada pela Supabase em 150 s. Num dia cheio a TOTVS leva 1 a 2 minutos
// para devolver a CapaVenda, então tudo trabalha contra um prazo único (PRAZO_MS): a CapaVenda
// pode esperar quase todo o prazo, só se tenta de novo se ainda houver tempo, e a execução
// sempre termina gravada (ok, revisar, sem_movimento ou falha), nunca presa em "rodando".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://chefweb.chef.totvs.com.br/chefwebAPI";
const PRAZO_MS = 138000; // a partir do início; sobra tempo para gravar antes dos 150 s
const TETO_VENDAS_MS = 132000; // uma chamada da CapaVenda pode esperar até isto
const TETO_CURTO_MS = 25000; // token, sangria e fechamento
const TENTATIVAS = 3;
const TOLERANCIA = 1; // R$ de diferença aceita nas conferências

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Credenciais = { usuario: string; senha: string; serial: string; chave: string; loja: number };
// deno-lint-ignore no-explicit-any
type J = any;

class ErroTotvs extends Error {}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const txt = (v: unknown) => String(v ?? "").trim();

// Mensagem de erro da TOTVS sem dados sensíveis
function errosDe(p: J) {
  const lista = Array.isArray(p?.Erros) ? p.Erros : [];
  const msg = lista
    .map((e: J) => [e?.CodigoErro != null ? `código ${e.CodigoErro}` : "", txt(e?.Mensagem ?? e?.MensagemErro ?? e?.Descricao ?? e?.DescricaoErro).split(/\r?\n/)[0]].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  return msg || "resposta sem sucesso";
}

// Tempo que ainda dá para esperar uma resposta, dentro do prazo da execução
const restante = (prazo: number, teto: number) => Math.min(teto, prazo - Date.now());

async function pedir(caminho: string, init: RequestInit, esperaMs: number) {
  if (esperaMs < 3000) throw new ErroTotvs("sem tempo para esperar a TOTVS");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), esperaMs);
  try {
    const r = await fetch(`${API}${caminho}`, { ...init, signal: ctl.signal });
    const corpo = await r.text();
    if (!r.ok) throw new ErroTotvs(`HTTP ${r.status}`);
    try {
      return JSON.parse(corpo);
    } catch {
      throw new ErroTotvs("resposta que não é JSON");
    }
  } catch (e) {
    if (e instanceof ErroTotvs) throw e;
    throw new ErroTotvs(ctl.signal.aborted ? `tempo esgotado (${Math.round(esperaMs / 1000)} s)` : "falha de conexão");
  } finally {
    clearTimeout(t);
  }
}

async function gerarToken(c: Credenciais, prazo: number) {
  const p = await pedir("/api/Token/GerarToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Usuario: c.usuario, Senha: c.senha, NumeroSerialLoja: c.serial, Chave: c.chave }),
  }, restante(prazo, TETO_CURTO_MS));
  if (!p?.Sucesso || !p?.Token) throw new ErroTotvs(`token recusado (${errosDe(p)})`);
  return String(p.Token);
}

const sucesso = (p: J) => p && p.Sucesso !== false && p.Success !== false;

type Registro = { endpoint: string; tentativas: number; ms: number; ok: boolean; erro?: string };

// Gera token novo, chama e descarta; repete com outro token em caso de erro, enquanto houver tempo
async function chamar(c: Credenciais, endpoint: string, montar: (token: string) => [string, RequestInit], log: Registro[], prazo: number, teto: number) {
  const comeco = Date.now();
  let ultimo = "";
  let i = 0;
  while (i < TENTATIVAS) {
    i++;
    try {
      const token = await gerarToken(c, prazo);
      const [caminho, init] = montar(token);
      const p = await pedir(caminho, init, restante(prazo, teto));
      if (!sucesso(p)) throw new ErroTotvs(errosDe(p));
      log.push({ endpoint, tentativas: i, ms: Date.now() - comeco, ok: true });
      return p;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : "erro";
      const espera = 1500 * i;
      // Só tenta de novo se ainda couber uma espera razoável pela resposta
      if (i >= TENTATIVAS || prazo - Date.now() - espera < 20000) break;
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  log.push({ endpoint, tentativas: i, ms: Date.now() - comeco, ok: false, erro: ultimo });
  throw new ErroTotvs(`${endpoint}: ${ultimo}`);
}

const json = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

// ---------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------
const TAXA_SERVICO = /TAXA\s*(DE\s*)?SERV|\bTX\.?\s*(DE\s*)?SERV|^SERVI[CÇ]O\b|GORJETA|COUVERT ART/i;

function categoria(grupo: string) {
  const g = grupo.toUpperCase();
  if (g.includes("BEBIDA")) return "bebida";
  if (g.includes("COMIDA")) return "comida";
  return "outros";
}

function tipoPagamento(descricao: string) {
  const d = descricao.toUpperCase();
  if (d.includes("ASSINAD")) return "assinada";
  if (d.includes("CORTESIA")) return "cortesia";
  return "caixa";
}

const cancelada = (v: J) => v?.StatusVenda !== 2 || !!(v?.DadosCancelamento && (v.DadosCancelamento.Data || v.DadosCancelamento.Motivo));

function normalizar(vendasResp: J, sangriasResp: J, fechResp: J) {
  const todas: J[] = Array.isArray(vendasResp?.Vendas) ? vendasResp.Vendas : [];
  const ativas = todas.filter((v) => !cancelada(v));
  const canceladas = todas.filter(cancelada);

  const produtos = new Map<string, J>();
  const pagamentos = new Map<string, J>();
  const garcons = new Map<string, J>();
  const porVenda: J[] = [];
  const s = {
    vendas_recebidas: todas.length, vendas_ativas: ativas.length, vendas_canceladas: canceladas.length,
    pessoas: 0, subtotal: 0, servico: 0, acrescimos: 0, descontos: 0, taxa_entrega: 0, total: 0, total_totvs: 0, troco: 0, troco_nos_pagamentos: 0,
    valor_produtos: 0, comida: 0, bebida: 0, outros: 0, itens_taxa_servico: 0,
    pagamentos_caixa: 0, assinadas: 0, cortesias: 0, pagamentos_total: 0,
    itens_cancelados: 0, sangrias: 0, fechamento_sistema: 0, fechamento_recebido: 0,
  };

  for (const v of ativas) {
    const t = v.TotalizadorVenda ?? {};
    s.pessoas += n(v.QuantidadePessoas);
    s.subtotal += n(t.ValorSubTotal);
    s.servico += n(t.ValorTotalServico);
    s.acrescimos += n(t.ValorTotalAcrescimo);
    // O mesmo desconto costuma vir nos dois campos (fiscal e sistema)
    s.descontos += Math.max(n(t.ValorTotalDescontoFiscal), n(t.ValorTotalDescontoSistema));
    s.taxa_entrega += n(t.ValorTotalTaxaEntrega);
    s.total_totvs += n(t.ValorTotal);
    s.troco += n(t.ValorTroco);

    const atendentesDaVenda = new Set<string>();
    const pv = {
      cupom: v.NumeroCupom ?? null, caixa: v.Caixa?.Numero ?? null, pessoas: n(v.QuantidadePessoas),
      subtotal: n(t.ValorSubTotal), servico: n(t.ValorTotalServico), descontos: Math.max(n(t.ValorTotalDescontoFiscal), n(t.ValorTotalDescontoSistema)),
      acrescimos: n(t.ValorTotalAcrescimo), total_totvs: n(t.ValorTotal), troco: n(t.ValorTroco),
      itens: 0, taxa_item: 0, valor: 0, pagamentos: 0, troco_nos_pagamentos: 0, sem_atendente: [] as string[],
    };
    for (const it of Array.isArray(v.Itens) ? v.Itens : []) {
      if (it?.Status !== 1) continue;
      const p = it.Produto ?? {};
      const nome = txt(p.Nome);
      const grupo = txt(p.Grupo);
      const valor = n(it.ValorTotal);
      if (TAXA_SERVICO.test(nome) || TAXA_SERVICO.test(grupo)) {
        s.itens_taxa_servico += valor;
        pv.taxa_item += valor;
        continue;
      }
      const cat = categoria(grupo);
      s.valor_produtos += valor;
      s[cat] += valor;
      pv.itens += valor;
      const chave = p.Codigo != null ? String(p.Codigo) : nome;
      const atual = produtos.get(chave) ?? {
        codigo: p.Codigo ?? null, nome, grupo, subgrupo: txt(p.SubGrupo), unidade: txt(p.Unidade), categoria: cat, quantidade: 0, valor: 0,
      };
      atual.quantidade += n(it.Quantidade);
      atual.valor += valor;
      produtos.set(chave, atual);

      const codAt = it.CodigoAtendenteVenda ?? it.CodigoAgenteVenda;
      const nomeAt = txt(it.AtendenteVenda || it.NomeAgenteVenda) || "Sem atendente";
      if (nomeAt === "Sem atendente") pv.sem_atendente.push(`${nome} ${valor}`);
      const chaveAt = codAt != null && codAt !== 0 ? String(codAt) : nomeAt;
      const g = garcons.get(chaveAt) ?? { codigo: codAt ?? null, nome: nomeAt, itens: 0, valor: 0, vendas: 0 };
      g.itens += n(it.Quantidade);
      g.valor += valor;
      garcons.set(chaveAt, g);
      atendentesDaVenda.add(chaveAt);
    }
    for (const a of atendentesDaVenda) garcons.get(a)!.vendas += 1;

    // Valor da venda: o ValorTotal da TOTVS. A soma dos itens não serve: descontos grandes (consumo interno,
    // desconto na conta) nem sempre chegam inteiros aos itens. Quando há troco, a TOTVS às vezes tira ou soma
    // o troco no ValorTotal; aí vale a conta do totalizador (subtotal − descontos + acréscimos + entrega).
    const conta = pv.subtotal - pv.descontos + pv.acrescimos + n(t.ValorTotalTaxaEntrega);
    const trocoNoTotal = pv.troco > 0 && [pv.total_totvs + pv.troco, pv.total_totvs - pv.troco].some((x) => Math.abs(conta - x) <= 0.01);
    pv.valor = trocoNoTotal ? conta : pv.total_totvs;
    s.total += pv.valor;

    const pags = (Array.isArray(v.Pagamentos) ? v.Pagamentos : []).map((pg: J) => ({
      descricao: txt(pg.Descricao) || "Não identificado",
      codigo: pg.TipoFormaPagamento ?? null,
      valor: pg.ValorEfetivo != null ? n(pg.ValorEfetivo) : n(pg.ValorRecebido),
    }));
    // Troco embutido: pagamentos passam do valor da venda exatamente pelo troco. Sai do dinheiro (ou do último pagamento).
    const excesso = r2(pags.reduce((a: number, x: J) => a + x.valor, 0) - pv.valor);
    if (pv.troco > 0 && Math.abs(excesso - pv.troco) <= 0.01) {
      const alvo = pags.find((x: J) => /DINHEIRO/i.test(x.descricao) && x.valor >= excesso) ?? pags[pags.length - 1];
      alvo.valor -= excesso;
      pv.troco_nos_pagamentos = excesso;
      s.troco_nos_pagamentos += excesso;
    }

    for (const pg of pags) {
      const descricao = pg.descricao;
      const tipo = tipoPagamento(descricao);
      const valor = pg.valor;
      const p = pagamentos.get(descricao) ?? { forma: descricao, tipo, codigo_tipo: pg.codigo, vezes: 0, valor: 0 };
      p.vezes += 1;
      p.valor += valor;
      pagamentos.set(descricao, p);
      s.pagamentos_total += valor;
      pv.pagamentos += valor;
      if (tipo === "assinada") s.assinadas += valor;
      else if (tipo === "cortesia") s.cortesias += valor;
      else s.pagamentos_caixa += valor;
    }
    porVenda.push(Object.fromEntries(Object.entries(pv).map(([k, x]) => [k, typeof x === "number" ? r2(x) : x])));
  }

  const cancelados = [
    ...canceladas.map((v) => ({
      tipo: "venda", cupom: v.NumeroCupom ?? null, total: r2(n(v.TotalizadorVenda?.ValorTotal)),
      operador: txt(v.DadosCancelamento?.Operador?.Nome), motivo: txt(v.DadosCancelamento?.Motivo),
    })),
    ...todas.flatMap((v) =>
      (Array.isArray(v.ItemCancelado) ? v.ItemCancelado : []).map((c: J) => ({
        tipo: "item", cupom: v.NumeroCupom ?? null, produto: txt(c.NomeProduto),
        operador: txt(c.NomeOperadorCancelamento), motivo: txt(c.Motivo), quando: txt(c.DataHora),
      }))
    ),
  ];
  s.itens_cancelados = cancelados.filter((c) => c.tipo === "item").length;

  const sangrias = (Array.isArray(sangriasResp?.Sangrias) ? sangriasResp.Sangrias : []).map((x: J) => {
    const valor = n(x.FormasPagamentos?.Valor);
    s.sangrias += valor;
    return {
      caixa: x.NumeroCaixa ?? null, quando: txt(x.DataSangria), operador: txt(x.NomeOperador), motivo: txt(x.Motivo),
      forma: txt(x.FormasPagamentos?.TipoFormaPagamento), valor: r2(valor),
    };
  });

  const fechamentos = (Array.isArray(fechResp?.Fechamentos) ? fechResp.Fechamentos : []).map((f: J) => {
    s.fechamento_sistema += n(f.ValorTotalSistema);
    s.fechamento_recebido += n(f.ValorTotalRecebido);
    return {
      caixa: f.Caixa ?? null, fechamento: f.IdFechamento ?? null, abertura: txt(f.DataAbertura), encerramento: txt(f.DataFechamento),
      operador: txt(f.OperadorCaixaFechamento || f.OperadorCaixa), sistema: r2(n(f.ValorTotalSistema)),
      recebido: r2(n(f.ValorTotalRecebido)), bordero: r2(n(f.ValorTotalBordero)),
      formas: (Array.isArray(f.Itens) ? f.Itens : []).map((i: J) => ({
        forma: txt(i.DescricaoFormaPagamento), sistema: r2(n(i.ValorSistema)), recebido: r2(n(i.ValorRecebido)), bordero: r2(n(i.ValorBordero)),
      })),
    };
  });

  for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = r2(s[k]);

  // Conferências: o que foi vendido tem de bater com o que foi pago. Divergência vira "revisar",
  // nunca é ajustada em silêncio.
  const divergencias: J[] = [];
  const conferir = (nome: string, a: number, b: number) => {
    const dif = r2(a - b);
    if (Math.abs(dif) > TOLERANCIA) divergencias.push({ conferencia: nome, a: r2(a), b: r2(b), diferenca: dif });
  };
  conferir("Total das vendas × soma dos pagamentos", s.total, s.pagamentos_total);
  const naoPagas = porVenda.filter((x) => Math.abs(x.valor - x.pagamentos) > TOLERANCIA);
  if (naoPagas.length) divergencias.push({ conferencia: "Vendas em que o pago não bate com o total", vendas: naoPagas.map((x) => x.cupom),
    valor: r2(naoPagas.reduce((a, x) => a + x.valor - x.pagamentos, 0)) });
  if (fechamentos.length) conferir("Fechamento de caixa (sistema) × pagamentos do caixa", s.fechamento_sistema, s.pagamentos_caixa);

  // Avisos: diferenças internas da TOTVS que não mudam o faturamento. Ficam registradas, mas não marcam o dia.
  const avisos: J[] = [];
  const avisar = (nome: string, a: number, b: number) => {
    const dif = r2(a - b);
    if (Math.abs(dif) > TOLERANCIA) avisos.push({ aviso: nome, a: r2(a), b: r2(b), diferenca: dif });
  };
  if (s.itens_taxa_servico && s.servico) avisar("Taxa de serviço nos itens × no totalizador da TOTVS", s.itens_taxa_servico, s.servico);
  // Produtos, comida e bebida somam os itens; aqui fica o quanto os itens diferem do total das vendas
  const itensDiferentes = porVenda.filter((x) => Math.abs(x.itens + (x.taxa_item || x.servico) + x.acrescimos - x.valor) > 0.01);
  if (itensDiferentes.length) avisos.push({ aviso: "Vendas com itens diferentes do total da TOTVS (desconto fora dos itens)",
    vendas: itensDiferentes.map((x) => x.cupom), valor: r2(itensDiferentes.reduce((a, x) => a + x.itens + (x.taxa_item || x.servico) + x.acrescimos - x.valor, 0)) });
  const semAtendente = [...garcons.values()].find((g) => g.nome === "Sem atendente");
  if (semAtendente) avisos.push({ aviso: "Itens sem atendente no ranking", valor: r2(semAtendente.valor) });

  const ordenar = (m: Map<string, J>) =>
    [...m.values()].map((x) => ({ ...x, valor: r2(x.valor), ...(x.quantidade != null ? { quantidade: r2(x.quantidade) } : {}) }))
      .sort((a, b) => b.valor - a.valor);

  return {
    resumo: s,
    produtos: ordenar(produtos),
    pagamentos: ordenar(pagamentos),
    garcons: ordenar(garcons).map((g) => ({ ...g, itens: r2(g.itens) })),
    sangrias,
    fechamentos,
    cancelados,
    divergencias,
    avisos,
    vendas: porVenda,
  };
}

// ---------------------------------------------------------------------
// NFC-e: a nota fiscal de cada venda (supabase/nfce.sql). Sem CPF, nome nem contato do cliente.
// ---------------------------------------------------------------------
const digitos = (v: unknown) => txt(v).replace(/\D/g, "");
// Datas da TOTVS vêm na hora de Fortaleza, sem fuso
const comFuso = (v: unknown) => {
  const s = txt(v);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? (/[+-]\d\d:\d\d$|Z$/.test(s) ? s : `${s.slice(0, 19)}-03:00`) : null;
};
const nulo = (v: unknown) => (txt(v) === "" ? null : txt(v));
const imposto = (x: J) => (x && typeof x === "object"
  ? { aliquota: x.Aliquota ?? null, base: x.BaseCalculo ?? null, valor: x.Valor ?? null, ...(x.Cst ? { cst: txt(x.Cst) } : {}) }
  : null);
const parte = (g: J, aliq: string, valor: string) => (g ? { aliquota: g[aliq] ?? null, valor: g[valor] ?? null, reducao: g.gRed?.pRedAliq ?? 0 } : null);

function notasFiscais(vendasResp: J) {
  const todas: J[] = Array.isArray(vendasResp?.Vendas) ? vendasResp.Vendas : [];
  const vendas = todas.filter((v) => txt(v.ChaveVenda)).map((v) => {
    const t = v.TotalizadorVenda ?? {};
    const chave = digitos(v.ChaveSefaz).length === 44 ? digitos(v.ChaveSefaz) : null;
    const protocolo = nulo(v.ProtocoloAutorizacaoSefaz);
    const canc = cancelada(v);
    const situacao = chave ? (canc ? "cancelada" : protocolo ? "autorizada" : "pendente")
      : canc ? "venda_cancelada" : v.ModeloFiscal === 2 ? "pendente" : "sem_nota";
    const d = v.DadosCancelamento;
    return {
      chave_venda: txt(v.ChaveVenda),
      emissao: comFuso(v.DataRecebimento) ?? comFuso(v.DataMovimento),
      chave,
      emitente_cnpj: chave ? chave.slice(6, 20) : digitos(v.Loja?.CNPJ) || null,
      numero: v.NumeroNota ?? null,
      serie: nulo(v.SerieNota),
      modelo: v.ModeloFiscal ?? null,
      status_nfce: v.StatusNotaNFCe ?? null,
      situacao,
      protocolo,
      cupom: v.NumeroCupom ?? null,
      caixa: v.Caixa?.Numero ?? null,
      pessoas: v.QuantidadePessoas ?? null,
      consumidor_identificado: !!digitos(v.CPFFidelidadeIntegracao) || !!digitos(v.Cliente?.Documento),
      valor: r2(n(t.ValorTotal)), subtotal: r2(n(t.ValorSubTotal)), servico: r2(n(t.ValorTotalServico)),
      desconto: r2(Math.max(n(t.ValorTotalDescontoFiscal), n(t.ValorTotalDescontoSistema))),
      acrescimo: r2(n(t.ValorTotalAcrescimo)), taxa_entrega: r2(n(t.ValorTotalTaxaEntrega)), troco: r2(n(t.ValorTroco)),
      base_icms: r2(n(t.ValorTotalBaseCalculoICMS)), icms: r2(n(t.ValorTotalICMS)),
      base_pis: r2(n(t.ValorTotalBaseCalculoPIS)), pis: r2(n(t.ValorTotalPIS)),
      base_cofins: r2(n(t.ValorTotalBaseCalculoCOFINS)), cofins: r2(n(t.ValorTotalCOFINS)),
      cbs: r2(n(t.ValorCBS)), ibs: r2(n(t.ValorIBS)),
      itens: (Array.isArray(v.Itens) ? v.Itens : []).map((it: J, k: number) => {
        const p = it.Produto ?? {};
        const g = it.IBSCBS?.gIBSCBS;
        return {
          n: k + 1, codigo: p.Codigo ?? null, nome: txt(p.Nome), grupo: nulo(p.Grupo), ncm: nulo(p.NCM), unidade: nulo(p.Unidade),
          cfop: nulo(it.Cfop), cst: nulo(it.Cst), csosn: nulo(it.Csosn), cest: nulo(it.CEST),
          quantidade: n(it.Quantidade), valor_unitario: n(it.ValorUnitario), desconto: n(it.ValorDesconto),
          acrescimo: n(it.ValorAcrescimo), valor_total: n(it.ValorTotal), cancelado: it.Status !== 1,
          icms: imposto(it.Icms), pis: imposto(it.Pis), cofins: imposto(it.Cofins),
          ibscbs: it.IBSCBS ? {
            cst: nulo(it.IBSCBS.CST), cclasstrib: nulo(it.IBSCBS.CClasstrib), base: g?.vBC ?? null,
            cbs: parte(g?.gCBS, "pCBS", "vCBS"), ibs_uf: parte(g?.gIBSUF, "pIBSUF", "vIBSUF"), ibs_mun: parte(g?.gIBSMun, "pIBSMun", "vIBSMun"),
          } : null,
        };
      }),
      pagamentos: (Array.isArray(v.Pagamentos) ? v.Pagamentos : []).map((pg: J) => ({
        descricao: txt(pg.Descricao) || "Não identificado", tipo: pg.TipoFormaPagamento ?? null,
        valor: r2(pg.ValorEfetivo != null ? n(pg.ValorEfetivo) : n(pg.ValorRecebido)), recebido: r2(n(pg.ValorRecebido)),
      })),
      cancelamento: canc && d ? { quando: comFuso(d.Data), motivo: nulo(d.Motivo), protocolo: nulo(d.ProtocoloCancelamentoSefaz), operador: nulo(d.Operador?.Nome) } : null,
      // Quem fechou a conta no caixa, os garçons e o cliente da TOTVS (só código e nome: sem documento nem contato)
      operador: nulo(v.Caixa?.Operador?.Nome),
      atendentes: [...new Set((Array.isArray(v.Itens) ? v.Itens : []).map((it: J) => txt(it.AtendenteVenda || it.NomeAgenteVenda)).filter(Boolean))],
      cliente_codigo: v.Cliente?.Codigo ?? null,
      cliente_nome: nulo(v.Cliente?.Nome),
    };
  });
  const inutilizadas = (Array.isArray(vendasResp?.NotasInutilizadas) ? vendasResp.NotasInutilizadas : []).map((x: J) => ({
    serie: txt(x.SerieNota), numero_ini: x.NumeroNotaIni ?? null, numero_fim: x.NumeroNotaFim ?? x.NumeroNotaIni ?? null,
    motivo: nulo(x.Motivo), protocolo: nulo(x.NumeroRecibo), caixa: x.NumeroCaixa ?? null, quando: comFuso(x.DataRecibo) ?? comFuso(x.DataCriacao),
  })).filter((x: J) => x.numero_ini != null);
  const canceladas = (Array.isArray(vendasResp?.NotasCanceladas) ? vendasResp.NotasCanceladas : []).map((x: J) => ({
    chave_venda: nulo(x.ChaveVenda), chave: digitos(x.ChaveSefaz).length === 44 ? digitos(x.ChaveSefaz) : null,
    numero: x.NumeroNota ?? null, serie: nulo(x.SerieNota), motivo: nulo(x.Motivo), protocolo: nulo(x.NumeroRecibo),
    caixa: x.NumeroCaixa ?? null, valor: x.Valor ?? null, quando: comFuso(x.DataRecibo) ?? comFuso(x.DataCriacao),
  }));
  return { vendas, inutilizadas, canceladas };
}

async function gravarNotas(unidade: string, dia: string, vendasResp: J, log: Registro[]) {
  const comeco = Date.now();
  const nf = notasFiscais(vendasResp);
  const { data, error } = await supabase.rpc("nfce_gravar", {
    p_unidade: unidade, p_dia: dia, p_vendas: nf.vendas, p_inutilizadas: nf.inutilizadas, p_canceladas: nf.canceladas,
  });
  log.push({ endpoint: "nfce_gravar", tentativas: 1, ms: Date.now() - comeco, ok: !error, ...(error ? { erro: error.message.slice(0, 200) } : {}) });
  if (error) throw new Error(`gravação das NFC-e: ${error.message}`);
  return { notas: nf.vendas.filter((v) => v.chave).length, ...(data as J) };
}

// ---------------------------------------------------------------------
// Uma extração (unidade + dia)
// ---------------------------------------------------------------------
async function processar(execucaoId: string) {
  const comeco = Date.now();
  const prazo = comeco + PRAZO_MS;
  const { data: ex } = await supabase.from("totvs_execucoes").select("id,unidade_id,dia,status,origem").eq("id", execucaoId).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("totvs_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);
  const soNotas = ex.origem === "nfce";

  const log: Registro[] = [];
  let encerrada = false;
  const fim = async (status: string, erro = "") => {
    if (encerrada) return;
    encerrada = true;
    await supabase.from("totvs_execucoes").update({
      status, erro: erro.slice(0, 500), fim: new Date().toISOString(), endpoints: log,
      tentativas: log.reduce((m, r) => Math.max(m, r.tentativas), 0),
    }).eq("id", ex.id);
  };
  // Rede de segurança: se algo travar além do prazo, a execução fica como falha antes de a função ser encerrada
  const guarda = setTimeout(() => {
    fim("falha", `a TOTVS não respondeu a tempo (mais de ${Math.round(PRAZO_MS / 1000)} s); tente de novo`).catch(() => {});
  }, PRAZO_MS + 4000);

  try {
    const { data: c } = await supabase.rpc("totvs_credenciais", { p_unidade: ex.unidade_id }).maybeSingle<Credenciais>();
    if (!c?.loja || !c?.chave) throw new ErroTotvs("unidade sem loja ou chave TOTVS configurada");
    if (!c.usuario || !c.senha || !c.serial) throw new ErroTotvs("faltam credenciais no Vault (usuário, senha ou serial desta unidade)");

    const ini = `${ex.dia}T00:00:00`;
    const fimDia = `${ex.dia}T23:59:59`;
    // A CapaVenda é a chamada lenta: vai primeiro e pode usar quase todo o prazo
    const vendas = await chamar(c, "CapaVenda/ListPorDataMovimento", (token) => ["/api/CapaVenda/ListPorDataMovimento", json({
      Token: token, CodigoLoja: c.loja, DataMovimentoInicial: ini, DataMovimentoFinal: fimDia, Online: false, Composicoes: true,
      NotasInutilizadas: true, ValidaSaltoNota: false, EnviofaturamentoCaixaFechado: false,
    })], log, prazo - 7000, TETO_VENDAS_MS);
    if (!Array.isArray(vendas?.Vendas)) throw new ErroTotvs("resposta de vendas sem a lista Vendas");

    // Histórico das NFC-e: só as notas
    if (soNotas) {
      const r = await gravarNotas(ex.unidade_id, ex.dia, vendas, log);
      const status = vendas.Vendas.length ? "ok" : "sem_movimento";
      await fim(status);
      console.log(JSON.stringify({ integracao: "totvs-nfce", unidade_id: ex.unidade_id, dia: ex.dia, status, correlation_id: ex.id,
        vendas: vendas.Vendas.length, notas: r.notas, ms: Date.now() - comeco }));
      return;
    }

    const sangrias = await chamar(c, "sangria/Listar", (token) => ["/api/sangria/Listar", json({
      Token: token, CodigoLoja: c.loja, DataInicial: ini, DataFinal: fimDia,
    })], log, prazo, TETO_CURTO_MS);
    const fechamentos = await chamar(c, "FechamentoCaixa/ObterFechamentoCaixa", (token) => ["/api/FechamentoCaixa/ObterFechamentoCaixa", json({
      Token: token, Lojas: [c.loja], DataInicial: ini, DataFinal: fimDia, Chave: null, Valor: null,
    })], log, prazo, TETO_CURTO_MS);

    const d = normalizar(vendas, sangrias, fechamentos);
    const status = d.resumo.vendas_recebidas === 0 ? "sem_movimento" : d.divergencias.length ? "revisar" : "ok";
    const { error } = await supabase.from("totvs_dias").upsert({
      unidade_id: ex.unidade_id, dia: ex.dia, status,
      vendas: d.resumo.vendas_ativas, pessoas: d.resumo.pessoas, total: d.resumo.total,
      resumo: d.resumo, produtos: d.produtos, pagamentos: d.pagamentos, garcons: d.garcons,
      sangrias: d.sangrias, fechamentos: d.fechamentos, cancelados: d.cancelados, divergencias: d.divergencias, avisos: d.avisos,
      vendas_detalhe: d.vendas, execucao_id: ex.id, atualizado_em: new Date().toISOString(),
    }, { onConflict: "unidade_id,dia" });
    if (error) throw new Error(`gravação: ${error.message}`);
    // As notas não derrubam a leitura das vendas: se falharem, fica registrado no log da execução
    let notas: number | string = 0;
    if (d.resumo.vendas_recebidas) {
      try { notas = (await gravarNotas(ex.unidade_id, ex.dia, vendas, log)).notas; } catch (e) { notas = e instanceof Error ? e.message : "erro"; }
    }
    await fim(status);
    console.log(JSON.stringify({ integracao: "totvs-chef", unidade_id: ex.unidade_id, dia: ex.dia, status, correlation_id: ex.id,
      vendas_recebidas: d.resumo.vendas_recebidas, vendas_ativas: d.resumo.vendas_ativas, divergencias: d.divergencias.length,
      nfce: notas, ms: Date.now() - comeco }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await fim("falha", msg);
    console.log(JSON.stringify({ integracao: soNotas ? "totvs-nfce" : "totvs-chef", unidade_id: ex.unidade_id, dia: ex.dia, status: "falha", correlation_id: ex.id, erro: msg,
      ms: Date.now() - comeco }));
  } finally {
    clearTimeout(guarda);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const { data: ok } = await supabase.rpc("totvs_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!ok) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  EdgeRuntime.waitUntil(processar(id));
  return new Response(JSON.stringify({ recebido: id }), { headers: { "Content-Type": "application/json" } });
});
