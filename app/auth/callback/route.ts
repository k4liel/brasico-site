import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Link por e-mail (só na área dos sócios). Quem é da equipe das casas entra só por /colaboradores.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: papel } = await supabase.rpc("operacao_papel", { p_user: data.user.id });
      if (["solicitante", "compras", "estoque"].includes(String(papel ?? ""))) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/colaboradores?erro=area`);
      }
      return NextResponse.redirect(`${origin}/`);
    }
  }
  return NextResponse.redirect(`${origin}/login?erro=link`);
}
