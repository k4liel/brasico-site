import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EscalaLider from "@/components/EscalaLider";

export const dynamic = "force-dynamic";

export default async function EscalaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/colaboradores");

  return <EscalaLider userEmail={user.email ?? ""} />;
}
