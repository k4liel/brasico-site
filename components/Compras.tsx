"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { NotaAvulsa } from "./Notas";

// Compras (Operação · fase 2): pedidos do grupo COMPRAS analisados pelo Claude viram uma lista por
// pessoa; cada pessoa revisa e aprova a sua; a Fernanda junta as aprovadas na lista única por
// fornecedor e gera o PDF. Tabelas e funções em supabase/compras.sql.
type Papel = "socio" | "compras" | "solicitante" | null;
type Pessoa = { id: string; nome: string; unidade: string | null; setor: string | null; papel: string; email?: string | null;
  user_id: string | null; wa_nome: string | null; ativo: boolean; convidado_em: string | null; registra_estoque?: boolean };
type Semana = { id: string; inicio: string; status: string };
type Lista = { id: string; semana_id: string; pessoa_id: string; status: string; pedido_texto: string | null; analisada_em: string | null; aprovada_em: string | null };
type Item = { id: number; lista_id: string; ordem: number; nome: string; fornecedor: string | null; unidade: string | null;
  qtd_pedida: number | null; qtd_sugerida: number | null; motivo: string | null; qtd: number | null; preco: number | null;
  removido: boolean; incluido_na_revisao: boolean };
type Final = { id: number; fornecedor: string; nome: string; unidade: string; qtd: number | null; preco: number | null;
  origem: { pessoa: string; unidade: string; setor: string; qtd: number }[]; removido: boolean; editado: boolean };

const UNIDADES: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua" };
const SETORES: Record<string, string> = { bar: "Bar", cozinha: "Cozinha", salao: "Salão", producao: "Produção" };
const STATUS: Record<string, string> = { aguardando: "aguardando análise", em_revisao: "em revisão", aprovada: "aprovada" };
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
      const { data: ss } = await supabase.from("compras_semanas").select("id,inicio,status").order("inicio", { ascending: false }).limit(20);
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
        <p>Semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}. Pedidos no grupo até segunda à noite; terça às 6h sai a lista sugerida.
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
      {gestor ? <Topo email={userEmail} ativo="compras" /> : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} outra={eu?.registra_estoque ? { href: "/estoque", nome: "Estoque" } : undefined} />}
      <main className="miolo tv es cp-area">
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

function useLista(semanaId: string, pessoaId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Lista | null | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const carregar = useCallback(async () => {
    if (!pessoaId) return;
    const { data: l } = await supabase.from("compras_listas").select("*").eq("semana_id", semanaId).eq("pessoa_id", pessoaId).maybeSingle();
    setLista((l as Lista | null) ?? null);
    if (l) {
      const { data: it } = await supabase.from("compras_itens").select("*").eq("lista_id", (l as Lista).id).order("ordem").order("id");
      setItens((it ?? []) as Item[]);
    } else setItens([]);
  }, [supabase, semanaId, pessoaId]);
  useEffect(() => { carregar(); }, [carregar]);
  return { lista, itens, carregar };
}

