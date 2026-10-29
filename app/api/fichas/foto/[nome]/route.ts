import { createClient } from "@/lib/supabase/server";

// Fotos das fichas técnicas enviadas pela página /fichas. Ficam no bucket
// privado fichas-fotos e só abrem para quem vê as fichas (notas_pode_ver,
// conferido também pela regra do próprio armazenamento).
// Caminho: /api/fichas/foto/<arquivo>.jpg

export const runtime = "nodejs";

const BUCKET = "fichas-fotos";
const TIPOS: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
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
  const { data: pode } = await supabase.rpc("notas_pode_ver", { p_user: user.id });
  if (!pode) return new Response("Sem acesso às fichas.", { status: 403 });

  const { data: blob } = await supabase.storage.from(BUCKET).download(nome);
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
