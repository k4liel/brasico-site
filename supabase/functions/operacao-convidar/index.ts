// Dá acesso à área de Compras para uma pessoa de operacao_pessoas (supabase/compras.sql).
// Só um sócio logado chama (o token dele vai no Authorization). Cria o login com o e-mail
// cadastrado, já confirmado, sem senha: a pessoa entra pelo "Link por e-mail" da tela de login.
// Se o e-mail já tem login, só liga a pessoa a ele. Nada de senha ou token nos logs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "https://brasico.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return responder({ erro: "Use POST" }, 405);

  // Quem chama precisa ser sócio (conferido no banco com o próprio login dele)
  const auth = req.headers.get("Authorization") ?? "";
  const doUsuario = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: papel } = await doUsuario.rpc("operacao_papel", { p_user: (await doUsuario.auth.getUser()).data.user?.id ?? null });
  if (papel !== "socio") return responder({ erro: "Só os sócios dão acesso à área de Compras." }, 403);

  const corpo = await req.json().catch(() => ({}));
  const pessoaId = String(corpo.pessoa ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(pessoaId)) return responder({ erro: "Pessoa inválida." }, 400);

  const { data: pessoa } = await admin.from("operacao_pessoas").select("id,nome,email,user_id,ativo").eq("id", pessoaId).maybeSingle();
  if (!pessoa || !pessoa.ativo) return responder({ erro: "Pessoa não encontrada." }, 404);
  if (!pessoa.email) return responder({ erro: `Cadastre o e-mail de ${pessoa.nome} antes de dar acesso.` }, 400);
  if (pessoa.user_id) return responder({ ok: true, ja_tinha: true, nome: pessoa.nome });

  let userId: string | null = null;
  const criado = await admin.auth.admin.createUser({ email: pessoa.email, email_confirm: true, user_metadata: { nome: pessoa.nome } });
  if (criado.data.user) userId = criado.data.user.id;
  else {
    // E-mail que já tinha login: procura o usuário e liga a pessoa a ele
    for (let pagina = 1; pagina <= 10 && !userId; pagina++) {
      const { data } = await admin.auth.admin.listUsers({ page: pagina, perPage: 100 });
      const u = data?.users.find((x) => (x.email ?? "").toLowerCase() === pessoa.email!.toLowerCase());
      if (u) userId = u.id;
      if (!data || data.users.length < 100) break;
    }
    if (!userId) return responder({ erro: `Não consegui criar o acesso: ${criado.error?.message ?? "erro desconhecido"}` }, 500);
  }

  const { error } = await admin.rpc("operacao_pessoa_convidada", { p_pessoa: pessoa.id, p_user: userId });
  if (error) return responder({ erro: `Acesso criado, mas não consegui ligar a pessoa: ${error.message}` }, 500);
  console.log(JSON.stringify({ funcao: "operacao-convidar", pessoa: pessoa.id }));
  return responder({ ok: true, nome: pessoa.nome });
});
