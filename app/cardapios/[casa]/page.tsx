import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { restaurante } from "@/lib/restaurantes";
import Cardapios from "@/components/restaurante/Cardapios";

export const dynamic = "force-dynamic";

// Menu → Menus → <casa> (25/11/2026): editar na tela × PDFs para imprimir e o link público, uma aba por casa
export default async function MenusCasaPage({ params }: { params: Promise<{ casa: string }> }) {
  const { casa } = await params;
  const r = restaurante(casa);
  if (!r) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <Cardapios casa={r.id} nome={r.casa} projeto={r.projeto} userEmail={user.email ?? ""} />;
}
