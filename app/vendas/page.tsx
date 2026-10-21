import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Vendas from "@/components/Vendas";

export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Vendas userId={user.id} userEmail={user.email ?? ""} />;
}
