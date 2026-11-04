"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { NotaAvulsa } from "./Notas";

// Compras (Operação · fase 2): pedidos do grupo COMPRAS analisados pelo Claude viram listas por pessoa
// (uma por pedido: mercado, Ceasa...), cada item ligado ao produto das notas, com a média de 4 semanas e a
// projeção; cada pessoa revisa, junta listas se quiser e aprova; a Fernanda junta as aprovadas na lista
// única por fornecedor e gera o PDF. Tabelas e funções em supabase/compras.sql e compras_listas_metricas.sql.
type Papel = "socio" | "compras" | "solicitante" | null;
type Pessoa = { id: string; nome: string; unidade: string | null; setor: string | null; papel: string; email?: string | null;
  user_id: string | null; wa_nome: string | null; ativo: boolean; convidado_em: string | null; registra_estoque?: boolean };
type Semana = { id: string; inicio: string; status: string; aumento_pct?: number };
type Lista = { id: string; semana_id: string; pessoa_id: string; status: string; titulo: string | null; pedido_texto: string | null; analisada_em: string | null; aprovada_em: string | null; created_at: string };
type Item = { id: number; lista_id: string; ordem: number; nome: string; fornecedor: string | null; unidade: string | null;
  qtd_pedida: number | null; qtd_sugerida: number | null; motivo: string | null; qtd: number | null; preco: number | null;
  removido: boolean; incluido_na_revisao: boolean; media_4s: number | null; projecao: number | null; base: string | null;
  produto_nota: string | null; confianca: "alta" | "media" | "baixa" | null };
type Final = { id: number; fornecedor: string; nome: string; unidade: string; qtd: number | null; preco: number | null;
  origem: { pessoa: string; unidade: string; setor: string; qtd: number }[]; removido: boolean; editado: boolean };

const UNIDADES: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua" };
const SETORES: Record<string, string> = { bar: "Bar", cozinha: "Cozinha", salao: "Salão", producao: "Produção" };
const STATUS: Record<string, string> = { aguardando: "aguardando análise", em_revisao: "em revisão", aprovada: "aprovada" };
const ATIVAS = ["aguardando", "em_revisao", "aprovada"];
const CONFIANCA: Record<string, string> = { alta: "produto certo nas notas", media: "produto parecido nas notas", baixa: "não achado nas notas" };
// Situação de uma pessoa com várias listas: aprovada só quando todas estão aprovadas
const situacao = (ls: Lista[]) => (!ls.length ? null : ls.every((l) => l.status === "aprovada") ? "aprovada" : ls.some((l) => l.status === "em_revisao") ? "em_revisao" : "aguardando");
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const ler = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const fimSemana = (iso: string) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + 6); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };

export default function Compras({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<Papel | undefined>(undefined);
  const [eu, setEu] = useState<Pessoa | null>(null);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [aba, setAba] = useState<"andamento" | "final" | "pessoas" | "avulsa">("andamento");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("operacao_eu");
      const r = (data ?? {}) as { papel: Papel; pessoa: Pessoa | null };
      setPapel(r.papel ?? null);
      setEu(r.pessoa);
      if (!r.papel) return;
      const { data: atual } = await supabase.rpc("compras_semana_atual");
      const { data: ss } = await supabase.from("compras_semanas").select("id,inicio,status,aumento_pct").order("inicio", { ascending: false }).limit(20);
      const lista = (ss ?? []) as Semana[];
      setSemanas(lista);
      setSemana(lista.find((s) => s.id === atual) ?? lista[0] ?? null);
    })();
  }, [supabase]);

  const gestor = papel === "socio" || papel === "compras";

  if (papel === undefined) return <div className="pagina"><main className="miolo"><p className="muted vazio">Carregando…</p></main></div>;
  if (papel === null) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="compras" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à área de Compras.</p></main>
      </div>
    );
  }

  const cabecalho = semana && (
    <div className="es-topo">
      <div>
        <span className="es-sobre">Operação · Compras</span>
        <h1>{gestor ? "Compras da semana" : `Sua lista · ${SETORES[eu?.setor ?? ""] ?? ""} · ${UNIDADES[eu?.unidade ?? ""] ?? ""}`}</h1>
        <p>Semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}. Pedidos no grupo até terça à noite; a lista sugerida de cada pessoa sai em até 15 minutos depois de cada mensagem no grupo.
          {semana.status === "fechada" && " Esta semana já foi fechada."}</p>
      </div>
      {semanas.length > 1 && (
        <select className="cp-semana" value={semana.id} onChange={(v) => setSemana(semanas.find((s) => s.id === v.target.value) ?? null)} aria-label="Semana">
          {semanas.map((s) => <option key={s.id} value={s.id}>Semana de {diaSemana(s.inicio)}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <div className="pagina">
      {gestor ? <Topo email={userEmail} ativo="compras" /> : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} outra={eu?.registra_estoque ? { href: "/estoque", nome: "Câmara fria" } : undefined} />}
      <main className="miolo tv es cp-area nf-larga">
        {cabecalho}
        {!semana ? <p className="muted">Carregando a semana…</p> : gestor ? (
          <>
            <div className="cp-abas" role="tablist">
              <button role="tab" aria-selected={aba === "andamento"} className={aba === "andamento" ? "on" : ""} onClick={() => setAba("andamento")}>Listas</button>
              <button role="tab" aria-selected={aba === "final"} className={aba === "final" ? "on" : ""} onClick={() => setAba("final")}>Lista única</button>
              <button role="tab" aria-selected={aba === "avulsa"} className={aba === "avulsa" ? "on" : ""} onClick={() => setAba("avulsa")}>Nota avulsa</button>
              {papel === "socio" && <button role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "on" : ""} onClick={() => setAba("pessoas")}>Pessoas e acesso</button>}
            </div>
            {aba === "andamento" && <Andamento semana={semana} />}
            {aba === "final" && <ListaUnica semana={semana} />}
            {aba === "avulsa" && <NotaAvulsa empresas={[]} onPronto={() => {}} />}
            {aba === "pessoas" && papel === "socio" && <Pessoas />}
          </>
        ) : eu ? (
          <>
            <MinhaLista semana={semana} pessoa={eu} />
            <NotaAvulsa empresas={[]} onPronto={() => {}} />
          </>
        ) : null}
      </main>
    </div>
  );
}

