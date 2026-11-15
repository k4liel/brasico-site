"use client";

// Operação do hotel (/hoteis/<hotel>/operacao[/<tela>]): a área de criação de cada hotel (recepção, governança,
// CRM…). As telas são documentos HTML criados pelo Claude de quem edita a área (conector: operacao_*; guia em
// lib/operacao.ts) e rodam numa caixa isolada (iframe sem a mesma origem: não vê a sessão nem o resto do site).
// A tela fala com o banco só por window.brasico → postMessage → operacao_chamar (funções api_* do hotel).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "../Topo";

type Tela = {
  slug: string; titulo: string; descricao: string | null; icone: string | null; ordem: number;
  html: string | null; rascunho: string | null; tem_rascunho: boolean; publicado_em: string | null; atualizado_em: string;
};

// a ponte que entra no começo de toda tela
function ponte(hotel: string, tema: string) {
  return `<script>(function(){
  var n=0, esperando={};
  function pedir(tipo, dados){ return new Promise(function(ok, falha){ var id=++n; esperando[id]={ok:ok,falha:falha};
    parent.postMessage({brasico:true,id:id,tipo:tipo,dados:dados}, "*"); }); }
  window.addEventListener("message", function(e){ var m=e.data; if(!m||!m.brasico||!esperando[m.id]) return;
    var p=esperando[m.id]; delete esperando[m.id]; m.ok ? p.ok(m.dados) : p.falha(new Error(m.erro)); });
  window.brasico = { hotel: ${JSON.stringify(hotel)}, tema: ${JSON.stringify(tema)},
    chamar: function(funcao, args){ return pedir("chamar", {funcao: funcao, args: args || {}}); },
    eu: function(){ return pedir("eu", {}); },
    abrir: function(slug){ parent.postMessage({brasico:true,tipo:"abrir",dados:{slug:slug}}, "*"); } };
  function altura(){ parent.postMessage({brasico:true,tipo:"altura",dados:{h:document.documentElement.scrollHeight}}, "*"); }
  window.addEventListener("load", altura);
  try { new ResizeObserver(altura).observe(document.documentElement); } catch (e) { setInterval(altura, 800); }
})();</script>`;
}
function montar(html: string, hotel: string, tema: string) {
  const p = ponte(hotel, tema);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => h + p);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (h) => `${h}<head>${p}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${p}</head><body>${html}</body></html>`;
}

const ICONES: Record<string, string> = {
  quartos: "M3 21V8l9-5 9 5v13M9 21v-6h6v6", limpeza: "M14 3l7 7-9 9H5v-7zM3 21l4-4",
  recepcao: "M4 20h16M6 20V10h12v10M9 6h6M12 3v3", clientes: "M9 8a3 3 0 1 0 0-.01M3 20c.8-3.5 3.3-5.5 6-5.5s5.2 2 6 5.5M17 8.5a2.5 2.5 0 0 1 0 5M19 14.5c1.5.6 2.4 2.1 2.8 4.5",
  manutencao: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  tarefas: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2", painel: "M4 19V10M10 19V5M16 19v-7M22 19H2",
  agenda: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4", estoque: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
};
const iconeDe = (nome: string | null) => ICONES[(nome ?? "").toLowerCase()] ?? "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z";
const quando = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "";

