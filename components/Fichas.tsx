"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Fichas técnicas (Operação · fase 3): fichas copiadas do projeto "Fichas técnicas" (que continua como está),
// com o custo pelo último preço pago de cada insumo e a venda na TOTVS. Duas abas:
//  - Fichas técnicas: cartões pequenos por local; ao clicar, a ficha abre inteira para editar.
//  - Menus: o cardápio de cada casa (o que a TOTVS vendeu nos últimos 60 dias), cada item ligado à sua ficha.
// Foto (envio e retirada) em supabase/fichas_fotos_precos.sql; custo digitado de cada ingrediente em supabase/fichas_custo_manual.sql.
// Tabelas e funções em supabase/fichas.sql, fichas_importar.sql e fichas_edicao.sql. Cores e blocos do padrão do sistema (.es).
type Ficha = { id: string; nome: string; unidade_negocio: string; grupo: string | null; tipo: string; rendimento: number | null;
  rendimento_unidade: string | null; preparo: string | null; observacoes: string | null; foto: string | null; conferida: boolean };
type Custo = { ficha_id: string; custo: number | null; ingredientes: number; sem_preco: number };
type Venda = { ficha_id: string; unidade_totvs: string; produto: string; vendidos_30d: number; preco_medio: number | null };
type Item = { id: number; ordem: number; ingrediente: string; insumo_id: string | null; sub_ficha_id: string | null;
  quantidade: number | null; quantidade_texto: string | null; unidade: string | null; removido: boolean; custo_manual: number | null };
type Insumo = { id: string; nome: string; unidade: string };
type Preco = { insumo_id: string; data: string; fornecedor: string; preco: number; fonte: string };
type Apelido = { id: number; insumo_id: string; apelido: string; unidade_compra: string | null; fator: number | null; confirmado: boolean; semelhanca: number | null };
type Produto = { unidade_id: string; grupo: string | null; subgrupo: string | null; categoria: string | null; produto: string;
  vendidos_60d: number; preco_medio: number | null; ultima_venda: string; ficha_id: string | null };

