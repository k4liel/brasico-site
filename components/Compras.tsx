"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { NotaAvulsa } from "./Notas";
import IndicePrecos from "./IndicePrecos";

// Compras (Operação · fase 2): pedidos do grupo COMPRAS analisados pelo Claude viram listas por pessoa
// (uma por pedido: mercado, Ceasa...), cada item ligado ao produto das notas, com a média de 4 semanas e a
// projeção; cada pessoa revisa, junta listas se quiser e aprova; a Fernanda junta as aprovadas na lista
// única por fornecedor, gera o PDF de cada fornecedor, marca pedido feito e recebido e confere a nota fiscal
// com o pedido. Tabelas e funções em supabase/compras.sql, compras_listas_metricas.sql e compras_fernanda.sql.
type Papel = "socio" | "compras" | "solicitante" | null;
type Pessoa = { id: string; nome: string; unidade: string | null; setor: string | null; papel: string; email?: string | null;
  user_id: string | null; wa_nome: string | null; ativo: boolean; convidado_em: string | null; registra_estoque?: boolean };
type Semana = { id: string; inicio: string; status: string; aumento_pct?: number };
type Lista = { id: string; semana_id: string; pessoa_id: string; status: string; titulo: string | null; pedido_texto: string | null; analisada_em: string | null; aprovada_em: string | null; created_at: string };
type Item = { id: number; lista_id: string; ordem: number; nome: string; fornecedor: string | null; unidade: string | null;
  qtd_pedida: number | null; qtd_sugerida: number | null; motivo: string | null; qtd: number | null; preco: number | null;
  removido: boolean; incluido_na_revisao: boolean; media_4s: number | null; projecao: number | null; base: string | null;
  produto_nota: string | null; confianca: "alta" | "media" | "baixa" | null };
type Pedido = { fornecedor: string; status: "a_pedir" | "pedido" | "recebido"; pedido_em: string | null; recebido_em: string | null; nota_chave: string | null; observacao: string | null };
type Final = { id: number; fornecedor: string; nome: string; unidade: string; qtd: number | null; preco: number | null;
  origem: { pessoa: string; unidade: string; setor: string; qtd: number }[]; removido: boolean; editado: boolean };

const UNIDADES: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua" };
const SETORES: Record<string, string> = { bar: "Bar", cozinha: "Cozinha", salao: "Salão", producao: "Produção" };
const STATUS: Record<string, string> = { aguardando: "aguardando análise", em_revisao: "em revisão", aprovada: "aprovada" };
const ATIVAS = ["aguardando", "em_revisao", "aprovada"];
const PEDIDO: Record<string, string> = { a_pedir: "a pedir", pedido: "pedido feito", recebido: "recebido" };
const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const CONFIANCA: Record<string, string> = { alta: "produto certo nas notas", media: "produto parecido nas notas", baixa: "não achado nas notas" };
// Situação de uma pessoa com várias listas: aprovada só quando todas estão aprovadas
const situacao = (ls: Lista[]) => (!ls.length ? null : ls.every((l) => l.status === "aprovada") ? "aprovada" : ls.some((l) => l.status === "em_revisao") ? "em_revisao" : "aguardando");
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const ler = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const fimSemana = (iso: string) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + 6); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };

type Aba = "painel" | "andamento" | "final" | "notas" | "precos" | "pessoas" | "avulsa";

