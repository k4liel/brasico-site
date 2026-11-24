// Testes do Ponto do mês (lib/esocial/ponto-mes.ts). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { atrasoDe, classificarDia, diasDoMes, horarioDoRelogio, resumir, type DiaRelogio } from "../lib/esocial/ponto-mes.ts";

const rel = (extra: Partial<DiaRelogio> = {}): DiaRelogio => ({
  dia: "2026-11-10", horario: "15:00-19:00\r\n20:00-23:20", folga: false, feriado: false, falta: false, justificado: false,
  minutos_trabalhados: 0, minutos_atraso: 0, saldo_banco: null, alerta: "", batidas: [], ...extra,
});
const HOJE = "2026-11-23";

test("horário do relógio vira previsto e descanso", () => {
  assert.deepEqual(horarioDoRelogio("15:00-19:00\r\n20:00-23:20"), { entrada: "15:00", saida: "23:20", descanso: "19:00–20:00" });
  assert.deepEqual(horarioDoRelogio("7:00-15:20"), { entrada: "07:00", saida: "15:20", descanso: "" });
});

test("atraso: só acima de 10 min, e não conta batida de outro turno", () => {
  assert.equal(atrasoDe("15:00", [{ hora: "15:42" }]), 42);
  assert.equal(atrasoDe("15:00", [{ hora: "15:09" }]), 0);
  assert.equal(atrasoDe("15:00", [{ hora: "10:49" }]), 0); // entrou mais cedo
  assert.equal(atrasoDe("07:00", [{ hora: "21:00" }]), 0); // outro turno
});

test("falta do relógio na folga da escala do Brasico vira folga", () => {
  const d = classificarDia("2026-11-09", HOJE, rel({ dia: "2026-11-09", falta: true }), { codigo: "F", entrada: null, saida: null, intervalo: null }, [], true);
  assert.equal(d.tipo, "fol");
  assert.equal(d.rotulo, "Folga");
});

test("falta com trabalho marcado na escala é falta; sem escala no Brasico fica a conferir", () => {
  const comEscala = classificarDia("2026-11-12", HOJE, rel({ falta: true }), { codigo: "T", entrada: "15:00", saida: "23:20", intervalo: "19:00-20:00" }, [], true);
  assert.equal(comEscala.tipo, "fal");
  const semEscala = classificarDia("2026-11-12", HOJE, rel({ falta: true }), undefined, [], false);
  assert.equal(semEscala.tipo, "falc");
});

test("batida com atraso usa a entrada da escala do Brasico", () => {
  const d = classificarDia("2026-11-10", HOJE, rel({ batidas: [{ hora: "15:46" }, { hora: "17:05" }], minutos_trabalhados: 348 }),
    { codigo: "T", entrada: "15:30", saida: "23:20", intervalo: null }, [], true);
  assert.equal(d.tipo, "atr");
  assert.equal(d.atraso, 16);
  assert.equal(d.previsto, "15:30–23:20");
});

test("afastamento do RHiD ganha da falta; dia futuro é previsto", () => {
  const a = classificarDia("2026-11-12", HOJE, rel({ falta: true }), undefined, [{ inicio: "2026-11-01", fim: "2026-11-30", tipo: "Férias", afasta: true }], false);
  assert.equal(a.tipo, "afa");
  assert.equal(a.rotulo, "Férias");
  assert.equal(classificarDia("2026-11-25", HOJE, rel({ dia: "2026-11-25" }), undefined, [], false).tipo, "prev");
});

test("resumo do mês e dias do mês", () => {
  const ds = [
    classificarDia("2026-11-10", HOJE, rel({ batidas: [{ hora: "15:00" }], minutos_trabalhados: 400 }), undefined, [], false),
    classificarDia("2026-11-11", HOJE, rel({ batidas: [{ hora: "15:30" }], minutos_trabalhados: 380 }), undefined, [], false),
    classificarDia("2026-11-12", HOJE, rel({ falta: true }), { codigo: "T", entrada: "15:00", saida: "23:20", intervalo: null }, [], true),
  ];
  const r = resumir(ds);
  assert.equal(r.dias, 2);
  assert.equal(r.minutos, 780);
  assert.equal(r.atrasos, 1);
  assert.equal(r.minutosAtraso, 30);
  assert.equal(r.faltas, 1);
  assert.equal(diasDoMes("2026-11").length, 30);
  assert.equal(diasDoMes("2026-02").length, 28);
});
