// Testes das regras do painel de integrações (lib/integracoes.ts). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { horarioLegivel, montarIntegracoes, quando, type Exec, type Painel } from "../lib/integracoes.ts";

// 13/11/2026 às 15h de Fortaleza (18h UTC)
const AGORA = "2026-11-13T18:00:00.000Z";
const antes = (min: number, base = AGORA) => new Date(new Date(base).getTime() - min * 60000).toISOString();

const exec = (okHa: number, extra: Partial<Exec> = {}): Exec => ({
  ultima: antes(okHa), ultima_ok: antes(okHa), ultima_falha: null, ok_24h: 10, falha_24h: 0, rodando: 0, presos: 0,
  ultimo_erro: null, ultimo_erro_em: null, ...extra,
});

function painel(mudar: (p: Painel) => void = () => {}, agora = AGORA): Painel {
  const p: Painel = {
    agora,
    fontes: {
      rhid: { ...exec(1), ultima_agora: antes(1, agora), ultima_apuracao: antes(30, agora), ultimo_cadastro: antes(600, agora), clientes: 3 },
      esocial: { ...exec(120), empresas: [{ nome: "LAIF HOTELARIAS LTDA", ligada: true, limite: 10, acessos_hoje: 4, a_baixar: 0 }] },
      receita: { ...exec(300), ultimo_evento: antes(300), empresas_producao: 3, gasto_ciclo: 50, orcamento_ciclo: 179, cobradas_hoje: 10, chamadas_erro_24h: 0 },
      notas: { ...exec(500), empresas: 4, bloqueadas: 2, notas_7d: 100, ultima_nota: antes(500) },
      nfse: { ...exec(300), empresas: 5, bloqueadas: 0, notas_7d: 8 },
      totvs: { ...exec(200), unidades: [{ nome: "Cicchetti Pipa", ultimo_dia: "2026-11-12", ontem: "ok" }] },
      cicchetti: { ultima: antes(60), ultima_ok: antes(60), ultima_falha: null, ok_24h: 10, falha_24h: 0, ultimo_erro: null, ultima_coleta_itens: antes(60), notas_sem_itens: 3 },
      pms: { ...exec(20), intervalo_min: 30, hoteis: [{ nome: "Filha da Lua - Eco Lodge", ultima_leitura: antes(20) }] },
      whatsapp: { ultima_mensagem: antes(15), mensagens_24h: 100, grupos_24h: 20, envios_24h: 0, envios_falha_24h: 0 },
      gemini: exec(600),
      claude: { ultimo_resumo: antes(480), resumo_ontem: true },
      conector: { links: 2, ultimo_uso: antes(60) },
    },
    certificados: [{ nome: "LAIF HOTELARIAS LTDA", cnpj: "50639716000101", matriz: true, validade: "2027-05-28T12:00:00Z" }],
    agendas: [],
    eventos: [],
  };
  mudar(p);
  return p;
}
const de = (p: Painel, id: string) => montarIntegracoes(p).find((i) => i.id === id)!;

test("com tudo em dia, todas as integrações ficam verdes", () => {
  const ruins = montarIntegracoes(painel()).filter((i) => i.estado !== "ok");
  assert.deepEqual(ruins.map((i) => `${i.id}: ${i.frase}`), []);
});

test("eSocial fica pausado do dia 1 ao 7 (regra do governo), mesmo sem ler há dias", () => {
  const agora = "2026-12-03T15:00:00.000Z";
  const p = painel((x) => { x.fontes.esocial.ultima_ok = antes(4 * 24 * 60, agora); }, agora);
  assert.equal(de(p, "esocial").estado, "pausa");
});

test("eSocial sem resposta há 3 dias (fora da pausa) = parado", () => {
  const p = painel((x) => { x.fontes.esocial.ultima_ok = antes(3 * 24 * 60); });
  assert.equal(de(p, "esocial").estado, "erro");
});

