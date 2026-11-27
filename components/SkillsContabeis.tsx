"use client";

// Skills contábeis (/skills; 25/11/2026, pedido do dono): a Biblioteca PRO "Skills IA para Contadores" e as áreas
// feitas para o grupo, numa página própria dentro de Fiscal e Contábil. Só os sócios veem (RLS: notas_pode_ver).
// Dados: public.skills_contabeis (supabase/skills_contabeis.sql). A lista vem leve por skills_lista() e o prompt
// de cada skill só quando ela é aberta. CSS no bloco "Skills contábeis" de app/globals.css (sk-*).
// Visual refeito em 27/11/2026 (pedido do dono: "melhore o design e a UX, tá muito feio"): áreas numa coluna à
// esquerda (as do grupo primeiro), busca com contagem por área, recentes, gaveta larga com o texto legível,
// campos a preencher em destaque, Copiar sempre à vista e Anterior/Próxima.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import Gaveta from "./Gaveta";

type Item = { a: string; an: string; n: number; t: string; d: string | null };
type Skill = { area_slug: string; area_nome: string; numero: number; titulo: string; descricao: string | null; prompt: string; quando_usar: string | null; dicas: string | null };
type Area = { slug: string; nome: string; total: number; achadas: number; grupo: boolean };

// Áreas montadas para o grupo (legislação das casas, reforma para restaurantes e hotéis, tabela oficial do CST)
const DO_GRUPO: Record<string, string> = {
  "rt-restaurantes-hoteis": "Reforma tributária aplicada às casas, com o texto oficial das leis embutido",
  "cst-cclasstrib": "Tabela oficial de CST e cClassTrib do IBS/CBS, código a código",
  "leis-brasico": "Convenções, leis trabalhistas, sanitárias e municipais de Pipa, Natal e João Pessoa",
};
const ORDEM_GRUPO = Object.keys(DO_GRUPO);

const POR_PAGINA = 40;
const SUGESTOES = ["gorjeta", "cClassTrib", "hotelaria", "férias", "rescisão", "Simples", "NFS-e", "DCTFWeb"];
const simples = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const num = (n: number) => String(n).padStart(2, "0");
const chave = (s: Pick<Item, "a" | "n">) => `${s.a}:${s.n}`;

// Marca os termos da busca no texto (sem acento e sem maiúscula, como a busca)
function Marcado({ texto, termos }: { texto: string; termos: string[] }) {
  if (!termos.length) return <>{texto}</>;
  const base = simples(texto);
  const marcas: [number, number][] = [];
  for (const t of termos) {
    let i = base.indexOf(t);
    while (i >= 0 && t) { marcas.push([i, i + t.length]); i = base.indexOf(t, i + t.length); }
  }
  if (!marcas.length) return <>{texto}</>;
  marcas.sort((x, y) => x[0] - y[0]);
  const partes: React.ReactNode[] = [];
  let pos = 0;
  for (const [ini, fim] of marcas) {
    if (ini < pos) continue;
    if (ini > pos) partes.push(texto.slice(pos, ini));
    partes.push(<mark key={ini}>{texto.slice(ini, fim)}</mark>);
    pos = fim;
  }
  partes.push(texto.slice(pos));
  return <>{partes}</>;
}

