// As casas da escala planejada (09/11/2026): agrupam os locais da grade do RH (usado no título do PDF e do
// texto do WhatsApp quando a escala é filtrada por casa).
// O local de cada grupo vem da grade do RH (lib/esocial/locais.ts): "Cicchetti Pipa" é o Cicchetti Centro, e
// todo local que não é de uma casa daqui (Hello Barra, Hello Pipa, Vila da Barra…) cai em "Outras casas".

export type Casa = { id: string; nome: string; locais: string[]; hotel: boolean };

export const CASAS: Casa[] = [
  { id: "filha-da-lua", nome: "Filha da Lua", locais: ["Filha da Lua"], hotel: true },
  { id: "sempre-vivo", nome: "Sempre Vivo", locais: ["Sempre Vivo"], hotel: true },
  { id: "filho-do-vento", nome: "Filho do Vento", locais: ["Filho do Vento"], hotel: true },
  { id: "cicchetti-centro", nome: "Cicchetti Centro", locais: ["Cicchetti Pipa", "Cicchetti Centro"], hotel: false },
  { id: "outras-casas", nome: "Outras casas", locais: [], hotel: false },
];

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function casaDoLocal(local: string): string {
  const l = sem(local);
  return CASAS.find((c) => c.locais.some((x) => sem(x) === l))?.id ?? "outras-casas";
}

export const casaPorId = (id: string) => CASAS.find((c) => c.id === id);

