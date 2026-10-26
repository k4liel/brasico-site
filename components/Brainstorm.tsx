"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Brainstorm em quadro, no estilo do Trello: cada lista é uma coluna e cada item um card.
// Arrastar: mouse arrasta direto; no celular, segure o card (ou o título da coluna) um instante e arraste.

type Lista = { id: string; nome: string; ordem: number; criado_por: string; created_at: string };
type Item = {
  id: string; lista_id: string; texto: string; nota: string; feito: boolean; feito_em: string | null;
  responsavel: string | null; prazo: string | null; ordem: number; criado_por: string; origem: string; created_at: string;
};
type Perfil = { id: string; email: string | null; display_name: string | null };
type Arrasto = { tipo: "card" | "coluna"; id: string; lista: string; indice: number; altura: number; largura: number };
type Gesto = {
  tipo: "card" | "coluna"; id: string; lista: string; el: HTMLElement; x: number; y: number;
  toque: boolean; ativo: boolean; timer?: number; dx: number; dy: number; fantasma?: HTMLElement; quadro?: number;
};

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataCurta = (d: string) => {
  const [, m, dia] = d.slice(0, 10).split("-");
  return `${parseInt(dia, 10)} ${MES[parseInt(m, 10) - 1]}`;
};
const dataLonga = (d: string) => `${dataCurta(d)} ${d.slice(0, 4)}`;
const iniciais = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
const porOrdem = (a: Item, b: Item) => a.ordem - b.ordem;

