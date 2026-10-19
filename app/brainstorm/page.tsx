import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Brainstorm from "@/components/Brainstorm";

export const dynamic = "force-dynamic";

export default async function BrainstormPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Brainstorm userId={user.id} userEmail={user.email ?? ""} />;
}
