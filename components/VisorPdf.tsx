"use client";

import { useEffect, useState } from "react";

type Doc = { url: string; titulo: string; codigo: string };

// Abre numa janela por cima da página qualquer PDF marcado com data-pdf
// dentro do documento (blocos :::arquivos).
export default function VisorPdf() {
  const [doc, setDoc] = useState<Doc | null>(null);
  // Android não mostra PDF dentro da página: lá o visor oferece abrir no leitor do aparelho.
  const [semVisor, setSemVisor] = useState(false);
  useEffect(() => setSemVisor(/Android/i.test(navigator.userAgent)), []);

  useEffect(() => {
    const abrir = (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-pdf]");
      const url = alvo?.dataset.pdf;
      if (!alvo || !url || !(url.startsWith("/api/arquivo/") || url.startsWith("/api/publico/"))) return;
      e.preventDefault();
      setDoc({ url, titulo: alvo.dataset.titulo ?? "", codigo: alvo.dataset.codigo ?? "" });
    };
    document.addEventListener("click", abrir);
    return () => document.removeEventListener("click", abrir);
  }, []);

  useEffect(() => {
    if (!doc) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDoc(null);
    window.addEventListener("keydown", esc);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = antes;
    };
  }, [doc]);

  if (!doc) return null;
  return (
    <div className="visor-fundo" onClick={() => setDoc(null)}>
      <div className="visor" role="dialog" aria-modal="true" aria-label={doc.titulo} onClick={(e) => e.stopPropagation()}>
        <div className="visor-topo">
          <div className="visor-titulo">
            {doc.codigo && <span className="visor-cod">{doc.codigo}</span>}
            <b>{doc.titulo}</b>
          </div>
          <a className="visor-botao" href={doc.url} target="_blank" rel="noopener">Nova aba</a>
          <a className="visor-botao" href={`${doc.url}?baixar=1`}>Baixar</a>
          <button className="visor-fechar" onClick={() => setDoc(null)} aria-label="Fechar">×</button>
        </div>
        {semVisor ? (
          <div className="visor-alt">
            <img src={doc.url.replace(/\/([^/]+)\.pdf$/, "/capas/$1.jpg")} alt="" />
            <a className="visor-abrir" href={doc.url} target="_blank" rel="noopener">Abrir o PDF</a>
          </div>
        ) : (
          <iframe className="visor-pdf" src={`${doc.url}#view=FitH`} title={doc.titulo} />
        )}
      </div>
    </div>
  );
}
