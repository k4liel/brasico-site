import type { Metadata } from "next";
import Publico from "@/components/Publico";

// Link público de um projeto: abre sem login e mostra só o documento.
export const metadata: Metadata = {
  title: "Projeto",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Publico slug={slug} />;
}
