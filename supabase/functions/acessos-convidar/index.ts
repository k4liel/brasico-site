// Novo login dos sócios/editores, sem ninguém digitar senha (supabase/acessos_novo_login.sql).
// Só um administrador logado chama (o token dele vai no Authorization). Cria a conta com o e-mail, já confirmada e sem
// senha (ou acha a que já existe) e devolve um link de 1 hora para a própria pessoa criar a senha em /auth/senha.
// O mesmo serve para "esqueci a senha": gera um link novo. Nada de senha, token ou link nos logs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SITE = "https://brasico.vercel.app";
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return responder({ erro: "Use POST" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const quem = (await admin.auth.getUser(jwt)).data.user?.id ?? null;
  if (!quem) return responder({ erro: "Entre no site de novo." }, 401);
  const { data: ehAdmin } = await admin.rpc("acesso_eh_admin", { p_user: quem });
  if (ehAdmin !== true) return responder({ erro: "Só os administradores criam logins." }, 403);

  const corpo = await req.json().catch(() => ({}));
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const nome = String(corpo.nome ?? "").trim().slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ erro: "E-mail inválido." }, 400);
  if (email.endsWith("@usuarios.brasico")) return responder({ erro: "A equipe das casas entra com usuário e senha: crie em Novo usuário." }, 400);

  // conta nova (se o e-mail já tiver login, segue com ele)
  const criado = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: nome ? { nome } : {} });
  const novo = !!criado.data.user;

  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (erroLink || !link?.properties?.hashed_token || !link.user) {
    return responder({ erro: `Não consegui gerar o link: ${erroLink?.message ?? criado.error?.message ?? "erro desconhecido"}` }, 500);
  }
  const { error } = await admin.rpc("acessos_novo_login", { p_user: link.user.id, p_nome: novo ? nome : "", p_por: quem });
  if (error) return responder({ erro: `Conta criada, mas não consegui registrar o acesso: ${error.message}` }, 500);

  console.log(JSON.stringify({ funcao: "acessos-convidar", novo }));
  return responder({ ok: true, novo, user_id: link.user.id, link: `${SITE}/auth/senha#t=${link.properties.hashed_token}` });
});
