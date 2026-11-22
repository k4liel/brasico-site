// Restaurantes do grupo "Hotéis e restaurantes" do menu (22/11/2026, pedido do dono).
// Cada um tem a sua página (/restaurantes/<id>); por enquanto só os Cardápios, que vêm do
// projeto da casa (cardapios_vivos = editar na tela; cardapios_impressos = PDFs para imprimir).
// Restaurante novo: uma linha aqui (o projeto é onde ficam os menus e os PDFs no bucket).

export type Restaurante = { id: string; nome: string; casa: string; projeto: string };

export const RESTAURANTES: Restaurante[] = [
  { id: "ponta-negra", nome: "Ponta Negra", casa: "Cicchetti Ponta Negra", projeto: "b648cc8b-8f21-4d52-84ab-3c664e7cae04" },
];

export const restaurante = (id: string) => RESTAURANTES.find((r) => r.id === id);
