import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Usuarios from "@/components/Usuarios";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Usuarios userEmail={user.email ?? ""} />;
}
