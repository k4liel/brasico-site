import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Notas from "@/components/Notas";

export const dynamic = "force-dynamic";

export default async function NotasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Notas userId={user.id} userEmail={user.email ?? ""} />;
}
