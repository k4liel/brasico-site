import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Projeto from "@/components/Projeto";

export const dynamic = "force-dynamic";

export default async function ProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Projeto projectId={id} userId={user.id} userEmail={user.email ?? ""} />;
}
