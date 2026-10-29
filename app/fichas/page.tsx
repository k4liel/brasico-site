import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Fichas from "@/components/Fichas";

export const dynamic = "force-dynamic";

export default async function FichasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Fichas userId={user.id} userEmail={user.email ?? ""} />;
}
