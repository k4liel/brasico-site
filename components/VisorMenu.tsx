"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Menus vivos (18/11/2026, pedido do dono: "deixe esses menus editáveis na tela quando abro").
// No bloco :::arquivos, a linha com "menu:<código>" abre aqui o menu da tabela cardapios_vivos
// (supabase/cardapios_vivos.sql): o mesmo visual do impresso, num iframe sem scripts.
// Editar = clicar no texto e digitar; Salvar grava uma versão nova (a anterior vai para o histórico);
// Baixar PDF imprime pelo navegador no tamanho certo (e, se a folha pedir, várias cópias com marcas de corte).

type Menu = { id: string; codigo: string; title: string; html: string; css: string; folha: Folha; versao: number; updated_at: string };
type Folha = { largura?: number; altura?: number; grade?: [number, number]; marcas?: boolean };
type Versao = { versao: number; html: string; css: string; gravado_em: string };

const PT_PX = 4 / 3;

// Visual da tela (fundo cinza, folhas com sombra); não vai para o que se grava nem para a impressão
const CSS_TELA = `
html { background: #525659; }
body { margin: 0 !important; padding: 28px 0 !important; display: flex; flex-direction: column; align-items: center; gap: 28px; background: #525659 !important; width: auto !important; height: auto !important; }
.pagina { box-shadow: 0 6px 24px rgba(0,0,0,.35); flex: none; }
body.editando .pagina { outline: 2px dashed rgba(208,171,104,.9); outline-offset: 6px; }
body.editando .pagina *:hover { box-shadow: inset 0 0 0 1px rgba(208,171,104,.55); }
`;

