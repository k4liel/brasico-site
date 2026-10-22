import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Certificados from "@/components/Certificados";

export const dynamic = "force-dynamic";

export default async function CertificadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Certificados userId={user.id} userEmail={user.email ?? ""} />;
}