export default function SkillsContabeis({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [aberta, setAberta] = useState<Item | null>(null);
  const [recentes, setRecentes] = useState<string[]>([]);
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc("skills_lista").then(({ data, error }) => {
      if (error) setErro(error.message);
      else setLista((data as Item[]) ?? []);
    });
    try {
      const a = localStorage.getItem("brasico-skills-area");
      if (a) setArea(a);
      const r = JSON.parse(localStorage.getItem("brasico-skills-recentes") ?? "[]");
      if (Array.isArray(r)) setRecentes(r.slice(0, 6));
    } catch {}
  }, [supabase]);

  // "/" leva à busca
  useEffect(() => {
    const f = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement;
      if (ev.key === "/" && !aberta && !["INPUT", "TEXTAREA"].includes(alvo.tagName)) { ev.preventDefault(); buscaRef.current?.focus(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aberta]);

  const termos = useMemo(() => simples(busca).split(/\s+/).filter(Boolean), [busca]);
  const combina = useMemo(() => (s: Item) => {
    if (!termos.length) return true;
    const texto = simples(`${s.t} ${s.d ?? ""} ${s.an}`);
    return termos.every((t) => texto.includes(t));
  }, [termos]);

  const areas = useMemo(() => {
    const m = new Map<string, Area>();
    for (const s of lista ?? []) {
      const x = m.get(s.a) ?? { slug: s.a, nome: s.an, total: 0, achadas: 0, grupo: s.a in DO_GRUPO };
      x.total++;
      if (combina(s)) x.achadas++;
      m.set(s.a, x);
    }
    const todas = [...m.values()];
    const grupo = todas.filter((a) => a.grupo).sort((x, y) => ORDEM_GRUPO.indexOf(x.slug) - ORDEM_GRUPO.indexOf(y.slug));
    const pro = todas.filter((a) => !a.grupo).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
    return { grupo, pro, todas };
  }, [lista, combina]);

  const filtradas = useMemo(() => (lista ?? []).filter((s) => (!area || s.a === area) && combina(s)), [lista, area, combina]);
  const achadasTotal = useMemo(() => (lista ?? []).filter(combina).length, [lista, combina]);
  const recentesItens = useMemo(() => {
    const porChave = new Map((lista ?? []).map((s) => [chave(s), s]));
    return recentes.map((k) => porChave.get(k)).filter(Boolean) as Item[];
  }, [lista, recentes]);

  function escolherArea(a: string) {
    setArea(a);
    setMostrar(POR_PAGINA);
    try { localStorage.setItem("brasico-skills-area", a); } catch {}
    listaRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function abrir(s: Item) {
    setAberta(s);
    setRecentes((r) => {
      const novo = [chave(s), ...r.filter((k) => k !== chave(s))].slice(0, 6);
      try { localStorage.setItem("brasico-skills-recentes", JSON.stringify(novo)); } catch {}
      return novo;
    });
  }

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
  const areaAtual = areas.todas.find((a) => a.slug === area);
  const posicao = aberta ? filtradas.findIndex((s) => chave(s) === chave(aberta)) : -1;

  const botaoArea = (a: Area) => (
    <button key={a.slug} className={area === a.slug ? "sk-lado-item on" : "sk-lado-item"} onClick={() => escolherArea(a.slug)}
      disabled={!!termos.length && !a.achadas} aria-current={area === a.slug}>
      <span>{a.nome}</span>
      <small>{termos.length ? a.achadas : a.total}</small>
    </button>
  );

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="skills" />
      <main className="miolo sk-pagina">
        <header className="sk-cabeca">
          <div>
            <span className="sk-sobre">Fiscal e Contábil</span>
            <h1>Skills contábeis</h1>
            <p className="muted">Prompts prontos para usar com o Claude: copie, cole numa conversa e responda o que ele perguntar.</p>
          </div>
          {lista && !semAcesso && (
            <dl className="sk-numeros">
              <div><dt>Skills</dt><dd>{total.toLocaleString("pt-BR")}</dd></div>
              <div><dt>Áreas</dt><dd>{areas.todas.length}</dd></div>
              <div><dt>Do grupo</dt><dd>{areas.grupo.reduce((s, a) => s + a.total, 0)}</dd></div>
            </dl>
          )}
        </header>

        {lista === null && <div className="sk-carregando"><span /><span /><span /></div>}
        {semAcesso && <p className="vazio muted">Só os sócios veem as skills.</p>}

        {!semAcesso && lista !== null && (
          <div className="sk-grade">
            <aside className="sk-lado" aria-label="Áreas">
              <button className={!area ? "sk-lado-item sk-lado-todas on" : "sk-lado-item sk-lado-todas"} onClick={() => escolherArea("")}>
                <span>Todas as áreas</span><small>{termos.length ? achadasTotal : total}</small>
              </button>
              <p className="sk-lado-titulo">Feitas para o grupo</p>
              {areas.grupo.map(botaoArea)}
              <p className="sk-lado-titulo">Biblioteca PRO</p>
              {areas.pro.map(botaoArea)}
            </aside>

            <section className="sk-conteudo" ref={listaRef}>
              <div className="sk-busca-caixa">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
                <input ref={buscaRef} type="search" className="sk-busca" placeholder="O que você precisa fazer? Ex.: gorjeta, férias, cClassTrib…"
                  value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} aria-label="Buscar skill" />
                {busca ? <button className="sk-limpar" onClick={() => { setBusca(""); buscaRef.current?.focus(); }} aria-label="Limpar busca">×</button>
                  : <kbd className="sk-atalho" title="Atalho: tecla /">/</kbd>}
              </div>

              <label className="sk-area-movel">
                <span>Área</span>
                <select value={area} onChange={(e) => escolherArea(e.target.value)}>
                  <option value="">Todas as áreas ({termos.length ? achadasTotal : total})</option>
                  <optgroup label="Feitas para o grupo">
                    {areas.grupo.map((a) => <option key={a.slug} value={a.slug}>{a.nome} ({termos.length ? a.achadas : a.total})</option>)}
                  </optgroup>
                  <optgroup label="Biblioteca PRO">
                    {areas.pro.map((a) => <option key={a.slug} value={a.slug}>{a.nome} ({termos.length ? a.achadas : a.total})</option>)}
                  </optgroup>
                </select>
              </label>

              {!area && !termos.length && (<>
                <div className="sk-destaques">
                  {areas.grupo.map((a) => (
                    <button key={a.slug} className="sk-destaque" onClick={() => escolherArea(a.slug)}>
                      <span className="sk-selo">Do grupo</span>
                      <b>{a.nome}</b>
                      <span>{DO_GRUPO[a.slug]}</span>
                      <small>{a.total} skills →</small>
                    </button>
                  ))}
                </div>
                {recentesItens.length > 0 && (
                  <div className="sk-recentes">
                    <p className="sk-rotulo">Abertas por último</p>
                    <div>
                      {recentesItens.map((s) => (
                        <button key={chave(s)} className="sk-recente" onClick={() => abrir(s)}><b>{s.t}</b><small>{s.an}</small></button>
                      ))}
                    </div>
                  </div>
                )}
              </>)}

              <div className="sk-lista-topo">
                <div>
                  <h2>{areaAtual ? areaAtual.nome : termos.length ? "Resultado da busca" : "Todas as skills"}</h2>
                  {areaAtual?.grupo && <p className="muted">{DO_GRUPO[areaAtual.slug]}</p>}
                </div>
                <span className="sk-contagem">
                  {filtradas.length.toLocaleString("pt-BR")} skill{filtradas.length === 1 ? "" : "s"}
                  {area && termos.length > 0 && achadasTotal > filtradas.length && (
                    <button className="sk-link" onClick={() => escolherArea("")}>ver {achadasTotal} em todas as áreas</button>
                  )}
                </span>
              </div>

              {!filtradas.length ? (
                <div className="sk-vazio">
                  <b>Nenhuma skill com “{busca}”{areaAtual ? ` em ${areaAtual.nome}` : ""}.</b>
                  <p className="muted">Tente uma palavra mais curta ou um destes temas:</p>
                  <div className="sk-sugestoes">
                    {SUGESTOES.map((s) => <button key={s} onClick={() => { setBusca(s); setArea(""); }}>{s}</button>)}
                  </div>
                </div>
              ) : (
                <div className="sk-lista">
                  {filtradas.slice(0, mostrar).map((s, i) => {
                    const novaArea = !area && (i === 0 || filtradas[i - 1].a !== s.a);
                    return (
                      <Fragment key={chave(s)}>
                        {novaArea && <p className="sk-separador">{s.an}{s.a in DO_GRUPO && <span className="sk-selo">Do grupo</span>}</p>}
                        <button className={aberta && chave(aberta) === chave(s) ? "sk-card on" : "sk-card"} onClick={() => abrir(s)}>
                          <span className="sk-num">{num(s.n)}</span>
                          <span className="sk-corpo">
                            <b><Marcado texto={s.t} termos={termos} /></b>
                            {s.d && <span className="sk-desc"><Marcado texto={s.d} termos={termos} /></span>}
                          </span>
                          <span className="sk-seta" aria-hidden="true">›</span>
                        </button>
                      </Fragment>
                    );
                  })}
                </div>
              )}
              {filtradas.length > mostrar && (
                <button className="sk-mais" onClick={() => setMostrar((m) => m + POR_PAGINA * 2)}>
                  Mostrar mais · faltam {(filtradas.length - mostrar).toLocaleString("pt-BR")}
                </button>
              )}
            </section>
          </div>
        )}
      </main>

      {aberta && (
        <FichaSkill item={aberta} fechar={() => setAberta(null)}
          anterior={posicao > 0 ? () => abrir(filtradas[posicao - 1]) : undefined}
          proxima={posicao >= 0 && posicao < filtradas.length - 1 ? () => abrir(filtradas[posicao + 1]) : undefined}
          posicao={posicao >= 0 ? `${posicao + 1} de ${filtradas.length}` : ""} />
      )}
    </div>
  );
}