// Para quem só tem a área de Compras: sem o menu do Brasico
// Topo de quem só abre uma área da Operação (solicitantes, Fernanda, câmara fria)
export function TopoSimples({ email, nome, area = "Compras", outra }: { email: string; nome: string; area?: string; outra?: { href: string; nome: string } }) {
  async function sair() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <header className="topo cp-topo">
      <span className="marca">Brasico · {area}</span>
      <span className="cp-quem">{outra && <a href={outra.href}>{outra.nome}</a>}{nome || email}<button className="ghost small" onClick={sair}>Sair</button></span>
    </header>
  );
}

function useListas(semanaId: string, pessoaId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [listas, setListas] = useState<Lista[] | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const carregar = useCallback(async () => {
    if (!pessoaId) return;
    const { data: l } = await supabase.from("compras_listas").select("*").eq("semana_id", semanaId).eq("pessoa_id", pessoaId)
      .in("status", ATIVAS).order("created_at");
    const ls = (l ?? []) as Lista[];
    setListas(ls);
    if (ls.length) {
      const { data: it } = await supabase.from("compras_itens").select("*").in("lista_id", ls.map((x) => x.id)).order("ordem").order("id");
      setItens((it ?? []) as Item[]);
    } else setItens([]);
  }, [supabase, semanaId, pessoaId]);
  useEffect(() => { carregar(); }, [carregar]);
  return { listas, itens, carregar };
}

