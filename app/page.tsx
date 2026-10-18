import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Central from "@/components/Central";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <Central userId={user.id} userEmail={user.email ?? ""} />;
}