export default function Brainstorm({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [listas, setListas] = useState<Lista[] | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novoCard, setNovoCard] = useState<{ lista: string; texto: string } | null>(null);
  const [novaColuna, setNovaColuna] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [verFeitos, setVerFeitos] = useState<Record<string, boolean>>({});
  const [arr, setArr] = useState<Arrasto | null>(null);
  const quadro = useRef<HTMLDivElement | null>(null);
  const gesto = useRef<Gesto | null>(null);
  const ponto = useRef({ x: 0, y: 0 });
  const arrRef = useRef<Arrasto | null>(null);
  const arrastou = useRef(false);
  const dados = useRef({ listas: [] as Lista[], itens: [] as Item[] });
  dados.current = { listas: listas ?? [], itens };
  const posicoes = useRef(new Map<string, { x: number; y: number }>());
  const primeiraPintura = useRef(true);

  // FLIP: a cada desenho, compara onde cada card/coluna estava e desliza do lugar antigo para o novo.
  // As posições são medidas descontando a rolagem, para rolar o quadro não parecer "movimento".
  useLayoutEffect(() => {
    const q = quadro.current;
    if (!q) return;
    const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const novas = new Map<string, { x: number; y: number }>();
    q.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const corpo = el.closest<HTMLElement>("[data-rolagem]");
      const pos = { x: r.left + q.scrollLeft, y: r.top + (corpo?.scrollTop ?? 0) };
      const id = el.dataset.flip!;
      const antes = posicoes.current.get(id);
      if (antes && !semMovimento && !primeiraPintura.current) {
        const dx = antes.x - pos.x;
        const dy = antes.y - pos.y;
        if ((Math.abs(dx) > 1 || Math.abs(dy) > 1) && Math.abs(dx) < 1200 && Math.abs(dy) < 1200) {
          el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 320, easing: "cubic-bezier(.2, .8, .2, 1)" }
          );
        }
      }
      novas.set(id, pos);
    });
    posicoes.current = novas;
    if (novas.size) primeiraPintura.current = false;
  });

  const carregar = useCallback(async () => {
    const [{ data: l }, { data: i }, { data: p }] = await Promise.all([
      supabase.from("listas").select("id,nome,ordem,criado_por,created_at").is("arquivada_em", null).order("ordem").order("created_at"),
      supabase.from("lista_itens").select("*").is("arquivado_em", null).order("ordem"),
      supabase.from("profiles").select("id,email,display_name"),
    ]);
    setListas((l as Lista[]) ?? []);
    setItens((i as Item[]) ?? []);
    setPerfis((p as Perfil[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    carregar();
    const ch = supabase
      .channel("brainstorm-quadro")
      .on("postgres_changes", { event: "*", schema: "public", table: "listas" }, () => carregar())
      .on("postgres_changes", { event: "*", schema: "public", table: "lista_itens" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  const nomeDe = (id: string | null) => {
    if (!id) return "";
    const p = perfis.find((x) => x.id === id);
    return p?.display_name || p?.email?.split("@")[0] || "Alguém";
  };

  const colunas = listas ?? [];
  const abertosDe = (lista: string) => itens.filter((i) => i.lista_id === lista && !i.feito).sort(porOrdem);
  const feitosDe = (lista: string) =>
    itens.filter((i) => i.lista_id === lista && i.feito).sort((a, b) => (b.feito_em ?? "").localeCompare(a.feito_em ?? ""));
  const noQuadro = itens.filter((i) => colunas.some((l) => l.id === i.lista_id));
  const totalAbertos = noQuadro.filter((i) => !i.feito).length;
  const totalFeitos = noQuadro.length - totalAbertos;
  const totalAtrasados = noQuadro.filter((i) => !i.feito && !!i.prazo && i.prazo < hojeISO()).length;

  // ---------- Gravação ----------
  async function salvarItem(id: string, campos: Partial<Item> & { arquivado_em?: string }) {
    setItens((l) => (campos.arquivado_em ? l.filter((i) => i.id !== id) : l.map((i) => (i.id === id ? { ...i, ...campos } : i))));
    const { error } = await supabase.from("lista_itens").update(campos).eq("id", id);
    if (error) {
      alert(error.message);
      carregar();
    }
  }

  async function adicionarCard(lista: string, texto: string) {
    const t = texto.trim();
    if (!t) return;
    const maior = Math.max(0, ...itens.filter((i) => i.lista_id === lista).map((i) => i.ordem));
    const ordem = Math.max(Date.now() / 1000, maior + 1);
    const { data, error } = await supabase
      .from("lista_itens")
      .insert({ lista_id: lista, texto: t, ordem, criado_por: userId })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setItens((l) => (l.some((i) => i.id === (data as Item).id) ? l : [...l, data as Item]));
  }

  async function criarColuna(nome: string) {
    const n = nome.trim();
    setNovaColuna(null);
    if (!n) return;
    const ordem = Math.max(-1, ...colunas.map((l) => l.ordem)) + 1;
    const { data, error } = await supabase.from("listas").insert({ nome: n, ordem, criado_por: userId }).select("id").single();
    if (error) return alert(error.message);
    await carregar();
    if (data) {
      setNovoCard({ lista: (data as { id: string }).id, texto: "" });
      setTimeout(() => quadro.current?.scrollTo({ left: quadro.current.scrollWidth, behavior: "smooth" }), 60);
    }
  }

  async function renomear(id: string, nome: string) {
    setRenomeando(null);
    const n = nome.trim();
    if (!n || n === colunas.find((l) => l.id === id)?.nome) return;
    setListas((l) => (l ?? []).map((x) => (x.id === id ? { ...x, nome: n } : x)));
    const { error } = await supabase.from("listas").update({ nome: n }).eq("id", id);
    if (error) {
      alert(error.message);
      carregar();
    }
  }

  async function arquivarColuna(l: Lista) {
    setMenu(null);
    if (!window.confirm(`Arquivar a coluna "${l.nome}"? Ela some do quadro com os seus cards, mas nada é apagado.`)) return;
    const { error } = await supabase.from("listas").update({ arquivada_em: new Date().toISOString() }).eq("id", l.id);
    if (error) return alert(error.message);
    carregar();
  }

  async function moverColuna(id: string, indice: number) {
    const atual = dados.current.listas;
    const resto = atual.filter((l) => l.id !== id);
    const coluna = atual.find((l) => l.id === id);
    if (!coluna) return;
    resto.splice(Math.max(0, Math.min(indice, resto.length)), 0, coluna);
    const novas = resto.map((l, i) => ({ ...l, ordem: i }));
    const mudou = novas.filter((l) => l.ordem !== atual.find((x) => x.id === l.id)?.ordem);
    if (!mudou.length) return;
    setListas(novas);
    const res = await Promise.all(
      mudou.map((l) => supabase.from("listas").update({ ordem: l.ordem }).eq("id", l.id))
    );
    const erro = res.find((r) => r.error)?.error;
    if (erro) {
      alert(erro.message);
      carregar();
    }
  }

  function moverCard(id: string, lista: string, indice: number) {
    const todos = dados.current.itens;
    const card = todos.find((i) => i.id === id);
    if (!card) return;
    const antes = todos.filter((i) => i.lista_id === card.lista_id && !i.feito).sort(porOrdem);
    if (card.lista_id === lista && antes.findIndex((i) => i.id === id) === indice) return;
    const outros = todos.filter((i) => i.lista_id === lista && !i.feito && i.id !== id).sort(porOrdem);
    const ant = outros[indice - 1]?.ordem;
    const prox = outros[indice]?.ordem;
    const ordem =
      ant != null && prox != null ? (ant + prox) / 2 : ant != null ? ant + 1 : prox != null ? prox - 1 : Date.now() / 1000;
    salvarItem(id, { lista_id: lista, ordem });
  }

  // ---------- Arrastar (mouse e toque) ----------
  function definirArr(a: Arrasto | null) {
    arrRef.current = a;
    setArr(a);
  }

  function calcularAlvo() {
    const g = gesto.current;
    const q = quadro.current;
    const a = arrRef.current;
    if (!g || !q || !a) return;
    const { x, y } = ponto.current;
    const cols = Array.from(q.querySelectorAll<HTMLElement>("[data-coluna]")).filter((c) => c.dataset.coluna !== g.id || g.tipo === "card");
    if (g.tipo === "coluna") {
      const indice = cols.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
      if (indice !== a.indice) definirArr({ ...a, indice });
      return;
    }
    let alvo: HTMLElement | null = null;
    let melhor = Infinity;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < melhor) {
        melhor = d;
        alvo = c;
      }
    }
    if (!alvo) return;
    const lista = alvo.dataset.coluna!;
    const indice = Array.from(alvo.querySelectorAll<HTMLElement>("[data-card]")).filter((c) => {
      if (c.dataset.card === g.id) return false;
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
    if (lista !== a.lista || indice !== a.indice) definirArr({ ...a, lista, indice });
  }

  function rolarSozinho() {
    const g = gesto.current;
    const q = quadro.current;
    if (!g?.ativo || !q) return;
    const { x, y } = ponto.current;
    const r = q.getBoundingClientRect();
    const borda = 70;
    if (x < r.left + borda) q.scrollLeft -= Math.ceil((r.left + borda - x) / 5);
    else if (x > r.right - borda) q.scrollLeft += Math.ceil((x - (r.right - borda)) / 5);
    if (g.tipo === "card" && arrRef.current) {
      const corpo = q.querySelector<HTMLElement>(`[data-coluna="${arrRef.current.lista}"] [data-rolagem]`);
      if (corpo) {
        const c = corpo.getBoundingClientRect();
        if (y < c.top + 50) corpo.scrollTop -= Math.ceil((c.top + 50 - y) / 4);
        else if (y > c.bottom - 50) corpo.scrollTop += Math.ceil((y - (c.bottom - 50)) / 4);
      }
    }
    calcularAlvo();
    g.quadro = requestAnimationFrame(rolarSozinho);
  }

  function posicionarFantasma() {
    const g = gesto.current;
    if (!g?.fantasma) return;
    g.fantasma.style.transform = `translate(${ponto.current.x - g.dx}px, ${ponto.current.y - g.dy}px) rotate(${g.tipo === "card" ? 2.5 : 1.5}deg)`;
  }

  function ativar() {
    const g = gesto.current;
    if (!g || g.ativo) return;
    g.ativo = true;
    arrastou.current = true;
    const r = g.el.getBoundingClientRect();
    g.dx = g.x - r.left;
    g.dy = g.y - r.top;
    const f = g.el.cloneNode(true) as HTMLElement;
    f.removeAttribute("data-card");
    f.removeAttribute("data-coluna");
    f.classList.add("bq-fantasma");
    f.style.width = `${r.width}px`;
    f.style.height = `${Math.min(r.height, window.innerHeight * 0.8)}px`;
    document.body.appendChild(f);
    g.fantasma = f;
    document.body.classList.add("bq-arrastando");
    if (g.toque) navigator.vibrate?.(12);
    const lista = g.tipo === "card" ? g.lista : g.id;
    const indice =
      g.tipo === "card"
        ? abertosDe(g.lista).findIndex((i) => i.id === g.id)
        : colunas.findIndex((l) => l.id === g.id);
    definirArr({ tipo: g.tipo, id: g.id, lista, indice, altura: r.height, largura: r.width });
    posicionarFantasma();
    g.quadro = requestAnimationFrame(rolarSozinho);
  }

  function mover(x: number, y: number) {
    const g = gesto.current;
    if (!g) return;
    ponto.current = { x, y };
    if (!g.ativo) {
      if (Math.hypot(x - g.x, y - g.y) > 6) {
        if (g.toque) return encerrar(false); // no celular, mexer antes de segurar é rolar a tela
        ativar();
      }
      return;
    }
    posicionarFantasma();
  }

  function encerrar(soltou: boolean) {
    const g = gesto.current;
    const a = arrRef.current;
    window.removeEventListener("pointermove", aoMoverMouse);
    window.removeEventListener("pointerup", aoSoltarMouse);
    window.removeEventListener("touchmove", aoMoverToque);
    window.removeEventListener("touchend", aoSoltarToque);
    window.removeEventListener("touchcancel", aoCancelarToque);
    window.removeEventListener("keydown", aoTeclar);
    if (!g) return;
    clearTimeout(g.timer);
    if (g.quadro) cancelAnimationFrame(g.quadro);
    g.fantasma?.remove();
    document.body.classList.remove("bq-arrastando");
    gesto.current = null;
    if (g.ativo && soltou && a) {
      if (a.tipo === "card") moverCard(a.id, a.lista, a.indice);
      else moverColuna(a.id, a.indice);
    }
    definirArr(null);
    setTimeout(() => (arrastou.current = false), 0);
  }

  // Funções estáveis para os ouvintes da janela (sempre chamam a versão atual)
  const h = useRef({ encerrar, mover, ativar });
  h.current = { encerrar, mover, ativar };
  const aoMoverMouse = useRef((e: PointerEvent) => h.current.mover(e.clientX, e.clientY)).current;
  const aoSoltarMouse = useRef(() => h.current.encerrar(true)).current;
  const aoMoverToque = useRef((e: TouchEvent) => {
    if (gesto.current?.ativo) e.preventDefault();
    const t = e.touches[0];
    if (t) h.current.mover(t.clientX, t.clientY);
  }).current;
  const aoSoltarToque = useRef(() => h.current.encerrar(true)).current;
  const aoCancelarToque = useRef(() => h.current.encerrar(false)).current;
  const aoTeclar = useRef((e: KeyboardEvent) => e.key === "Escape" && h.current.encerrar(false)).current;

  function iniciar(tipo: "card" | "coluna", id: string, lista: string, el: HTMLElement, x: number, y: number, toque: boolean) {
    if (gesto.current) return;
    gesto.current = { tipo, id, lista, el, x, y, toque, ativo: false, dx: 0, dy: 0 };
    ponto.current = { x, y };
    window.addEventListener("keydown", aoTeclar);
    if (toque) {
      gesto.current.timer = window.setTimeout(() => h.current.ativar(), 320);
      window.addEventListener("touchmove", aoMoverToque, { passive: false });
      window.addEventListener("touchend", aoSoltarToque);
      window.addEventListener("touchcancel", aoCancelarToque);
    } else {
      window.addEventListener("pointermove", aoMoverMouse);
      window.addEventListener("pointerup", aoSoltarMouse);
    }
  }

  const ignorar = (t: EventTarget) => !!(t as HTMLElement).closest("button, input, textarea, select, a, [data-sem-arrasto]");
  const pegar = (tipo: "card" | "coluna", id: string, lista: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch" || e.button !== 0 || ignorar(e.target)) return;
      iniciar(tipo, id, lista, tipo === "card" ? e.currentTarget : (e.currentTarget.closest("[data-coluna]") as HTMLElement), e.clientX, e.clientY, false);
    },
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1 || ignorar(e.target)) return;
      const t = e.touches[0];
      iniciar(tipo, id, lista, tipo === "card" ? e.currentTarget : (e.currentTarget.closest("[data-coluna]") as HTMLElement), t.clientX, t.clientY, true);
    },
  });

  useEffect(() => () => h.current.encerrar(false), []);

  // ---------- Desenho ----------
  const vaga = (altura: number) => <div className="bq-vaga" style={{ height: altura }} aria-hidden="true" />;

  const card = (i: Item, n = 0) => {
    const hoje = hojeISO();
    const atrasado = !!i.prazo && !i.feito && i.prazo < hoje;
    const ehHoje = !!i.prazo && !i.feito && i.prazo === hoje;
    const escondido = arr?.tipo === "card" && arr.id === i.id;
    return (
      <div
        key={i.id}
        data-card={i.feito ? undefined : i.id}
        data-flip={`card-${i.id}`}
        style={{ "--n": Math.min(n, 8) } as React.CSSProperties}
        className={`bq-card${i.feito ? " feito" : ""}${escondido ? " escondido" : ""}${atrasado ? " atrasado" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Abrir card: ${i.texto}`}
        onClick={() => !arrastou.current && setAberto(i.id)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setAberto(i.id);
          }
        }}
        onContextMenu={(e) => arr && e.preventDefault()}
        {...(i.feito ? {} : pegar("card", i.id, i.lista_id))}
      >
        <div className="bq-card-topo">
          <button
            className={i.feito ? "bq-check on" : "bq-check"}
            onClick={(e) => {
              e.stopPropagation();
              salvarItem(i.id, { feito: !i.feito });
            }}
            aria-label={i.feito ? "Desmarcar como feito" : "Marcar como feito"}
            aria-pressed={i.feito}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.6 2.5L12 5.5" /></svg>
          </button>
          <span className="bq-card-texto">{i.texto}</span>
        </div>
        {(i.prazo || i.nota || i.responsavel || i.criado_por) && (
          <div className="bq-card-rodape">
            {i.prazo && (
              <span className={`bq-selo${atrasado ? " atrasado" : ehHoje ? " hoje" : i.feito ? " ok" : ""}`} title={atrasado ? "Atrasado" : "Prazo"}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
                {ehHoje ? "Hoje" : dataCurta(i.prazo)}
              </span>
            )}
            {i.nota && (
              <span className="bq-selo" title="Tem nota">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h6" /></svg>
              </span>
            )}
            <span className="bq-autor" title={`Criado por ${nomeDe(i.criado_por)}${i.origem === "claude" ? " pelo Claude" : ""}`}>
              por {nomeDe(i.criado_por)}{i.origem === "claude" ? " · Claude" : ""}
            </span>
            <span className="spacer" />
            {i.responsavel && (
              <span className="bq-resp" title={`Responsável: ${nomeDe(i.responsavel)}`}>
                <span className="bq-avatar" aria-hidden="true">{iniciais(nomeDe(i.responsavel))}</span>
                {nomeDe(i.responsavel)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const coluna = (l: Lista, idx: number) => {
    const abertos = abertosDe(l.id);
    const feitos = feitosDe(l.id);
    const escondida = arr?.tipo === "coluna" && arr.id === l.id;
    const alvoAqui = arr?.tipo === "card" && arr.lista === l.id;
    const corpo: React.ReactNode[] = abertos.map((i, n) => card(i, n));
    if (alvoAqui) {
      const visiveis = abertos.filter((i) => i.id !== arr.id);
      const antes = visiveis[arr.indice - 1];
      const pos = antes ? corpo.findIndex((c) => (c as React.ReactElement).key === antes.id) + 1 : 0;
      corpo.splice(pos, 0, <div key="vaga">{vaga(arr.altura)}</div>);
    }
    const adicionando = novoCard?.lista === l.id;
    const total = abertos.length + feitos.length;
    const progresso = total ? feitos.length / total : 0;
    return (
      <section
        key={l.id}
        data-coluna={l.id}
        data-flip={`coluna-${l.id}`}
        style={{ "--n": Math.min(idx, 6) } as React.CSSProperties}
        className={`bq-coluna${escondida ? " escondida" : ""}${alvoAqui ? " alvo" : ""}${abertos.length === 0 && !alvoAqui ? " vazia" : ""}`}
        aria-label={l.nome}
      >
        <header className="bq-coluna-cabeca" {...pegar("coluna", l.id, l.id)}>
          {renomeando === l.id ? (
            <input
              autoFocus
              className="bq-renomear"
              defaultValue={l.nome}
              maxLength={80}
              onBlur={(e) => renomear(l.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenomeando(null);
              }}
            />
          ) : (
            <h2 onDoubleClick={() => setRenomeando(l.id)} title="Clique duas vezes para renomear">{l.nome}</h2>
          )}
          <span className="bq-contagem">{abertos.length}</span>
          <div className="bq-menu-caixa">
            <button className="bq-icone" onClick={() => setMenu(menu === l.id ? null : l.id)} aria-label={`Opções da coluna ${l.nome}`} aria-expanded={menu === l.id}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
            </button>
            {menu === l.id && (
              <>
                <div className="bq-menu-fundo" onClick={() => setMenu(null)} />
                <div className="bq-menu" role="menu">
                  <button role="menuitem" onClick={() => { setMenu(null); setNovoCard({ lista: l.id, texto: "" }); }}>Adicionar card</button>
                  <button role="menuitem" onClick={() => { setMenu(null); setRenomeando(l.id); }}>Renomear</button>
                  <button role="menuitem" disabled={idx === 0} onClick={() => { setMenu(null); moverColuna(l.id, idx - 1); }}>Mover para a esquerda</button>
                  <button role="menuitem" disabled={idx === colunas.length - 1} onClick={() => { setMenu(null); moverColuna(l.id, idx + 1); }}>Mover para a direita</button>
                  <hr />
                  <button role="menuitem" className="perigo" onClick={() => arquivarColuna(l)}>Arquivar coluna</button>
                </div>
              </>
            )}
          </div>
        </header>
        <div className="bq-progresso" title={total ? `${feitos.length} de ${total} concluído${total > 1 ? "s" : ""}` : "Sem cards"} aria-hidden="true">
          <span style={{ transform: `scaleX(${progresso})` }} />
        </div>

        <div className="bq-coluna-corpo" data-rolagem>
          {abertos.length === 0 && !alvoAqui && !adicionando && (
            <p className="bq-vazia">{feitos.length ? "Tudo concluído por aqui." : "Nenhum card ainda. Arraste um para cá ou crie o primeiro."}</p>
          )}
          {corpo}
          {adicionando && (
            <form
              className="bq-novo-card"
              onSubmit={(e) => {
                e.preventDefault();
                const t = novoCard.texto;
                setNovoCard({ lista: l.id, texto: "" });
                adicionarCard(l.id, t);
              }}
            >
              <textarea
                autoFocus
                rows={2}
                maxLength={300}
                placeholder="O que precisa ser feito?"
                value={novoCard.texto}
                onChange={(e) => setNovoCard({ lista: l.id, texto: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget.form as HTMLFormElement).requestSubmit();
                  }
                  if (e.key === "Escape") setNovoCard(null);
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim() && !(e.relatedTarget as HTMLElement | null)?.closest(".bq-novo-card")) setNovoCard(null);
                }}
              />
              <div className="bq-novo-acoes">
                <button type="submit">Adicionar card</button>
                <button type="button" className="bq-icone" onClick={() => setNovoCard(null)} aria-label="Cancelar">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              </div>
            </form>
          )}
          {feitos.length > 0 && (
            <div className="bq-feitos">
              <button className="bq-feitos-botao" onClick={() => setVerFeitos((v) => ({ ...v, [l.id]: !v[l.id] }))} aria-expanded={!!verFeitos[l.id]}>
                <svg viewBox="0 0 16 16" aria-hidden="true" className={verFeitos[l.id] ? "virado" : ""}><path d="M6 4l4 4-4 4" /></svg>
                {feitos.length} concluído{feitos.length > 1 ? "s" : ""}
              </button>
              {verFeitos[l.id] && feitos.map((i, n) => card(i, n))}
            </div>
          )}
        </div>

        {!adicionando && (
          <button className="bq-adicionar" onClick={() => setNovoCard({ lista: l.id, texto: "" })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            Adicionar card
          </button>
        )}
      </section>
    );
  };

  const desenharColunas = () => {
    const els: React.ReactNode[] = colunas.map(coluna);
    if (arr?.tipo === "coluna") {
      const visiveis = colunas.filter((l) => l.id !== arr.id);
      const antes = visiveis[arr.indice - 1];
      const pos = antes ? colunas.findIndex((l) => l.id === antes.id) + 1 : 0;
      els.splice(pos, 0, <div key="vaga-coluna" className="bq-vaga-coluna" style={{ width: arr.largura }} aria-hidden="true" />);
    }
    return els;
  };

  const itemAberto = itens.find((i) => i.id === aberto) ?? null;

  return (
    <div className="pagina bq-pagina">
      <Topo email={userEmail} ativo="brainstorm" />
      <header className="bq-cabeca">
        <div className="bq-titulo">
          <span className="bq-sobretitulo">Equipe Brasico</span>
          <h1>Brainstorm</h1>
        </div>
        {listas !== null && (
          <div className="bq-numeros" aria-label="Resumo do quadro">
            <span><b>{totalAbertos}</b> em aberto</span>
            <span><b>{totalFeitos}</b> concluído{totalFeitos === 1 ? "" : "s"}</span>
            <span className={totalAtrasados ? "alerta" : ""}><b>{totalAtrasados}</b> atrasado{totalAtrasados === 1 ? "" : "s"}</span>
          </div>
        )}
        <p className="bq-dica muted small">Arraste os cards entre as colunas. No celular, segure um instante antes de arrastar.</p>
      </header>

      <div className={`bq-quadro${arr ? " arrastando" : ""}`} ref={quadro}>
        {listas === null && (
          <div className="bq-carregando" aria-label="Carregando">
            {[0, 1, 2].map((n) => (
              <div key={n} className="bq-coluna bq-esqueleto" style={{ "--n": n } as React.CSSProperties}>
                <i /><i /><i />
              </div>
            ))}
          </div>
        )}
        {desenharColunas()}
        {listas !== null && (
          <div className="bq-coluna bq-coluna-nova" style={{ "--n": Math.min(colunas.length, 6) } as React.CSSProperties}>
            {novaColuna !== null ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  criarColuna(novaColuna);
                }}
              >
                <input
                  autoFocus
                  className="bq-renomear"
                  placeholder="Nome da coluna"
                  value={novaColuna}
                  maxLength={80}
                  onChange={(e) => setNovaColuna(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNovaColuna(null)}
                  onBlur={(e) => !e.target.value.trim() && !(e.relatedTarget as HTMLElement | null)?.closest(".bq-coluna-nova") && setNovaColuna(null)}
                />
                <div className="bq-novo-acoes">
                  <button type="submit">Criar coluna</button>
                  <button type="button" className="bq-icone" onClick={() => setNovaColuna(null)} aria-label="Cancelar">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                  </button>
                </div>
              </form>
            ) : (
              <button className="bq-adicionar" onClick={() => setNovaColuna("")}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                {colunas.length ? "Nova coluna" : "Criar a primeira coluna"}
              </button>
            )}
          </div>
        )}
      </div>

      {itemAberto && (
        <Detalhe
          key={itemAberto.id}
          item={itemAberto}
          listas={colunas}
          perfis={perfis}
          nomeDe={nomeDe}
          onSalvar={(c) => salvarItem(itemAberto.id, c)}
          onArquivar={() => {
            if (!window.confirm("Arquivar este card? Ele some do quadro, mas nada é apagado.")) return;
            salvarItem(itemAberto.id, { arquivado_em: new Date().toISOString() });
            setAberto(null);
          }}
          onFechar={() => setAberto(null)}
        />
      )}
    </div>
  );
}

function Detalhe({
  item, listas, perfis, nomeDe, onSalvar, onArquivar, onFechar,
}: {
  item: Item; listas: Lista[]; perfis: Perfil[]; nomeDe: (id: string | null) => string;
  onSalvar: (c: Partial<Item>) => void; onArquivar: () => void; onFechar: () => void;
}) {
  const [texto, setTexto] = useState(item.texto);
  const [nota, setNota] = useState(item.nota);
  const guardar = () => {
    const c: Partial<Item> = {};
    if (texto.trim() && texto.trim() !== item.texto) c.texto = texto.trim();
    if (nota !== item.nota) c.nota = nota;
    if (Object.keys(c).length) onSalvar(c);
  };
  const fechar = () => {
    guardar();
    onFechar();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const coluna = listas.find((l) => l.id === item.lista_id);
  return (
    <div className="bq-modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="bq-modal" role="dialog" aria-modal="true" aria-label="Card">
        <div className="bq-modal-topo">
          <button
            className={item.feito ? "bq-check grande on" : "bq-check grande"}
            onClick={() => onSalvar({ feito: !item.feito })}
            aria-label={item.feito ? "Desmarcar como feito" : "Marcar como feito"}
            aria-pressed={item.feito}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.6 2.5L12 5.5" /></svg>
          </button>
          <div className="bq-modal-titulo">
            <textarea
              rows={1}
              value={texto}
              maxLength={300}
              onChange={(e) => setTexto(e.target.value)}
              onBlur={guardar}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              aria-label="Título do card"
            />
            <span className="muted small">
              na coluna <strong>{coluna?.nome ?? "—"}</strong>
              {item.feito && item.feito_em ? ` · concluído em ${dataLonga(item.feito_em)}` : ""}
            </span>
          </div>
          <button className="bq-icone" onClick={fechar} aria-label="Fechar">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>

        <div className="bq-modal-campos">
          <label>
            <span>Responsável</span>
            <select value={item.responsavel ?? ""} onChange={(e) => onSalvar({ responsavel: e.target.value || null })}>
              <option value="">Ninguém</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
            </select>
          </label>
          <label>
            <span>Prazo</span>
            <input type="date" value={item.prazo ?? ""} onChange={(e) => onSalvar({ prazo: e.target.value || null })} />
          </label>
          <label>
            <span>Coluna</span>
            <select value={item.lista_id} onChange={(e) => onSalvar({ lista_id: e.target.value, ordem: Date.now() / 1000 })}>
              {listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
        </div>

        <label className="bq-modal-nota">
          <span>Nota</span>
          <textarea rows={5} value={nota} onChange={(e) => setNota(e.target.value)} onBlur={guardar} placeholder="Detalhes, links, decisões…" />
        </label>

        <div className="bq-modal-rodape">
          <span className="muted small">
            Criado por {nomeDe(item.criado_por)}{item.origem === "claude" ? " pelo Claude" : ""} em {dataLonga(item.created_at)}
          </span>
          <span className="spacer" />
          <button className="acao acao-excluir" onClick={onArquivar}>Arquivar card</button>
          <button onClick={fechar}>Pronto</button>
        </div>
      </div>
    </div>
  );
}
