// Testes das contas do RH (lib/esocial/rh.ts). Rodar: npm test
// Cada caso monta eventos do eSocial "de mentira" e confere o que a página vai mostrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  faltandoNaFicha, liquidoDoUltimoMes, montarCobertura, montarNumeros, montarPessoas, somarDias, hoje,
  type EventoRH, type PagamentoRH, type TrabalhadorRH,
} from "../lib/esocial/rh.ts";

let n = 0;
function ev(tipo: string, cpf: string, resumo: Record<string, string>, extra: Partial<EventoRH> = {}): EventoRH {
  n++;
  return {
    id_evento: `ID${String(n).padStart(34, "0")}`, empresa_id: "E1", tipo, cpf_trab: cpf, per_apur: null, situacao: "baixado",
    nr_recibo: `R${n}`, resumo, descoberto_em: "2026-01-01T00:00:00Z", baixado_em: "2026-01-01T00:00:00Z", ...extra,
  };
}
function trab(cpf: string, extra: Partial<TrabalhadorRH> = {}): TrabalhadorRH {
  return {
    empresa_id: "E1", cpf, nome: `Pessoa ${cpf}`, matricula: "", cargo: "Cozinheiro", admissao: "2025-01-10", unidade: "Cicchetti",
    origem: "manual", ativo: true, consultado_ate: "2026-11-01T00:00:00Z", consultado_desde: "2025-01-01T00:00:00Z", ponto_situacao: "batendo", ...extra,
  };
}
const pg = (cpf: string, per_ref: string, vr_liq: number, tipo = "mensal"): PagamentoRH =>
  ({ empresa_id: "E1", cpf, dt_pgto: `${per_ref.length === 7 ? per_ref : "2025-12"}-05`, per_ref, tipo, vr_liq });

test("salário vem da alteração de contrato mais nova (S-2206 depois do S-2200)", () => {
  const ps = montarPessoas([
    ev("S-2200", "111", { dtAdm: "2025-01-10", vrSalFx: "1600.00", nome: "ANA" }),
    ev("S-2206", "111", { dtAlteracao: "2026-03-01", vrSalFx: "1800.00" }),
  ], [trab("111")]);
  assert.equal(ps[0].salario, "1800.00");
  assert.equal(ps[0].situacao, "trabalhando");
});

test("desligamento (S-2299) marca 'saiu' e não conta como ativo", () => {
  const ps = montarPessoas([
    ev("S-2200", "222", { dtAdm: "2025-01-10" }),
    ev("S-2299", "222", { dtDeslig: "2026-10-05", mtvDeslig: "07" }),
  ], [trab("222")]);
  assert.equal(ps[0].situacao, "saiu");
  assert.equal(ps[0].motivoSaida, "pediu para sair");
  assert.equal(montarNumeros(ps, []).ativos, 0);
});

test("evento excluído (S-3000) não vale", () => {
  const sai = ev("S-2299", "333", { dtDeslig: "2026-10-05", mtvDeslig: "02" });
  const ps = montarPessoas([
    ev("S-2200", "333", { dtAdm: "2025-01-10" }), sai, ev("S-3000", "333", { nrRecEvt: sai.nr_recibo! }),
  ], [trab("333")]);
  assert.equal(ps[0].situacao, "trabalhando");
});

test("inativo no ponto sem desligamento no eSocial vira 'Saiu do ponto' e sai dos ativos", () => {
  const ps = montarPessoas([ev("S-2200", "444", { dtAdm: "2025-01-10" })], [trab("444", { ponto_situacao: "inativo" })]);
  assert.equal(ps[0].situacao, "saiu_ponto");
  assert.equal(montarNumeros(ps, []).ativos, 0);
  assert.equal(montarCobertura(ps).saiuPonto.length, 1);
});

test("afastamento aberto ganha de 'saiu do ponto' (quem está no INSS some do relógio)", () => {
  const ps = montarPessoas([
    ev("S-2200", "555", { dtAdm: "2025-01-10" }),
    ev("S-2230", "555", { dtIniAfast: somarDias(hoje(), -40), codMotAfast: "03" }),
  ], [trab("555", { ponto_situacao: "inativo" })]);
  assert.equal(ps[0].situacao, "afastado");
});

test("férias terminadas não deixam a pessoa afastada", () => {
  const ps = montarPessoas([
    ev("S-2200", "666", { dtAdm: "2025-01-10" }),
    ev("S-2230", "666", { dtIniAfast: "2026-06-01", codMotAfast: "15" }),
    ev("S-2230", "666", { dtTermAfast: "2026-06-30" }),
  ], [trab("666")]);
  assert.equal(ps[0].situacao, "trabalhando");
});

test("líquido do último mês soma só os pagamentos mensais do mês mais novo", () => {
  const l = liquidoDoUltimoMes([pg("1", "2026-08", 1500), pg("1", "2026-09", 1000), pg("1", "2026-09", 250.5), pg("1", "2026", 900, "13º salário")]);
  assert.deepEqual(l, { mes: "2026-09", valor: 1250.5 });
  assert.equal(liquidoDoUltimoMes([pg("1", "2025", 900, "13º salário")]), null);
});

test("pagamentos entram na ficha certa e a conferência conta quem tem salário e líquido", () => {
  const ps = montarPessoas(
    [ev("S-2200", "777", { dtAdm: "2025-01-10", vrSalFx: "2000" })],
    [trab("777"), trab("888", { ponto_situacao: "sem_ponto", consultado_ate: null })],
    [pg("777", "2026-09", 1700)],
  );
  const a = ps.find((p) => p.cpf === "777")!, b = ps.find((p) => p.cpf === "888")!;
  assert.deepEqual(a.liquido, { mes: "2026-09", valor: 1700 });
  assert.deepEqual(a.faltando, []);
  assert.deepEqual(faltandoNaFicha(b), ["salário de contrato", "pagamento", "leitura do eSocial", "cadastro no ponto"]);
  const c = montarCobertura(ps);
  assert.equal(c.ativos, 2);
  assert.equal(c.comSalario, 1);
  assert.equal(c.comLiquido, 1);
  assert.equal(c.semPonto.length, 1);
});

test("quem só está no cadastro do contador (sem eventos) aparece aguardando, com nome e cargo da planilha", () => {
  const ps = montarPessoas([], [trab("999", { admissao: null })]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].situacao, "aguardando");
  assert.equal(ps[0].cargo, "Cozinheiro");
});
