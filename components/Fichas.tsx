"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import Abas, { numeroDe, semNumero } from "./Abas";
import { cssDoProjeto } from "@/lib/livre";

// Fichas técnicas (Operação · fase 3): fichas copiadas do projeto "Fichas técnicas" para tabelas,
// com o custo calculado pelo último preço pago de cada insumo e a margem frente à venda na TOTVS.
// A página usa o mesmo visual do projeto: o CSS dele (fichas_capitulos), as abas e o desenho de cada ficha.
// Tabelas e funções em supabase/fichas.sql e fichas_importar.sql.
type Ficha = { id: string; nome: string; unidade_negocio: string; grupo: string | null; tipo: string; rendimento: number | null;
  rendimento_unidade: string | null; preparo: string | null; observacoes: string | null; foto: string | null; conferida: boolean };
type Custo = { ficha_id: string; custo: number | null; ingredientes: number; sem_preco: number };
type Venda = { ficha_id: string; produto: string; vendidos_30d: number; preco_medio: number | null };
type Item = { id: number; ordem: number; ingrediente: string; insumo_id: string | null; sub_ficha_id: string | null;
  quantidade: number | null; quantidade_texto: string | null; unidade: string | null; removido: boolean };
type Insumo = { id: string; nome: string; unidade: string };
type Preco = { insumo_id: string; data: string; fornecedor: string; preco: number; fonte: string };
type Apelido = { id: number; insumo_id: string; apelido: string; unidade_compra: string | null; fator: number | null; confirmado: boolean; semelhanca: number | null };