function MinhaLista({ semana, pessoa }: { semana: Semana; pessoa: Pessoa }) {
  const { lista, itens, carregar } = useLista(semana.id, pessoa.id);
  if (lista === undefined) return <p className="muted">Carregando a sua lista…</p>;
  if (!lista || !itens.length) {
    return (
      <section className="es-bloco">
        <h2>Sua lista ainda não saiu</h2>
        <p className="muted">Mande o pedido do seu setor no grupo COMPRAS até segunda à noite. Na terça às 6h a lista sugerida aparece aqui para você revisar.</p>
      </section>
    );
  }
  return <EditorLista lista={lista} itens={itens} podeEditar={semana.status === "aberta" && lista.status !== "aprovada"} onMudou={carregar} gestor={false} />;
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
  async function aprovar(sim: boolean) {
    setErro("");
    const { error } = await supabase.rpc("compras_lista_aprovar", { p_lista: lista.id, p_aprovar: sim });
    if (error) setErro(error.message);
    onMudou();
  }

  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca">
        <h2>{vivos.length} itens <span className="muted">· {brl(total)}</span></h2>
        <span className={`estado ${lista.status === "aprovada" ? "tv-ok" : "tv-revisar"}`}>{STATUS[lista.status] ?? lista.status}</span>
      </div>
      {lista.pedido_texto && (
        <details className="cp-pedido"><summary>O pedido que veio no grupo</summary><pre>{lista.pedido_texto}</pre></details>
      )}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela cp-tabela">
          <thead><tr><th>Item</th><th>Fornecedor</th><th className="n">Pediu</th><th className="n">Sugerido</th><th className="n">Pedir</th><th>Unid.</th><th className="n">Preço</th><th /></tr></thead>
          <tbody>
            {itens.map((i) => {
              const difere = i.qtd_sugerida != null && i.qtd_pedida != null && i.qtd_sugerida !== i.qtd_pedida;
              return (
                <tr key={i.id} className={i.removido ? "cp-tirado" : ""}>
                  <td>
                    {podeEditar && !i.removido ? <input defaultValue={i.nome} onBlur={(v) => v.target.value !== i.nome && salvar(i, { nome: v.target.value })} aria-label="Item" /> : <span>{i.nome}</span>}
                    {i.motivo && <small className={difere ? "cp-motivo atencao" : "cp-motivo"}>{i.motivo}</small>}
                    {i.incluido_na_revisao && <small className="cp-motivo">incluído na revisão</small>}
                  </td>
                  <td>{podeEditar && !i.removido ? <input defaultValue={i.fornecedor ?? ""} onBlur={(v) => v.target.value !== (i.fornecedor ?? "") && salvar(i, { fornecedor: v.target.value })} aria-label="Fornecedor" /> : i.fornecedor ?? "—"}</td>
                  <td className="n">{num(i.qtd_pedida) || "—"}</td>
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

// Situação da análise automática de terça (compras_analises, supabase/automacao.sql)
const ANALISE: Record<string, string> = { analisando: "analisando…", ok: "lista sugerida pelo Claude", sem_pedido: "sem pedido no grupo",
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
    // a última análise automática de cada pessoa na semana (terça às 6h)
    setAnalises(Object.fromEntries(((a.data ?? []) as { pessoa_id: string; status: string; erro: string | null }[]).map((x) => [x.pessoa_id, x])));
  }, [supabase, semana.id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const c = supabase.channel("compras-listas").on("postgres_changes", { event: "*", schema: "public", table: "compras_listas" }, carregar).subscribe();
    return () => { supabase.removeChannel(c); };
  }, [supabase, carregar]);

  const porUnidade = Object.keys(UNIDADES).map((u) => ({ u, pessoas: pessoas.filter((p) => p.unidade === u).sort((a, b) => (a.setor ?? "").localeCompare(b.setor ?? "")) }));
  const aprovadas = listas.filter((l) => l.status === "aprovada").length;

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Listas aprovadas</span><span className="es-numero-valor">{aprovadas} de {pessoas.length}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Em revisão</span><span className="es-numero-valor">{listas.filter((l) => l.status === "em_revisao").length}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Sem lista ainda</span><span className="es-numero-valor">{pessoas.length - listas.filter((l) => l.status !== "aguardando").length}</span></div>
      </div>
      <div className="cp-unidades">
        {porUnidade.map(({ u, pessoas: ps }) => (
          <section key={u} className="es-bloco">
            <h2>{UNIDADES[u]}</h2>
            <ul className="cp-pessoas">
              {ps.map((p) => {
                const l = listas.find((x) => x.pessoa_id === p.id);
                return (
                  <li key={p.id}>
                    <button className="cp-pessoa" onClick={() => setAberta(aberta === p.id ? null : p.id)} aria-expanded={aberta === p.id}>
                      <span><strong>{p.nome}</strong><small>{SETORES[p.setor ?? ""]}{!p.wa_nome ? " · sem nome no WhatsApp" : analises[p.id] ? ` · ${ANALISE[analises[p.id].status] ?? analises[p.id].status}` : ""}</small></span>
                      <span className={`estado ${l?.status === "aprovada" ? "tv-ok" : l?.status === "em_revisao" ? "tv-revisar" : ""}`}>{l ? STATUS[l.status] : "sem lista"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {aberta && <ListaDaPessoa semana={semana} pessoa={pessoas.find((p) => p.id === aberta)!} />}
    </>
  );
}

function ListaDaPessoa({ semana, pessoa }: { semana: Semana; pessoa: Pessoa }) {
  const { lista, itens, carregar } = useLista(semana.id, pessoa.id);
  return (
    <div className="cp-da-pessoa">
      <h3>{pessoa.nome} · {SETORES[pessoa.setor ?? ""]} · {UNIDADES[pessoa.unidade ?? ""]}</h3>
      {lista === undefined ? <p className="muted">Carregando…</p>
        : !lista || !itens.length ? <p className="muted">Ainda sem lista nesta semana. A análise de terça grava a lista sugerida aqui.</p>
        : <EditorLista lista={lista} itens={itens} podeEditar={semana.status === "aberta"} onMudou={carregar} gestor />}
    </div>
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
    <section className="es-bloco cp-final">
      <div className="es-bloco-cabeca no-print">
        <h2>Lista única por fornecedor <span className="muted">· {vivas.length} itens · {brl(total)}</span></h2>
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
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Pessoas e acesso</h2><span className="muted">quem pede no grupo e a Fernanda</span></div>
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
