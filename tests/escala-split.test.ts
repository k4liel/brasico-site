// Split da escala (duas jornadas no mesmo dia; lib/escala/regras.ts). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPLIT_PADRAO, jornada, partesSplit, rotuloSplit } from "../lib/escala/regras.ts";

const dia = (entrada: string, saida: string, intervalo: string | null) => ({ codigo: "T" as const, entrada, saida, intervalo });

test("o split padrão vira as duas jornadas e conta 9h35 de trabalho", () => {
  const d = dia("11:00", "23:20", "15:00-17:45");
  assert.deepEqual(partesSplit(d), SPLIT_PADRAO);
  assert.equal(rotuloSplit(partesSplit(d)!), "11:00–15:00 · 17:45–23:20");
  assert.equal(jornada(d)!.liquido, 9 * 60 + 35);
});

test("descanso de até 2 h não é split", () => {
  assert.equal(partesSplit(dia("07:00", "15:20", "12:00-13:00")), null);
  assert.equal(partesSplit(dia("10:00", "20:00", "13:00-15:00")), null);
});

test("sem descanso, folga ou código não é split", () => {
  assert.equal(partesSplit(dia("07:00", "15:00", null)), null);
  assert.equal(partesSplit({ codigo: "F" }), null);
  assert.equal(partesSplit(undefined), null);
});
