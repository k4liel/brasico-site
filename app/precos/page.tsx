import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PaginaPrecos from "@/components/PaginaPrecos";

export const dynamic = "force-dynamic";

// Índice de preços: página própria dentro de Operação (15/11/2026; antes era uma aba da página Notas).
export default async function PrecosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <PaginaPrecos userId={user.id} userEmail={user.email ?? ""} />;
}
