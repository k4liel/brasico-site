import { createClient } from "@supabase/supabase-js";

// PDFs (e capas) dos cardápios do link público, sem login (22/11/2026; supabase/cardapios_impressos.sql).
// Caminho: /api/menus/<código do link>/<menu>.pdf  (ou .jpg = capa). O endereço de cada menu é fixo:
// quando o PDF é trocado no banco, o mesmo link já entrega o novo.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{11,79}$/;
const ARQ = /^([a-z0-9][a-z0-9-]{0,60})\.(pdf|jpg)$/;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; arquivo: string }> }) {
  const { slug, arquivo } = await params;
  const m = (arquivo ?? "").match(ARQ);
  if (!SLUG.test(slug ?? "") || !m) return new Response("Não encontrado", { status: 404 });
  const capa = m[2] === "jpg";

  // cliente sem sessão: vale só a regra pública
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: info } = await supabase.rpc("cardapio_publico_arquivo", { p_slug: slug, p_codigo: m[1], p_capa: capa });
  const i = info as { caminho: string; nome: string } | null;
  if (!i?.caminho) return new Response("Este cardápio não está disponível.", { status: 404 });

  const { data: blob } = await supabase.storage.from("workspace-files").download(i.caminho);
  if (!blob) return new Response("Arquivo não encontrado.", { status: 404 });
  const dados = new Uint8Array(await blob.arrayBuffer());

  const baixar = new URL(req.url).searchParams.has("baixar");
  const nome = `${i.nome}.${m[2]}`;
  const ascii = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .()-]/g, "-");
  return new Response(dados as BodyInit, {
    headers: {
      "Content-Type": capa ? "image/jpeg" : "application/pdf",
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      // sempre a versão atual: o PDF pode ser trocado a qualquer hora
      "Cache-Control": capa ? "public, max-age=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
