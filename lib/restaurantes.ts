// Casas da página Menus (/cardapios, 25/11/2026, pedido do dono: "no menu vai ter uma página chamada Menus",
// com os menus de toda a companhia, no mesmo desenho que o Ponta Negra tinha em Hotels & Restaurants).
// Cada casa é uma aba; os menus ficam por projeto (cardapios_vivos = editar na tela; cardapios_impressos =
// PDFs para imprimir; cardapios_links = link público /menus/<slug>). Casa sem `projeto` ainda não tem menus:
// a aba aparece com o aviso. Casa nova ou menus novos: ponha o projeto onde ficam os menus e os PDFs no bucket.

export type Restaurante = { id: string; nome: string; casa: string; projeto: string | null };

export const RESTAURANTES: Restaurante[] = [
  { id: "cicchetti-pipa", nome: "Cicchetti Pipa", casa: "Cicchetti Pipa", projeto: null },
  { id: "ponta-negra", nome: "Ponta Negra", casa: "Cicchetti Ponta Negra", projeto: "b648cc8b-8f21-4d52-84ab-3c664e7cae04" },
  { id: "sempre-vivo", nome: "Sempre Vivo", casa: "Sempre Vivo", projeto: null },
  { id: "filha-da-lua", nome: "Filha da Lua", casa: "Filha da Lua", projeto: null },
];

export const restaurante = (id: string) => RESTAURANTES.find((r) => r.id === id);
// aba que abre quando ninguém escolheu: a primeira casa que já tem menus
export const CASA_INICIAL = (RESTAURANTES.find((r) => r.projeto) ?? RESTAURANTES[0]).id;
