"use client";

// Skills contábeis (/skills; 25/11/2026, pedido do dono): a Biblioteca PRO "Skills IA para Contadores" (2.078 prompts
// em 27 áreas), numa página própria, fora de Hotels & Restaurants. Só os sócios veem (RLS: notas_pode_ver).
// Dados: public.skills_contabeis (supabase/skills_contabeis.sql). A lista vem leve por skills_lista() e o prompt
// de cada skill só quando ela é aberta. CSS no bloco "Skills contábeis" de app/globals.css (sk-*).
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import Gaveta from "./Gaveta";

type Item = { a: string; an: string; n: number; t: string; d: string | null };
type Skill = { area_slug: string; area_nome: string; numero: number; titulo: string; descricao: string | null; prompt: string; quando_usar: string | null; dicas: string | null };

const POR_PAGINA = 60;
// sem acento e sem maiúscula, para a busca achar "ferias" em "Férias"
const simples = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function SkillsContabeis({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [aberta, setAberta] = useState<Item | null>(null);

  useEffect(() => {
    supabase.rpc("skills_lista").then(({ data, error }) => {
      if (error) setErro(error.message);
      else setLista((data as Item[]) ?? []);
    });
    try {
      const a = localStorage.getItem("brasico-skills-area");
      if (a) setArea(a);
    } catch {}
  }, [supabase]);

  function escolherArea(a: string) {
    setArea(a);
    setMostrar(POR_PAGINA);
    try { localStorage.setItem("brasico-skills-area", a); } catch {}
  }

  const areas = useMemo(() => {
    const m = new Map<string, { slug: string; nome: string; total: number }>();
    for (const s of lista ?? []) {
      const x = m.get(s.a) ?? { slug: s.a, nome: s.an, total: 0 };
      x.total++;
      m.set(s.a, x);
    }
    return [...m.values()].sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  }, [lista]);

  const filtradas = useMemo(() => {
    const termos = simples(busca).split(/\s+/).filter(Boolean);
    return (lista ?? []).filter((s) => {
      if (area && s.a !== area) return false;
      if (!termos.length) return true;
      const texto = simples(`${s.t} ${s.d ?? ""} ${s.an}`);
      return termos.every((t) => texto.includes(t));
    });
  }, [lista, area, busca]);

  if (erro) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="skills" />
        <main className="miolo"><p className="vazio muted">Não foi possível abrir as skills: {erro}</p></main>
      </div>
    );
  }

  const total = lista?.length ?? 0;
  const semAcesso = lista !== null && total === 0;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="skills" />
      <main className="miolo sk-pagina">
        <header className="fx-topo">
          <div>
            <h1>Skills contábeis</h1>
            <p className="muted">
              {lista === null ? "Carregando…" : semAcesso ? "Só os sócios veem as skills." : `${total.toLocaleString("pt-BR")} prompts prontos em ${areas.length} áreas: fiscal, DP, eSocial, notas, reforma tributária e mais.`}
            </p>
          </div>
        </header>

        {!semAcesso && lista !== null && (<>
          <p className="sk-aviso">Copie o prompt, cole numa conversa com o Claude e responda o que ele pedir. Revise sempre o resultado com o contador antes de usar.</p>

          <div className="sk-barra">
            <input type="search" className="sk-busca" placeholder="Buscar por tarefa: férias, DCTFWeb, Simples, CBS, rescisão…"
              value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} aria-label="Buscar skill" />
          </div>

          <div className="sk-areas" role="tablist" aria-label="Áreas">
            <button role="tab" aria-selected={!area} className={!area ? "sk-area on" : "sk-area"} onClick={() => escolherArea("")}>
              Todas <small>{total}</small>
            </button>
            {areas.map((a) => (
              <button key={a.slug} role="tab" aria-selected={area === a.slug} className={area === a.slug ? "sk-area on" : "sk-area"} onClick={() => escolherArea(a.slug)}>
                {a.nome} <small>{a.total}</small>
              </button>
            ))}
          </div>

          <p className="sk-contagem muted">
            {filtradas.length ? `${filtradas.length.toLocaleString("pt-BR")} skill${filtradas.length > 1 ? "s" : ""}` : "Nenhuma skill encontrada."}
          </p>

          <div className="sk-lista">
            {filtradas.slice(0, mostrar).map((s) => (
              <button key={`${s.a}-${s.n}`} className="sk-card" onClick={() => setAberta(s)}>
                <span className="sk-num">{String(s.n).padStart(2, "0")}</span>
                <span className="sk-corpo">
                  <b>{s.t}</b>
                  {s.d && <span className="sk-desc">{s.d}</span>}
                  {!area && <i className="sk-chip">{s.an}</i>}
                </span>
              </button>
            ))}
          </div>
          {filtradas.length > mostrar && (
            <button className="sk-mais" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
              Mostrar mais ({(filtradas.length - mostrar).toLocaleString("pt-BR")} restantes)
            </button>
          )}
        </>)}
      </main>

      {aberta && <FichaSkill item={aberta} fechar={() => setAberta(null)} />}
    </div>
  );
}

function FichaSkill({ item, fechar }: { item: Item; fechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [s, setS] = useState<Skill | null>(null);
  const [aba, setAba] = useState<"prompt" | "quando" | "dicas">("prompt");
  const [copiado, setCopiado] = useState("");

  useEffect(() => {
    setS(null);
    setAba("prompt");
    supabase.from("skills_contabeis").select("area_slug, area_nome, numero, titulo, descricao, prompt, quando_usar, dicas")
      .eq("area_slug", item.a).eq("numero", item.n).single()
      .then(({ data }) => setS(data as Skill | null));
  }, [supabase, item]);

  async function copiar() {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.prompt);
      setCopiado("Copiado!");
    } catch {
      setCopiado("Não deu para copiar: selecione o texto e use Ctrl+C");
    }
    setTimeout(() => setCopiado(""), 2500);
  }

  const abas = s ? ([
    ["prompt", "Prompt", s.prompt],
    ["quando", "Quando usar", s.quando_usar],
    ["dicas", "Dicas", s.dicas],
  ] as const).filter((a) => a[2]) : [];
  const texto = abas.find((a) => a[0] === aba)?.[2] ?? "";

  return (
    <Gaveta titulo={item.t} sub={`${item.an} · ${String(item.n).padStart(2, "0")}`} fechar={fechar}>
      <div className="sk-ficha">
        {item.d && <p className="muted">{item.d}</p>}
        {!s ? <p className="muted">Carregando…</p> : (<>
          <div className="sk-abas">
            {abas.map(([id, nome]) => (
              <button key={id} className={aba === id ? "sk-aba on" : "sk-aba"} onClick={() => setAba(id)}>{nome}</button>
            ))}
          </div>
          <pre className="sk-texto">{texto}</pre>
          <div className="sk-acoes">
            <button className="sk-copiar" onClick={copiar}>Copiar prompt</button>
            {copiado && <span className="sk-ok">{copiado}</span>}
          </div>
        </>)}
      </div>
    </Gaveta>
  );
}
