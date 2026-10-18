import path from "node:path";
import { createClient } from "@/lib/supabase/server";

// Arquivos privados de um projeto (PDFs e capas). Ficam no armazenamento do
// Supabase (bucket privado workspace-files, pasta <projeto>/...) e só abrem
// para quem é da equipe do projeto (a regra de acesso do próprio Supabase).
// Caminho: /api/arquivo/<projeto>/<pasta>/<arquivo>.pdf  ou  .../capas/<arquivo>.jpg

export const runtime = "nodejs";

const BUCKET = "workspace-files";
const TIPOS: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTE = /^[a-z0-9][a-z0-9_-]*(\.(pdf|jpg|png))?$/;

export async function GET(req: Request, { params }: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await params;
  const [projeto, ...resto] = caminho ?? [];
  if (!projeto || !UUID.test(projeto) || !resto.length || resto.length > 3 || !resto.every((p) => PARTE.test(p)))
    return new Response("Não encontrado", { status: 404 });
  const ext = path.extname(resto[resto.length - 1]);
  if (!TIPOS[ext]) return new Response("Não encontrado", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Entre no Brasico para ver este arquivo.", { status: 401 });
  const { data: membro } = await supabase.rpc("is_member", { ws: projeto });
  if (!membro) return new Response("Você não faz parte deste projeto.", { status: 403 });

  const chave = [projeto, ...resto].join("/");
  const { data: blob } = await supabase.storage.from(BUCKET).download(chave);
  if (!blob) return new Response("Arquivo não encontrado.", { status: 404 });
  const dados = new Uint8Array(await blob.arrayBuffer());

  const baixar = new URL(req.url).searchParams.has("baixar");
  const nome = resto[resto.length - 1];
  return new Response(dados as BodyInit, {
    headers: {
      "Content-Type": TIPOS[ext],
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${nome}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
