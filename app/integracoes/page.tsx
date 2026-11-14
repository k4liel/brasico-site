import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Integracoes from "@/components/Integracoes";

export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Integracoes userEmail={user.email ?? ""} />;
}
