"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cssDoProjeto } from "@/lib/livre";
import DocView from "./DocView";
import Topo from "./Topo";
import VisorPdf from "./VisorPdf";
import HotelMapa from "./HotelMapa";
import Cabecalho, { type Vista } from "./hotel/Cabecalho";
import VisaoGeral from "./hotel/VisaoGeral";
import Reservas from "./hotel/Reservas";
import Transacoes from "./hotel/Transacoes";
import Bandeira from "./Bandeira";
import Abas, { semNumero } from "./Abas";
import { IDIOMAS, TEXTOS, ehIdioma, type Idioma } from "@/lib/idioma";

// Página de um hotel (grupo Hotéis do menu, /hoteis/<hotel>): documento de capítulos em 5 idiomas, com CSS e abas,
// guardado em hoteis / hoteis_capitulos (supabase/hoteis.sql). Filha da Lua = o antigo projeto "Filha da Lua Ecolodge".
// O conteúdo fica só no banco: o repositório é público.

type Cap = {
  id: string; ordem: number; titulo: string; conteudo: string;
  titulo_en: string | null; conteudo_en: string | null; titulo_pl: string | null; conteudo_pl: string | null;
  titulo_fr: string | null; conteudo_fr: string | null; titulo_de: string | null; conteudo_de: string | null;
};
type Estilo = { nome: string; css: string; rodape: string | null; rodape_en: string | null; rodape_pl: string | null; rodape_fr: string | null; rodape_de: string | null; abas_grupos: boolean };

