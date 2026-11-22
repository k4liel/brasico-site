import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import MenusPublicos, { type MenuPublico } from "@/components/MenusPublicos";
import { createClient } from "@supabase/supabase-js";

// Página pública dos cardápios de uma casa (22/11/2026, pedido do dono: "uma página que fique aberta para
// qualquer um que tiver o link baixar ... sempre atualizado", para o grupo da casa e o marketing).
// Sem login; mostra só os PDFs ativos (cardapios_publicos). O link e cada PDF têm endereço fixo.

export const dynamic = "force-dynamic";

type Dados = { nome: string; menus: MenuPublico[] };

async function ler(slug: string): Promise<Dados | null> {
  if (!/^[a-z0-9][a-z0-9-]{11,79}$/.test(slug)) return null;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.rpc("cardapios_publicos", { p_slug: slug });
  return (data as Dados | null) ?? null;
}

// Prévia do link (WhatsApp etc.) e ícone da aba com o selo CCHT, não a marca do Brasico (22/11/2026, pedido
// do dono: "lá é só de menu ... é legal não misturar"). Arquivos em public/marcas/ccht-*.png.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await ler(slug);
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "brasico.vercel.app"}`;
  const titulo = d ? `Cardápios · ${d.nome}` : "Cardápios";
  const descricao = d ? `Baixe os cardápios do ${d.nome} em PDF, sempre na versão atual.` : "Cardápios em PDF.";
  const selo = { url: `${base}/marcas/ccht-selo.png`, width: 1024, height: 1024, alt: "CCHT", type: "image/png" };
  return {
    metadataBase: new URL(base),
    title: titulo,
    description: descricao,
    applicationName: d?.nome ?? "Cardápios",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    icons: {
      icon: [
        { url: "/marcas/ccht-icone-32.png", sizes: "32x32", type: "image/png" },
        { url: "/marcas/ccht-icone-64.png", sizes: "64x64", type: "image/png" },
      ],
      apple: [{ url: "/marcas/ccht-selo-180.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: { type: "website", url: `${base}/menus/${slug}`, title: titulo, description: descricao, siteName: d?.nome ?? "Cardápios", locale: "pt_BR", images: [selo] },
    twitter: { card: "summary", title: titulo, description: descricao, images: [selo.url] },
  };
}

const data = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Fortaleza" });

export default async function MenusPublicosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await ler(slug);
  if (!d) notFound();
  const recente = d.menus.reduce((m, x) => (x.atualizado_em > m ? x.atualizado_em : m), "");
  const cicchetti = /cicchetti/i.test(d.nome);

  return (
    <div className="mp">
      <header className="mp-cab">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cicchetti && <img className="mp-logo" src="/marcas/cicchetti.png" alt="Cicchetti" width={147} height={130} />}
        <span className="mp-olho">{d.nome}</span>
        <h1>Cardápios</h1>
        <p>Veja, baixe ou compartilhe cada cardápio. Este endereço é sempre o mesmo: quando um cardápio muda, o arquivo daqui já é o novo.</p>
        {recente && <span className="mp-atual">Atualizado em {data(recente)}</span>}
      </header>

      <MenusPublicos slug={slug} nome={d.nome} menus={d.menus} />

      <footer className="mp-rodape">{d.nome}</footer>
    </div>
  );
}