const LOCAIS: Record<string, string> = { midway: "Cicchetti Midway", cicchetti_centro: "Cicchetti Centro", filha_da_lua: "Filha da Lua", producao: "Produção central" };
const CASAS: Record<string, string> = { midway: "Cicchetti Midway", pipa_centro: "Cicchetti Centro", filha_da_lua: "Filha da Lua" };
const DA_CASA: Record<string, string> = { midway: "midway", pipa_centro: "cicchetti_centro", filha_da_lua: "filha_da_lua" };
const TIPOS: Record<string, string> = { prato: "Prato", drink: "Drink", preparo: "Preparo" };
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const qtd = (v: number | null) => (v == null ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
// "0,16" e "1.250,5" (vírgula = decimal) ou "0.16"
const numero = (s: string) => { const t = s.trim(); if (!t) return null; return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const LIMITE_CMV = 0.35;

export default function Fichas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [custos, setCustos] = useState<Record<string, Custo>>({});
  const [vendas, setVendas] = useState<Record<string, Venda[]>>({});
  const [aba, setAba] = useState<"fichas" | "menus">("fichas");
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [f, c, v] = await Promise.all([
      supabase.from("fichas").select("id,nome,unidade_negocio,grupo,tipo,rendimento,rendimento_unidade,preparo,observacoes,foto,conferida").eq("ativa", true).order("nome"),
      supabase.from("fichas_custo").select("*"),
      supabase.from("fichas_venda").select("ficha_id,unidade_totvs,produto,vendidos_30d,preco_medio"),
    ]);
    setFichas((f.data ?? []) as Ficha[]);
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
      carregar();
    })();
  }, [supabase, userId, carregar]);

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="fichas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso às fichas técnicas.</p></main>
      </div>
    );
  }

  const ficha = aberta ? fichas.find((f) => f.id === aberta) : null;
  const comCusto = fichas.filter((f) => custos[f.id]?.custo != null).length;
  const conferidas = fichas.filter((f) => f.conferida).length;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="fichas" />
      <main className="miolo tv es ft">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Fichas técnicas</h1>
            <p>Cada prato, drink e preparo com os ingredientes, o modo de fazer e o custo pelo último preço pago. Clique numa ficha para abrir e editar.</p>
          </div>
        </div>

        <div className="es-numeros">
          <div className="es-numero"><span className="tv-cartao-rotulo">Fichas</span><span className="es-numero-valor">{fichas.length}</span><span className="tv-cartao-detalhe">{conferidas} conferidas com a cozinha</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Com custo</span><span className="es-numero-valor">{comCusto}</span><span className="tv-cartao-detalhe">pelo último preço das notas</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">No cardápio</span><span className="es-numero-valor">{Object.keys(vendas).length}</span><span className="tv-cartao-detalhe">vendidas na TOTVS em 30 dias</span></div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "fichas"} className={aba === "fichas" ? "on" : ""} onClick={() => setAba("fichas")}>Fichas técnicas</button>
          <button role="tab" aria-selected={aba === "menus"} className={aba === "menus" ? "on" : ""} onClick={() => setAba("menus")}>Menus</button>
        </div>

        {aba === "fichas"
          ? <ListaFichas fichas={fichas} custos={custos} vendas={vendas} abrir={setAberta} onMudou={carregar} />
          : <Menus fichas={fichas} custos={custos} abrir={setAberta} />}
      </main>

      {ficha && <FichaAberta ficha={ficha} custo={custos[ficha.id]} vendas={vendas[ficha.id] ?? []} onMudou={carregar} onFechar={() => setAberta(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Aba Fichas técnicas: escolhe o local, depois o grupo; cartões pequenos
// ---------------------------------------------------------------------
function ListaFichas({ fichas, custos, vendas, abrir, onMudou }: {
  fichas: Ficha[]; custos: Record<string, Custo>; vendas: Record<string, Venda[]>; abrir: (id: string) => void; onMudou: () => void;
}) {
  const [local, setLocal] = useState("midway");
  const [grupo, setGrupo] = useState("");
  const [busca, setBusca] = useState("");
  const [revisar, setRevisar] = useState(false);

  const doLocal = fichas.filter((f) => f.unidade_negocio === local);
  const grupos = [...new Set(doLocal.map((f) => f.grupo ?? TIPOS[f.tipo]))];
  const b = busca.trim().toLowerCase();
  const visiveis = (b ? fichas.filter((f) => f.nome.toLowerCase().includes(b)) : doLocal.filter((f) => !grupo || (f.grupo ?? TIPOS[f.tipo]) === grupo));
  const porGrupo = [...new Set(visiveis.map((f) => (b ? LOCAIS[f.unidade_negocio] : f.grupo ?? TIPOS[f.tipo])))]
    .map((g) => ({ g, fs: visiveis.filter((f) => (b ? LOCAIS[f.unidade_negocio] : f.grupo ?? TIPOS[f.tipo]) === g) }));

  if (revisar) {
    return (
      <>
        <button className="ghost small ft-voltar" onClick={() => setRevisar(false)}>← Voltar para as fichas</button>
        <RevisarInsumos onMudou={onMudou} />
      </>
    );
  }

  return (
    <>
      <div className="ft-barra">
        <div className="ft-chips" role="tablist" aria-label="Local">
          {Object.entries(LOCAIS).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={local === k && !b} className={local === k && !b ? "on" : ""} onClick={() => { setLocal(k); setGrupo(""); setBusca(""); }}>
              {n}<span>{fichas.filter((f) => f.unidade_negocio === k).length}</span>
            </button>
          ))}
        </div>
        <div className="ft-ferramentas">
          <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar ficha" aria-label="Buscar ficha" />
          <button className="ghost small" onClick={() => setRevisar(true)}>Revisar insumos</button>
        </div>
      </div>
      {!b && grupos.length > 1 && (
        <div className="ft-chips ft-chips-sub" role="tablist" aria-label="Grupo">
          <button role="tab" aria-selected={!grupo} className={!grupo ? "on" : ""} onClick={() => setGrupo("")}>Todos</button>
          {grupos.map((g) => <button key={g} role="tab" aria-selected={grupo === g} className={grupo === g ? "on" : ""} onClick={() => setGrupo(g)}>{g}</button>)}
        </div>
      )}

      {porGrupo.map(({ g, fs }) => (
        <section key={g} className="ft-secao">
          <h2>{g}<span className="muted">{fs.length} {fs.length === 1 ? "ficha" : "fichas"}</span></h2>
          <div className="ft-cards">
            {fs.map((f) => <Cartao key={f.id} ficha={f} custo={custos[f.id]} venda={(vendas[f.id] ?? [])[0]} abrir={() => abrir(f.id)} />)}
          </div>
        </section>
      ))}
      {!visiveis.length && <p className="muted vazio">Nenhuma ficha encontrada.</p>}
    </>
  );
}

function Cartao({ ficha, custo, venda, abrir }: { ficha: Ficha; custo?: Custo; venda?: Venda; abrir: () => void }) {
  const cmv = custo?.custo != null && venda?.preco_medio ? custo.custo / venda.preco_medio : null;
  return (
    <button className="ft-card" onClick={abrir}>
      {ficha.foto
        ? <img className={ficha.tipo === "drink" ? "ft-card-foto drink" : "ft-card-foto"} src={ficha.foto} alt="" loading="lazy" />
        : <span className="ft-card-foto vazia" aria-hidden="true">{ficha.nome.slice(0, 1)}</span>}
      <span className="ft-card-txt">
        <b>{ficha.nome}</b>
        <small>
          {custo?.custo != null ? `Custo ${brl(custo.custo)}` : "Sem custo ainda"}
          {cmv != null && <> · <span className={cmv > LIMITE_CMV ? "es-ruim" : ""}>{pct(cmv)} do preço</span></>}
        </small>
      </span>
      {ficha.conferida && <span className="estado tv-ok ft-card-selo">conferida</span>}
    </button>
  );
}

// ---------------------------------------------------------------------
// Ficha aberta: a ficha inteira, grande, para editar
// ---------------------------------------------------------------------
function FichaAberta({ ficha, custo, vendas, onMudou, onFechar }: { ficha: Ficha; custo?: Custo; vendas: Venda[]; onMudou: () => void; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [itens, setItens] = useState<Item[]>([]);
  const [custoItem, setCustoItem] = useState<Record<number, number | null>>({});
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [precos, setPrecos] = useState<Record<string, Preco>>({});
  const [form, setForm] = useState({ nome: ficha.nome, grupo: ficha.grupo ?? "", rendimento: ficha.rendimento != null ? qtd(ficha.rendimento) : "",
    rendimento_unidade: ficha.rendimento_unidade ?? "", preparo: ficha.preparo ?? "", observacoes: ficha.observacoes ?? "" });
  const [novo, setNovo] = useState({ ingrediente: "", quantidade: "", unidade: "", insumo: "" });
  const [msg, setMsg] = useState("");
  const [salvo, setSalvo] = useState("");
  const painel = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const [a, b, c, d] = await Promise.all([
      supabase.from("fichas_itens").select("*").eq("ficha_id", ficha.id).eq("removido", false).order("ordem"),
      supabase.from("fichas_itens_custo").select("item_id,custo").eq("ficha_id", ficha.id),
      supabase.from("insumos").select("id,nome,unidade").eq("ativo", true).order("nome"),
      supabase.from("insumos_precos").select("*"),
    ]);
    setItens((a.data ?? []) as Item[]);
    setCustoItem(Object.fromEntries(((b.data ?? []) as { item_id: number; custo: number | null }[]).map((x) => [x.item_id, x.custo])));
    setInsumos((c.data ?? []) as Insumo[]);
    setPrecos(Object.fromEntries(((d.data ?? []) as Preco[]).map((x) => [x.insumo_id, x])));
  }, [supabase, ficha.id]);
  useEffect(() => { carregar(); }, [carregar]);

  // Esc fecha; o foco vai para o painel ao abrir
  useEffect(() => {
    painel.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [onFechar]);

  const porNome = useMemo(() => Object.fromEntries(insumos.map((i) => [i.nome.toLowerCase(), i])), [insumos]);
  const porId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i])), [insumos]);
  const v = [...vendas].sort((x, y) => y.vendidos_30d - x.vendidos_30d)[0];
  const cmv = custo?.custo != null && v?.preco_medio ? custo.custo / v.preco_medio : null;

  async function feito(p: PromiseLike<{ error: { message: string } | null }>, texto = "Salvo.") {
    setMsg(""); setSalvo("");
    const { error } = await p;
    if (error) return setMsg(error.message);
    setSalvo(texto);
    carregar(); onMudou();
  }
  function salvarItem(i: Item, m: Partial<{ ingrediente: string; quantidade: string; unidade: string; insumo: string; removido: boolean }>) {
    const q = m.quantidade !== undefined ? numero(m.quantidade) : i.quantidade;
    if (q !== null && Number.isNaN(q)) return setMsg("Quantidade inválida.");
    const insumo = m.insumo !== undefined ? (porNome[m.insumo.trim().toLowerCase()]?.id ?? (m.insumo.trim() ? undefined : null)) : i.insumo_id;
    if (insumo === undefined) return setMsg(`“${m.insumo}” não está no cadastro de insumos. Escolha um nome da lista.`);
    feito(supabase.rpc("fichas_item_atualizar", { p_item: i.id, p_ingrediente: m.ingrediente ?? i.ingrediente, p_quantidade: q,
      p_unidade: m.unidade ?? i.unidade ?? "", p_insumo: insumo, p_removido: m.removido ?? false }), m.removido ? "Ingrediente tirado." : "Salvo.");
  }
  function incluir() {
    const q = numero(novo.quantidade);
    if (q !== null && Number.isNaN(q)) return setMsg("Quantidade inválida.");
    const insumo = novo.insumo.trim() ? porNome[novo.insumo.trim().toLowerCase()]?.id : null;
    if (insumo === undefined) return setMsg(`“${novo.insumo}” não está no cadastro de insumos. Escolha um nome da lista.`);
    feito(supabase.rpc("fichas_item_incluir", { p_ficha: ficha.id, p_ingrediente: novo.ingrediente, p_quantidade: q, p_unidade: novo.unidade, p_insumo: insumo }), "Ingrediente incluído.");
    setNovo({ ingrediente: "", quantidade: "", unidade: "", insumo: "" });
  }
  function salvarTextos() {
    const r = numero(form.rendimento);
    if (r !== null && Number.isNaN(r)) return setMsg("Rendimento inválido.");
    feito(supabase.rpc("fichas_salvar", { p_ficha: ficha.id, p_nome: form.nome, p_grupo: form.grupo, p_rendimento: r,
      p_rendimento_unidade: form.rendimento_unidade, p_preparo: form.preparo, p_observacoes: form.observacoes }));
  }

  return (
    <div className="ft-fundo" onClick={onFechar}>
      <div className="ft-painel es" role="dialog" aria-modal="true" aria-label={`Ficha técnica: ${ficha.nome}`} tabIndex={-1} ref={painel} onClick={(e) => e.stopPropagation()}>
        <header className="ft-painel-cabeca">
          <FotoFicha ficha={ficha} feito={feito} avisar={setMsg} />
          <div className="ft-painel-titulo">
            <span className="es-sobre">{LOCAIS[ficha.unidade_negocio]} · {ficha.grupo ?? TIPOS[ficha.tipo]}</span>
            <input className="ft-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} onBlur={() => form.nome !== ficha.nome && salvarTextos()} aria-label="Nome da ficha" />
            <div className="ft-indicadores">
              <span><small>Custo</small><b>{brl(custo?.custo)}</b>{custo && custo.sem_preco > 0 && <em>{custo.sem_preco} sem preço</em>}</span>
              <span><small>Venda na TOTVS</small><b>{v ? brl(v.preco_medio) : "—"}</b>{v && <em>{qtd(v.vendidos_30d)} em 30 dias</em>}</span>
              <span><small>Custo ÷ preço</small><b className={cmv != null && cmv > LIMITE_CMV ? "es-ruim" : ""}>{cmv != null ? pct(cmv) : "—"}</b></span>
            </div>
          </div>
          <div className="ft-painel-acoes">
            {ficha.conferida
              ? <button className="ghost small" onClick={() => feito(supabase.rpc("fichas_conferir", { p_ficha: ficha.id, p_conferida: false }))}>Desmarcar conferida</button>
              : <button className="small" onClick={() => feito(supabase.rpc("fichas_conferir", { p_ficha: ficha.id, p_conferida: true }), "Marcada como conferida.")}>Marcar como conferida</button>}
            <button className="ghost small" onClick={onFechar} aria-label="Fechar a ficha">Fechar</button>
          </div>
        </header>

        {(msg || salvo) && <p className={msg ? "es-aviso tv-alerta" : "es-aviso"} role="status">{msg || salvo}</p>}

        <div className="ft-painel-corpo">
          <section className="ft-ingredientes">
            <h3>Ingredientes</h3>
            <div className="nf-tabela-wrap">
              <table className="nf-tabela ft-tabela">
                <thead><tr><th>Ingrediente</th><th className="n">Qtd.</th><th>Un.</th><th>Insumo (para o custo)</th><th className="n">Custo</th><th /></tr></thead>
                <tbody>
                  {itens.map((i) => {
                    const ins = i.insumo_id ? porId[i.insumo_id] : null;
                    const p = i.insumo_id ? precos[i.insumo_id] : null;
                    const c = custoItem[i.id];
                    return (
                      <tr key={`${i.id}-${i.quantidade}-${i.insumo_id}-${i.custo_manual}`}>
                        <td><input defaultValue={i.ingrediente} onBlur={(e) => e.target.value.trim() !== i.ingrediente && salvarItem(i, { ingrediente: e.target.value })} aria-label="Ingrediente" />
                          {i.sub_ficha_id && <small>usa outra ficha (preparo)</small>}</td>
                        <td className="n"><input className="n" inputMode="decimal" defaultValue={i.quantidade != null ? qtd(i.quantidade) : i.quantidade_texto ?? ""} placeholder="q.b."
                          onBlur={(e) => e.target.value !== (i.quantidade != null ? qtd(i.quantidade) : i.quantidade_texto ?? "") && salvarItem(i, { quantidade: e.target.value })} aria-label={`Quantidade de ${i.ingrediente}`} /></td>
                        <td><input className="ft-un" defaultValue={i.unidade ?? ""} onBlur={(e) => e.target.value.trim() !== (i.unidade ?? "") && salvarItem(i, { unidade: e.target.value })} aria-label={`Unidade de ${i.ingrediente}`} /></td>
                        <td><input list="ft-insumos" defaultValue={ins?.nome ?? ""} placeholder="escolha um insumo"
                          onBlur={(e) => e.target.value.trim() !== (ins?.nome ?? "") && salvarItem(i, { insumo: e.target.value })} aria-label={`Insumo de ${i.ingrediente}`} />
                          {p && <small>{brl(p.preco)} / {ins?.unidade} · {p.fornecedor}</small>}</td>
                        <td className="n"><CustoItem item={i} custo={c ?? null} feito={feito} avisar={setMsg} /></td>
                        <td><button className="ghost small ft-tirar" onClick={() => salvarItem(i, { removido: true })} aria-label={`Tirar ${i.ingrediente}`} title="Tirar da ficha">×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
                {custo?.custo != null && <tfoot><tr><td colSpan={4}><strong>Custo da ficha</strong></td><td className="n"><strong>{brl(custo.custo)}</strong></td><td /></tr></tfoot>}
              </table>
            </div>
            <datalist id="ft-insumos">{insumos.map((i) => <option key={i.id} value={i.nome}>{i.unidade}</option>)}</datalist>
            <div className="ft-incluir">
              <input value={novo.ingrediente} onChange={(e) => setNovo({ ...novo, ingrediente: e.target.value })} placeholder="Novo ingrediente" aria-label="Novo ingrediente" />
              <input className="n" inputMode="decimal" value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} placeholder="Qtd." aria-label="Quantidade" />
              <input value={novo.unidade} onChange={(e) => setNovo({ ...novo, unidade: e.target.value })} placeholder="Un." aria-label="Unidade" />
              <input list="ft-insumos" value={novo.insumo} onChange={(e) => setNovo({ ...novo, insumo: e.target.value })} placeholder="Insumo" aria-label="Insumo" />
              <button className="ghost small" disabled={!novo.ingrediente.trim()} onClick={incluir}>Incluir</button>
            </div>
          </section>

          <section className="ft-preparo-bloco">
            <h3>Modo de preparo</h3>
            <textarea rows={Math.max(6, form.preparo.split("\n").length + 1)} value={form.preparo} onChange={(e) => setForm({ ...form, preparo: e.target.value })}
              placeholder="Um passo por linha" aria-label="Modo de preparo" />
            <h3>Observações</h3>
            <textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} aria-label="Observações" />
            <div className="ft-linha">
              <label>Grupo<input value={form.grupo} onChange={(e) => setForm({ ...form, grupo: e.target.value })} /></label>
              <label>Rende<input inputMode="decimal" value={form.rendimento} onChange={(e) => setForm({ ...form, rendimento: e.target.value })} /></label>
              <label>Unidade<input value={form.rendimento_unidade} onChange={(e) => setForm({ ...form, rendimento_unidade: e.target.value })} placeholder="porções, kg…" /></label>
            </div>
            <button onClick={salvarTextos}>Salvar preparo e observações</button>
            {vendas.length > 0 && (
              <p className="muted ft-totvs">Na TOTVS: {vendas.map((x) => `${titulo(x.produto)} (${CASAS[x.unidade_totvs] ?? x.unidade_totvs}) · ${qtd(x.vendidos_30d)} vendidos a ${brl(x.preco_medio)}`).join(" | ")}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Foto da ficha: enviar (a foto é reduzida no navegador antes de subir), trocar ou tirar.
// Tirar só desliga a foto da ficha: o arquivo fica guardado e a troca vai para o histórico.
type Feito = (p: PromiseLike<{ error: { message: string } | null }>, texto?: string) => Promise<void>;

function FotoFicha({ ficha, feito, avisar }: { ficha: Ficha; feito: Feito; avisar: (m: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) return avisar("Escolha uma imagem (JPG, PNG ou WebP).");
    setEnviando(true);
    try {
      const foto = await reduzir(arquivo);
      const nome = `${ficha.id}-${Date.now()}.jpg`;
      const up = await supabase.storage.from("fichas-fotos").upload(nome, foto, { contentType: "image/jpeg" });
      if (up.error) return avisar(`Não foi possível enviar a foto: ${up.error.message}`);
      await feito(supabase.rpc("fichas_foto_definir", { p_ficha: ficha.id, p_foto: `/api/fichas/foto/${nome}` }), "Foto salva.");
    } catch {
      avisar("Não foi possível ler essa imagem. Tente outra foto.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }
  function tirar() {
    if (!confirm(`Tirar a foto da ficha “${ficha.nome}”?`)) return;
    feito(supabase.rpc("fichas_foto_definir", { p_ficha: ficha.id, p_foto: null }), "Foto tirada.");
  }

  return (
    <div className="ft-foto-bloco">
      {ficha.foto
        ? <img className={ficha.tipo === "drink" ? "ft-painel-foto drink" : "ft-painel-foto"} src={ficha.foto} alt={`Foto de ${ficha.nome}`} />
        : <button className="ft-painel-foto vazia" onClick={() => entrada.current?.click()} disabled={enviando}>{enviando ? "Enviando…" : "+ Adicionar foto"}</button>}
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => enviar(e.target.files?.[0])} />
      {ficha.foto && (
        <div className="ft-foto-acoes">
          <button className="ghost small" onClick={() => entrada.current?.click()} disabled={enviando}>{enviando ? "Enviando…" : "Trocar foto"}</button>
          <button className="ghost small" onClick={tirar} disabled={enviando}>Tirar foto</button>
        </div>
      )}
    </div>
  );
}

// Reduz a foto para no máximo 1200 px no lado maior, em JPEG (fotos de celular chegam a 5 MB)
async function reduzir(arquivo: File): Promise<Blob> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1200 / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(img.width * escala);
  tela.height = Math.round(img.height * escala);
  const ctx = tela.getContext("2d");
  if (!ctx) throw new Error("sem canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tela.width, tela.height);
  ctx.drawImage(img, 0, 0, tela.width, tela.height);
  return await new Promise<Blob>((ok, erro) => tela.toBlob((b) => (b ? ok(b) : erro(new Error("sem foto"))), "image/jpeg", 0.85));
}

// Custo do ingrediente na ficha: mostra a conta (quantidade × último preço) e deixa digitar o valor em R$.
// O valor digitado vale no lugar da conta; apagar o campo volta para a conta.
function CustoItem({ item, custo, feito, avisar }: { item: Item; custo: number | null; feito: Feito; avisar: (m: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const inicial = item.custo_manual != null ? item.custo_manual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  function salvar(texto: string) {
    const t = texto.replace(/r\$\s*/i, "").trim();
    if (t === inicial) return;
    const v = numero(t);
    if (v != null && (Number.isNaN(v) || v < 0)) return avisar("Custo inválido: use, por exemplo, 12,50.");
    feito(supabase.rpc("fichas_item_custo", { p_item: item.id, p_custo: v }),
      v == null ? `${item.ingrediente}: custo voltou para a conta pelo preço da nota.` : `Custo de ${item.ingrediente} salvo.`);
  }
  return (
    <span className="ft-custo">
      <input className="n" inputMode="decimal" defaultValue={inicial}
        placeholder={item.custo_manual == null && custo != null ? brl(custo) : item.quantidade == null && item.custo_manual == null ? "q.b." : "R$ 0,00"}
        onBlur={(e) => salvar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={`Custo de ${item.ingrediente}`} title="Digite o custo em R$; apague para voltar à conta" />
      <small>{item.custo_manual != null ? "digitado" : custo != null ? "pela nota" : "sem custo"}</small>
    </span>
  );
}

// ---------------------------------------------------------------------
// Aba Menus: o cardápio de cada casa, ligado às fichas
// ---------------------------------------------------------------------
function Menus({ fichas, custos, abrir }: { fichas: Ficha[]; custos: Record<string, Custo>; abrir: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [casa, setCasa] = useState("midway");
  const [categoria, setCategoria] = useState("comida");
  const [ligando, setLigando] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("menus_produtos").select("*").neq("grupo", "TAXAS").order("subgrupo").order("produto");
    if (error) setMsg(error.message);
    setProdutos((data ?? []) as Produto[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function ligar(p: Produto, fichaId: string) {
    setMsg("");
    const { error } = await supabase.rpc("fichas_totvs_ligar", { p_ficha: fichaId, p_unidade: p.unidade_id, p_produto: p.produto, p_ligar: true });
    if (error) return setMsg(error.message);
    setLigando(null);
    carregar();
  }

  if (!produtos) return <p className="muted">Carregando o cardápio…</p>;
  const daCasa = produtos.filter((p) => p.unidade_id === casa);
  const lista = daCasa.filter((p) => (p.categoria ?? "").toLowerCase() === categoria);
  const secoes = [...new Set(lista.map((p) => p.subgrupo ?? "Outros"))].map((s) => ({ s, ps: lista.filter((p) => (p.subgrupo ?? "Outros") === s) }));
  const ligados = lista.filter((p) => p.ficha_id).length;
  const fichasDaCasa = fichas.filter((f) => f.unidade_negocio === DA_CASA[casa] || f.unidade_negocio === "producao");

  return (
    <>
      <div className="ft-barra">
        <div className="ft-chips" role="tablist" aria-label="Casa">
          {Object.entries(CASAS).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={casa === k} className={casa === k ? "on" : ""} onClick={() => setCasa(k)}>
              {n}<span>{produtos.filter((p) => p.unidade_id === k).length}</span>
            </button>
          ))}
        </div>
        <div className="ft-chips" role="tablist" aria-label="Comida ou bebida">
          {["comida", "bebida"].map((c) => (
            <button key={c} role="tab" aria-selected={categoria === c} className={categoria === c ? "on" : ""} onClick={() => setCategoria(c)}>{c === "comida" ? "Comida" : "Bebida"}</button>
          ))}
        </div>
      </div>
      <p className="muted cp-ajuda">O cardápio é o que a TOTVS vendeu nos últimos 60 dias. {ligados} de {lista.length} itens já estão ligados a uma ficha:
        clique para abrir a ficha, ou ligue os que faltam.</p>
      {msg && <p className="es-aviso tv-alerta">{msg}</p>}

      {secoes.map(({ s, ps }) => (
        <section key={s} className="ft-secao">
          <h2>{titulo(s)}<span className="muted">{ps.length} {ps.length === 1 ? "item" : "itens"}</span></h2>
          <div className="nf-tabela-wrap">
            <table className="nf-tabela ft-menu">
              <thead><tr><th>Item</th><th className="n">Preço</th><th className="n">Vendidos em 60 dias</th><th className="n">Custo</th><th className="n">Custo ÷ preço</th><th>Ficha</th></tr></thead>
              <tbody>
                {ps.map((p) => {
                  const f = p.ficha_id ? fichas.find((x) => x.id === p.ficha_id) : null;
                  const c = f ? custos[f.id]?.custo ?? null : null;
                  const cmv = c != null && p.preco_medio ? c / p.preco_medio : null;
                  const chave = `${p.unidade_id}|${p.produto}`;
                  return (
                    <tr key={chave} className={f ? "ft-menu-ligado" : ""} onClick={f ? () => abrir(f.id) : undefined}>
                      <td><strong>{titulo(p.produto)}</strong></td>
                      <td className="n">{brl(p.preco_medio)}</td>
                      <td className="n">{qtd(p.vendidos_60d)}</td>
                      <td className="n">{c != null ? brl(c) : "—"}</td>
                      <td className="n">{cmv != null ? <span className={cmv > LIMITE_CMV ? "es-ruim" : ""}>{pct(cmv)}</span> : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {f ? <button className="ft-link" onClick={() => abrir(f.id)}>{f.nome}</button>
                          : ligando === chave
                            ? <select autoFocus defaultValue="" onChange={(e) => e.target.value && ligar(p, e.target.value)} onBlur={() => setLigando(null)} aria-label={`Ficha de ${p.produto}`}>
                                <option value="">Escolha a ficha…</option>
                                {fichasDaCasa.map((x) => <option key={x.id} value={x.id}>{x.nome} · {LOCAIS[x.unidade_negocio]}</option>)}
                              </select>
                            : <button className="ghost small" onClick={() => setLigando(chave)}>Ligar ficha</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!lista.length && <p className="muted vazio">Nada vendido nesta casa nos últimos 60 dias.</p>}
    </>
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
