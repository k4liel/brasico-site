import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Se o Supabase devolver o login para outra página (ex.: a raiz do site,
  // quando a Redirect URL não está cadastrada), encaminha o código para o callback.
  const code = request.nextUrl.searchParams.get("code");
  if (code && !request.nextUrl.pathname.startsWith("/auth/callback")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    url.search = `?code=${encodeURIComponent(code)}`;
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // /p/<código>: link público de um projeto (só leitura, sem login)
  if (path.startsWith("/p/")) return response;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Solicitantes e setor de compras (operacao_pessoas) só abrem as Compras e o Estoque;
  // quem é só da câmara fria (papel estoque), só o Estoque e a Produção.
  // A trava de verdade é a do banco (RLS): aqui é só o caminho certo na tela.
  if (user && !isPublic && !path.startsWith("/estoque") && !path.startsWith("/producao")) {
    const { data: papel } = await supabase.rpc("operacao_papel", { p_user: user.id });
    const destino = papel === "estoque" ? "/estoque" : papel === "solicitante" || papel === "compras" ? "/compras" : null;
    if (destino && !path.startsWith(destino)) {
      const url = request.nextUrl.clone();
      url.pathname = destino;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // A rota do Claude (/api/...) tem autenticação própria por token.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
