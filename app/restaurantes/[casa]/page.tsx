import { redirect } from "next/navigation";

// Endereço antigo (Hotels & Restaurants → Ponta Negra): os menus agora ficam na página Menus
export default async function RestaurantePage({ params }: { params: Promise<{ casa: string }> }) {
  const { casa } = await params;
  redirect(`/cardapios/${casa}`);
}
