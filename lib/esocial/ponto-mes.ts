// Ponto do mês (aba "Ponto e banco de horas" do RH, 23/11/2026): o que aconteceu em cada dia de cada pessoa,
// cruzando o relógio (RHiD, rhid_dias) com a escala do Brasico (escala_planejada) e as justificativas do RHiD.
// Por que cruzar: no RHiD a escala é o horário do contrato todos os dias, sem a folga da semana — o relógio marca
// "Falta" na folga. A folga de verdade está na escala do Brasico. E o RHiD avisa "Atraso acima de 10 min" sem mandar
// os minutos (minutos_atraso vem 0): o atraso é calculado aqui, pela 1ª batida contra a entrada prevista.
// Testes em tests/ponto-mes.test.ts (npm test).

export type BatidaMes = { hora: string; tipo?: string; origem?: string; classificacao?: string; justificada?: boolean };
export type DiaRelogio = {
  dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; saldo_banco: number | null; alerta: string; batidas: BatidaMes[];
};
export type DiaEscala = { codigo: string; entrada: string | null; saida: string | null; intervalo: string | null };
export type Afastamento = { inicio: string; fim: string; tipo: string; afasta: boolean };

// trab = trabalhou · atr = com atraso · fal = falta (com escala no Brasico) · falc = falta pelo relógio, sem escala
// no Brasico (pode ser a folga: conferir) · fol = folga · fer = feriado · afa = afastado/férias/atestado/licença ·
// fora = trabalhou em outro lugar (viagem, home office, outra casa) · prev = previsto (dia que ainda não chegou) ·
// hoje = hoje sem batida ainda · vazio = sem escala nem leitura
export type TipoDia = "trab" | "atr" | "fal" | "falc" | "fol" | "fer" | "afa" | "fora" | "prev" | "hoje" | "vazio";
export type DiaMes = {
  dia: string; tipo: TipoDia; rotulo: string; previsto: string; descanso: string; batidas: BatidaMes[];
  minutos: number; atraso: number; alerta: string; origemEscala: "brasico" | "relogio" | null; ajustada: boolean;
};

export const TOLERANCIA_ATRASO = 10;
const FOLGAS: Record<string, string> = { F: "Folga", DM: "Domingo do mês", FC: "Folga de compensação", BH: "Folga do banco de horas" };
const AFASTA: Record<string, string> = { FE: "Férias", AT: "Atestado", LIC: "Licença" };
const FORA: Record<string, string> = { VN: "Viagem de negócios", HO: "Home office", CC: "No Cicchetti Centro", FL: "Na Filha da Lua", SV: "No Sempre Vivo" };

const min = (hm: string) => { const m = hm.match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hm = (s: string | null | undefined) => { const m = (s ?? "").match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };

// "15:00-19:00\r\n20:00-23:20" → previsto "15:00–23:20", descanso "19:00–20:00"
export function horarioDoRelogio(h: string): { entrada: string; saida: string; descanso: string } {
  const trechos = [...(h ?? "").matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)].map((m) => [hm(m[1]), hm(m[2])]);
  if (!trechos.length) return { entrada: "", saida: "", descanso: "" };
  return {
    entrada: trechos[0][0], saida: trechos[trechos.length - 1][1],
    descanso: trechos.length > 1 ? `${trechos[0][1]}–${trechos[1][0]}` : "",
  };
}

// Minutos de atraso: 1ª batida depois da entrada prevista, só acima da tolerância (como o RHiD avisa).
// Batida muito antes ou muito depois (turno da madrugada, entrou em outro turno) não conta como atraso.
export function atrasoDe(entrada: string, batidas: BatidaMes[]): number {
  const e = min(entrada), b = batidas.length ? min(batidas[0].hora) : null;
  if (e == null || b == null) return 0;
  const d = b - e;
  return d > TOLERANCIA_ATRASO && d <= 5 * 60 ? d : 0;
}

