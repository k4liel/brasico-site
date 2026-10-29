import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Estoque from "@/components/Estoque";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Estoque userId={user.id} userEmail={user.email ?? ""} />;
}
