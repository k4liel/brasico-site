import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Totvs from "@/components/Totvs";

export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Totvs userId={user.id} userEmail={user.email ?? ""} />;
}
