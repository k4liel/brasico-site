import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist lê o texto do relatório de situação fiscal da Receita (lib/receita/pdf.ts); fica fora do bundle
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
