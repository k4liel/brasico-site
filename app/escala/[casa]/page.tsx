import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EscalaLider from "@/components/EscalaLider";
import { casaPorId } from "@/lib/escala/casas";

export const dynamic = "force-dynamic";

// Escala de uma casa: /escala/cicchetti-centro, /escala/outras-casas (e a dos hotéis, para os líderes)
export default async function EscalaCasaPage({ params }: { params: Promise<{ casa: string }> }) {
  const { casa } = await params;
  if (!casaPorId(casa)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/colaboradores");

  return <EscalaLider userEmail={user.email ?? ""} casa={casa} />;
}
