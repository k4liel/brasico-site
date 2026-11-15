import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Operacao from "@/components/hotel/Operacao";

export const dynamic = "force-dynamic";

// Operação do hotel: a área de criação (recepção, governança, CRM…). O acesso é conferido no banco (op_nivel).
const NOMES: Record<string, string> = { "filha-da-lua": "Filha da Lua", "sempre-vivo": "Sempre Vivo" };

export default async function OperacaoPage({ params, searchParams }: {
  params: Promise<{ hotel: string; tela?: string[] }>; searchParams: Promise<{ rascunho?: string }>;
}) {
  const { hotel, tela } = await params;
  const { rascunho } = await searchParams;
  if (!NOMES[hotel] || (tela && tela.length > 1)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <Operacao hotel={hotel} nome={NOMES[hotel]} slug={tela?.[0] ?? null} userEmail={user.email ?? ""} verRascunho={rascunho === "1"} />;
}
