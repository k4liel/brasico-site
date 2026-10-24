// Contas e formatos do painel de vendas TOTVS (components/Totvs.tsx e components/TotvsPartes.tsx).
// Tudo é calculado na tela a partir de totvs_dias (um resumo por unidade e dia).
export type Unidade = { id: string; nome: string; loja: number | null; ativa: boolean; ordem: number };
export type Historico = { unidade_id: string; cursor: string; parado: boolean; motivo: string };
export type Produto = { nome: string; grupo: string; categoria: string; quantidade: number; valor: number };
export type Pagamento = { tipo: string; forma: string; valor: number; vezes: number };
export type Garcom = { nome: string; itens: number; valor: number; vendas: number };
export type Cancelado = { tipo: string; cupom?: number | string | null; produto?: string; total?: number; operador?: string; motivo?: string; quando?: string };
export type Sangria = { caixa?: number | null; quando?: string; operador?: string; motivo?: string; forma?: string; valor: number };
export type Divergencia = { conferencia: string; diferenca?: number; valor?: number };
export type Dia = {
  unidade_id: string; dia: string; status: string; vendas: number; pessoas: number; total: number;
  resumo: Record<string, number>; produtos: Produto[]; pagamentos: Pagamento[]; garcons: Garcom[];
  cancelados: Cancelado[]; sangrias: Sangria[]; divergencias: Divergencia[];
};
// Série leve para a evolução mensal (um ponto por dia)
export type Ponto = { dia: string; total: number; pessoas: number; status: string };

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const reais = (v: number) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const reaisCurto = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 100000 ? 0 : 1 })} mil` : reais(v));
export const inteiro = (v: number) => Math.round(v ?? 0).toLocaleString("pt-BR");
export const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${Math.round(n) === 1 ? um : varios}`;
export const pct =(v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const hojeFortaleza = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
export const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const diasNoMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
export const somarMeses = (mes: string, n: number) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
export const mesAnterior = (mes: string) => somarMeses(mes, -1);
export const nomeMes = (mes: string) => `${MESES[+mes.slice(5, 7) - 1]} de ${mes.slice(0, 4)}`;
export const mesCurto = (mes: string) => `${MESES[+mes.slice(5, 7) - 1].slice(0, 3)}/${mes.slice(2, 4)}`;
export const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
// Nomes da TOTVS vêm em caixa alta; na tela ficam só com as iniciais maiúsculas
export const titulo = (t: string) => (t ?? "").toLocaleLowerCase("pt-BR").replace(/(^|[\s\-/(])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR"));
const r = (d: Dia, k: string) => Number(d.resumo?.[k] ?? 0);
// Dia com vendas de verdade (loja fechada não entra nas médias)
export const comMovimento = (d: { status: string; total: number }) => d.status !== "sem_movimento" && Number(d.total) > 0;

// Topo do eixo de um gráfico: um valor redondo logo acima do maior
export function escalaBonita(max: number) {
  const p = 10 ** Math.floor(Math.log10(max || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p;
}

export function somar(dias: Dia[]) {
  const s = { total: 0, pessoas: 0, vendas: 0, servico: 0, comida: 0, bebida: 0, outros: 0, descontos: 0, cortesias: 0, assinadas: 0, sangrias: 0, itensCancelados: 0, cuponsCancelados: 0 };
  for (const d of dias) {
    s.total += Number(d.total); s.pessoas += d.pessoas; s.vendas += d.vendas;
    s.servico += r(d, "servico"); s.comida += r(d, "comida"); s.bebida += r(d, "bebida"); s.outros += r(d, "outros");
    s.descontos += r(d, "descontos"); s.cortesias += r(d, "cortesias"); s.assinadas += r(d, "assinadas"); s.sangrias += r(d, "sangrias");
    s.itensCancelados += r(d, "itens_cancelados"); s.cuponsCancelados += r(d, "vendas_canceladas");
  }
  return s;
}

function agrupar<T>(dias: Dia[], lista: (d: Dia) => T[], chave: (x: T) => string, juntar: (a: T | undefined, x: T, dia: string) => T) {
  const m = new Map<string, T>();
  for (const d of dias) for (const x of lista(d) ?? []) m.set(chave(x), juntar(m.get(chave(x)), x, d.dia));
  return Array.from(m.values());
}

export const agruparProdutos = (dias: Dia[]) =>
  agrupar<Produto>(dias, (d) => d.produtos, (p) => p.nome,
    (a, p) => ({ ...p, quantidade: (a?.quantidade ?? 0) + Number(p.quantidade), valor: (a?.valor ?? 0) + Number(p.valor) }))
    .sort((a, b) => b.valor - a.valor);

export const agruparPagamentos = (dias: Dia[]) =>
  agrupar<Pagamento>(dias, (d) => d.pagamentos, (p) => `${p.tipo}|${p.forma}`,
    (a, p) => ({ ...p, valor: (a?.valor ?? 0) + Number(p.valor), vezes: (a?.vezes ?? 0) + Number(p.vezes) }))
    .sort((a, b) => b.valor - a.valor);


export type GarcomMes = Garcom & { dias: Set<string> };
export const agruparGarcons = (dias: Dia[]) =>
  agrupar<GarcomMes>(dias, (d) => d.garcons as GarcomMes[], (g) => g.nome,
    (a, g, dia) => ({ ...g, itens: (a?.itens ?? 0) + Number(g.itens), valor: (a?.valor ?? 0) + Number(g.valor), vendas: (a?.vendas ?? 0) + Number(g.vendas), dias: new Set([...(a?.dias ?? []), dia]) }))
    .sort((a, b) => b.valor - a.valor);

// Planilha do mês, um dia por linha, no formato que o Excel brasileiro abre direto (; e vírgula decimal)
export function planilhaDoMes(unidade: string, dias: Dia[]) {
  const num = (v: number) => (Math.round((v ?? 0) * 100) / 100).toFixed(2).replace(".", ",");
  const cab = ["Unidade", "Data", "Dia da semana", "Situação", "Faturamento", "Pessoas", "Cupons", "Ticket por pessoa", "Comida", "Bebida", "Outros",
    "Taxa de serviço", "Descontos", "Cortesias", "Assinadas", "Sangrias", "Itens cancelados", "Cupons cancelados"];
  const situacao: Record<string, string> = { ok: "Conferido", revisar: "Para revisar", sem_movimento: "Sem movimento" };
  const linhas = dias.map((d) => [
    unidade, `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}/${d.dia.slice(0, 4)}`, SEMANA[diaSemana(d.dia)], situacao[d.status] ?? d.status,
    num(d.total), String(d.pessoas), String(d.vendas), d.pessoas ? num(d.total / d.pessoas) : "",
    num(r(d, "comida")), num(r(d, "bebida")), num(r(d, "outros")), num(r(d, "servico")), num(r(d, "descontos")),
    num(r(d, "cortesias")), num(r(d, "assinadas")), num(r(d, "sangrias")), String(r(d, "itens_cancelados")), String(r(d, "vendas_canceladas")),
  ]);
  const cel = (t: string) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return "﻿" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
}
