import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SkillsContabeis from "@/components/SkillsContabeis";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <SkillsContabeis userEmail={user.email ?? ""} />;
}
