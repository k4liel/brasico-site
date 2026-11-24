import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Avaliacoes from "@/components/Avaliacoes";

export const dynamic = "force-dynamic";

export default async function AvaliacoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Avaliacoes userEmail={user.email ?? ""} />;
}
