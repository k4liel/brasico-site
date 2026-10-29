import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Producao from "@/components/Producao";

export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Producao userId={user.id} userEmail={user.email ?? ""} />;
}
