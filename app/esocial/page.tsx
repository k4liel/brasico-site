import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ESocial from "@/components/ESocial";

export const dynamic = "force-dynamic";

export default async function ESocialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <ESocial userId={user.id} userEmail={user.email ?? ""} />;
}