test("certificado vencendo em menos de uma semana pede atenção e aparece na frase", () => {
  const p = painel((x) => { x.certificados.push({ nome: "BRASICO77 EMPREENDIMENTOS TURISTICOS LTDA", cnpj: "24021962000276", matriz: false, validade: "2026-11-19T12:00:00Z" }); });
  const c = de(p, "certificados");
  assert.equal(c.estado, "atencao");
  assert.match(c.frase, /filial 0002.*vence em 5 dias/);
});

test("robô do PMS parado há 4 h = parado", () => {
  const p = painel((x) => { x.fontes.pms.ultima_ok = antes(240); x.fontes.pms.hoteis[0].ultima_leitura = antes(240); });
  assert.equal(de(p, "pms").estado, "erro");
});

test("ponto parado de madrugada é pausa, não erro", () => {
  const agora = "2026-11-13T06:00:00.000Z"; // 3h em Fortaleza
  const p = painel((x) => { x.fontes.rhid.ultima_agora = antes(180, agora); }, agora);
  assert.equal(de(p, "rhid").estado, "pausa");
});

test("falha antiga já resolvida por uma leitura boa não aparece como erro", () => {
  const p = painel((x) => { x.fontes.nfse.ultima_falha = antes(600); x.fontes.nfse.ultimo_erro = "conexão: ETIMEDOUT"; });
  const n = de(p, "nfse");
  assert.equal(n.erro, null);
  assert.equal(n.estado, "ok");
});

test("falha mais nova que a última leitura boa aparece e pede atenção", () => {
  const p = painel((x) => { x.fontes.receita.ultima_falha = antes(10); x.fontes.receita.ultimo_erro = "Erro ao obter o relatório"; x.fontes.receita.ultimo_erro_em = antes(10); });
  const r = de(p, "receita");
  assert.equal(r.estado, "atencao");
  assert.equal(r.erro?.texto, "Erro ao obter o relatório");
});

test("TOTVS: ontem que não chegou depois das 13h = parado; de manhã só atenção", () => {
  const tarde = painel((x) => { x.fontes.totvs.unidades[0].ontem = null; });
  assert.equal(de(tarde, "totvs").estado, "erro");
  const manha = "2026-11-13T11:00:00.000Z"; // 8h em Fortaleza
  const cedo = painel((x) => { x.fontes.totvs.unidades[0].ontem = null; x.fontes.totvs.ultima_ok = antes(200, manha); }, manha);
  assert.equal(de(cedo, "totvs").estado, "atencao");
});

test("Cicchetti: itens das notas parados há dias pede atenção", () => {
  const p = painel((x) => { x.fontes.cicchetti.notas_sem_itens = 842; x.fontes.cicchetti.ultima_coleta_itens = "2026-10-30T21:00:00Z"; });
  const c = de(p, "cicchetti");
  assert.equal(c.estado, "atencao");
  assert.match(c.frase, /parados desde 30\/10/);
});

test("horários das agendas saem em português no horário de Fortaleza", () => {
  assert.equal(horarioLegivel("* * * * *"), "a cada minuto");
  assert.equal(horarioLegivel("30 seconds"), "a cada 30 s");
  assert.equal(horarioLegivel("0 10 * * *"), "todo dia às 7h00");
  assert.equal(horarioLegivel("30 9,15 * * *"), "todo dia às 6h30, 12h30");
  assert.equal(horarioLegivel("*/15 10-12 * * *"), "a cada 15 min das 7h às 9h59");
  assert.equal(horarioLegivel("0 9 2 * *"), "todo mês às 6h00 no dia 2");
});

test("quando: minutos, hoje e ontem", () => {
  assert.equal(quando(antes(5), AGORA), "há 5 min");
  assert.equal(quando(antes(120), AGORA), "hoje às 13:00");
  assert.equal(quando(antes(24 * 60), AGORA), "ontem às 15:00");
});
