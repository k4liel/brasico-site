import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Hotel from "@/components/Hotel";

export const dynamic = "force-dynamic";

// Nomes dos hotéis do menu (o nome de verdade vem da tabela hoteis)
const NOMES: Record<string, string> = { "filha-da-lua": "Filha da Lua", "sempre-vivo": "Sempre Vivo", "filho-do-vento": "Filho do Vento" };

export default async function HotelPage({ params }: { params: Promise<{ hotel: string }> }) {
  const { hotel } = await params;
  if (!NOMES[hotel]) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Hotel hotel={hotel} nome={NOMES[hotel]} userEmail={user.email ?? ""} />;
}