export function classificarDia(dia: string, hoje: string, r: DiaRelogio | undefined, e: DiaEscala | undefined,
  afastamentos: Afastamento[], temEscalaNoMes: boolean): DiaMes {
  const codigo = (e?.codigo ?? "").toUpperCase();
  const rel = horarioDoRelogio(r?.horario ?? "");
  const daEscala = codigo === "T" && e?.entrada;
  const entrada = daEscala ? hm(e!.entrada) : rel.entrada;
  const saida = daEscala ? hm(e!.saida) : rel.saida;
  const descanso = daEscala ? (e!.intervalo ?? "").replace("-", "–") : rel.descanso;
  const previsto = entrada && saida ? `${entrada}–${saida}` : "";
  const batidas = r?.batidas ?? [];
  const base = {
    dia, previsto, descanso, batidas, minutos: r?.minutos_trabalhados ?? 0, alerta: r?.alerta ?? "",
    origemEscala: codigo ? "brasico" as const : r?.horario ? "relogio" as const : null,
    ajustada: batidas.some((b) => !!b.justificada || b.classificacao === "J" || b.origem === "I"), atraso: 0,
  };
  const afast = afastamentos.find((a) => a.afasta && a.inicio <= dia && a.fim >= dia);
  const just = afastamentos.find((a) => !a.afasta && a.inicio <= dia && a.fim >= dia);

  if (batidas.length) {
    const atraso = atrasoDe(entrada, batidas);
    return { ...base, tipo: atraso ? "atr" : "trab", atraso, rotulo: atraso ? `Atraso de ${atraso} min` : dia === hoje ? (batidas.length % 2 ? "Trabalhando agora" : "Já saiu") : "Trabalhou" };
  }
  if (afast) return { ...base, tipo: "afa", rotulo: afast.tipo || "Afastado" };
  if (AFASTA[codigo]) return { ...base, tipo: "afa", rotulo: AFASTA[codigo] };
  if (FOLGAS[codigo]) return { ...base, tipo: "fol", rotulo: FOLGAS[codigo] };
  if (FORA[codigo]) return { ...base, tipo: "fora", rotulo: FORA[codigo] };
  if (codigo === "FX") return dia >= hoje ? { ...base, tipo: dia === hoje ? "hoje" : "prev", rotulo: "Flexível" } : { ...base, tipo: "fora", rotulo: "Flexível (sem horário certo)" };
  if (dia > hoje) {
    if (r?.folga && !codigo) return { ...base, tipo: "fol", rotulo: "Folga" };
    return previsto ? { ...base, tipo: "prev", rotulo: "Previsto" } : { ...base, tipo: "vazio", rotulo: "" };
  }
  if (dia === hoje) return previsto ? { ...base, tipo: "hoje", rotulo: "Ainda sem batida" } : { ...base, tipo: "vazio", rotulo: "" };
  if (just || r?.justificado) return { ...base, tipo: "fol", rotulo: just?.tipo ? `Justificado: ${just.tipo}` : "Justificado no relógio" };
  if (r?.feriado) return { ...base, tipo: "fer", rotulo: "Feriado" };
  if (r?.folga) return { ...base, tipo: "fol", rotulo: "Folga" };
  if (codigo === "T") return { ...base, tipo: "fal", rotulo: "Falta" };
  if (r?.falta) return temEscalaNoMes
    ? { ...base, tipo: "fol", rotulo: "Sem escala neste dia" }
    : { ...base, tipo: "falc", rotulo: "Falta pelo relógio (conferir: pode ser a folga)" };
  return { ...base, tipo: "vazio", rotulo: r ? "Sem batida" : "" };
}

export type ResumoMes = {
  dias: number; minutos: number; faltas: number; aConferir: number; atrasos: number; minutosAtraso: number;
  folgas: number; afastado: number; feriados: number; fora: number;
};
export function resumir(ds: DiaMes[]): ResumoMes {
  const c = (t: TipoDia) => ds.filter((d) => d.tipo === t).length;
  return {
    dias: c("trab") + c("atr"), minutos: ds.reduce((t, d) => t + d.minutos, 0), faltas: c("fal"), aConferir: c("falc"),
    atrasos: c("atr"), minutosAtraso: ds.reduce((t, d) => t + d.atraso, 0), folgas: c("fol"), afastado: c("afa"),
    feriados: c("fer"), fora: c("fora"),
  };
}

// Os dias de um mês "AAAA-MM"
export function diasDoMes(mes: string): string[] {
  const [a, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}
export const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
