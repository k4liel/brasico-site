import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Compras from "@/components/Compras";
import "./compras.css";

export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/colaboradores");

  return <Compras userEmail={user.email ?? ""} />;
}
