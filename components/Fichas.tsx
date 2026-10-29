"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Fichas técnicas (Operação · fase 3): fichas copiadas do projeto "Fichas técnicas" para tabelas,
// com o custo calculado pelo último preço pago de cada insumo e a margem frente à venda na TOTVS.
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

export default function Fichas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [custos, setCustos] = useState<Record<string, Custo>>({});
  const [vendas, setVendas] = useState<Record<string, Venda[]>>({});
  const [unidade, setUnidade] = useState("");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [aba, setAba] = useState<"fichas" | "insumos">("fichas");

  const carregar = useCallback(async () => {
    const [f, c, v] = await Promise.all([
      supabase.from("fichas").select("id,nome,unidade_negocio,grupo,tipo,rendimento,rendimento_unidade,preparo,observacoes,foto,conferida").eq("ativa", true).order("nome"),
      supabase.from("fichas_custo").select("*"),
      supabase.from("fichas_venda").select("ficha_id,produto,vendidos_30d,preco_medio"),
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

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return fichas.filter((f) => (!unidade || f.unidade_negocio === unidade) && (!tipo || f.tipo === tipo) && (!b || f.nome.toLowerCase().includes(b)));
  }, [fichas, unidade, tipo, busca]);
  const resumo = useMemo(() => ({
    total: fichas.length,
    conferidas: fichas.filter((f) => f.conferida).length,
    comCusto: fichas.filter((f) => custos[f.id]?.custo != null).length,
    completas: fichas.filter((f) => custos[f.id]?.custo != null && custos[f.id]?.sem_preco === 0).length,
    vendidas: Object.keys(vendas).length,
  }), [fichas, custos, vendas]);

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="fichas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso às fichas técnicas.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="fichas" />
      <main className="miolo tv es ft">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Fichas técnicas</h1>
            <p>Cada prato, drink e preparo com os ingredientes e o custo pelo último preço pago. Copiadas do projeto Fichas técnicas, que continua como está.</p>
          </div>
        </div>

        <div className="es-numeros">
          <div className="es-numero"><span className="tv-cartao-rotulo">Fichas</span><span className="es-numero-valor">{resumo.total}</span><span className="tv-cartao-detalhe">{resumo.conferidas} conferidas com a cozinha</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Com custo</span><span className="es-numero-valor">{resumo.comCusto}</span><span className="tv-cartao-detalhe">{resumo.completas} com todos os ingredientes</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Ligadas à TOTVS</span><span className="es-numero-valor">{resumo.vendidas}</span><span className="tv-cartao-detalhe">com venda nos últimos 30 dias</span></div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "fichas"} className={aba === "fichas" ? "on" : ""} onClick={() => setAba("fichas")}>Fichas</button>
          <button role="tab" aria-selected={aba === "insumos"} className={aba === "insumos" ? "on" : ""} onClick={() => setAba("insumos")}>Revisar insumos</button>
        </div>

        {aba === "insumos" ? <RevisarInsumos onMudou={carregar} /> : (
          <section className="es-bloco">
            <div className="es-filtros nf-filtros">
              <select value={unidade} onChange={(v) => setUnidade(v.target.value)} aria-label="Unidade">
                <option value="">Todas as unidades</option>
                {Object.entries(UNIDADES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <select value={tipo} onChange={(v) => setTipo(v.target.value)} aria-label="Tipo">
                <option value="">Pratos, drinks e preparos</option>
                {Object.entries(TIPOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <input value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Nome da ficha" aria-label="Buscar ficha" />
            </div>
            <div className="nf-tabela-wrap">
              <table className="nf-tabela nf-lista">
                <thead><tr><th>Ficha</th><th>Unidade</th><th className="n">Custo</th><th className="n">Venda (30 dias)</th><th className="n">Custo ÷ preço</th><th /></tr></thead>
                <tbody>
                  {visiveis.map((f) => {
                    const c = custos[f.id];
                    const v = (vendas[f.id] ?? []).sort((a, b) => b.vendidos_30d - a.vendidos_30d)[0];
                    const cmv = c?.custo != null && v?.preco_medio ? c.custo / v.preco_medio : null;
                    return (
                      <tr key={f.id} onClick={() => setAberta(aberta === f.id ? null : f.id)} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && setAberta(f.id)}>
                        <td><strong>{f.nome}</strong><small>{f.grupo ?? TIPOS[f.tipo]}</small></td>
                        <td>{UNIDADES[f.unidade_negocio]}</td>
                        <td className="n">{brl(c?.custo)}{c && c.sem_preco > 0 && <small>{c.sem_preco} sem preço</small>}</td>
                        <td className="n">{v ? <>{brl(v.preco_medio)}<small>{qtd(v.vendidos_30d)} vendidos</small></> : "—"}</td>
                        <td className="n">{cmv != null ? <span className={cmv > 0.35 ? "es-ruim" : ""}>{pct(cmv)}</span> : "—"}</td>
                        <td>{f.conferida ? <span className="estado tv-ok">conferida</span> : <span className="estado">a conferir</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {aberta && <Detalhe ficha={fichas.find((f) => f.id === aberta)!} vendas={vendas[aberta] ?? []} onMudou={carregar} onFechar={() => setAberta(null)} />}
            <p className="muted es-nota">O custo usa o último preço pago de cada insumo (notas da SEFAZ, avulsas e Cicchetti Management), só quando o nome da nota
              já foi ligado ao insumo e a unidade combina (g/kg, ml/L, un). Ingrediente “q.b.” não entra na conta. Custo ÷ preço acima de 35% aparece em vermelho.</p>
          </section>
        )}
      </main>
    </div>
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
