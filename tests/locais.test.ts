// Local e setor de cada pessoa (lib/esocial/locais.ts). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { localESetor } from "../lib/esocial/locais.ts";

test("Cicchetti Pipa: Bar separado do Salão pelo cargo", () => {
  assert.deepEqual(localESetor("SALÃO/BAR (CC)", "", "Cicchetti Centro", "Bartender"), { local: "Cicchetti Pipa", setor: "Bar" });
  assert.deepEqual(localESetor("SALÃO/BAR (CC)", "", "Cicchetti Centro", "Chefe de Bar I"), { local: "Cicchetti Pipa", setor: "Bar" });
  assert.deepEqual(localESetor("SALÃO/BAR (CC)", "", "Cicchetti Centro", "Garçom"), { local: "Cicchetti Pipa", setor: "Salão" });
  assert.deepEqual(localESetor("SALÃO/BAR (CC)", "", "Cicchetti Centro", "Cumim"), { local: "Cicchetti Pipa", setor: "Salão" });
});

test("Cicchetti Pipa: Hostess, Vigias e Gerência pelo cargo", () => {
  assert.equal(localESetor("ADMINISTRATIVO (CC)", "", "Cicchetti Centro", "Hostess").setor, "Hostess");
  assert.equal(localESetor("ADMINISTRATIVO (CC)", "", "Cicchetti Centro", "Vigilante").setor, "Vigias");
  assert.equal(localESetor("ADMINISTRATIVO (CC)", "", "Cicchetti Centro", "Porteiro").setor, "Vigias");
  assert.equal(localESetor("ADMINISTRATIVO (CC)", "", "Cicchetti Centro", "Gerente de restaurante").setor, "Gerência");
  assert.equal(localESetor("COZINHA (CC)", "", "Cicchetti Centro", "Cozinheiro").setor, "Cozinha");
});

test("nas outras casas o setor continua o do departamento", () => {
  assert.deepEqual(localESetor("SALÃO/BAR (FDL)", "", "Filha da Lua", "Bartender"), { local: "Filha da Lua", setor: "Salão/Bar" });
  assert.equal(localESetor("ADMINISTRATIVO (FDL)", "", "Filha da Lua", "Vigilante").setor, "Administrativo");
});