export default function Compras({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<Papel | undefined>(undefined);
  const [eu, setEu] = useState<Pessoa | null>(null);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [aba, setAba] = useState<Aba>("painel");

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
        <p>Semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}. Pedidos no grupo até terça à noite; quando todos tiverem pedido, o setor de compras monta e libera a lista sugerida de cada pessoa.
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
      {papel === "socio" ? <Topo email={userEmail} ativo="compras" /> : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} outra={eu?.registra_estoque ? { href: "/estoque", nome: "Câmara fria" } : undefined} />}
      <main className="miolo tv es cp-area nf-larga">
        {cabecalho}
        {!semana ? <p className="muted">Carregando a semana…</p> : gestor ? (
          <>
            <div className="cp-abas" role="tablist">
              {([["painel", "Painel"], ["andamento", "Listas"], ["final", "Lista única e pedidos"], ["notas", "Notas recebidas"], ["precos", "Índice de preços"], ["avulsa", "Nota avulsa"],
                 ...(papel === "socio" ? [["pessoas", "Pessoas e acesso"]] : [])] as [Aba, string][]).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? "on" : ""} onClick={() => setAba(k)}>{t}</button>
              ))}
            </div>
            <AvisosGestor semana={semana} irPara={setAba} />
            {aba === "painel" && <Painel semana={semana} irPara={setAba} />}
            {aba === "andamento" && <Andamento semana={semana} />}
            {aba === "final" && <ListaUnica semana={semana} />}
            {aba === "notas" && <NotasRecebidas />}
            {aba === "precos" && <IndicePrecos />}
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
  const [senha, setSenha] = useState(false);
  async function sair() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <>
      <header className="topo cp-topo">
        <span className="marca">Brasico · {area}</span>
        <span className="cp-quem">{outra && <a href={outra.href}>{outra.nome}</a>}{nome || email}
          <button className="ghost small" onClick={() => setSenha(!senha)} aria-expanded={senha}>Trocar senha</button>
          <button className="ghost small" onClick={sair}>Sair</button></span>
      </header>
      {senha && <TrocarSenha onFechar={() => setSenha(false)} />}
    </>
  );
}

