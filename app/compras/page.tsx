import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Compras from "@/components/Compras";

export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Compras userEmail={user.email ?? ""} />;
}