export default function Operacao({ hotel, nome, slug, userEmail, verRascunho }: {
  hotel: string; nome: string; slug: string | null; userEmail: string; verRascunho: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [telas, setTelas] = useState<Tela[] | null>(null);
  const [nivel, setNivel] = useState<"ver" | "editar" | null>(null);
  const [erro, setErro] = useState("");
  const [rascunho, setRascunho] = useState(verRascunho);
  const [altura, setAltura] = useState(640);
  const [tema, setTema] = useState("claro");
  const [eu, setEu] = useState<{ id: string; nome: string | null } | null>(null);
  const [aviso, setAviso] = useState("");
  const quadro = useRef<HTMLIFrameElement>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("operacao_paginas_site", { p_hotel: hotel });
    if (error) { setErro(error.message); setTelas([]); return; }
    const d = data as { nivel: "ver" | "editar"; paginas: Tela[] };
    setNivel(d.nivel);
    setTelas(d.paginas);
  }, [supabase, hotel]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    setTema(document.documentElement.dataset.theme === "dark" ? "escuro" : "claro");
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle();
      setEu({ id: data.user.id, nome: (p as { display_name: string | null } | null)?.display_name ?? null });
    });
  }, [supabase]);

  const tela = slug ? telas?.find((t) => t.slug === slug) ?? null : null;
  const html = tela ? (rascunho && tela.rascunho ? tela.rascunho : tela.html ?? tela.rascunho) : null;

  // a ponte: só aceita mensagens da caixa desta tela
  useEffect(() => {
    async function ouvir(e: MessageEvent) {
      if (!quadro.current || e.source !== quadro.current.contentWindow) return;
      const m = e.data as { brasico?: boolean; id?: number; tipo?: string; dados?: Record<string, unknown> };
      if (!m?.brasico) return;
      const responder = (ok: boolean, dados?: unknown, erroTexto?: string) =>
        quadro.current?.contentWindow?.postMessage({ brasico: true, id: m.id, ok, dados, erro: erroTexto }, "*");
      if (m.tipo === "altura") return setAltura(Math.max(320, Math.min(20000, Number(m.dados?.h) || 640)));
      if (m.tipo === "abrir") {
        const s = String(m.dados?.slug ?? "");
        if (/^[a-z0-9][a-z0-9-]{0,60}$/.test(s)) window.location.href = `/hoteis/${hotel}/operacao/${s}${rascunho ? "?rascunho=1" : ""}`;
        return;
      }
      if (m.tipo === "eu") return responder(true, { id: eu?.id, nome: eu?.nome, nivel });
      if (m.tipo === "chamar") {
        const { data, error } = await supabase.rpc("operacao_chamar", { p_hotel: hotel, p_funcao: String(m.dados?.funcao ?? ""), p_args: m.dados?.args ?? {} });
        return error ? responder(false, undefined, error.message) : responder(true, data);
      }
    }
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, [supabase, hotel, eu, nivel, rascunho]);

  async function publicar() {
    if (!tela) return;
    const { error } = await supabase.rpc("operacao_publicar_site", { p_hotel: hotel, p_slug: tela.slug });
    if (error) return setAviso(error.message);
    setAviso(`“${tela.titulo}” publicada para a equipe.`);
    setRascunho(false);
    carregar();
  }

  return (
    <div className="pagina pagina-doc modo-pagina">
      <Topo email={userEmail} ativo={slug ? `ophotel:${hotel}/${slug}` : `ophotel:${hotel}`} />
      <main className="hx-pagina op">
        {erro ? <p className="tv-alerta">{erro}</p> : !telas ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : !slug ? (
          <>
            <div className="op-topo">
              <div>
                <span className="hx-sobre">Operação dos hotéis</span>
                <h1>{nome}</h1>
                <p className="muted">Recepção, governança, clientes e as rotinas do hotel, criados aqui dentro.</p>
              </div>
            </div>
            {telas.length === 0 ? (
              <div className="op-vazio">
                <span className="op-vazio-icone" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconeDe(null)} /></svg>
                </span>
                <h3>Nada criado ainda</h3>
                {nivel === "editar"
                  ? <p className="muted">Peça ao seu Claude, conectado ao Brasico: “na Operação do {nome}, crie uma tela de governança com o status de cada quarto”. Ele cria as tabelas, as funções e a tela; você confere o rascunho aqui e publica.</p>
                  : <p className="muted">Quando a equipe criar os sistemas do hotel, eles aparecem aqui.</p>}
              </div>
            ) : (
              <ul className="op-grade">
                {telas.map((t) => (
                  <li key={t.slug}>
                    <a className="op-cartao" href={`/hoteis/${hotel}/operacao/${t.slug}${!t.html ? "?rascunho=1" : ""}`}>
                      <span className="op-cartao-icone" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={iconeDe(t.icone)} /></svg>
                      </span>
                      <span className="op-cartao-texto">
                        <strong>{t.titulo}</strong>
                        {t.descricao && <span className="muted">{t.descricao}</span>}
                      </span>
                      <span className="op-cartao-pe">
                        {!t.html ? <i className="op-selo rascunho">só rascunho</i> : t.tem_rascunho ? <i className="op-selo rascunho">rascunho novo</i> : <i className="op-selo">publicada {quando(t.publicado_em)}</i>}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : !tela || !html ? (
          <div className="op-vazio"><h3>Tela não encontrada</h3><p className="muted"><a href={`/hoteis/${hotel}/operacao`}>Voltar para a Operação</a></p></div>
        ) : (
          <>
            <div className="op-barra">
              <a className="op-voltar" href={`/hoteis/${hotel}/operacao`}>← Operação</a>
              <strong>{tela.titulo}</strong>
              <span className="op-barra-acoes">
                {nivel === "editar" && tela.rascunho && (tela.tem_rascunho || !tela.html) && (
                  <>
                    {tela.html && (
                      <span className="es-segmentos" role="tablist" aria-label="Versão">
                        <button role="tab" aria-selected={!rascunho} className={!rascunho ? "on" : ""} onClick={() => setRascunho(false)}>Publicada</button>
                        <button role="tab" aria-selected={rascunho} className={rascunho ? "on" : ""} onClick={() => setRascunho(true)}>Rascunho</button>
                      </span>
                    )}
                    <button className="small" onClick={publicar}>Publicar rascunho</button>
                  </>
                )}
              </span>
            </div>
            {aviso && <p className="es-aviso">{aviso}</p>}
            {rascunho && tela.rascunho && <p className="op-aviso-rascunho">Você está vendo o rascunho. A equipe vê a versão publicada.</p>}
            <iframe ref={quadro} key={`${tela.slug}-${rascunho ? "r" : "p"}-${tela.atualizado_em}`} className="op-quadro" title={tela.titulo}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
              style={{ height: altura }} srcDoc={montar(html, hotel, tema)} />
          </>
        )}
      </main>
    </div>
  );
}
