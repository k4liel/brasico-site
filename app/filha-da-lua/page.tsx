import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FilhaDaLua from "@/components/FilhaDaLua";

export const dynamic = "force-dynamic";

export default async function FilhaDaLuaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <FilhaDaLua userEmail={user.email ?? ""} />;
}