const UNIDADES: Record<string, string> = { midway: "Cicchetti Midway", cicchetti_centro: "Cicchetti Centro", filha_da_lua: "Filha da Lua", producao: "Produção central" };
const TIPOS: Record<string, string> = { prato: "Pratos", drink: "Drinks", preparo: "Preparos" };
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const qtd = (v: number | null) => (v == null ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const converter = (q: number | null, de: string | null, para: string) => {
  if (q == null || !de) return null;
  const d = de.toLowerCase();
  if (d === para.toLowerCase()) return q;
  if ((d === "g" || d === "gr") && para === "kg") return q / 1000;
  if (d === "ml" && para === "L") return q / 1000;
  if ((d === "l" || d === "lt") && para === "L") return q;
  if (["un", "un.", "und", "unid", "uni"].includes(d) && para === "un") return q;
  return null;
};

// Capítulos do projeto Fichas técnicas (cabeçalho lido do projeto, que continua como está)
type Cap = { id: string; titulo: string; rotulo: string | null; h1: string | null; abertura: string | null };
const INICIO = "inicio";
const REVISAR = "revisar";
const CURTO: Record<string, string> = { midway: "Midway", cicchetti_centro: "Cicchetti Centro", filha_da_lua: "Filha da Lua", producao: "Produção central" };

export default function Fichas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [fichas, setFichas] = useState<(Ficha & { origem_nota_id: string | null })[]>([]);
  const [custos, setCustos] = useState<Record<string, Custo>>({});
  const [vendas, setVendas] = useState<Record<string, Venda[]>>({});
  const [css, setCss] = useState("");
  const [caps, setCaps] = useState<Cap[]>([]);
  const [aba, setAba] = useState(INICIO);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [f, c, v] = await Promise.all([
      supabase.from("fichas").select("id,nome,unidade_negocio,grupo,tipo,rendimento,rendimento_unidade,preparo,observacoes,foto,conferida,origem_nota_id").eq("ativa", true).order("nome"),
      supabase.from("fichas_custo").select("*"),
      supabase.from("fichas_venda").select("ficha_id,produto,vendidos_30d,preco_medio"),
    ]);
    setFichas((f.data ?? []) as (Ficha & { origem_nota_id: string | null })[]);
    setCustos(Object.fromEntries(((c.data ?? []) as Custo[]).map((x) => [x.ficha_id, x])));
    const vv: Record<string, Venda[]> = {};
    for (const x of (v.data ?? []) as Venda[]) (vv[x.ficha_id] ??= []).push(x);
    setVendas(vv);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notas_acesso").select("user_id").eq("user_id", userId);
      if (!data?.length) return setAcesso(false);
      setAcesso(true);
      const { data: p } = await supabase.rpc("fichas_capitulos");
      const r = (p ?? {}) as { css: string | null; capitulos: Cap[] | null };
      setCss(r.css ?? "");
      setCaps(r.capitulos ?? []);
      carregar();
    })();
  }, [supabase, userId, carregar]);

  // Abas como no projeto: Início, os capítulos (agrupados pelo nome antes do " · ") e Revisar insumos
  const abas = useMemo(() => [
    { id: INICIO, titulo: "00 · Início" },
    ...caps.map((c) => ({ id: c.id, titulo: c.titulo })),
    { id: REVISAR, titulo: "90 · Revisar insumos" },
  ], [caps]);
  const idx = Math.max(0, abas.findIndex((a) => a.id === aba));
  function abrir(id: string) {
    setAba(id);
    setAberta(null);
    window.scrollTo({ top: 0 });
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="fichas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso às fichas técnicas.</p></main>
      </div>
    );
  }

  const cap = caps.find((c) => c.id === aba);
  const doCap = cap ? fichas.filter((f) => f.origem_nota_id === cap.id) : [];

  return (
    <div className="pagina pagina-doc modo-pagina">
      <Topo email={userEmail} ativo="fichas" />
      {css && <style dangerouslySetInnerHTML={{ __html: cssDoProjeto(css, ".doc-escopo") }} />}
      <main className="proj-doc doc-escopo">
        {!caps.length ? <p className="muted vazio">Carregando…</p> : (
          <>
            <Abas capitulos={abas} atual={abas[idx].id} grupos abrir={abrir} />
            <article className="doc doc-pagina">
              <section className="secao">
                {aba === INICIO && <Inicio caps={caps} fichas={fichas} custos={custos} abrir={abrir} />}
                {cap && (
                  <div>
                    {cap.rotulo && <div className="rotulo">{cap.rotulo}</div>}
                    <h1>{cap.h1 ?? semNumero(cap.titulo)}</h1>
                    {cap.abertura && <p className="abertura">{cap.abertura}</p>}
                    <div className="bloco-livre">
                      <div className="fichas">
                        {doCap.map((f) => (
                          <FichaCartao key={f.id} ficha={f} custo={custos[f.id]} vendas={vendas[f.id] ?? []}
                            aberta={aberta === f.id} alternar={() => setAberta(aberta === f.id ? null : f.id)} onMudou={carregar} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {aba === REVISAR && (
                  <div>
                    <div className="rotulo">CADASTRO ÚNICO DE INSUMOS</div>
                    <h1>Revisar insumos</h1>
                    <p className="abertura">Ligue o nome que vem nas notas de compra ao insumo das fichas. Só depois de confirmado o preço entra no custo.</p>
                    <RevisarInsumos onMudou={carregar} />
                  </div>
                )}
              </section>
            </article>
            <div className="abas-passo">
              {idx > 0 ? (
                <button className="passo" onClick={() => abrir(abas[idx - 1].id)}>
                  <span className="muted small">Anterior</span><b>{semNumero(abas[idx - 1].titulo)}</b>
                </button>
              ) : <span />}
              {idx < abas.length - 1 ? (
                <button className="passo passo-prox" onClick={() => abrir(abas[idx + 1].id)}>
                  <span className="muted small">Próximo</span><b>{semNumero(abas[idx + 1].titulo)}</b>
                </button>
              ) : <span />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Início: sumário por local, com um cartão por capítulo (foto da primeira ficha que tiver foto)
function Inicio({ caps, fichas, custos, abrir }: { caps: Cap[]; fichas: (Ficha & { origem_nota_id: string | null })[]; custos: Record<string, Custo>; abrir: (id: string) => void }) {
  const locais: { nome: string; caps: Cap[] }[] = [];
  for (const c of caps) {
    const t = semNumero(c.titulo);
    const nome = t.includes(" · ") ? t.slice(0, t.indexOf(" · ")) : t;
    const ultimo = locais[locais.length - 1];
    if (ultimo && ultimo.nome === nome) ultimo.caps.push(c);
    else locais.push({ nome, caps: [c] });
  }
  const comCusto = fichas.filter((f) => custos[f.id]?.custo != null).length;
  return (
    <div>
      <div className="rotulo">FICHAS TÉCNICAS · OPERAÇÃO</div>
      <h1>Fichas técnicas</h1>
      <p className="abertura">{fichas.length} fichas copiadas do projeto Fichas técnicas, com o custo pelo último preço pago de cada insumo ({comCusto} já têm custo). Use as abas lá em cima para ir direto a cada parte.</p>
      {locais.map((l) => (
        <div key={l.nome}>
          <div className="grupo-atalhos">{l.nome}</div>
          <div className="atalhos">
            {l.caps.map((c) => {
              const fs = fichas.filter((f) => f.origem_nota_id === c.id);
              const foto = fs.find((f) => f.foto)?.foto;
              const t = semNumero(c.titulo);
              return (
                <a key={c.id} className="atalho" href={`#${c.id}`} onClick={(e) => { e.preventDefault(); abrir(c.id); }}>
                  {foto ? <img className={fs[0]?.tipo === "drink" ? "drink" : ""} src={foto} alt="" /> : <span className="sem" />}
                  <div>
                    <span className="num">{numeroDe(c.titulo)} · {fs.length} fichas</span>
                    <b>{t.includes(" · ") ? t.slice(t.indexOf(" · ") + 3) : t}</b>
                    {c.h1 && <small>{c.h1}</small>}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Uma ficha no mesmo desenho do projeto: cabeçalho com foto, ingredientes à esquerda e preparo à direita.
// A mais: o custo de cada ingrediente, o total e a venda na TOTVS.
type ItemCusto = Item & { custo: number | null };
function FichaCartao({ ficha, custo, vendas, aberta, alternar, onMudou }: {
  ficha: Ficha; custo?: Custo; vendas: Venda[]; aberta: boolean; alternar: () => void; onMudou: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [itens, setItens] = useState<ItemCusto[] | null>(null);
  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from("fichas_itens").select("*").eq("ficha_id", ficha.id).eq("removido", false).order("ordem"),
        supabase.from("fichas_itens_custo").select("item_id,custo").eq("ficha_id", ficha.id),
      ]);
      const cs = Object.fromEntries(((b.data ?? []) as { item_id: number; custo: number | null }[]).map((x) => [x.item_id, x.custo]));
      setItens(((a.data ?? []) as Item[]).map((i) => ({ ...i, custo: cs[i.id] ?? null })));
    })();
  }, [supabase, ficha.id, custo?.custo]);

  const v = [...vendas].sort((x, y) => y.vendidos_30d - x.vendidos_30d)[0];
  const cmv = custo?.custo != null && v?.preco_medio ? custo.custo / v.preco_medio : null;
  const sub: ReactNode[] = [
    ficha.rendimento ? `Rende ${qtd(ficha.rendimento)} ${ficha.rendimento_unidade ?? ""}` : "",
    custo?.custo != null ? `Custo ${brl(custo.custo)}${custo.sem_preco ? ` (${custo.sem_preco} sem preço)` : ""}` : "",
    v ? `Venda ${brl(v.preco_medio)}` : "",
    cmv != null ? <span className={cmv > 0.35 ? "es-ruim" : undefined}>Custo ÷ preço {pct(cmv)}</span> : "",
    ficha.conferida ? "Conferida com a cozinha" : "",
  ].filter(Boolean);
  const passos = (ficha.preparo ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const obs = (ficha.observacoes ?? "").replace(/^Obs\.?:\s*/i, "");

  return (
    <article className="ficha">
      <div className={ficha.tipo === "drink" ? "ficha-cab drink" : "ficha-cab"}>
        {ficha.foto ? <img className="ficha-foto" src={ficha.foto} alt="" /> : <span className="ficha-foto vazia" />}
        <div className="ficha-txt">
          <span className="ficha-tag">{CURTO[ficha.unidade_negocio] ?? ficha.unidade_negocio} · {ficha.grupo ?? TIPOS[ficha.tipo]}</span>
          <h3>{ficha.nome}</h3>
          {sub.length > 0 && <p className="ficha-sub">{sub.map((s, k) => <Fragment key={k}>{k > 0 && " · "}{s}</Fragment>)}</p>}
        </div>
      </div>
      <div className="ficha-corpo">
        <table className="ficha-tab">
          <thead><tr><th>Ingrediente</th><th>Un.</th><th>Qtd.</th><th>Custo</th></tr></thead>
          <tbody>
            {(itens ?? []).map((i) => (
              <tr key={i.id}>
                <td>{i.ingrediente}</td>
                <td>{i.unidade ?? ""}</td>
                <td>{i.quantidade != null ? qtd(i.quantidade) : i.quantidade_texto ?? "q.b."}</td>
                <td>{i.custo != null ? brl(i.custo) : "—"}</td>
              </tr>
            ))}
            {custo?.custo != null && <tr className="total"><td>Custo</td><td /><td /><td>{brl(custo.custo)}</td></tr>}
          </tbody>
        </table>
        {passos.length > 0 && <p><b>Preparo:</b></p>}
        {passos.length > 0 && <ol>{passos.map((p, k) => <li key={k}>{p}</li>)}</ol>}
        {obs && <p><b>Obs.:</b> {obs}</p>}
        <p className="ft-acoes"><button className="ghost small" onClick={alternar}>{aberta ? "Fechar" : "Ajustar quantidades e conferir"}</button></p>
      </div>
      {aberta && <Detalhe ficha={ficha} vendas={vendas} onMudou={onMudou} onFechar={alternar} />}
    </article>
  );
}

function Detalhe({ ficha, vendas, onMudou, onFechar }: { ficha: Ficha; vendas: Venda[]; onMudou: () => void; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [itens, setItens] = useState<Item[]>([]);
  const [insumos, setInsumos] = useState<Record<string, Insumo>>({});
  const [precos, setPrecos] = useState<Record<string, Preco>>({});
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("fichas_itens").select("*").eq("ficha_id", ficha.id).eq("removido", false).order("ordem");
    const its = (data ?? []) as Item[];
    setItens(its);
    const ids = [...new Set(its.map((i) => i.insumo_id).filter(Boolean))] as string[];
    const sids = [...new Set(its.map((i) => i.sub_ficha_id).filter(Boolean))] as string[];
    const [a, b, s] = await Promise.all([
      ids.length ? supabase.from("insumos").select("id,nome,unidade").in("id", ids) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from("insumos_precos").select("*").in("insumo_id", ids) : Promise.resolve({ data: [] }),
      sids.length ? supabase.from("fichas").select("id,nome").in("id", sids) : Promise.resolve({ data: [] }),
    ]);
    setInsumos(Object.fromEntries(((a.data ?? []) as Insumo[]).map((x) => [x.id, x])));
    setPrecos(Object.fromEntries(((b.data ?? []) as Preco[]).map((x) => [x.insumo_id, x])));
    setSubs(Object.fromEntries(((s.data ?? []) as { id: string; nome: string }[]).map((x) => [x.id, x.nome])));
  }, [supabase, ficha.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function conferir(sim: boolean) {
    const { error } = await supabase.rpc("fichas_conferir", { p_ficha: ficha.id, p_conferida: sim });
    if (error) setErro(error.message);
    onMudou();
  }
  async function salvarQtd(i: Item, valor: string) {
    const q = valor.trim() === "" ? null : Number(valor.replace(",", "."));
    if (q !== null && Number.isNaN(q)) return setErro("Quantidade inválida.");
    const { error } = await supabase.rpc("fichas_item_salvar", { p_item: i.id, p_quantidade: q, p_unidade: i.unidade ?? "", p_insumo: i.insumo_id, p_removido: false });
    if (error) return setErro(error.message);
    carregar(); onMudou();
  }

  let total = 0;
  return (
    <section className="es-bloco nf-detalhe">
      <div className="es-bloco-cabeca">
        <h2>{ficha.nome} <span className="muted">· {UNIDADES[ficha.unidade_negocio]}{ficha.rendimento ? ` · rende ${qtd(ficha.rendimento)} ${ficha.rendimento_unidade ?? ""}` : ""}</span></h2>
        <div className="nf-acoes">
          {ficha.conferida ? <button className="ghost small" onClick={() => conferir(false)}>Desmarcar conferida</button>
            : <button className="small" onClick={() => conferir(true)}>Marcar como conferida</button>}
          <button className="ghost small" onClick={onFechar}>Fechar</button>
        </div>
      </div>
      {ficha.foto && <img className="nf-foto" src={ficha.foto} alt={`Foto de ${ficha.nome}`} />}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela">
          <thead><tr><th>Ingrediente</th><th className="n">Quantidade</th><th>Insumo</th><th className="n">Último preço</th><th className="n">Custo</th></tr></thead>
          <tbody>
            {itens.map((i) => {
              const ins = i.insumo_id ? insumos[i.insumo_id] : null;
              const p = i.insumo_id ? precos[i.insumo_id] : null;
              const q = ins ? converter(i.quantidade, i.unidade, ins.unidade) : null;
              const c = q != null && p ? q * p.preco : null;
              if (c != null) total += c;
              return (
                <tr key={i.id}>
                  <td>{i.ingrediente}{i.sub_ficha_id && <small>preparo: {subs[i.sub_ficha_id] ?? ""}</small>}</td>
                  <td className="n"><input className="n ft-qtd" defaultValue={i.quantidade != null ? String(i.quantidade).replace(".", ",") : i.quantidade_texto ?? ""}
                    onBlur={(v) => v.target.value.replace(",", ".") !== String(i.quantidade ?? "") && salvarQtd(i, v.target.value)} aria-label={`Quantidade de ${i.ingrediente}`} /> {i.unidade ?? ""}</td>
                  <td>{ins ? ins.nome : i.sub_ficha_id ? "—" : <span className="muted">sem insumo</span>}</td>
                  <td className="n">{p ? <>{brl(p.preco)} / {ins?.unidade}<small>{p.fornecedor}</small></> : "—"}</td>
                  <td className="n">{c != null ? brl(c) : i.quantidade == null ? <span className="muted">q.b.</span> : <span className="muted">sem preço</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={4}><strong>Custo dos ingredientes com preço</strong></td><td className="n"><strong>{brl(total)}</strong></td></tr></tfoot>
        </table>
      </div>
      {vendas.length > 0 && (
        <p className="muted ft-venda">Na TOTVS: {vendas.map((v) => `${v.produto} · ${qtd(v.vendidos_30d)} vendidos em 30 dias a ${brl(v.preco_medio)}`).join(" | ")}</p>
      )}
      {ficha.preparo && (<><h3>Preparo</h3><ol className="ft-preparo">{ficha.preparo.split("\n").map((l, k) => <li key={k}>{l}</li>)}</ol></>)}
      {ficha.observacoes && <p className="muted es-nota">{ficha.observacoes}</p>}
      {erro && <p className="tv-alerta">{erro}</p>}
    </section>
  );
}

// Ligar os nomes das notas de compra aos insumos das fichas (sugestões automáticas para conferir)
function RevisarInsumos({ onMudou }: { onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [apelidos, setApelidos] = useState<Apelido[]>([]);
  const [insumos, setInsumos] = useState<Record<string, Insumo>>({});
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState("");
  const fatores = useRef<Record<number, string>>({});

  const carregar = useCallback(async () => {
    const [a, i] = await Promise.all([
      supabase.from("insumos_apelidos").select("id,insumo_id,apelido,unidade_compra,fator,confirmado,semelhanca").eq("origem", "nota").eq("confirmado", false).gt("semelhanca", 0).order("semelhanca", { ascending: false }).limit(400),
      supabase.from("insumos").select("id,nome,unidade").eq("ativo", true),
    ]);
    setApelidos((a.data ?? []) as Apelido[]);
    setInsumos(Object.fromEntries(((i.data ?? []) as Insumo[]).map((x) => [x.id, x])));
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function decidir(a: Apelido, sim: boolean, fatorTxt?: string) {
    setMsg("");
    const fator = fatorTxt && fatorTxt.trim() ? Number(fatorTxt.replace(",", ".")) : a.fator;
    if (sim && !(fator && fator > 0)) return setMsg(`Informe quanto de ${insumos[a.insumo_id]?.unidade ?? ""} vem em 1 ${a.unidade_compra ?? "unidade"} de “${a.apelido}”.`);
    const { error } = await supabase.rpc("insumos_apelido_confirmar", { p_apelido: a.id, p_confirmado: sim, p_fator: sim ? fator : null });
    if (error) return setMsg(error.message);
    setApelidos((xs) => xs.filter((x) => x.id !== a.id));
    onMudou();
  }

  const b = filtro.trim().toLowerCase();
  const lista = apelidos.filter((a) => !b || a.apelido.toLowerCase().includes(b) || (insumos[a.insumo_id]?.nome ?? "").toLowerCase().includes(b));

  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Revisar insumos <span className="muted">· {apelidos.length} sugestões para conferir</span></h2></div>
      <p className="muted cp-ajuda">Cada linha é um nome que aparece nas notas de compra e o insumo das fichas que parece ser o mesmo produto.
        Confirme quando for o mesmo e diga quanto do insumo vem em 1 unidade da nota (ex.: pacote de 500 g = 0,5 kg). Recuse quando não for.</p>
      <div className="es-filtros nf-filtros"><input value={filtro} onChange={(v) => setFiltro(v.target.value)} placeholder="Produto ou insumo" aria-label="Filtrar sugestões" /></div>
      {msg && <p className="tv-alerta">{msg}</p>}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela">
          <thead><tr><th>Nome na nota</th><th>Insumo da ficha</th><th className="n">Quanto vem</th><th /></tr></thead>
          <tbody>
            {lista.map((a) => {
              const ins = insumos[a.insumo_id];
              return (
                <tr key={a.id}>
                  <td>{a.apelido}<small>vendido por {a.unidade_compra ?? "?"} · {Math.round((a.semelhanca ?? 0) * 100)}% parecido</small></td>
                  <td>{ins?.nome ?? "?"}<small>em {ins?.unidade}</small></td>
                  <td className="n"><input className="n ft-qtd" defaultValue={a.fator != null ? String(a.fator).replace(".", ",") : ""} placeholder="?"
                    onChange={(v) => { fatores.current[a.id] = v.target.value; }} aria-label={`Quanto de ${ins?.nome ?? "insumo"} vem em 1 ${a.unidade_compra ?? "unidade"}`} /> {ins?.unidade}</td>
                  <td className="nf-acoes"><button className="small" onClick={() => decidir(a, true, fatores.current[a.id])}>É o mesmo</button><button className="ghost small" onClick={() => decidir(a, false)}>Não é</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
