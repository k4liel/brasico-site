// Regras comuns da página de Reservas e do Mapa de reservas dos hotéis (dados do PMS em pms_estadias, pms_uhs, pms_bloqueios).

export type Estadia = {
  item_id: number; codigo: string | null; grupo_codigo: string | null; grupo_nome: string | null;
  uh_id: number | null; uh_numero: string | null; tipo: string | null;
  checkin: string | null; checkout: string | null; noites: number | null;
  status_id: number | null; status: string | null; hospede: string | null;
  adultos: number | null; criancas: number | null; hospedes: number | null; vip: boolean;
  canal: string | null; empresa: string | null; tarifa: string | null; valor_diarias: number | null;
  criada_em: string | null; cancelada_em: string | null; visto_em: string;
};
export type Uh = { uh_id: number; numero: string; tipo: string | null; andar: string | null; ativa: boolean; fora_inventario: boolean; visto_em: string };
export type Bloqueio = { bloqueio_id: string; uh_id: number | null; inicio: string | null; fim: string | null; motivo: string | null; comentario: string | null };

// Status do PMS (reservationItemStatus)
export const STATUS: Record<number, { nome: string; fase: Fase }> = {
  1: { nome: "Confirmada", fase: "reservada" },
  4: { nome: "Pendente", fase: "pendente" },
  2: { nome: "Hospedada (check-in)", fase: "hospedada" },
  3: { nome: "Finalizada (check-out)", fase: "finalizada" },
  5: { nome: "No-show", fase: "noshow" },
  6: { nome: "Cancelada", fase: "cancelada" },
};
export type Fase = "reservada" | "pendente" | "hospedada" | "finalizada" | "bloqueio" | "manutencao" | "noshow" | "cancelada";
export const FASES: { id: Fase; nome: string }[] = [
  { id: "reservada", nome: "Reservada" },
  { id: "pendente", nome: "Pendente" },
  { id: "hospedada", nome: "Hospedada" },
  { id: "finalizada", nome: "Finalizada" },
  { id: "bloqueio", nome: "Bloqueio" },
  { id: "manutencao", nome: "Manutenção" },
];
export const faseDe = (e: { status_id: number | null }): Fase => STATUS[e.status_id ?? 0]?.fase ?? "reservada";
export const nomeStatus = (e: { status_id: number | null; status: string | null }) => STATUS[e.status_id ?? 0]?.nome ?? e.status ?? "—";
export const valida = (e: Estadia) => e.status_id !== 5 && e.status_id !== 6 && !!e.checkin && !!e.checkout && e.checkout > e.checkin;
export const faseBloqueio = (b: Bloqueio): Fase => (/manut/i.test(`${b.motivo ?? ""} ${b.comentario ?? ""}`) ? "manutencao" : "bloqueio");

export const hojeFortaleza = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
export const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const dataCurta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
export const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaSemana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
export const fimDeSemana = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
export const ordemNatural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
export const reais = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
export const inteiro = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("pt-BR"));
export const antecedencia = (e: Estadia) => (e.criada_em && e.checkin ? (Date.parse(`${e.checkin}T12:00:00-03:00`) - Date.parse(e.criada_em)) / 86400000 : null);
export const canalNome = (e: { canal: string | null }) => {
  const c = (e.canal ?? "").trim();
  if (!c) return "Direto / balcão";
  const m: Record<string, string> = { booking: "Booking.com", expedia: "Expedia", "site hotel": "Site do hotel" };
  return m[c.toLowerCase()] ?? c;
};

// Busca todas as linhas de uma consulta (o Supabase devolve no máximo 1000 por vez)
export async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let de = 0; de < 20000; de += 1000) {
    const r = await consulta(de, de + 999);
    if (r.error) throw new Error(r.error.message);
    const l = (r.data as T[]) ?? [];
    out.push(...l);
    if (l.length < 1000) break;
  }
  return out;
}
