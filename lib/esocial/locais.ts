// Local (restaurante, pousada, associação) e setor de uma pessoa, a partir do centro de custo e do
// departamento do RHiD e da unidade do cadastro do RH (eSocial). Usado no Ponto, no Banco de horas e
// nos Salários para agrupar as pessoas sempre do mesmo jeito.
//
// O centro de custo do RHiD é o local de verdade (LAIF: "Cicchetti Centro", "Filha da Lua", "Sempre Vivo";
// Brasico77: "CICCHETTI"). O departamento traz o setor e, na LAIF, repete o local entre parênteses:
// "COZINHA (CC)", "SALÃO/BAR (FDL)". Na Genesis o departamento já é o local ("Hello Barra", "Sempre Vivo").
// Sem centro de custo nem sigla, vale a unidade do RH ("Brasico Cicchetti", "Brasico FDL").
const SIGLAS: Record<string, string> = {
  CC: "Cicchetti Pipa", CICCHETTI: "Cicchetti Pipa", "CICCHETTI CENTRO": "Cicchetti Pipa", "BRASICO CICCHETTI": "Cicchetti Pipa",
  FDL: "Filha da Lua", "BRASICO FDL": "Filha da Lua",
  SV: "Sempre Vivo", "INSTRUTORES SV": "Sempre Vivo",
  GENESIS: "Associação Genesis",
};
const nomeBonito = (s: string) =>
  s.trim().toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bDe\b|\bDa\b|\bDo\b/g, (m) => m.toLowerCase());

// Locais que são o mesmo lugar: a Vila da Barra fica no Hello Barra (pedido do dono, 09/11/2026)
const MESMO_LUGAR: Record<string, string> = { "VILA DA BARRA": "Hello Barra" };
const juntar = (r: { local: string; setor: string }) => ({ ...r, local: MESMO_LUGAR[r.local.trim().toUpperCase()] ?? r.local });

export function localESetor(departamento: string, unidadeRH = "", centroCusto = "", cargo = ""): { local: string; setor: string } {
  return setorPeloCargo(juntar(localESetorBruto(departamento, unidadeRH, centroCusto)), cargo);
}

// Cicchetti Pipa (14/11/2026, pedido do dono): o cargo decide o setor — Bar separado do Salão, Hostess, Vigias
// (vigilante e porteiro) e Gerência. Nas outras casas o setor continua o do departamento do RHiD.
const sem = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
export function setorPeloCargo(r: { local: string; setor: string }, cargo: string): { local: string; setor: string } {
  if (r.local !== "Cicchetti Pipa") return r;
  const c = sem(cargo ?? ""), s = sem(r.setor);
  if (/GERENTE|GERENCIA/.test(c)) return { ...r, setor: "Gerência" };
  if (/HOSTESS/.test(c)) return { ...r, setor: "Hostess" };
  if (/VIGIA|VIGILANTE|PORTEIRO/.test(c)) return { ...r, setor: "Vigias" };
  if (s === "SALAO/BAR" || s === "SALAO" || s === "BAR") return { ...r, setor: /BAR/.test(c) ? "Bar" : "Salão" };
  return r;
}

function localESetorBruto(departamento: string, unidadeRH: string, centroCusto: string): { local: string; setor: string } {
  const d = (departamento ?? "").trim();
  const m = d.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  // A equipe da produção trabalha no Sempre Vivo: entra na cozinha de lá (pedido do dono, 30/10/2026;
  // a separação entre cozinha e produção ainda vai ser definida)
  if (/^PRODU[ÇC][ÃA]O$/i.test(m ? m[1] : d)) return { local: "Sempre Vivo", setor: "Cozinha" };
  // A Fazenda é um lugar à parte, não um setor do Sempre Vivo (pedido do dono, 09/11/2026)
  if (/^FAZENDA$/i.test(m ? m[1] : d)) return { local: "Fazenda", setor: "" };
  if (m) {
    const sigla = m[2].trim().toUpperCase();
    return { local: SIGLAS[sigla] ?? nomeBonito(m[2]), setor: nomeBonito(m[1]) };
  }
  const cc = (centroCusto ?? "").trim().toUpperCase();
  if (cc && SIGLAS[cc]) return { local: SIGLAS[cc], setor: d ? nomeBonito(d) : "" };
  const u = unidadeRH.trim().toUpperCase();
  const localRH = SIGLAS[u] ?? (unidadeRH.trim() ? nomeBonito(unidadeRH) : "");
  // Departamento que é um local (Genesis): sem setor
  const dU = d.toUpperCase();
  if (dU && !SETORES.has(dU) && (!localRH || localRH === "Associação Genesis")) return { local: nomeBonito(d), setor: "" };
  return { local: localRH, setor: d ? nomeBonito(d) : "" };
}

// Nomes de setor conhecidos (para não confundir setor com local)
const SETORES = new Set(["ADMINISTRATIVO", "COZINHA", "LIMPEZA", "SALÃO/BAR", "SALAO/BAR", "PRODUÇÃO", "PRODUCAO", "CONFEITARIA", "GOVERNANÇA", "GOVERNANCA",
  "MANUTENÇÃO/JARDIM", "MANUTENCAO/JARDIM", "RECEPÇÃO", "RECEPCAO", "PORTARIA", "BAR", "SALÃO", "SALAO", "GERÊNCIA", "GERENCIA", "HOSTESS", "VIGIAS"]);

// Unidade do RH (eSocial) em nome de local
export const localDaUnidadeRH = (unidade: string) => {
  const u = (unidade ?? "").trim();
  const m = u.match(/\(([^)]+)\)\s*$/);
  const l = m ? SIGLAS[m[1].trim().toUpperCase()] ?? nomeBonito(m[1]) : SIGLAS[u.toUpperCase()] ?? (u ? nomeBonito(u) : "");
  return MESMO_LUGAR[l.toUpperCase()] ?? l;
};