// A própria pessoa troca a senha (Supabase Auth); a senha nova não passa por mais nenhum lugar
function TrocarSenha({ onFechar }: { onFechar: () => void }) {
  const [nova, setNova] = useState("");
  const [repete, setRepete] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (nova.length < 8) return setMsg({ ok: false, t: "A senha precisa ter pelo menos 8 caracteres." });
    if (nova !== repete) return setMsg({ ok: false, t: "As duas senhas não são iguais." });
    setSalvando(true);
    const { error } = await createClient().auth.updateUser({ password: nova });
    setSalvando(false);
    if (error) return setMsg({ ok: false, t: /different|same/i.test(error.message) ? "A senha nova precisa ser diferente da atual." : error.message });
    setNova(""); setRepete("");
    setMsg({ ok: true, t: "Senha trocada. Use a nova da próxima vez que entrar." });
  }
  return (
    <form className="cp-senha" onSubmit={salvar}>
      <strong>Trocar a sua senha</strong>
      <input type="password" autoComplete="new-password" value={nova} onChange={(v) => setNova(v.target.value)} placeholder="Senha nova (8 ou mais caracteres)" aria-label="Senha nova" />
      <input type="password" autoComplete="new-password" value={repete} onChange={(v) => setRepete(v.target.value)} placeholder="Repita a senha nova" aria-label="Repita a senha nova" />
      <button className="small" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      <button type="button" className="ghost small" onClick={onFechar}>Fechar</button>
      {msg && <small className={msg.ok ? "ok" : "err"} role="status">{msg.t}</small>}
    </form>
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
  // ao vivo: lista nova ou atualizada pela análise do grupo aparece sem recarregar a página
  useEffect(() => {
    if (!pessoaId) return;
    const c = supabase.channel(`compras-listas-${pessoaId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_listas", filter: `pessoa_id=eq.${pessoaId}` }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(c); };
  }, [supabase, pessoaId, carregar]);
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
        <EditorLista key={l.id} lista={l} itens={itens.filter((i) => i.lista_id === l.id)} abertaInicial={listas.length === 1}
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
          <p className="muted">Mande o pedido do seu setor no grupo COMPRAS (texto, planilha, PDF ou foto) até terça à noite. Quando todos tiverem pedido, a lista sugerida é montada e aparece aqui para você revisar (você recebe um aviso nesta página).</p>
        </section>
      </>
    );
  }
  return (
    <>
      <AvisoListaNova pessoa={pessoa.id} listas={listas} />
      <Etapas atual={situacao(listas) === "aprovada" ? 3 : 2} />
      <Listas semana={semana} listas={listas} itens={itens} carregar={carregar} gestor={false} />
    </>
  );
}

// Aviso de lista nova ou atualizada desde a última vez que a pessoa olhou (guardado só neste aparelho)
function AvisoListaNova({ pessoa, listas }: { pessoa: string; listas: Lista[] }) {
  const chave = `cp-visto-${pessoa}`;
  const ultima = listas.reduce((m, l) => (l.analisada_em && l.analisada_em > m ? l.analisada_em : m), "");
  const [visto, setVisto] = useState<string | null>(null);
  useEffect(() => {
    try { setVisto(localStorage.getItem(chave) ?? ""); } catch { setVisto(""); }
  }, [chave]);
  if (visto === null || !ultima || ultima <= visto) return null;
  const novas = listas.filter((l) => l.analisada_em && l.analisada_em > visto && l.status !== "aprovada");
  if (!novas.length) return null;
  function ok() {
    try { localStorage.setItem(chave, ultima); } catch { /* sem armazenamento: o aviso volta na próxima vez */ }
    setVisto(ultima);
  }
  return (
    <div className="cp-aviso-novo" role="status">
      <span><b>{visto ? "Sua lista foi atualizada" : novas.length > 1 ? `Chegaram ${novas.length} listas para você revisar` : "Chegou a sua lista para revisar"}</b>
        <small>{novas.map((l) => l.titulo || "Lista").join(" · ")} · montada pelo Claude a partir do seu pedido no grupo</small></span>
      <button className="small" onClick={ok}>Ok, vou revisar</button>
    </div>
  );
}

// Cada lista abre e fecha: com várias listas, começam fechadas (só o título, os itens, o valor e a situação)
function EditorLista({ lista, itens, podeEditar, onMudou, gestor, abertaInicial = true }: { lista: Lista; itens: Item[]; podeEditar: boolean; onMudou: () => void; gestor: boolean; abertaInicial?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [aberta, setAberta] = useState(abertaInicial);
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
    <section className={aberta ? "av-bloco cp-lista" : "av-bloco cp-lista cp-fechada"}>
      <div className="cp-lista-cabeca">
        <button type="button" className="cp-abre" onClick={() => setAberta(!aberta)} aria-expanded={aberta}
          aria-label={aberta ? "Fechar a lista" : "Abrir a lista"}><span aria-hidden="true">{aberta ? "▾" : "▸"}</span></button>
        <div className="cp-lista-titulo" onClick={() => !aberta && setAberta(true)}>
          {podeEditar && aberta ? <input defaultValue={lista.titulo ?? ""} placeholder="Nome da lista (ex.: Mercado, Ceasa)" aria-label="Nome da lista"
            onBlur={(v) => v.target.value !== (lista.titulo ?? "") && renomear(v.target.value)} /> : <h3>{lista.titulo || "Lista"}</h3>}
        </div>
        <div className="cp-lista-total"><span>{vivos.length} itens</span><b>{brl(total)}</b></div>
        <span className={`estado ${lista.status === "aprovada" ? "tv-ok" : "tv-revisar"}`}>{STATUS[lista.status] ?? lista.status}</span>
      </div>
      {aberta && <>
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
      </>}
    </section>
  );
}

// As etapas da semana de compras, com a atual em destaque
const ETAPAS = [
  { t: "Pedidos no grupo", d: "até segunda à noite" },
  { t: "Lista sugerida", d: "montada quando todos pediram" },
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
        : !listas.length ? <p className="muted">Ainda sem lista nesta semana. Quando a pessoa pedir no grupo, a lista sugerida aparece aqui depois que for montada.</p>
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
  const [pedidos, setPedidos] = useState<Record<string, Pedido>>({});
  const [imprimir, setImprimir] = useState<string | null>(null);
  const [conferir, setConferir] = useState<string | null>(null);
  const aberta = semana.status === "aberta";

  const carregar = useCallback(async () => {
    const [{ data }, { data: ps }] = await Promise.all([
      supabase.from("compras_final").select("*").eq("semana_id", semana.id).order("fornecedor").order("nome"),
      supabase.from("compras_pedidos").select("*").eq("semana_id", semana.id),
    ]);
    setLinhas((data ?? []) as Final[]);
    setPedidos(Object.fromEntries(((ps ?? []) as Pedido[]).map((x) => [x.fornecedor, x])));
  }, [supabase, semana.id]);

  // PDF de um fornecedor só: marca qual imprimir, imprime e volta ao normal
  useEffect(() => {
    if (!imprimir) return;
    const fim = () => setImprimir(null);
    window.addEventListener("afterprint", fim);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", fim); };
  }, [imprimir]);
  async function marcar(fornecedor: string, status: Pedido["status"]) {
    setErro("");
    const { error } = await supabase.rpc("compras_pedido_gravar", { p_semana: semana.id, p_fornecedor: fornecedor, p_status: status });
    if (error) setErro(error.message);
    carregar();
  }
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

      <div className={imprimir ? "cp-pdf cp-so-um" : "cp-pdf"}>
        <div className="cp-pdf-cabeca">
          <strong>{imprimir ? `Pedido · ${imprimir}` : "Lista de compras"} · semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</strong>
          {imprimir ? (() => { const g = grupos.find((x) => x.f === imprimir); return <span>{g?.itens.length ?? 0} itens · total {brl(g?.itens.reduce((s, l) => s + (l.qtd ?? 0) * (l.preco ?? 0), 0) ?? 0)}</span>; })()
            : <span>{vivas.length} itens · {grupos.length} fornecedores · total {brl(total)}</span>}
          <span>Descontar o que já tem no estoque antes de pedir.</span>
        </div>
        {!vivas.length ? <p className="muted">Nada ainda. Quando as listas forem aprovadas, use “Juntar listas aprovadas”.</p> : grupos.map((g) => {
          const sub = g.itens.reduce((s, l) => s + (l.qtd ?? 0) * (l.preco ?? 0), 0);
          const ped = pedidos[g.f];
          const st = ped?.status ?? "a_pedir";
          return (
            <div key={g.f} className={imprimir === g.f ? "cp-forn cp-imprimir" : "cp-forn"}>
              <div className="cp-forn-cabeca">
                <strong>{g.f}</strong>
                <span className={`cp-ped no-print ${st}`}>{PEDIDO[st]}{st === "pedido" && ped?.pedido_em ? ` · ${quando(ped.pedido_em)}` : st === "recebido" && ped?.recebido_em ? ` · ${quando(ped.recebido_em)}` : ""}{ped?.nota_chave ? " · nota ligada" : ""}</span>
                <span>{brl(sub)}</span>
              </div>
              <div className="cp-forn-acoes no-print">
                <button className="ghost small" onClick={() => setImprimir(g.f)}>PDF deste fornecedor</button>
                {st === "a_pedir" && <button className="small" onClick={() => marcar(g.f, "pedido")}>Marcar pedido feito</button>}
                {st === "pedido" && <><button className="small" onClick={() => marcar(g.f, "recebido")}>Marcar recebido</button><button className="ghost small" onClick={() => marcar(g.f, "a_pedir")}>Voltar para “a pedir”</button></>}
                {st === "recebido" && <button className="ghost small" onClick={() => marcar(g.f, "pedido")}>Desfazer recebido</button>}
                <button className={conferir === g.f ? "ghost small on" : "ghost small"} onClick={() => setConferir(conferir === g.f ? null : g.f)} aria-expanded={conferir === g.f}>Conferir com a nota</button>
              </div>
              {conferir === g.f && <ConferirNota semana={semana} fornecedor={g.f} pedido={ped} onMudou={carregar} />}
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

// Avisos ao vivo para quem coordena: lista aprovada, lista nova ou atualizada pela análise do grupo
function AvisosGestor({ semana, irPara }: { semana: Semana; irPara: (a: Aba) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [avisos, setAvisos] = useState<{ id: number; t: string; aprovada: boolean }[]>([]);
  useEffect(() => {
    let vivo = true;
    const status = new Map<string, string>();
    const nomes = new Map<string, string>();
    (async () => {
      const [{ data: ls }, { data: ps }] = await Promise.all([
        supabase.from("compras_listas").select("id,status").eq("semana_id", semana.id),
        supabase.from("operacao_pessoas").select("id,nome"),
      ]);
      (ls ?? []).forEach((l: { id: string; status: string }) => status.set(l.id, l.status));
      (ps ?? []).forEach((p: { id: string; nome: string }) => nomes.set(p.id, p.nome));
    })();
    let n = 0;
    const c = supabase.channel(`compras-avisos-${semana.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_listas", filter: `semana_id=eq.${semana.id}` }, (ev) => {
        if (!vivo) return;
        const l = ev.new as Lista;
        if (!l?.id) return;
        const antes = status.get(l.id);
        status.set(l.id, l.status);
        const quem = nomes.get(l.pessoa_id) ?? "Alguém";
        const nome = l.titulo ? `“${l.titulo}”` : "a lista";
        let t = "";
        if (l.status === "aprovada" && antes !== "aprovada") t = `${quem} aprovou ${nome}`;
        else if (ev.eventType === "INSERT" && ATIVAS.includes(l.status)) t = `Lista nova de ${quem}: ${l.titulo || "sem título"}`;
        if (!t) return;
        const id = ++n;
        setAvisos((a) => [...a.slice(-3), { id, t, aprovada: l.status === "aprovada" }]);
        setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 12000);
      })
      .subscribe();
    return () => { vivo = false; supabase.removeChannel(c); };
  }, [supabase, semana.id]);
  if (!avisos.length) return null;
  return (
    <div className="cp-avisos" role="status" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={a.aprovada ? "cp-aviso aprovada" : "cp-aviso"}>
          <span>{a.t}</span>
          <button className="ghost small" onClick={() => irPara(a.aprovada ? "final" : "andamento")}>{a.aprovada ? "Lista única" : "Ver"}</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Painel da Fernanda: em que pé está a semana e o que fazer agora (compras_painel, supabase/compras_fernanda.sql)
// ---------------------------------------------------------------------
type PainelDados = {
  listas: { pessoas: number; com_lista: number; aprovadas: number; em_revisao: number; aguardando: number; pessoas_tudo_aprovado: number };
  pendentes: { pessoa: string; unidade: string; setor: string; listas: number; aprovadas: number }[];
  itens: { total: number; baixa: number; valor_aprovado: number; valor_todas: number };
  fornecedores: { fornecedor: string; itens: number; valor: number; status: Pedido["status"]; pedido_em: string | null; recebido_em: string | null; nota: string | null }[];
  alertas_preco: { descricao: string; fornecedor: string; preco: number; media_anterior: number; alta_pct: number; unidade: string; emissao: string }[];
};
function Painel({ semana, irPara }: { semana: Semana; irPara: (a: Aba) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<PainelDados | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    supabase.rpc("compras_painel", { p_semana: semana.id }).then(({ data, error }) => {
      if (error) setErro(error.message); else setD(data as PainelDados);
    });
  }, [supabase, semana.id]);
  if (erro) return <p className="tv-alerta">{erro}</p>;
  if (!d) return <p className="muted">Carregando o painel…</p>;

  const fs = d.fornecedores;
  const aPedir = fs.filter((f) => f.status === "a_pedir");
  const esperando = fs.filter((f) => f.status === "pedido");
  const semNota = fs.filter((f) => f.status === "recebido" && !f.nota);
  const totalFinal = fs.reduce((s, f) => s + Number(f.valor ?? 0), 0);
  const pctAprov = d.listas.com_lista ? Math.round((d.listas.pessoas_tudo_aprovado / d.listas.com_lista) * 100) : 0;
  const tarefas: { t: string; d: string; acao?: [string, Aba] }[] = [];
  if (d.listas.com_lista < d.listas.pessoas) tarefas.push({ t: `${d.listas.pessoas - d.listas.com_lista} pessoas ainda sem lista`, d: "ainda não pediram no grupo COMPRAS nesta semana" });
  if (d.pendentes.length) tarefas.push({ t: `${d.pendentes.length} pessoas ainda não aprovaram tudo`, d: d.pendentes.map((p) => `${p.pessoa} (${p.aprovadas}/${p.listas})`).join(" · "), acao: ["Ver listas", "andamento"] });
  if (d.listas.pessoas_tudo_aprovado > 0 && !fs.length) tarefas.push({ t: "Juntar as listas aprovadas", d: "monta a lista única por fornecedor", acao: ["Abrir a lista única", "final"] });
  if (aPedir.length) tarefas.push({ t: `Fazer o pedido a ${aPedir.length} fornecedores`, d: aPedir.map((f) => f.fornecedor).join(" · "), acao: ["Abrir os pedidos", "final"] });
  if (esperando.length) tarefas.push({ t: `Esperando a entrega de ${esperando.length}`, d: esperando.map((f) => f.fornecedor).join(" · "), acao: ["Marcar recebido", "final"] });
  if (semNota.length) tarefas.push({ t: `Ligar a nota de ${semNota.length} pedidos recebidos`, d: "e conferir quantidade e preço com o que foi pedido", acao: ["Conferir", "final"] });
  if (d.itens.baixa) tarefas.push({ t: `${d.itens.baixa} itens sem produto nas notas`, d: "a análise não achou compra parecida: confira o fornecedor e o preço", acao: ["Ver listas", "andamento"] });

  return (
    <section className="cp-painel">
      <div className="ip-numeros">
        <div className="ip-numero">
          <span className="ip-rotulo">Pessoas com tudo aprovado</span>
          <span className="ip-valor">{d.listas.pessoas_tudo_aprovado}<small className="cp-de"> de {d.listas.com_lista}</small></span>
          <span className="ip-var neutro">{d.listas.aprovadas} de {d.listas.aprovadas + d.listas.em_revisao + d.listas.aguardando} listas aprovadas</span>
          <span className="pd-progresso" aria-hidden="true"><span style={{ width: `${pctAprov}%` }} /></span>
        </div>
        <div className="ip-numero"><span className="ip-rotulo">Estimado nas listas</span><span className="ip-valor">{brl(Number(d.itens.valor_todas))}</span><span className="ip-var neutro">{brl(Number(d.itens.valor_aprovado))} já aprovado</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Pedidos feitos</span><span className="ip-valor">{fs.length - aPedir.length}<small className="cp-de"> de {fs.length}</small></span><span className="ip-var neutro">{fs.filter((f) => f.status === "recebido").length} recebidos · {brl(totalFinal)} na lista única</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Itens nas listas</span><span className="ip-valor">{d.itens.total}</span><span className={d.itens.baixa ? "ip-var cf-alerta" : "ip-var neutro"}>{d.itens.baixa} sem produto nas notas</span></div>
      </div>

      <div className="cp-painel-grade">
        <section className="av-bloco">
          <h2>O que fazer agora</h2>
          {!tarefas.length ? <p className="es-tudo-certo">Tudo em dia nesta semana.</p> : (
            <ol className="cp-tarefas">
              {tarefas.map((x) => (
                <li key={x.t}>
                  <span><b>{x.t}</b><small>{x.d}</small></span>
                  {x.acao && <button className="ghost small" onClick={() => irPara(x.acao![1])}>{x.acao[0]}</button>}
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="av-bloco">
          <h2>Altas de preço nas notas</h2>
          {!d.alertas_preco.length ? <p className="muted">Nenhuma alta de 15% ou mais nos últimos 14 dias.</p> : (
            <ul className="cp-altas">
              {d.alertas_preco.map((a, i) => (
                <li key={i}>
                  <span><b>{a.descricao}</b><small>{a.fornecedor} · {new Date(a.emissao).toLocaleDateString("pt-BR")}</small></span>
                  <span className="n"><b className="cf-alerta">+{num(a.alta_pct)}%</b><small>{brl(a.preco)} / {a.unidade} · média {brl(a.media_anterior)}</small></span>
                </li>
              ))}
            </ul>
          )}
          <button className="ghost small" onClick={() => irPara("precos")}>Abrir o índice de preços</button>
        </section>
      </div>

      {fs.length > 0 && (
        <section className="av-bloco">
          <h2>Pedidos por fornecedor</h2>
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead><tr><th>Fornecedor</th><th className="n">Itens</th><th className="n">Valor</th><th>Situação</th><th>Nota</th></tr></thead>
              <tbody>
                {fs.map((f) => (
                  <tr key={f.fornecedor}>
                    <td>{f.fornecedor}</td><td className="n">{f.itens}</td><td className="n">{brl(Number(f.valor))}</td>
                    <td><span className={`cp-ped ${f.status}`}>{PEDIDO[f.status]}</span> <small className="muted">{quando(f.status === "recebido" ? f.recebido_em : f.pedido_em)}</small></td>
                    <td>{f.nota ? <a href={`/api/notas/danfe/${f.nota}`} target="_blank" rel="noreferrer">Ver PDF</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

// Conferência da nota com o pedido de um fornecedor (compras_conferir, compras_notas_do_fornecedor)
type Conferencia = {
  nota: { chave: string; emissao: string; valor: number; emitente: string; completa: boolean } | null;
  itens?: { item: string; unidade: string; qtd_pedida: number | null; preco_pedido: number | null; na_nota: string | null; unidade_nota: string | null; qtd_nota: number | null; preco_nota: number | null; situacao: "ok" | "faltou" | "quantidade" | "preco" }[];
  fora_do_pedido?: { descricao: string; unidade: string; quantidade: number; preco: number }[];
};
const SITUACAO: Record<string, string> = { ok: "confere", faltou: "não veio na nota", quantidade: "quantidade diferente", preco: "preço acima do pedido" };
function ConferirNota({ semana, fornecedor, pedido, onMudou }: { semana: Semana; fornecedor: string; pedido?: Pedido; onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [sugestoes, setSugestoes] = useState<{ chave: string; emissao: string; valor: number; emitente: string; completa: boolean }[] | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    setErro("");
    const [c, n] = await Promise.all([
      supabase.rpc("compras_conferir", { p_semana: semana.id, p_fornecedor: fornecedor }),
      supabase.rpc("compras_notas_do_fornecedor", { p_semana: semana.id, p_fornecedor: fornecedor }),
    ]);
    if (c.error || n.error) setErro((c.error ?? n.error)!.message);
    setConf((c.data ?? { nota: null }) as Conferencia);
    setSugestoes((n.data ?? []) as typeof sugestoes);
  }, [supabase, semana.id, fornecedor]);
  useEffect(() => { carregar(); }, [carregar, pedido?.nota_chave]);
  async function ligar(chave: string | null) {
    setErro("");
    const { error } = await supabase.rpc("compras_pedido_gravar", chave
      ? { p_semana: semana.id, p_fornecedor: fornecedor, p_nota: chave, p_status: pedido?.status === "recebido" ? null : "recebido" }
      : { p_semana: semana.id, p_fornecedor: fornecedor, p_tirar_nota: true });
    if (error) return setErro(error.message);
    onMudou();
    carregar();
  }
  if (!conf || !sugestoes) return <div className="cp-conferir no-print"><p className="muted">Carregando…</p></div>;
  const problemas = (conf.itens ?? []).filter((i) => i.situacao !== "ok").length;
  return (
    <div className="cp-conferir no-print">
      {erro && <p className="tv-alerta">{erro}</p>}
      {!conf.nota ? (
        <>
          <p className="muted">Escolha a nota fiscal deste pedido. Aparecem as notas do mesmo fornecedor de 3 dias antes da semana até 12 dias depois (a nota chega da SEFAZ uma vez por dia).</p>
          {!sugestoes.length ? <p className="muted">Nenhuma nota desse fornecedor ainda. Se a compra veio sem nota, lance como nota avulsa.</p> : (
            <ul className="cp-sugestoes">
              {sugestoes.map((n) => (
                <li key={n.chave}>
                  <span><b>{n.emitente}</b><small>{new Date(n.emissao).toLocaleDateString("pt-BR")} · {brl(n.valor)}{n.completa ? "" : " · só o resumo (sem itens ainda)"}</small></span>
                  <a className="ghost small botao" href={`/api/notas/danfe/${n.chave}`} target="_blank" rel="noreferrer">Ver PDF</a>
                  <button className="small" onClick={() => ligar(n.chave)}>É esta</button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="cp-conferir-cabeca">
            <span><b>Nota de {new Date(conf.nota.emissao).toLocaleDateString("pt-BR")} · {brl(conf.nota.valor)}</b>
              <small>{problemas ? `${problemas} ${problemas === 1 ? "item pede" : "itens pedem"} atenção` : "Tudo confere com o pedido."}</small></span>
            <a className="ghost small botao" href={`/api/notas/danfe/${conf.nota.chave}`} target="_blank" rel="noreferrer">Ver PDF da nota</a>
            <button className="ghost small" onClick={() => ligar(null)}>Trocar a nota</button>
          </div>
          {!conf.nota.completa && <p className="es-aviso">A nota ainda está só em resumo: os itens aparecem quando a SEFAZ liberar a nota completa.</p>}
          <div className="nf-tabela-wrap">
            <table className="nf-tabela cp-tabela">
              <thead><tr><th>Pedido</th><th className="n">Qtd. pedida</th><th className="n">Preço pedido</th><th>Na nota</th><th className="n">Qtd. na nota</th><th className="n">Preço na nota</th><th>Situação</th></tr></thead>
              <tbody>
                {(conf.itens ?? []).map((i, k) => (
                  <tr key={k} className={i.situacao === "ok" ? "" : "cp-conf-atencao"}>
                    <td>{i.item}<small className="muted"> {i.unidade}</small></td>
                    <td className="n">{num(i.qtd_pedida)}</td><td className="n">{brl(i.preco_pedido)}</td>
                    <td>{i.na_nota ?? "—"}{i.unidade_nota && <small className="muted"> {i.unidade_nota}</small>}</td>
                    <td className="n">{num(i.qtd_nota)}</td><td className="n">{brl(i.preco_nota)}</td>
                    <td><span className={`cp-sit ${i.situacao}`}>{SITUACAO[i.situacao]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!conf.fora_do_pedido?.length && (
            <details className="cp-pedido"><summary>{conf.fora_do_pedido.length} itens na nota que não estavam no pedido</summary>
              <ul className="cp-fora">{conf.fora_do_pedido.map((x, k) => <li key={k}>{x.descricao} · {num(x.quantidade)} {x.unidade} · {brl(x.preco)}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// Notas de compra recentes (para a Fernanda conferir e achar a nota de cada pedido)
type NotaRecente = { chave: string; emissao: string; valor: number; emitente: string; casa: string; completa: boolean; origem: string; itens: number; pedido: { fornecedor: string; status: string } | null };
type ItemNota = { n_item: number; descricao: string; unidade: string; quantidade: number; valor_unitario: number; valor_total: number };
function NotasRecebidas() {
  const supabase = useMemo(() => createClient(), []);
  const [dias, setDias] = useState(21);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [notas, setNotas] = useState<NotaRecente[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemNota[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setNotas(null);
    supabase.rpc("compras_notas_recentes", { p_dias: dias, p_busca: termo || null }).then(({ data, error }) => {
      if (error) setErro(error.message);
      setNotas((data ?? []) as NotaRecente[]);
    });
  }, [supabase, dias, termo]);
  async function abrir(chave: string) {
    if (aberta === chave) return setAberta(null);
    setAberta(chave); setItens([]);
    const { data } = await supabase.from("notas_itens").select("n_item,descricao,unidade,quantidade,valor_unitario,valor_total").eq("chave", chave).order("n_item");
    setItens((data ?? []) as ItemNota[]);
  }
  const CASA: Record<string, string> = { ...UNIDADES, grupo: "outra empresa do grupo" };
  const total = (notas ?? []).reduce((s, n) => s + Number(n.valor ?? 0), 0);
  return (
    <section className="cp-notas">
      <form className="cp-notas-filtro" onSubmit={(e) => { e.preventDefault(); setTermo(busca.trim()); }}>
        <input value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Fornecedor ou item (ex.: Eloi, queijo)" aria-label="Buscar nas notas" />
        <select value={dias} onChange={(v) => setDias(Number(v.target.value))} aria-label="Período">
          <option value={7}>últimos 7 dias</option><option value={21}>últimas 3 semanas</option><option value={60}>últimos 2 meses</option><option value={120}>últimos 4 meses</option>
        </select>
        <button className="ghost small">Buscar</button>
      </form>
      {erro && <p className="tv-alerta">{erro}</p>}
      {!notas ? <p className="muted">Carregando as notas…</p> : !notas.length ? <p className="muted">Nenhuma nota nesse período.</p> : (
        <>
          <p className="muted">{notas.length} notas · {brl(total)}. As notas chegam da SEFAZ todo dia de manhã; a compra sem nota entra como nota avulsa.</p>
          <ul className="cp-lista-notas">
            {notas.map((n) => (
              <li key={n.chave} className={aberta === n.chave ? "on" : ""}>
                <button className="cp-nota-linha" onClick={() => abrir(n.chave)} aria-expanded={aberta === n.chave}>
                  <span><b>{n.emitente}</b><small>{new Date(n.emissao).toLocaleDateString("pt-BR")} · {CASA[n.casa] ?? n.casa} · {n.itens} itens{n.origem === "avulsa" ? " · avulsa" : ""}{n.completa ? "" : " · só resumo"}</small></span>
                  {n.pedido && <span className={`cp-ped ${n.pedido.status}`}>pedido da semana</span>}
                  <b className="n">{brl(n.valor)}</b>
                </button>
                {aberta === n.chave && (
                  <div className="cp-nota-itens">
                    {n.completa && <a className="ghost small botao" href={`/api/notas/danfe/${n.chave}`} target="_blank" rel="noreferrer">Ver PDF da nota</a>}
                    {!itens.length ? <p className="muted">{n.completa ? "Carregando os itens…" : "A nota ainda está só em resumo, sem itens."}</p> : (
                      <div className="nf-tabela-wrap">
                        <table className="nf-tabela">
                          <thead><tr><th>Item</th><th className="n">Qtd.</th><th>Unid.</th><th className="n">Preço</th><th className="n">Total</th></tr></thead>
                          <tbody>{itens.map((i) => <tr key={i.n_item}><td>{i.descricao}</td><td className="n">{num(i.quantidade)}</td><td>{i.unidade}</td><td className="n">{brl(i.valor_unitario)}</td><td className="n">{brl(i.valor_total)}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
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
