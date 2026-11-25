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
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }) },
  });
  // Erro do banco ou do armazenamento = 503 sem guardar (a Vercel segue entregando a última cópia boa);
  // 404 só quando o banco respondeu que o cardápio não existe ou está pausado.
  const indisponivel = () =>
    new Response("O cardápio está demorando para abrir. Tente de novo em alguns minutos.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  const { data: info, error } = await supabase.rpc("cardapio_publico_arquivo", { p_slug: slug, p_codigo: m[1], p_capa: capa });
  if (error) return indisponivel();
  const i = info as { caminho: string; nome: string } | null;
  if (!i?.caminho) return new Response("Este cardápio não está disponível.", { status: 404, headers: { "Cache-Control": "no-store" } });

  const { data: blob } = await supabase.storage.from("workspace-files").download(i.caminho);
  if (!blob) return indisponivel();
  const dados = new Uint8Array(await blob.arrayBuffer());

  const baixar = new URL(req.url).searchParams.has("baixar");
  const nome = `${i.nome}.${m[2]}`;
  const ascii = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .()-]/g, "-");
  return new Response(dados as BodyInit, {
    headers: {
      "Content-Type": capa ? "image/jpeg" : "application/pdf",
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      // O navegador sempre pergunta de novo (o PDF pode ser trocado a qualquer hora); a Vercel guarda uma
      // cópia por 1 minuto e, se o banco travar, continua entregando a última boa (25/11/2026).
      "Cache-Control": capa ? "public, max-age=300" : "public, max-age=0, must-revalidate",
      "CDN-Cache-Control": "max-age=60, stale-while-revalidate=604800, stale-if-error=604800",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
