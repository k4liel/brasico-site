"use client";

import { useEffect, useRef } from "react";

// O PDF de uma nota (NFC-e, CT-e) numa janela por cima da tela, no mesmo visual do PDF da NF-e; Esc ou clicar fora fecha
export default function JanelaPdfNota({ url, titulo, subtitulo, arquivo, onFechar }: {
  url: string; titulo: string; subtitulo?: string; arquivo: string; onFechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [onFechar]);
  return (
    <div className="nf-pdf-fundo" onClick={onFechar}>
      <div className="nf-pdf" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={caixa} onClick={(e) => e.stopPropagation()}>
        <header className="nf-pdf-cabeca">
          <span><strong>{titulo}</strong>{subtitulo && <small>{subtitulo}</small>}</span>
          <span className="nf-pdf-acoes">
            <a className="botao small" href={url} target="_blank" rel="noreferrer">Abrir em outra aba</a>
            <a className="botao small ghost" href={url} download={arquivo}>Baixar</a>
            <button className="ghost small" onClick={onFechar} aria-label="Fechar o PDF">Fechar</button>
          </span>
        </header>
        <iframe className="nf-pdf-quadro" src={url} title={titulo} />
      </div>
    </div>
  );
}
