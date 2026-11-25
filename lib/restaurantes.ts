// Casas da página Menus (/cardapios, 25/11/2026, pedido do dono: "no menu vai ter uma página chamada Menus",
// com os menus de toda a companhia, no mesmo desenho que o Ponta Negra tinha em Hotels & Restaurants).
// Cada casa é uma aba; os menus ficam por projeto (cardapios_vivos = editar na tela; cardapios_impressos =
// PDFs para imprimir; cardapios_links = link público /menus/<slug>). Casa sem `projeto` ainda não tem menus:
// a aba aparece com o aviso. Casa nova ou menus novos: ponha o projeto onde ficam os menus e os PDFs no bucket.
// Projetos (25/11/2026): Cicchetti Pipa = o projeto "Cicchetti Pipa" que já existia; Sempre Vivo e Filha da Lua = projetos
// "<casa> · Menus", criados só para guardar os menus. Os PDFs viram menus editáveis por privado/menus/converter.py.

export type Restaurante = { id: string; nome: string; casa: string; projeto: string | null };

export const RESTAURANTES: Restaurante[] = [
  { id: "cicchetti-pipa", nome: "Cicchetti Pipa", casa: "Cicchetti Pipa", projeto: "8836722a-c390-4ad0-9ede-fd39e5b59d6a" },
  { id: "ponta-negra", nome: "Ponta Negra", casa: "Cicchetti Ponta Negra", projeto: "b648cc8b-8f21-4d52-84ab-3c664e7cae04" },
  { id: "sempre-vivo", nome: "Sempre Vivo", casa: "Sempre Vivo", projeto: "a8733766-e638-41a2-924e-3a425852704f" },
  { id: "filha-da-lua", nome: "Filha da Lua", casa: "Filha da Lua", projeto: "daf62794-a1e8-4683-a305-13ef4b4aeac7" },
];

export const restaurante = (id: string) => RESTAURANTES.find((r) => r.id === id);
// aba que abre quando ninguém escolheu: a primeira casa que já tem menus
export const CASA_INICIAL = (RESTAURANTES.find((r) => r.projeto) ?? RESTAURANTES[0]).id;
