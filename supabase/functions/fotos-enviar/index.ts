// Envia fotos de pratos para o bucket privado workspace-files, na pasta <projeto>/fotos/.
// Uso do Claude (ex.: fotos extraídas de uma planilha de fichas técnicas), nunca do site.
// Só aceita JPG/PNG/WebP de até 3 MB, só em <id do projeto>/fotos/<nome>, e só com o segredo
// fotos_segredo do Vault (conferido no banco por fotos_segredo_ok). Depois de usar, troque o
// segredo para um valor aleatório: assim a função fica desligada até a próxima vez.
// Esquema em supabase/fotos_enviar.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const TIPOS: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Use POST" }, 405);

  const segredo = req.headers.get("x-segredo") ?? "";
  const { data: ok } = await supabase.rpc("fotos_segredo_ok", { p_segredo: segredo });
  if (ok !== true) return responder({ erro: "Sem permissão." }, 401);

  const corpo = await req.json().catch(() => ({}));
  const caminho = String(corpo.caminho ?? "");
  const m = caminho.match(/^([0-9a-f-]{36})\/fotos\/([a-z0-9_\-]{1,80})\.(jpg|jpeg|png|webp)$/);
  if (!m) return responder({ erro: "Caminho inválido: use <id do projeto>/fotos/<nome>.jpg" }, 400);

  const { data: projeto } = await supabase.from("workspaces").select("id").eq("id", m[1]).is("removido_em", null).maybeSingle();
  if (!projeto) return responder({ erro: "Projeto não encontrado." }, 404);

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(String(corpo.base64 ?? "")), (c) => c.charCodeAt(0));
  } catch {
    return responder({ erro: "Arquivo inválido (base64)." }, 400);
  }
  if (bytes.length === 0 || bytes.length > 3 * 1024 * 1024) return responder({ erro: "Arquivo vazio ou maior que 3 MB." }, 400);

  const { error } = await supabase.storage.from("workspace-files").upload(caminho, bytes, {
    contentType: TIPOS[m[3]],
    upsert: corpo.substituir === true,
  });
  if (error) return responder({ erro: error.message }, 400);
  return responder({ ok: true, caminho, tamanho: bytes.length });
});
