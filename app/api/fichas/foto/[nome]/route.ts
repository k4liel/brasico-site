import { createClient } from "@/lib/supabase/server";

// Fotos das fichas técnicas enviadas pela página /fichas. Ficam no bucket
// privado fichas-fotos e só abrem para quem vê as fichas (fichas_pode,
// conferido também pela regra do próprio armazenamento).
// Caminho: /api/fichas/foto/<arquivo>.jpg
// As 154 fotos que vieram do projeto Fichas técnicas continuam no bucket
// workspace-files, pasta <projeto antigo>/fotos/. O projeto foi excluído para
// sempre (20/11/2026), então elas não abrem mais por /api/arquivo: se a foto
// não está em fichas-fotos, é lida de lá (política "fichas fotos antigas ver",
// supabase/fichas_fotos_antigas.sql). Não apague essa pasta.

export const runtime = "nodejs";

const BUCKET = "fichas-fotos";
const TIPOS: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ANTIGAS = "110ba821-787e-4535-a3f8-836884934e84/fotos/";
const NOME = /^[a-z0-9][a-z0-9_-]{0,100}\.(jpg|png|webp)$/;

export async function GET(_req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const { nome } = await params;
  const m = nome?.match(NOME);
  if (!m) return new Response("Não encontrado", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Entre no Brasico para ver esta foto.", { status: 401 });
  const { data: pode } = await supabase.rpc("fichas_pode", { p_user: user.id });
  if (!pode) return new Response("Sem acesso às fichas.", { status: 403 });

  let { data: blob } = await supabase.storage.from(BUCKET).download(nome);
  if (!blob) ({ data: blob } = await supabase.storage.from("workspace-files").download(ANTIGAS + nome));
  if (!blob) return new Response("Foto não encontrada.", { status: 404 });
  return new Response(new Uint8Array(await blob.arrayBuffer()) as BodyInit, {
    headers: {
      "Content-Type": TIPOS[m[1]],
      "Content-Disposition": `inline; filename="${nome}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
