import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Receita from "@/components/Receita";

export const dynamic = "force-dynamic";

export default async function ReceitaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Receita userId={user.id} userEmail={user.email ?? ""} />;
}