function documento(css: string, corpo: string, extra = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style><style>${extra}</style></head><body>${corpo}</body></html>`;
}

// Tira o que não pode ficar gravado (scripts, objetos, eventos, links javascript:)
function limpar(body: HTMLElement) {
  const c = body.cloneNode(true) as HTMLElement;
  c.querySelectorAll("script,iframe,object,embed,form,input,button,textarea,select,link,meta,base").forEach((n) => n.remove());
  c.querySelectorAll("*").forEach((n) => {
    for (const a of Array.from(n.attributes)) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value) || a.name === "contenteditable" || a.name === "spellcheck") n.removeAttribute(a.name);
    }
  });
  return c.innerHTML.trim();
}

// Tamanho da página em pt, lido do CSS já aplicado
function tamanhoPagina(doc: Document) {
  const p = doc.querySelector<HTMLElement>(".pagina");
  if (!p) return { w: 595.28, h: 841.89 };
  const r = p.getBoundingClientRect();
  const z = parseFloat(p.style.zoom || "1") || 1;
  return { w: r.width / z / PT_PX, h: r.height / z / PT_PX };
}

function documentoImpressao(menu: { css: string; html: string; folha: Folha }, tam: { w: number; h: number }) {
  const tmp = new DOMParser().parseFromString(`<body>${menu.html}</body>`, "text/html");
  const paginas = Array.from(tmp.querySelectorAll(".pagina")).map((p) => p.outerHTML);
  const f = menu.folha ?? {};
  if (f.grade && f.largura && f.altura) {
    const [lin, col] = f.grade;
    const W = f.largura, H = f.altura;
    const ox = (W - col * tam.w) / 2, oy = (H - lin * tam.h) / 2;
    const marcas: string[] = [];
    if (f.marcas) {
      const L = 10, g = 3;
      for (let j = 0; j <= col; j++) {
        const x = ox + j * tam.w;
        marcas.push(`<i class="mc" style="left:${x - 0.2}pt;top:${oy - g - L}pt;width:.4pt;height:${L}pt"></i>`);
        marcas.push(`<i class="mc" style="left:${x - 0.2}pt;top:${oy + lin * tam.h + g}pt;width:.4pt;height:${L}pt"></i>`);
      }
      for (let i = 0; i <= lin; i++) {
        const y = oy + i * tam.h;
        marcas.push(`<i class="mc" style="top:${y - 0.2}pt;left:${ox - g - L}pt;height:.4pt;width:${L}pt"></i>`);
        marcas.push(`<i class="mc" style="top:${y - 0.2}pt;left:${ox + col * tam.w + g}pt;height:.4pt;width:${L}pt"></i>`);
      }
    }
    const folhas = paginas.map((p) => {
      const copias: string[] = [];
      for (let i = 0; i < lin; i++)
        for (let j = 0; j < col; j++)
          copias.push(`<div class="cp" style="left:${ox + j * tam.w}pt;top:${oy + i * tam.h}pt">${p}</div>`);
      return `<div class="folha-imp">${copias.join("")}${marcas.join("")}</div>`;
    });
    const css = `@page { size: ${W}pt ${H}pt; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important; background: #fff !important; }
      .folha-imp { position: relative; width: ${W}pt; height: ${H}pt; overflow: hidden; page-break-after: always; break-after: page; }
      .folha-imp:last-child { page-break-after: auto; break-after: auto; }
      .cp { position: absolute; } .mc { position: absolute; background: #8c8c8c; display: block; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
    return documento(menu.css, folhas.join(""), css);
  }
  const css = `@page { size: ${tam.w}pt ${tam.h}pt; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important; background: #fff !important; }
    .pagina { page-break-after: always; break-after: page; } .pagina:last-child { page-break-after: auto; break-after: auto; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
  return documento(menu.css, paginas.join(""), css);
}

async function esperarPronto(doc: Document) {
  try {
    await doc.fonts.ready;
  } catch {}
  await Promise.all(
    Array.from(doc.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))
  );
}

export default function VisorMenu({ projectId }: { projectId: string }) {
  const supabase = useRef(createClient()).current;
  const [menus, setMenus] = useState<Record<string, Menu>>({});
  const [aberto, setAberto] = useState<{ codigo: string; titulo: string; rotulo: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [mudou, setMudou] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [versoes, setVersoes] = useState<Versao[] | null>(null);
  const [vendo, setVendo] = useState<Versao | null>(null); // versão antiga aberta para conferir
  const quadro = useRef<HTMLIFrameElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("cardapios_vivos")
      .select("id,codigo,title,html,css,folha,versao,updated_at")
      .eq("workspace_id", projectId)
      .is("arquivado_em", null);
    const m: Record<string, Menu> = {};
    (data ?? []).forEach((x: Menu) => (m[x.codigo] = x));
    setMenus(m);
  }, [supabase, projectId]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Capas: miniatura viva de cada menu no lugar da imagem (refeita quando o menu muda ou a aba troca)
  useEffect(() => {
    const pintar = () => {
      document.querySelectorAll<HTMLElement>("[data-menu-capa]").forEach((el) => {
        const m = menus[el.dataset.menuCapa ?? ""];
        if (!m) return;
        const chave = `${m.id}:${m.versao}`;
        if (el.dataset.pintado === chave) return;
        el.dataset.pintado = chave;
        el.innerHTML = "";
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-same-origin");
        f.setAttribute("tabindex", "-1");
        f.setAttribute("aria-hidden", "true");
        f.className = "menu-capa";
        const tmp = new DOMParser().parseFromString(`<body>${m.html}</body>`, "text/html");
        const primeira = tmp.querySelector(".pagina")?.outerHTML ?? "";
        f.srcdoc = documento(m.css, primeira, "html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:hidden!important;width:auto!important;height:auto!important}");
        f.onload = () => {
          const d = f.contentDocument;
          const p = d?.querySelector<HTMLElement>(".pagina");
          if (!d || !p) return;
          const z = el.clientWidth / p.getBoundingClientRect().width;
          p.style.zoom = String(z);
        };
        el.appendChild(f);
      });
    };
    pintar();
    const obs = new MutationObserver(() => pintar());
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [menus]);

  // Clique no cartão do menu
  useEffect(() => {
    const abrir = (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-menu]");
      const codigo = alvo?.dataset.menu;
      if (!alvo || !codigo) return;
      e.preventDefault();
      setAberto({ codigo, titulo: alvo.dataset.titulo ?? "", rotulo: alvo.dataset.codigo ?? "" });
      setEditando(false);
      setMudou(false);
      setAviso(null);
      setVersoes(null);
      setVendo(null);
    };
    document.addEventListener("click", abrir);
    return () => document.removeEventListener("click", abrir);
  }, []);

  const menu = aberto ? menus[aberto.codigo] : undefined;
  const mostrado = vendo ?? menu;

  // Monta o menu no quadro
  const montar = useCallback(() => {
    const f = quadro.current;
    if (!f || !mostrado) return;
    f.srcdoc = documento(mostrado.css, mostrado.html, CSS_TELA);
  }, [mostrado]);
  useEffect(() => {
    montar();
  }, [montar]);

  // Ajusta o zoom das páginas à largura da janela
  const ajustar = useCallback(() => {
    const f = quadro.current;
    const d = f?.contentDocument;
    if (!f || !d) return;
    d.querySelectorAll<HTMLElement>(".pagina").forEach((p) => {
      p.style.zoom = "1";
      const larg = p.getBoundingClientRect().width;
      const z = Math.max(0.3, Math.min(2.6, (f.clientWidth - 56) / larg));
      p.style.zoom = String(z);
    });
  }, []);

  const aoCarregar = useCallback(() => {
    const d = quadro.current?.contentDocument;
    if (!d) return;
    ajustar();
    d.addEventListener("input", () => setMudou(true));
    if (editando && !vendo) {
      d.designMode = "on";
      d.body.classList.add("editando");
    }
  }, [ajustar, editando, vendo]);

  useEffect(() => {
    if (!aberto) return;
    const r = () => ajustar();
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, [aberto, ajustar]);

  // Liga e desliga a edição sem recarregar
  useEffect(() => {
    const d = quadro.current?.contentDocument;
    if (!d?.body) return;
    d.designMode = editando && !vendo ? "on" : "off";
    d.body.classList.toggle("editando", editando && !vendo);
  }, [editando, vendo]);

  const fechar = useCallback(() => {
    if (mudou && !confirm("Há mudanças não salvas neste menu. Fechar sem salvar?")) return;
    setAberto(null);
  }, [mudou]);

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", esc);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = antes;
    };
  }, [aberto, fechar]);

  async function salvar(html?: string, css?: string) {
    if (!menu) return;
    const d = quadro.current?.contentDocument;
    const novo = html ?? (d?.body ? limpar(d.body) : null);
    if (!novo) return;
    setSalvando(true);
    setAviso(null);
    const { data, error } = await supabase
      .from("cardapios_vivos")
      .update({ html: novo, ...(css !== undefined ? { css } : {}) })
      .eq("id", menu.id)
      .eq("versao", menu.versao)
      .select("id,codigo,title,html,css,folha,versao,updated_at")
      .maybeSingle();
    setSalvando(false);
    if (error) {
      setAviso({ tipo: "erro", texto: /42501|só tem acesso/.test(`${error.code} ${error.message}`) ? "Você só tem acesso para ver este projeto: peça a um administrador para liberar a edição." : `Não foi possível salvar: ${error.message}` });
      return;
    }
    if (!data) {
      setAviso({ tipo: "erro", texto: "Outra pessoa salvou este menu enquanto você editava. Copie o que mudou, feche e abra de novo para ver a versão nova." });
      return;
    }
    setMenus((m) => ({ ...m, [data.codigo]: data as Menu }));
    setMudou(false);
    setEditando(false);
    setVendo(null);
    setVersoes(null);
    setAviso({ tipo: "ok", texto: `Salvo (versão ${data.versao}). A anterior fica guardada em Versões.` });
  }

  function descartar() {
    if (mudou && !confirm("Descartar o que foi mudado?")) return;
    setMudou(false);
    setEditando(false);
    montar();
  }

  async function abrirVersoes() {
    if (!menu) return;
    if (versoes) {
      setVersoes(null);
      setVendo(null);
      return;
    }
    const { data } = await supabase
      .from("cardapios_vivos_historico")
      .select("versao,html,css,gravado_em")
      .eq("cardapio_id", menu.id)
      .order("versao", { ascending: false })
      .limit(40);
    setVersoes((data ?? []) as Versao[]);
  }

  async function baixarPdf() {
    const d = quadro.current?.contentDocument;
    if (!mostrado || !d) return;
    const tam = tamanhoPagina(d);
    const html = editando && d.body ? limpar(d.body) : mostrado.html;
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-same-origin allow-modals");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    f.srcdoc = documentoImpressao({ css: mostrado.css, html, folha: (menu?.folha ?? {}) as Folha }, tam);
    f.onload = async () => {
      const doc = f.contentDocument;
      if (doc) await esperarPronto(doc);
      const antes = document.title;
      document.title = (aberto?.titulo || "Menu").replace(/[\\/:*?"<>|]/g, "-");
      f.contentWindow?.print();
      document.title = antes;
      setTimeout(() => f.remove(), 60000);
    };
    document.body.appendChild(f);
  }

  if (!aberto) return null;
  const quando = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="visor-fundo" onClick={fechar}>
      <div className="visor visor-menu" role="dialog" aria-modal="true" aria-label={aberto.titulo} onClick={(e) => e.stopPropagation()}>
        <div className="visor-topo">
          <div className="visor-titulo">
            {aberto.rotulo && <span className="visor-cod">{aberto.rotulo}</span>}
            <b>{aberto.titulo}</b>
            {menu && <span className="vm-versao">versão {menu.versao}</span>}
          </div>
          {menu && !vendo && (editando ? (
            <>
              <button className="visor-botao" onClick={descartar} disabled={salvando}>Descartar</button>
              <button className="visor-botao vm-salvar" onClick={() => salvar()} disabled={salvando || !mudou}>{salvando ? "Salvando…" : "Salvar"}</button>
            </>
          ) : (
            <button className="visor-botao vm-editar" onClick={() => { setEditando(true); setAviso(null); }}>Editar</button>
          ))}
          {menu && <button className="visor-botao" onClick={abrirVersoes} disabled={editando}>{versoes ? "Fechar versões" : "Versões"}</button>}
          {menu && <button className="visor-botao" onClick={baixarPdf}>Baixar PDF</button>}
          <button className="visor-fechar" onClick={fechar} aria-label="Fechar">×</button>
        </div>
        {editando && <div className="vm-faixa">Clique no texto do menu e digite. Ctrl+Z desfaz. Quando terminar, clique em <b>Salvar</b>.</div>}
        {vendo && menu && (
          <div className="vm-faixa vm-faixa-velha">
            Vendo a versão {vendo.versao} ({quando(vendo.gravado_em)}).
            <button className="visor-botao" onClick={() => setVendo(null)}>Voltar para a atual</button>
            <button className="visor-botao vm-salvar" disabled={salvando} onClick={() => confirm(`Voltar o menu para a versão ${vendo.versao}? A atual fica guardada nas versões.`) && salvar(vendo.html, vendo.css)}>Restaurar esta versão</button>
          </div>
        )}
        {aviso && <div className={`vm-aviso ${aviso.tipo}`}>{aviso.texto}</div>}
        <div className="vm-corpo">
          {versoes && (
            <aside className="vm-versoes">
              <b>Versões anteriores</b>
              {versoes.length === 0 && <span className="vm-vazia">Ainda não há versões anteriores.</span>}
              {versoes.map((v) => (
                <button key={v.versao} className={vendo?.versao === v.versao ? "on" : ""} onClick={() => setVendo(v)}>
                  Versão {v.versao}<small>{quando(v.gravado_em)}</small>
                </button>
              ))}
            </aside>
          )}
          {menu ? (
            <iframe ref={quadro} className="vm-quadro" sandbox="allow-same-origin allow-modals" title={aberto.titulo} onLoad={aoCarregar} />
          ) : (
            <div className="vm-carregando">Carregando o menu…</div>
          )}
        </div>
      </div>
    </div>
  );
}
