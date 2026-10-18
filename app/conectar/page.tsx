import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Conectar from "@/components/Conectar";

export const dynamic = "force-dynamic";

export default async function ConectarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Conectar userId={user.id} userEmail={user.email ?? ""} />;
}
