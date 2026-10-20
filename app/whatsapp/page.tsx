import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WhatsApp from "@/components/WhatsApp";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <WhatsApp userId={user.id} userEmail={user.email ?? ""} />;
}