export default function Hotel({ hotel, nome, userEmail }: { hotel: string; nome: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [caps, setCaps] = useState<Cap[] | null>(null);
  const [estilo, setEstilo] = useState<Estilo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<"pagina" | "pdf">("pagina");
  const [idioma, setIdioma] = useState<Idioma>("pt");
  const [aba, setAba] = useState<string | null>(null);
  // Visão geral, Reservas, Mapa de reservas, Transações (dados do PMS) e Documento (os capítulos)
  const [vista, setVista] = useState<Vista>("gerencial");

  useEffect(() => {
    const h = window.location.hash;
    if (h.startsWith("#cap-") || h === "#documento") setVista("documento");
    else if (h === "#reservas") setVista("reservas");
    else if (h === "#mapa") setVista("mapa");
    else if (h === "#transacoes") setVista("transacoes");
  }, []);
  function trocarVista(v: Vista) {
    setVista(v);
    try { history.replaceState(null, "", v === "gerencial" ? window.location.pathname : `#${v}`); } catch {}
  }

  useEffect(() => {
    (async () => {
      const [c, e] = await Promise.all([
        supabase.from("hoteis_capitulos").select("*").eq("hotel", hotel).is("arquivado_em", null).order("ordem").order("titulo"),
        supabase.from("hoteis").select("*").eq("id", hotel).maybeSingle(),
      ]);
      if (c.error) setErro(c.error.message);
      setCaps((c.data as Cap[]) ?? []);
      setEstilo((e.data as Estilo) ?? null);
    })();
  }, [supabase, hotel]);

  useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("lang") ?? localStorage.getItem("brasico-idioma");
      if (ehIdioma(l)) setIdioma(l);
    } catch {}
    const ler = () => {
      const h = window.location.hash.match(/^#cap-(.+)$/);
      setAba(h ? decodeURIComponent(h[1]) : null);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  function trocarIdioma(l: Idioma) {
    setIdioma(l);
    try { localStorage.setItem("brasico-idioma", l); } catch {}
  }

  const capitulos = useMemo(
    () =>
      (caps ?? []).map((c) => {
        const t = idioma === "pt" ? null : c[`titulo_${idioma}` as const];
        const x = idioma === "pt" ? null : c[`conteudo_${idioma}` as const];
        return { id: c.id, titulo: t?.trim() || c.titulo, conteudo: x?.trim() || c.conteudo };
      }),
    [caps, idioma]
  );
  const rodape =
    (idioma === "pt" ? null : estilo?.[`rodape_${idioma}` as const]?.trim()) || estilo?.rodape || null;

  const abaAtual = capitulos.find((c) => c.id === aba) ?? capitulos[0];
  const idx = abaAtual ? capitulos.indexOf(abaAtual) : -1;
  function abrirAba(id: string | undefined) {
    if (!id) return;
    setAba(id);
    try { history.replaceState(null, "", `#cap-${id}`); } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".abas").forEach((nav) => {
      const on = nav.querySelector<HTMLElement>(".aba.on");
      if (on && nav.scrollWidth > nav.clientWidth)
        nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: "smooth" });
    });
  }, [abaAtual?.id, modo]);

  function baixarPdf() {
    setModo("pdf");
    const antes = document.title;
    const voltar = () => { document.title = antes; window.removeEventListener("afterprint", voltar); };
    window.addEventListener("afterprint", voltar);
    setTimeout(() => { document.title = estilo?.nome ?? nome; window.print(); }, 500);
  }

  return (
    <div className={modo === "pagina" ? "pagina pagina-doc modo-pagina" : "pagina pagina-doc"}>
      <Topo email={userEmail} ativo={`hotel:${hotel}`} />

      <Cabecalho hotel={hotel} nome={estilo?.nome ?? nome} vista={vista} mudar={trocarVista}
        acoes={vista === "documento" ? (
          <div className="proj-acoes">
            {capitulos.length > 0 && (
              <div className="alternar alternar-idioma" role="group" aria-label="Idioma do documento">
                {IDIOMAS.map((l) => (
                  <button key={l.id} className={idioma === l.id ? "on" : ""} onClick={() => trocarIdioma(l.id)}
                    title={l.nome} aria-label={l.nome} aria-pressed={idioma === l.id} lang={l.lang}>
                    <Bandeira idioma={l.id} />
                  </button>
                ))}
              </div>
            )}
            <div className="alternar" role="group" aria-label="Visualização">
              <button className={modo === "pagina" ? "on" : ""} onClick={() => setModo("pagina")}>Página</button>
              <button className={modo === "pdf" ? "on" : ""} onClick={() => setModo("pdf")}>PDF</button>
            </div>
            {capitulos.length > 0 && (
              <button className="acao" onClick={baixarPdf} title="Gerar o arquivo PDF para enviar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                Baixar PDF
              </button>
            )}
          </div>
        ) : null} />

      {vista === "gerencial" ? (
        <main className="hx-pagina"><VisaoGeral hotel={hotel} /></main>
      ) : vista === "reservas" ? (
        <main className="hx-pagina"><Reservas hotel={hotel} nome={estilo?.nome ?? nome} /></main>
      ) : vista === "mapa" ? (
        <main className="hx-pagina hx-largo"><HotelMapa hotel={hotel} /></main>
      ) : vista === "transacoes" ? (
        <main className="hx-pagina"><Transacoes hotel={hotel} nome={estilo?.nome ?? nome} /></main>
      ) : (
      <>
      {estilo?.css && <style dangerouslySetInnerHTML={{ __html: cssDoProjeto(estilo.css, ".doc-escopo") }} />}
      <main className="proj-doc doc-escopo">
        {caps === null ? (
          <p className="muted">Carregando…</p>
        ) : erro ? (
          <p className="muted">Não foi possível abrir: {erro}</p>
        ) : capitulos.length === 0 ? (
          <div className="vazio">
            <p>A página {estilo?.nome ?? nome} ainda está vazia.</p>
            <p className="muted">Peça ao seu Claude: “na página {estilo?.nome ?? nome} do Brasico, crie a capa e o primeiro capítulo com …”.</p>
          </div>
        ) : modo === "pagina" && abaAtual ? (
          <>
            <Abas capitulos={capitulos} atual={abaAtual.id} grupos={estilo?.abas_grupos ?? true} abrir={abrirAba} />
            <DocView key={`${abaAtual.id}-${idioma}`} capitulos={[abaAtual]} modo="pagina" idioma={idioma} />
            <div className="abas-passo">
              {idx > 0 ? (
                <button className="passo" onClick={() => abrirAba(capitulos[idx - 1].id)}>
                  <span className="muted small">{TEXTOS[idioma].anterior}</span>
                  <b>{semNumero(capitulos[idx - 1].titulo)}</b>
                </button>
              ) : <span />}
              {idx < capitulos.length - 1 ? (
                <button className="passo passo-prox" onClick={() => abrirAba(capitulos[idx + 1].id)}>
                  <span className="muted small">{TEXTOS[idioma].proximo}</span>
                  <b>{semNumero(capitulos[idx + 1].titulo)}</b>
                </button>
              ) : <span />}
            </div>
            {rodape && <footer className="doc-pagina-rodape">{rodape}</footer>}
          </>
        ) : (
          <DocView capitulos={capitulos} rodape={rodape} modo="pdf" idioma={idioma} />
        )}
      </main>
      </>
      )}

      <VisorPdf />
    </div>
  );
}
