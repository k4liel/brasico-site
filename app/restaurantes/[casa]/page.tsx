import { notFound, redirect } from "next/navigation";
import { restaurante } from "@/lib/restaurantes";

// Página do restaurante: por enquanto só os Cardápios (painéis e outras áreas virão depois)
export default async function RestaurantePage({ params }: { params: Promise<{ casa: string }> }) {
  const { casa } = await params;
  if (!restaurante(casa)) notFound();
  redirect(`/restaurantes/${casa}/cardapios`);
}
