// Envia uma mensagem de texto pelo número da Brasico, a partir do site (Menu → WhatsApp).
// Só funciona com o envio LIGADO em wa_ajustes e para quem está em wa_acesso (os sócios).
// O endereço e a chave da Evolution ficam no Vault (wa_evolution_url / wa_evolution_chave).
// Cada envio fica registrado em wa_envios; a mensagem volta pelo webhook e aparece na conversa.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ erro: "Use POST" }, 405);

  // Quem está pedindo
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await supabase.auth.getUser(jwt);
  const usuario = u?.user;
  if (!usuario) return responder({ erro: "Entre no site de novo." }, 401);
  const { data: acesso } = await supabase.from("wa_acesso").select("user_id").eq("user_id", usuario.id).maybeSingle();
  if (!acesso) return responder({ erro: "Sem acesso ao WhatsApp." }, 403);

  // Envio ligado?
  const { data: ajustes } = await supabase.from("wa_ajustes").select("envio_ativo").eq("id", 1).maybeSingle();
  if (!ajustes?.envio_ativo) return responder({ erro: "O envio pelo site está desligado." }, 403);

  const corpo = await req.json().catch(() => ({}));
  const conversa = String(corpo.conversa ?? "");
  const texto = String(corpo.texto ?? "").trim();
  if (!texto) return responder({ erro: "Mensagem vazia." }, 400);
  if (texto.length > 4000) return responder({ erro: "Mensagem longa demais (máximo 4.000 caracteres)." }, 400);
  const { data: c } = await supabase.from("wa_grupos").select("id,ativo").eq("id", conversa).maybeSingle();
  if (!c) return responder({ erro: "Conversa não encontrada." }, 404);

  const { data: evo } = await supabase.rpc("wa_evolution").maybeSingle<{ url: string; chave: string }>();
  if (!evo?.url || !evo?.chave) return responder({ erro: "Falta configurar a Evolution no Vault." }, 503);

  let ok = false;
  let erro = "";
  let mensagemId = "";
  try {
    const r = await fetch(`${evo.url.replace(/\/$/, "")}/message/sendText/brasico`, {
      method: "POST",
      headers: { apikey: evo.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ number: conversa, text: texto }),
    });
    const resposta = await r.json().catch(() => ({}));
    ok = r.ok;
    mensagemId = resposta?.key?.id ?? "";
    if (!r.ok) erro = String(resposta?.response?.message ?? resposta?.message ?? `Erro ${r.status}`).slice(0, 500);
  } catch (e) {
    erro = String(e).slice(0, 500);
  }

  await supabase.from("wa_envios").insert({ user_id: usuario.id, conversa_id: conversa, texto, ok, erro, mensagem_id: mensagemId });
  return ok ? responder({ ok: true, id: mensagemId }) : responder({ erro: erro || "Não foi possível enviar." }, 502);
});