// Texto do prompt: títulos em maiúsculas viram subtítulos e os campos a preencher ([descreva], [VERIFICAR]) ficam marcados
function TextoPrompt({ texto }: { texto: string }) {
  const blocos = texto.split(/\n{2,}/);
  return (
    <div className="sk-texto">
      {blocos.map((b, i) => {
        const linhas = b.split("\n");
        const primeira = linhas[0].trim();
        const titulo = primeira.length > 3 && primeira.length < 90 && primeira === primeira.toUpperCase() && /[A-ZÁÉÍÓÚÇÃÕ]{3}/.test(primeira);
        const corpo = titulo ? linhas.slice(1).join("\n") : b;
        return (
          <div key={i} className="sk-bloco">
            {titulo && <h3>{primeira}</h3>}
            {corpo && <p>{corpo.split(/(\[[^\]\n]{2,80}\])/g).map((p, j) => (/^\[.*\]$/.test(p) ? <mark key={j} className="sk-campo">{p}</mark> : p))}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FichaSkill({ item, fechar, anterior, proxima, posicao }: { item: Item; fechar: () => void; anterior?: () => void; proxima?: () => void; posicao: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [s, setS] = useState<Skill | null>(null);
  const [aba, setAba] = useState<"prompt" | "quando" | "dicas">("prompt");
  const [copiado, setCopiado] = useState("");
  const corpoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    setS(null);
    setAba("prompt");
    supabase.from("skills_contabeis").select("area_slug, area_nome, numero, titulo, descricao, prompt, quando_usar, dicas")
      .eq("area_slug", item.a).eq("numero", item.n).single()
      .then(({ data }) => { if (vivo) setS(data as Skill | null); });
    corpoRef.current?.closest(".fx-gaveta-corpo")?.scrollTo({ top: 0 });
    return () => { vivo = false; };
  }, [supabase, item]);

  // ← → trocam de skill
  useEffect(() => {
    const f = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).tagName === "INPUT") return;
      if (ev.key === "ArrowLeft" && anterior) anterior();
      if (ev.key === "ArrowRight" && proxima) proxima();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [anterior, proxima]);

  async function copiar() {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.prompt);
      setCopiado("Copiado. Agora cole numa conversa com o Claude.");
    } catch {
      setCopiado("Não deu para copiar: selecione o texto e use Ctrl+C.");
    }
    setTimeout(() => setCopiado(""), 3500);
  }

  const abas = s ? ([
    ["prompt", "Prompt", s.prompt],
    ["quando", "Quando usar", s.quando_usar],
    ["dicas", "Dicas", s.dicas],
  ] as const).filter((a) => a[2]) : [];
  const texto = abas.find((a) => a[0] === aba)?.[2] ?? "";
  const tamanho = s ? s.prompt.length : 0;
  const tamanhoTexto = tamanho > 20000 ? `${Math.round(tamanho / 1000).toLocaleString("pt-BR")} mil caracteres · traz o texto oficial junto` : `${tamanho.toLocaleString("pt-BR")} caracteres`;

  const barra = (
    <div className="sk-barra-ficha">
      <div className="sk-abas" role="tablist">
        {abas.map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} className={aba === id ? "sk-aba on" : "sk-aba"} onClick={() => setAba(id)}>{nome}</button>
        ))}
      </div>
      <button className="sk-copiar" onClick={copiar} disabled={!s}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
        Copiar prompt
      </button>
    </div>
  );

  return (
    <Gaveta titulo={item.t} sub={`${item.an} · nº ${num(item.n)}`} fechar={fechar} topo={s ? barra : undefined}>
      <div className="sk-ficha" ref={corpoRef}>
        {copiado && <p className="sk-ok" role="status">{copiado}</p>}
        {item.d && <p className="sk-resumo">{item.d}</p>}
        {!s ? <div className="sk-carregando"><span /><span /><span /></div> : (<>
          {aba === "prompt" && <p className="sk-tamanho">{tamanhoTexto}. Os campos <mark className="sk-campo">[assim]</mark> são para você preencher.</p>}
          <TextoPrompt texto={texto} />
        </>)}
        <nav className="sk-navega">
          <button onClick={anterior} disabled={!anterior}>← Anterior</button>
          <span className="muted">{posicao}</span>
          <button onClick={proxima} disabled={!proxima}>Próxima →</button>
        </nav>
      </div>
    </Gaveta>
  );
}
