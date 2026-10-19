import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Arquivos de um projeto com link público ativo (PDFs e capas), sem login.
// Caminho: /api/publico/<código do link>/<projeto>/<pasta>/<arquivo>.pdf
// Só abre se o código estiver ativo e o arquivo for daquele mesmo projeto.

export const runtime = "nodejs";

const BUCKET = "workspace-files";
const TIPOS: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png" };
const SLUG = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTE = /^[a-z0-9][a-z0-9_-]*(\.(pdf|jpg|png))?$/;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; caminho: string[] }> }) {
  const { slug, caminho } = await params;
  const [projeto, ...resto] = caminho ?? [];
  if (!SLUG.test(slug ?? "") || !projeto || !UUID.test(projeto) || !resto.length || resto.length > 3 || !resto.every((p) => PARTE.test(p)))
    return new Response("Não encontrado", { status: 404 });
  const ext = path.extname(resto[resto.length - 1]);
  if (!TIPOS[ext]) return new Response("Não encontrado", { status: 404 });

  // Cliente sem sessão: vale a regra pública, mesmo que o visitante esteja logado em outra conta
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: id } = await supabase.rpc("projeto_publico", { p_slug: slug });
  if (!id || id !== projeto) return new Response("Link indisponível.", { status: 404 });

  const { data: blob } = await supabase.storage.from(BUCKET).download([projeto, ...resto].join("/"));
  if (!blob) return new Response("Arquivo não encontrado.", { status: 404 });
  const dados = new Uint8Array(await blob.arrayBuffer());

  const baixar = new URL(req.url).searchParams.has("baixar");
  const nome = resto[resto.length - 1];
  return new Response(dados as BodyInit, {
    headers: {
      "Content-Type": TIPOS[ext],
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${nome}"`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
