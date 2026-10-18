import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import "./documento.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const lora = Lora({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Brasico",
  description: "Brasico — central de projetos editáveis, conectada ao Claude.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${lora.variable}`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes de pintar a tela (sem piscar) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("brasico-tema");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
