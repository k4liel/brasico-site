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
    <html lang="pt-BR" data-theme="dark" className={`${inter.variable} ${lora.variable}`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes de pintar a tela (sem piscar). Padrão: escuro. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `var t="dark";try{var s=localStorage.getItem("brasico-tema-v2");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.dataset.theme=t`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