// Juntar duas listas da mesma pessoa numa só (os itens vão para a primeira; a segunda fica guardada como juntada)
function JuntarListas({ listas, onMudou }: { listas: Lista[]; onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const abertas = listas.filter((l) => l.status !== "aprovada");
  const [destino, setDestino] = useState("");
  const [origem, setOrigem] = useState("");
  const [erro, setErro] = useState("");
  if (abertas.length < 2) return null;
  const nome = (l: Lista) => l.titulo || `Lista de ${new Date(l.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
  async function juntar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro("");
    const { error } = await supabase.rpc("compras_listas_juntar", { p_destino: destino, p_origem: origem });
    if (error) return setErro(error.message);
    setDestino(""); setOrigem("");
    onMudou();
  }
  return (
    <form className="cp-juntar" onSubmit={juntar}>
      <span className="cp-juntar-rotulo">Juntar listas</span>
      <select value={destino} onChange={(v) => setDestino(v.target.value)} aria-label="Lista que fica">
        <option value="">Lista que fica…</option>
        {abertas.map((l) => <option key={l.id} value={l.id}>{nome(l)}</option>)}
      </select>
      <span aria-hidden="true">+</span>
      <select value={origem} onChange={(v) => setOrigem(v.target.value)} aria-label="Lista que entra nela">
        <option value="">Lista que entra nela…</option>
        {abertas.filter((l) => l.id !== destino).map((l) => <option key={l.id} value={l.id}>{nome(l)}</option>)}
      </select>
      <button className="ghost small" disabled={!destino || !origem}>Juntar</button>
      {erro && <p className="tv-alerta">{erro}</p>}
    </form>
  );
}

function Listas({ semana, listas, itens, carregar, gestor }: { semana: Semana; listas: Lista[]; itens: Item[]; carregar: () => void; gestor: boolean }) {
  const aberta = semana.status === "aberta";
  return (
    <>
      {listas.length > 1 && (
        <p className="muted cp-listas-resumo">{listas.length} listas nesta semana · {listas.filter((l) => l.status === "aprovada").length} aprovadas.
          Confira e aprove cada uma; se preferir, junte duas numa só.</p>
      )}
      {aberta && <JuntarListas listas={listas} onMudou={carregar} />}
      {listas.map((l) => (
        <EditorLista key={l.id} lista={l} itens={itens.filter((i) => i.lista_id === l.id)}
          podeEditar={aberta && (gestor || l.status !== "aprovada")} onMudou={carregar} gestor={gestor} />
      ))}
    </>
  );
}

function MinhaLista({ semana, pessoa }: { semana: Semana; pessoa: Pessoa }) {
  const { listas, itens, carregar } = useListas(semana.id, pessoa.id);
  if (listas === undefined) return <p className="muted">Carregando as suas listas…</p>;
  if (!listas.length) {
    return (
      <>
        <Etapas atual={0} />
        <section className="av-bloco cp-vazio">
          <h2>Sua lista ainda não saiu</h2>
          <p className="muted">Mande o pedido do seu setor no grupo COMPRAS (texto, planilha, PDF ou foto) até terça à noite. Em até 15 minutos a lista sugerida aparece aqui para você revisar.</p>
        </section>
      </>
    );
  }
  return (
    <>
      <Etapas atual={situacao(listas) === "aprovada" ? 3 : 2} />
      <Listas semana={semana} listas={listas} itens={itens} carregar={carregar} gestor={false} />
    </>
  );
}

function EditorLista({ lista, itens, podeEditar, onMudou, gestor }: { lista: Lista; itens: Item[]; podeEditar: boolean; onMudou: () => void; gestor: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState({ nome: "", fornecedor: "", unidade: "", qtd: "", preco: "" });
  const vivos = itens.filter((i) => !i.removido);
  const total = vivos.reduce((s, i) => s + (i.qtd ?? 0) * (i.preco ?? 0), 0);

  async function salvar(i: Item, mudanca: Partial<Item>) {
    setErro("");
    const x = { ...i, ...mudanca };
    const { error } = await supabase.rpc("compras_item_salvar", {
      p_item: i.id, p_nome: x.nome, p_fornecedor: x.fornecedor ?? "", p_unidade: x.unidade ?? "", p_qtd: x.qtd, p_preco: x.preco, p_removido: x.removido,
    });
    if (error) setErro(error.message);
    onMudou();
  }
  async function incluir(ev: React.FormEvent) {
    ev.preventDefault();
    setErro("");
    const { error } = await supabase.rpc("compras_item_incluir", {
      p_lista: lista.id, p_nome: novo.nome, p_fornecedor: novo.fornecedor, p_unidade: novo.unidade, p_qtd: ler(novo.qtd), p_preco: ler(novo.preco),
    });
    if (error) return setErro(error.message);
    setNovo({ nome: "", fornecedor: "", unidade: "", qtd: "", preco: "" });
    onMudou();
  }
  async function renomear(titulo: string) {
    setErro("");
    const { error } = await supabase.rpc("compras_lista_titulo", { p_lista: lista.id, p_titulo: titulo });
    if (error) setErro(error.message);
    onMudou();
  }
  async function aprovar(sim: boolean) {
    setErro("");
    const { error } = await supabase.rpc("compras_lista_aprovar", { p_lista: lista.id, p_aprovar: sim });
    if (error) setErro(error.message);
    onMudou();
  }

  return (
    <section className="av-bloco cp-lista">
      <div className="cp-lista-cabeca">
        <div className="cp-lista-titulo">
          {podeEditar ? <input defaultValue={lista.titulo ?? ""} placeholder="Nome da lista (ex.: Mercado, Ceasa)" aria-label="Nome da lista"
            onBlur={(v) => v.target.value !== (lista.titulo ?? "") && renomear(v.target.value)} /> : <h3>{lista.titulo || "Lista"}</h3>}
        </div>
        <div className="cp-lista-total"><span>{vivos.length} itens</span><b>{brl(total)}</b></div>
        <span className={`estado ${lista.status === "aprovada" ? "tv-ok" : "tv-revisar"}`}>{STATUS[lista.status] ?? lista.status}</span>
      </div>
      {lista.pedido_texto && (
        <details className="cp-pedido"><summary>O pedido que veio no grupo</summary><pre>{lista.pedido_texto}</pre></details>
      )}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela cp-tabela">
          <thead><tr><th>Item</th><th>Fornecedor</th><th className="n">Pediu</th><th className="n" title="Compra média por semana nas últimas 4 semanas (notas fiscais)">Média 4 sem.</th><th className="n" title="Média × (1 + % da semana), na embalagem">Projeção</th><th className="n">Sugerido</th><th className="n">Pedir</th><th>Unid.</th><th className="n">Preço</th><th /></tr></thead>
          <tbody>
            {itens.map((i) => {
              const difere = i.qtd_sugerida != null && i.qtd_pedida != null && i.qtd_sugerida !== i.qtd_pedida;
              return (
                <tr key={i.id} className={i.removido ? "cp-tirado" : ""}>
                  <td>
                    {podeEditar && !i.removido ? <input defaultValue={i.nome} onBlur={(v) => v.target.value !== i.nome && salvar(i, { nome: v.target.value })} aria-label="Item" /> : <span>{i.nome}</span>}
                    {(i.produto_nota || i.confianca) && (
                      <small className="cp-nota">
                        {i.confianca && <span className={`cp-conf ${i.confianca}`} title={CONFIANCA[i.confianca]}>{i.confianca === "alta" ? "✓" : i.confianca === "media" ? "≈" : "?"}</span>}
                        {i.produto_nota ? `na nota: ${i.produto_nota}` : CONFIANCA[i.confianca ?? ""]}
                      </small>
                    )}
                    {i.motivo && <small className={difere ? "cp-motivo atencao" : "cp-motivo"}>{i.motivo}</small>}
                    {i.incluido_na_revisao && <small className="cp-motivo">incluído na revisão</small>}
                  </td>
                  <td>{podeEditar && !i.removido ? <input defaultValue={i.fornecedor ?? ""} onBlur={(v) => v.target.value !== (i.fornecedor ?? "") && salvar(i, { fornecedor: v.target.value })} aria-label="Fornecedor" /> : i.fornecedor ?? "—"}</td>
                  <td className="n">{num(i.qtd_pedida) || "—"}</td>
                  <td className="n" title={i.base ?? undefined}>{i.media_4s != null ? num(Math.round(i.media_4s * 100) / 100) : "—"}{i.base && <small className="cp-base">{i.base}</small>}</td>
                  <td className="n">{num(i.projecao) || "—"}</td>
                  <td className={difere ? "n cp-difere" : "n"}>{num(i.qtd_sugerida) || "—"}</td>
                  <td className="n">{podeEditar && !i.removido ? <input className="n" inputMode="decimal" defaultValue={num(i.qtd)} onBlur={(v) => ler(v.target.value) !== i.qtd && salvar(i, { qtd: ler(v.target.value) })} aria-label="Quantidade final" /> : num(i.qtd)}</td>
                  <td>{podeEditar && !i.removido ? <input defaultValue={i.unidade ?? ""} onBlur={(v) => v.target.value !== (i.unidade ?? "") && salvar(i, { unidade: v.target.value })} aria-label="Unidade" /> : i.unidade ?? ""}</td>
                  <td className="n">{podeEditar && !i.removido ? <input className="n" inputMode="decimal" defaultValue={num(i.preco)} onBlur={(v) => ler(v.target.value) !== i.preco && salvar(i, { preco: ler(v.target.value) })} aria-label="Preço" /> : brl(i.preco)}</td>
                  <td>{podeEditar && <button className="ghost small" onClick={() => salvar(i, { removido: !i.removido })}>{i.removido ? "Voltar" : "Tirar"}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {podeEditar && (
        <form className="cp-incluir" onSubmit={incluir}>
          <input value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v.target.value })} placeholder="Item que faltou" aria-label="Novo item" />
          <input value={novo.fornecedor} onChange={(v) => setNovo({ ...novo, fornecedor: v.target.value })} placeholder="Fornecedor" aria-label="Fornecedor do novo item" />
          <input value={novo.qtd} onChange={(v) => setNovo({ ...novo, qtd: v.target.value })} inputMode="decimal" placeholder="Qtd." aria-label="Quantidade do novo item" />
          <input value={novo.unidade} onChange={(v) => setNovo({ ...novo, unidade: v.target.value })} placeholder="Unid." aria-label="Unidade do novo item" />
          <input value={novo.preco} onChange={(v) => setNovo({ ...novo, preco: v.target.value })} inputMode="decimal" placeholder="Preço" aria-label="Preço do novo item" />
          <button className="ghost small">Incluir</button>
        </form>
      )}
      {erro && <p className="tv-alerta">{erro}</p>}
      <div className="cp-rodape">
        {podeEditar && <button onClick={() => aprovar(true)}>Aprovar a lista</button>}
        {gestor && lista.status === "aprovada" && <button className="ghost" onClick={() => aprovar(false)}>Reabrir para a pessoa</button>}
        {lista.status === "aprovada" && !gestor && <p className="es-tudo-certo">Lista aprovada. O setor de compras já pode juntá-la na lista final.</p>}
      </div>
    </section>
  );
}

// As etapas da semana de compras, com a atual em destaque
const ETAPAS = [
  { t: "Pedidos no grupo", d: "até segunda à noite" },
  { t: "Lista sugerida", d: "até 15 min depois do pedido, pelo Claude" },
  { t: "Revisão", d: "cada pessoa confere e aprova" },
  { t: "Lista única", d: "a Fernanda junta por fornecedor" },
  { t: "Semana fechada", d: "PDF e pedidos enviados" },
];
function Etapas({ atual }: { atual: number }) {
  return (
    <ol className="cp-etapas" aria-label="Etapas da semana">
      {ETAPAS.map((e, i) => (
        <li key={e.t} className={i < atual ? "feita" : i === atual ? "atual" : ""} aria-current={i === atual ? "step" : undefined}>
          <span className="cp-etapa-n" aria-hidden="true">{i < atual ? "✓" : i + 1}</span>
          <span><b>{e.t}</b><small>{e.d}</small></span>
        </li>
      ))}
    </ol>
  );
}

// Situação da leitura automática do grupo (compras_analises, supabase/compras_continuo.sql)
const ANALISE: Record<string, string> = { analisando: "analisando…", no_lote: "analisando…", ok: "lista sugerida pelo Claude", sem_pedido: "sem pedido no grupo",
  pulada: "já estava em revisão", falha: "a análise falhou" };

function Andamento({ semana }: { semana: Semana }) {
  const supabase = useMemo(() => createClient(), []);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [listas, setListas] = useState<Lista[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [analises, setAnalises] = useState<Record<string, { status: string; erro: string | null }>>({});
  const carregar = useCallback(async () => {
    const [p, l, a] = await Promise.all([
      supabase.from("operacao_pessoas").select("id,nome,unidade,setor,papel,user_id,wa_nome,ativo,convidado_em").eq("papel", "solicitante").eq("ativo", true),
      supabase.from("compras_listas").select("*").eq("semana_id", semana.id),
      supabase.from("compras_analises").select("pessoa_id,status,erro,inicio").eq("semana_id", semana.id).order("inicio"),
    ]);
    setPessoas((p.data ?? []) as Pessoa[]);
    setListas((l.data ?? []) as Lista[]);
    // a última análise automática de cada pessoa na semana
    setAnalises(Object.fromEntries(((a.data ?? []) as { pessoa_id: string; status: string; erro: string | null }[]).map((x) => [x.pessoa_id, x])));
  }, [supabase, semana.id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const c = supabase.channel("compras-listas").on("postgres_changes", { event: "*", schema: "public", table: "compras_listas" }, carregar).subscribe();
    return () => { supabase.removeChannel(c); };
  }, [supabase, carregar]);

  const porUnidade = Object.keys(UNIDADES).map((u) => ({ u, pessoas: pessoas.filter((p) => p.unidade === u).sort((a, b) => (a.setor ?? "").localeCompare(b.setor ?? "")) }));
  const ativas = listas.filter((l) => ATIVAS.includes(l.status));
  const daPessoa = (id: string) => ativas.filter((l) => l.pessoa_id === id);
  const aprovadas = pessoas.filter((p) => situacao(daPessoa(p.id)) === "aprovada").length;
  const revisao = pessoas.filter((p) => situacao(daPessoa(p.id)) === "em_revisao").length;
  const semLista = pessoas.filter((p) => !daPessoa(p.id).length).length;
  const pct = pessoas.length ? Math.round((aprovadas / pessoas.length) * 100) : 0;
  // Em que etapa a semana está: pedidos → lista sugerida → revisão → lista única → fechada
  const etapa = semana.status === "fechada" ? 4 : aprovadas === pessoas.length && pessoas.length ? 3 : ativas.some((l) => l.status !== "aguardando") ? 2 : 0;

  return (
    <>
      <Etapas atual={etapa} />
      <AumentoSemana semana={semana} />
      <div className="ip-numeros">
        <div className="ip-numero">
          <span className="ip-rotulo">Listas aprovadas</span>
          <span className="ip-valor">{aprovadas}<small className="cp-de"> de {pessoas.length}</small></span>
          <span className="ip-var neutro">{pct}% das pessoas</span>
          <span className="pd-progresso" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
        </div>
        <div className="ip-numero"><span className="ip-rotulo">Em revisão</span><span className="ip-valor">{revisao}</span><span className="ip-var neutro">a pessoa confere e aprova</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Sem lista ainda</span><span className={semLista ? "ip-valor cf-alerta" : "ip-valor"}>{semLista}</span><span className="ip-var neutro">pedido no grupo até segunda</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Leitura do grupo</span><span className="ip-valor">{Object.values(analises).filter((a) => a.status === "ok").length}</span><span className="ip-var neutro">listas sugeridas pelo Claude</span></div>
      </div>
      <div className="cp-unidades">
        {porUnidade.map(({ u, pessoas: ps }) => {
          const ok = ps.filter((p) => situacao(daPessoa(p.id)) === "aprovada").length;
          return (
            <section key={u} className="cp-unidade">
              <header className="cp-unidade-cabeca">
                <span className="nf-grupo-icone" aria-hidden="true">{UNIDADES[u].slice(0, 1)}</span>
                <div><h2>{UNIDADES[u]}</h2><small>{ok} de {ps.length} aprovadas</small></div>
              </header>
              <ul className="cp-pessoas">
                {ps.map((p) => {
                  const ls = daPessoa(p.id);
                  const st = situacao(ls);
                  return (
                    <li key={p.id}>
                      <button className={aberta === p.id ? "cp-pessoa on" : "cp-pessoa"} onClick={() => setAberta(aberta === p.id ? null : p.id)} aria-expanded={aberta === p.id}>
                        <span className="cp-avatar" aria-hidden="true">{p.nome.slice(0, 1)}</span>
                        <span className="cp-pessoa-nome"><strong>{p.nome}</strong><small>{SETORES[p.setor ?? ""]}{!p.wa_nome ? " · sem nome no WhatsApp" : analises[p.id] ? ` · ${ANALISE[analises[p.id].status] ?? analises[p.id].status}` : ""}</small></span>
                        <span className={`estado ${st === "aprovada" ? "tv-ok" : st === "em_revisao" ? "tv-revisar" : ""}`}>{st ? `${ls.length > 1 ? `${ls.length} listas · ` : ""}${STATUS[st]}` : "sem lista"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {aberta && <ListaDaPessoa semana={semana} pessoa={pessoas.find((p) => p.id === aberta)!} onFechar={() => setAberta(null)} />}
    </>
  );
}

function ListaDaPessoa({ semana, pessoa, onFechar }: { semana: Semana; pessoa: Pessoa; onFechar: () => void }) {
  const { listas, itens, carregar } = useListas(semana.id, pessoa.id);
  return (
    <div className="cp-da-pessoa">
      <header className="cp-da-pessoa-cabeca">
        <span className="cp-avatar grande" aria-hidden="true">{pessoa.nome.slice(0, 1)}</span>
        <div><h3>{pessoa.nome}</h3><small>{SETORES[pessoa.setor ?? ""]} · {UNIDADES[pessoa.unidade ?? ""]}</small></div>
        <button className="ghost small" onClick={onFechar}>Fechar</button>
      </header>
      {listas === undefined ? <p className="muted">Carregando…</p>
        : !listas.length ? <p className="muted">Ainda sem lista nesta semana. Quando a pessoa pedir no grupo, a lista sugerida aparece aqui em até 15 minutos.</p>
        : <Listas semana={semana} listas={listas} itens={itens} carregar={carregar} gestor />}
    </div>
  );
}

// % a mais da semana (feriado, evento): entra na projeção de cada item na próxima análise
function AumentoSemana({ semana }: { semana: Semana }) {
  const supabase = useMemo(() => createClient(), []);
  const [pct, setPct] = useState(String(semana.aumento_pct ?? 0));
  const [msg, setMsg] = useState("");
  useEffect(() => { setPct(String(semana.aumento_pct ?? 0)); }, [semana.id, semana.aumento_pct]);
  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    const { error } = await supabase.rpc("compras_semana_aumento", { p_semana: semana.id, p_pct: ler(pct) ?? 0 });
    setMsg(error ? error.message : "Salvo. Vale para as próximas análises desta semana.");
  }
  if (semana.status !== "aberta") return null;
  return (
    <form className="cp-aumento" onSubmit={salvar}>
      <label>Aumento da semana (feriado, evento)
        <span><input inputMode="decimal" value={pct} onChange={(v) => setPct(v.target.value)} aria-label="Aumento da semana em %" />%</span>
      </label>
      <button className="ghost small">Salvar</button>
      <small className="muted">{msg || "A projeção de cada item é a média das últimas 4 semanas mais esta porcentagem."}</small>
    </form>
  );
}

function ListaUnica({ semana }: { semana: Semana }) {
  const supabase = useMemo(() => createClient(), []);
  const [linhas, setLinhas] = useState<Final[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [novo, setNovo] = useState({ fornecedor: "", nome: "", unidade: "", qtd: "", preco: "" });
  const aberta = semana.status === "aberta";

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("compras_final").select("*").eq("semana_id", semana.id).order("fornecedor").order("nome");
    setLinhas((data ?? []) as Final[]);
  }, [supabase, semana.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function juntar() {
    setErro(""); setAviso("");
    const { data, error } = await supabase.rpc("compras_consolidar", { p_semana: semana.id });
    if (error) return setErro(error.message);
    setAviso(`${data ?? 0} itens juntados das listas aprovadas. Itens que você já editou ficaram como estavam.`);
    carregar();
  }
  async function salvar(f: Final, m: Partial<Final>) {
    setErro("");
    const x = { ...f, ...m };
    const { error } = await supabase.rpc("compras_final_salvar", { p_id: f.id, p_fornecedor: x.fornecedor, p_nome: x.nome, p_unidade: x.unidade, p_qtd: x.qtd, p_preco: x.preco, p_removido: x.removido });
    if (error) setErro(error.message);
    carregar();
  }
  async function incluir(ev: React.FormEvent) {
    ev.preventDefault();
    const { error } = await supabase.rpc("compras_final_incluir", { p_semana: semana.id, p_fornecedor: novo.fornecedor, p_nome: novo.nome, p_unidade: novo.unidade, p_qtd: ler(novo.qtd), p_preco: ler(novo.preco) });
    if (error) return setErro(error.message);
    setNovo({ fornecedor: "", nome: "", unidade: "", qtd: "", preco: "" });
    carregar();
  }
  async function fechar(sim: boolean) {
    const { error } = await supabase.rpc("compras_semana_fechar", { p_semana: semana.id, p_fechar: sim });
    if (error) return setErro(error.message);
    window.location.reload();
  }

  const vivas = linhas.filter((l) => !l.removido);
  const grupos = [...new Set(vivas.map((l) => l.fornecedor))].map((f) => ({ f, itens: vivas.filter((l) => l.fornecedor === f) }));
  const total = vivas.reduce((s, l) => s + (l.qtd ?? 0) * (l.preco ?? 0), 0);

  return (
    <section className="cp-final">
      <div className="ip-numeros no-print">
        <div className="ip-numero"><span className="ip-rotulo">Itens</span><span className="ip-valor">{vivas.length}</span><span className="ip-var neutro">na lista única</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Fornecedores</span><span className="ip-valor">{grupos.length}</span><span className="ip-var neutro">um pedido para cada</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Total estimado</span><span className="ip-valor">{brl(total)}</span><span className="ip-var neutro">pelo último preço pago</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Semana</span><span className="ip-valor">{aberta ? "aberta" : "fechada"}</span><span className="ip-var neutro">{diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</span></div>
      </div>
      <div className="es-bloco-cabeca no-print cp-final-acoes">
        <h2>Lista única por fornecedor</h2>
        <div className="nf-acoes">
          {aberta && <button className="ghost small" onClick={juntar}>Juntar listas aprovadas</button>}
          <button className="small" onClick={() => window.print()} disabled={!vivas.length}>Gerar PDF</button>
          {aberta ? <button className="ghost small" onClick={() => fechar(true)} disabled={!vivas.length}>Fechar a semana</button>
            : <button className="ghost small" onClick={() => fechar(false)}>Reabrir a semana</button>}
        </div>
      </div>
      {erro && <p className="tv-alerta no-print">{erro}</p>}
      {aviso && <p className="es-aviso no-print">{aviso}</p>}

      <div className="cp-pdf">
        <div className="cp-pdf-cabeca">
          <strong>Lista de compras · semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</strong>
          <span>{vivas.length} itens · {grupos.length} fornecedores · total {brl(total)}</span>
          <span>Descontar o que já tem no estoque antes de pedir.</span>
        </div>
        {!vivas.length ? <p className="muted">Nada ainda. Quando as listas forem aprovadas, use “Juntar listas aprovadas”.</p> : grupos.map((g) => {
          const sub = g.itens.reduce((s, l) => s + (l.qtd ?? 0) * (l.preco ?? 0), 0);
          return (
            <div key={g.f} className="cp-forn">
              <div className="cp-forn-cabeca"><strong>{g.f}</strong><span>{brl(sub)}</span></div>
              <table className="nf-tabela cp-tabela">
                <tbody>
                  {g.itens.map((l) => (
                    <tr key={l.id}>
                      <td className="cp-caixa" aria-hidden="true">☐</td>
                      <td>
                        {aberta ? <input className="no-print-input" defaultValue={l.nome} onBlur={(v) => v.target.value !== l.nome && salvar(l, { nome: v.target.value })} aria-label="Item" /> : null}
                        <span className={aberta ? "so-print" : ""}>{l.nome}</span>
                        <small className="no-print">{l.origem.map((o) => `${o.pessoa} ${num(o.qtd)}`).join(" · ")}{l.editado ? " · editado" : ""}</small>
                      </td>
                      <td className="no-print">{aberta && <input defaultValue={l.fornecedor} onBlur={(v) => v.target.value !== l.fornecedor && salvar(l, { fornecedor: v.target.value })} aria-label="Fornecedor" />}</td>
                      <td className="n">{aberta ? <><input className="n no-print-input" inputMode="decimal" defaultValue={num(l.qtd)} onBlur={(v) => ler(v.target.value) !== l.qtd && salvar(l, { qtd: ler(v.target.value) })} aria-label="Quantidade" /><span className="so-print">{num(l.qtd)}</span></> : num(l.qtd)} {l.unidade}</td>
                      <td className="n">{aberta ? <><input className="n no-print-input" inputMode="decimal" defaultValue={num(l.preco)} onBlur={(v) => ler(v.target.value) !== l.preco && salvar(l, { preco: ler(v.target.value) })} aria-label="Preço" /><span className="so-print">{brl(l.preco)}</span></> : brl(l.preco)}</td>
                      <td className="n">{brl((l.qtd ?? 0) * (l.preco ?? 0))}</td>
                      <td className="no-print">{aberta && <button className="ghost small" onClick={() => salvar(l, { removido: true })}>Tirar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {aberta && (
        <form className="cp-incluir no-print" onSubmit={incluir}>
          <input value={novo.fornecedor} onChange={(v) => setNovo({ ...novo, fornecedor: v.target.value })} placeholder="Fornecedor" aria-label="Fornecedor" />
          <input value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v.target.value })} placeholder="Item" aria-label="Item" />
          <input value={novo.qtd} onChange={(v) => setNovo({ ...novo, qtd: v.target.value })} inputMode="decimal" placeholder="Qtd." aria-label="Quantidade" />
          <input value={novo.unidade} onChange={(v) => setNovo({ ...novo, unidade: v.target.value })} placeholder="Unid." aria-label="Unidade" />
          <input value={novo.preco} onChange={(v) => setNovo({ ...novo, preco: v.target.value })} inputMode="decimal" placeholder="Preço" aria-label="Preço" />
          <button className="ghost small">Incluir na lista única</button>
        </form>
      )}
    </section>
  );
}

function Pessoas() {
  const supabase = useMemo(() => createClient(), []);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [msg, setMsg] = useState("");
  const carregar = useCallback(async () => {
    const { data } = await supabase.from("operacao_pessoas").select("*").order("papel").order("unidade").order("setor");
    setPessoas((data ?? []) as Pessoa[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvar(p: Pessoa, m: Partial<Pessoa>) {
    setMsg("");
    const x = { ...p, ...m };
    const { error } = await supabase.rpc("operacao_pessoa_salvar", { p_id: p.id, p_nome: x.nome, p_unidade: x.unidade ?? "", p_setor: x.setor ?? "",
      p_papel: x.papel, p_email: x.email ?? "", p_wa_nome: x.wa_nome ?? "", p_ativo: x.ativo });
    if (error) setMsg(error.message);
    carregar();
  }
  async function darAcesso(p: Pessoa) {
    setMsg("");
    const { data, error } = await supabase.functions.invoke("operacao-convidar", { body: { pessoa: p.id } });
    const r = (data ?? {}) as { ok?: boolean; erro?: string; ja_tinha?: boolean };
    if (error || !r.ok) {
      let texto = r.erro ?? error?.message ?? "Não deu certo.";
      try { texto = (await (error as { context?: Response }).context?.json())?.erro ?? texto; } catch {}
      return setMsg(texto);
    }
    setMsg(`${p.nome} já pode entrar: em brasico.vercel.app/login, “Link por e-mail”, com ${p.email}.`);
    carregar();
  }

  return (
    <section className="av-bloco">
      <header className="av-bloco-cabeca"><div><h3>Pessoas e acesso</h3><p className="muted">quem pede no grupo e a Fernanda</p></div></header>
      <p className="muted cp-ajuda">Cadastre o e-mail e clique em Dar acesso. A pessoa entra pela tela de login, em “Link por e-mail”, e só vê a área de Compras.
        O nome no WhatsApp é como ela aparece no grupo COMPRAS, para o pedido cair na lista certa.</p>
      {msg && <p className="es-aviso">{msg}</p>}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela cp-tabela">
          <thead><tr><th>Pessoa</th><th>E-mail</th><th>Nome no WhatsApp</th><th>Acesso</th><th /></tr></thead>
          <tbody>
            {pessoas.map((p) => (
              <tr key={p.id} className={p.ativo ? "" : "cp-tirado"}>
                <td><strong>{p.nome}</strong><small>{p.papel === "compras" ? "Setor de compras" : p.papel === "estoque" ? "Câmara fria" : `${SETORES[p.setor ?? ""] ?? ""} · ${UNIDADES[p.unidade ?? ""] ?? ""}`}</small></td>
                <td><input type="email" defaultValue={p.email ?? ""} onBlur={(v) => v.target.value !== (p.email ?? "") && salvar(p, { email: v.target.value })} placeholder="nome@email.com" aria-label={`E-mail de ${p.nome}`} /></td>
                <td><input defaultValue={p.wa_nome ?? ""} onBlur={(v) => v.target.value !== (p.wa_nome ?? "") && salvar(p, { wa_nome: v.target.value })} placeholder="Como aparece no grupo" aria-label={`Nome no WhatsApp de ${p.nome}`} /></td>
                <td>{p.user_id ? <span className="estado tv-ok">com acesso</span> : <span className="estado">sem acesso</span>}</td>
                <td>{!p.user_id && <button className="ghost small" disabled={!p.email} onClick={() => darAcesso(p)}>Dar acesso</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
