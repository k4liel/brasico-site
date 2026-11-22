"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Página pública dos cardápios (/menus/<código>): cartões com Baixar PDF, Ver e Compartilhar.
// Ver (22/11/2026, pedido do dono): abre o cardápio numa janela por cima da página, sem sair dela, com
// Baixar e Compartilhar. As páginas são desenhadas com o pdf.js (no celular o navegador não mostra PDF
// dentro da página). Compartilhar usa o menu de compartilhar do telefone (WhatsApp ou o que a pessoa
// quiser); no computador, sem esse menu, oferece WhatsApp e Copiar link. O link compartilhado de um
// cardápio é a página com ?ver=<código>, que já abre a janela daquele cardápio (e mostra a prévia CCHT).

export type MenuPublico = { codigo: string; titulo: string; descricao: string; formato: string; paginas: number | null; atualizado_em: string };

const data = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Fortaleza" });

const Icone = {
  baixar: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />,
  ver: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  compartilhar: <><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" /></>,
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  whatsapp: <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z" />,
  copiar: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
};
const Svg = ({ d }: { d: React.ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;

// ---------------------------------------------------------------------
// Compartilhar: menu do telefone; sem ele, WhatsApp e Copiar link
// ---------------------------------------------------------------------
function Compartilhar({ titulo, texto, url, arquivo, classe = "mp-botao", rotulo = "Compartilhar" }: {
  titulo: string; texto: string; url: string; arquivo?: () => File | null; classe?: string; rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  async function clicar() {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share) {
      // com o PDF já carregado (janela Ver), manda o próprio arquivo quando o telefone aceita
      const f = arquivo?.();
      const comArquivo: ShareData | null = f ? { title: titulo, text: `${texto}\n${url}`, files: [f] } : null;
      try {
        if (comArquivo && nav.canShare?.(comArquivo)) await nav.share(comArquivo);
        else await nav.share({ title: titulo, text: texto, url });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return; // a pessoa fechou o menu
      }
    }
    setAberto((a) => !a);
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt("Copie o link:", url);
    }
    setCopiado(true);
    setTimeout(() => { setCopiado(false); setAberto(false); }, 1400);
  }

  return (
    <div className="mp-compartilhar" ref={caixa}>
      <button type="button" className={classe} onClick={clicar} aria-haspopup="menu" aria-expanded={aberto}>
        <Svg d={Icone.compartilhar} />
        {rotulo && <span>{rotulo}</span>}
      </button>
      {aberto && (
        <div className="mp-menu" role="menu">
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(`${texto}\n${url}`)}`} target="_blank" rel="noreferrer" onClick={() => setAberto(false)}>
            <Svg d={Icone.whatsapp} /> WhatsApp
          </a>
          <button role="menuitem" type="button" onClick={copiar}>
            <Svg d={Icone.copiar} /> {copiado ? "Link copiado ✓" : "Copiar link"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Janela Ver: as páginas do PDF desenhadas na tela
// ---------------------------------------------------------------------
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPagina>; destroy: () => Promise<void> };
type PdfPagina = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

async function abrirPdf(dados: Uint8Array): Promise<PdfDoc> {
  // o "worker" do pdf.js roda na própria página (globalThis.pdfjsWorker), carregado só quando alguém clica em Ver
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return (await pdfjs.getDocument({ data: dados, isEvalSupported: false }).promise) as unknown as PdfDoc;
}

function Visor({ menu, nome, slug, url, fechar }: { menu: MenuPublico; nome: string; slug: string; url: string; fechar: () => void }) {
  const base = `/api/menus/${slug}/${menu.codigo}`;
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [erro, setErro] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [largura, setLargura] = useState(0);
  const corpo = useRef<HTMLDivElement>(null);
  const bytes = useRef<Uint8Array | null>(null);

  // baixa o PDF uma vez e abre no pdf.js
  useEffect(() => {
    let vivo = true;
    let aberto: PdfDoc | null = null;
    (async () => {
      try {
        const r = await fetch(`${base}.pdf`);
        if (!r.ok) throw new Error(String(r.status));
        const b = new Uint8Array(await r.arrayBuffer());
        bytes.current = b.slice();
        aberto = await abrirPdf(b);
        if (vivo) setDoc(aberto);
        else aberto.destroy();
      } catch {
        if (vivo) setErro(true);
      }
    })();
    return () => {
      vivo = false;
      aberto?.destroy();
    };
  }, [base]);

  // largura disponível (refaz ao girar o telefone ou mudar a janela)
  useEffect(() => {
    const el = corpo.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc fecha; a página de trás não rola
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", esc);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = antes;
    };
  }, [fechar]);

  const arquivo = useCallback(() => {
    if (!bytes.current) return null;
    const ab = bytes.current.buffer.slice(bytes.current.byteOffset, bytes.current.byteOffset + bytes.current.byteLength) as ArrayBuffer;
    return new File([ab], `${nome} - ${menu.titulo}.pdf`, { type: "application/pdf" });
  }, [nome, menu.titulo]);

  const texto = `Cardápio ${menu.titulo} · ${nome}`;
  const n = doc?.numPages ?? menu.paginas ?? 1;

  return (
    <div className="mp-visor-fundo" onClick={fechar}>
      <div className="mp-visor" role="dialog" aria-modal="true" aria-label={menu.titulo} onClick={(e) => e.stopPropagation()}>
        <header className="mp-visor-topo">
          <div className="mp-visor-titulo">
            <b>{menu.titulo}</b>
            <span>{[menu.formato, `${n} ${n > 1 ? "páginas" : "página"}`].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="mp-visor-zoom" aria-label="Tamanho">
            <button type="button" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1} aria-label="Diminuir"><Svg d={Icone.menos} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} disabled={zoom >= 3} aria-label="Ampliar"><Svg d={Icone.mais} /></button>
          </div>
          <div className="mp-visor-acoes">
            <Compartilhar titulo={texto} texto={texto} url={url} arquivo={arquivo} classe="mp-botao" />
            <a className="mp-botao forte" href={`${base}.pdf?baixar`}><Svg d={Icone.baixar} /><span>Baixar PDF</span></a>
            <button type="button" className="mp-visor-fechar" onClick={fechar} aria-label="Fechar"><Svg d={Icone.fechar} /></button>
          </div>
        </header>
        <div className="mp-visor-corpo" ref={corpo}>
          {erro ? (
            <div className="mp-visor-aviso">
              Não foi possível mostrar o cardápio aqui. <a href={`${base}.pdf`} target="_blank" rel="noreferrer">Abrir o PDF</a>
            </div>
          ) : !doc || !largura ? (
            <div className="mp-visor-carregando">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${base}.jpg`} alt="" />
              <span>Abrindo o cardápio…</span>
            </div>
          ) : (
            <div className="mp-visor-paginas" style={{ width: Math.round(Math.min(largura - 24, 1400) * zoom) }}>
              {Array.from({ length: doc.numPages }, (_, i) => (
                <Pagina key={i} doc={doc} numero={i + 1} largura={Math.round(Math.min(largura - 24, 1400) * zoom)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pagina({ doc, numero, largura }: { doc: PdfDoc; numero: number; largura: number }) {
  const tela = useRef<HTMLCanvasElement>(null);
  const [proporcao, setProporcao] = useState<number | null>(null);
  useEffect(() => {
    let tarefa: { cancel: () => void } | null = null;
    let vivo = true;
    const t = setTimeout(async () => {
      const p = await doc.getPage(numero);
      if (!vivo || !tela.current) return;
      const v1 = p.getViewport({ scale: 1 });
      setProporcao(v1.height / v1.width);
      // nitidez: tela do aparelho (até 2×), sem passar de ~4000 px de largura
      const px = Math.min(largura * Math.min(window.devicePixelRatio || 1, 2), 4000);
      const vp = p.getViewport({ scale: px / v1.width });
      // desenha fora da tela e só então troca: ao ampliar, a imagem anterior fica até a nova ficar pronta
      const fora = document.createElement("canvas");
      fora.width = Math.floor(vp.width);
      fora.height = Math.floor(vp.height);
      const ctx = fora.getContext("2d");
      if (!ctx) return;
      const r = p.render({ canvasContext: ctx, viewport: vp });
      tarefa = r;
      try {
        await r.promise;
      } catch {
        return;
      }
      const c = tela.current;
      if (!vivo || !c) return;
      c.width = fora.width;
      c.height = fora.height;
      c.getContext("2d")?.drawImage(fora, 0, 0);
    }, 120); // espera o zoom parar de mudar
    return () => {
      vivo = false;
      clearTimeout(t);
      tarefa?.cancel();
    };
  }, [doc, numero, largura]);
  return <canvas ref={tela} className="mp-pagina" style={{ width: largura, height: proporcao ? Math.round(largura * proporcao) : undefined, aspectRatio: proporcao ? undefined : "1.41 / 1" }} />;
}

// ---------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------
export default function MenusPublicos({ slug, nome, menus }: { slug: string; nome: string; menus: MenuPublico[] }) {
  const [vendo, setVendo] = useState<MenuPublico | null>(null);
  const [origem, setOrigem] = useState("");

  const urlDe = useCallback((m?: MenuPublico) => `${origem}/menus/${slug}${m ? `?ver=${m.codigo}` : ""}`, [origem, slug]);

  // ?ver=<código> abre direto a janela daquele cardápio (é o link que se compartilha)
  useEffect(() => {
    setOrigem(window.location.origin);
    const c = new URLSearchParams(window.location.search).get("ver");
    const m = c ? menus.find((x) => x.codigo === c) : undefined;
    if (m) setVendo(m);
  }, [menus]);

  const abrir = (m: MenuPublico) => {
    setVendo(m);
    try { history.replaceState(null, "", `?ver=${m.codigo}`); } catch {}
  };
  const fechar = useCallback(() => {
    setVendo(null);
    try { history.replaceState(null, "", window.location.pathname); } catch {}
  }, []);

  return (
    <>
      <div className="mp-compartilhar-pagina">
        <Compartilhar titulo={`Cardápios · ${nome}`} texto={`Cardápios · ${nome}`} url={urlDe()} rotulo="Compartilhar esta página" classe="mp-botao mp-botao-claro" />
      </div>
      <main className="mp-grade">
        {menus.map((m) => {
          const base = `/api/menus/${slug}/${m.codigo}`;
          return (
            <article key={m.codigo} className="mp-cartao">
              <button type="button" className="mp-capa" onClick={() => abrir(m)} aria-label={`Ver ${m.titulo}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${base}.jpg`} alt="" loading="lazy" />
              </button>
              <div className="mp-info">
                <h2>{m.titulo}</h2>
                {m.descricao && <p>{m.descricao}</p>}
                <span className="mp-meta">
                  {[m.formato, m.paginas ? `${m.paginas} ${m.paginas > 1 ? "páginas" : "página"}` : "", `versão de ${data(m.atualizado_em)}`].filter(Boolean).join(" · ")}
                </span>
                <div className="mp-acoes">
                  <a className="mp-botao forte" href={`${base}.pdf?baixar`}><Svg d={Icone.baixar} /><span>Baixar PDF</span></a>
                  <button type="button" className="mp-botao" onClick={() => abrir(m)}><Svg d={Icone.ver} /><span>Ver</span></button>
                  <Compartilhar titulo={`Cardápio ${m.titulo} · ${nome}`} texto={`Cardápio ${m.titulo} · ${nome}`} url={urlDe(m)} />
                </div>
              </div>
            </article>
          );
        })}
        {menus.length === 0 && <p className="mp-vazio">Nenhum cardápio disponível agora.</p>}
      </main>
      {vendo && <Visor menu={vendo} nome={nome} slug={slug} url={urlDe(vendo)} fechar={fechar} />}
    </>
  );
}
