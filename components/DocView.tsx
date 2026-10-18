import type { ReactNode } from "react";
import { renderConteudo } from "@/lib/livre";
import EscalaDica from "./EscalaDica";

export type Capitulo = { id?: string; titulo: string; conteudo: string };

type Folha = { cap: Capitulo; idx: number; capa: boolean; md: string };

// Um capítulo com :::capa vira duas folhas: a capa azul e o restante.
function montarFolhas(capitulos: Capitulo[]): Folha[] {
  const folhas: Folha[] = [];
  capitulos.forEach((cap, idx) => {
    const m = cap.conteudo.match(/^\s*(:::capa[\s\S]*?\n:::\s*)(?:\n|$)([\s\S]*)$/);
    if (m) {
      folhas.push({ cap, idx, capa: true, md: m[1] });
      if (m[2].trim()) folhas.push({ cap, idx, capa: false, md: m[2] });
    } else {
      folhas.push({ cap, idx, capa: false, md: cap.conteudo });
    }
  });
  return folhas;
}

export default function DocView({
  capitulos,
  rodape,
  acoes,
  modo = "pdf",
}: {
  capitulos: Capitulo[];
  rodape?: string | null;
  acoes?: (cap: Capitulo, idx: number) => ReactNode;
  modo?: "pdf" | "pagina";
}) {
  // Modo página: o documento corre livre, como um site, sem folhas A4.
  if (modo === "pagina") {
    return (
      <article className="doc doc-pagina">
        {montarFolhas(capitulos).map((f, n, todas) => {
          const primeira = n === 0 || todas[n - 1].idx !== f.idx;
          return (
            <section
              key={`${f.cap.id ?? f.idx}-${n}`}
              id={primeira && f.cap.id ? `cap-${f.cap.id}` : undefined}
              className={f.capa ? "secao secao-capa" : "secao"}
            >
              {acoes && primeira && <div className="folha-acoes nao-imprimir">{acoes(f.cap, f.idx)}</div>}
              <div dangerouslySetInnerHTML={{ __html: renderConteudo(f.md) }} />
            </section>
          );
        })}
        {rodape && <footer className="doc-pagina-rodape">{rodape}</footer>}
        <EscalaDica />
      </article>
    );
  }

  const folhas = montarFolhas(capitulos);
  // Numeração como no PDF: a capa não conta como página.
  const offset = folhas[0]?.capa ? 0 : 1;
  const total = folhas.length - (folhas[0]?.capa ? 1 : 0);
  let ultimoCap = -1;

  // Rodapé do PDF impresso (texto à esquerda em todas as páginas)
  const css = rodape
    ? `@page { @bottom-left { content: "${rodape.replace(/[\\"]/g, "").replace(/[\n\r<>]/g, " ")}"; font-family: Inter, system-ui, sans-serif; font-size: 7.5pt; color: #6b7385; } }`
    : "";

  return (
    <div className="doc">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <EscalaDica />
      {folhas.map((f, n) => {
        const primeiraDoCap = f.idx !== ultimoCap;
        ultimoCap = f.idx;
        return (
          <section
            key={`${f.cap.id ?? f.idx}-${n}`}
            id={f.cap.id ? `cap-${f.cap.id}` : undefined}
            className={f.capa ? "folha folha-capa" : "folha"}
          >
            {acoes && primeiraDoCap && <div className="folha-acoes nao-imprimir">{acoes(f.cap, f.idx)}</div>}
            <div className="folha-corpo" dangerouslySetInnerHTML={{ __html: renderConteudo(f.md) }} />
            {!f.capa && (
              <div className="folha-rodape">
                <span>{rodape ?? ""}</span>
                <span>
                  pág. {n + offset} de {total}
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
