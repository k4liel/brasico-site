"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { NotaAvulsa } from "./Notas";

// Compras (Operação · fase 2): pedidos do grupo COMPRAS analisados pelo Claude viram listas por pessoa
// (uma por pedido: mercado, Ceasa...), cada item ligado ao produto das notas, com a média de 4 semanas e a
// projeção; cada pessoa revisa, junta listas se quiser e aprova; a Fernanda junta as aprovadas na lista
// única por fornecedor, gera o PDF de cada fornecedor, marca pedido feito e recebido e confere a nota fiscal
// com o pedido. Tabelas e funções em supabase/compras.sql, compras_listas_metricas.sql e compras_fernanda.sql.
type Papel = "socio" | "compras" | "solicitante" | null;
type Pessoa = { id: string; nome: string; unidade: string | null; setor: string | null; papel: string; email?: string | null;
  user_id: string | null; wa_nome: string | null; ativo: boolean; convidado_em: string | null; registra_estoque?: boolean };
type Semana = { id: string; inicio: string; status: string; aumento_pct?: number };
type Lista = { id: string; semana_id: string; pessoa_id: string; status: string; titulo: string | null; pedido_texto: string | null; analisada_em: string | null; aprovada_em: string | null; created_at: string; movida_de?: string | null; movida_em?: string | null };
// Situação da lista na semana (compras_listas_situacao): total e quantos itens já estão em pedido feito / recebido
type SitLista = { lista_id: string; pessoa_id: string; itens: number; total: number; pedidos: number; recebidos: number; pedido_em: string | null; recebido_em: string | null };
// Comprada = todos os itens já foram pedidos ao fornecedor; recebida = todos chegaram
const compra = (x?: SitLista) => (!x || !x.itens || !x.pedidos ? null : x.recebidos >= x.itens ? "recebida" : x.pedidos >= x.itens ? "comprada" : "parte");
const COMPRA: Record<string, string> = { recebida: "✓ Comprada e recebida", comprada: "✓ Comprada", parte: "Parte comprada" };
type Item = { id: number; lista_id: string; ordem: number; nome: string; fornecedor: string | null; unidade: string | null;
  qtd_pedida: number | null; qtd_sugerida: number | null; motivo: string | null; qtd: number | null; preco: number | null;
  removido: boolean; incluido_na_revisao: boolean; media_4s: number | null; projecao: number | null; base: string | null;
  produto_nota: string | null; confianca: "alta" | "media" | "baixa" | null };
type Pedido = { fornecedor: string; empresa: string; status: "a_pedir" | "pedido" | "recebido"; pedido_em: string | null; recebido_em: string | null; nota_chave: string | null; observacao: string | null };
type Final = { id: number; fornecedor: string; empresa: string; movido: boolean; nome: string; unidade: string; qtd: number | null; preco: number | null;
  origem: { pessoa: string; unidade: string; setor: string; qtd: number }[]; removido: boolean; editado: boolean; atualizado_em?: string | null };

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

type Aba = "painel" | "andamento" | "final" | "fornecedores" | "pessoas" | "avulsa";

export default function Compras({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<Papel | undefined>(undefined);
  const [eu, setEu] = useState<Pessoa | null>(null);
  const [lider, setLider] = useState(false);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [aba, setAba] = useState<Aba>("painel");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("operacao_eu");
      const r = (data ?? {}) as { papel: Papel; pessoa: Pessoa | null; lider?: boolean };
      setPapel(r.papel ?? null);
      setLider(!!r.lider);
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
        <p>Semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}. A semana vai de domingo a sábado: cada pedido do grupo COMPRAS entra na semana em que foi mandado e a lista aparece aqui em poucos minutos.
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
      {papel === "socio" ? <Topo email={userEmail} ativo="compras" /> : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} outra={papel === "compras" ? { href: "/notas", nome: "Notas fiscais" } : eu?.registra_estoque ? { href: "/estoque", nome: "Câmara fria" } : lider ? { href: "/escala", nome: "Escala" } : undefined} />}
      <main className="miolo tv es cp-area nf-larga">
        {cabecalho}
        {!semana ? <p className="muted">Carregando a semana…</p> : gestor ? (
          <>
            <div className="cp-abas" role="tablist">
              {([["painel", "Painel"], ["andamento", "Listas"], ["final", "Lista Geral"], ["fornecedores", "Fornecedores"], ["avulsa", "Nota avulsa"],
                 ...(papel === "socio" ? [["pessoas", "Pessoas e acesso"]] : [])] as [Aba, string][]).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? "on" : ""} onClick={() => setAba(k)}>{t}</button>
              ))}
            </div>
            <AvisosGestor semana={semana} irPara={setAba} />
            {aba === "painel" && <Painel semana={semana} />}
            {aba === "andamento" && <Andamento semana={semana} />}
            {aba === "final" && <ListaUnica semana={semana} />}
            {aba === "fornecedores" && <Fornecedores />}
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
const ORDEM_AREAS = ["Compras", "Notas fiscais", "Fichas técnicas", "Câmara fria", "Produção", "Escala"];
// Quem tem a Operação completa (operacao_pessoas.operacao_completa) vê todas as áreas e os projetos de que é membro
const AREAS_OPERACAO = [
  { href: "/compras", nome: "Compras" }, { href: "/notas", nome: "Notas fiscais" }, { href: "/fichas", nome: "Fichas técnicas" },
  { href: "/estoque", nome: "Câmara fria" }, { href: "/producao", nome: "Produção" },
];
// Topo de quem só abre uma área da Operação (solicitantes, Fernanda, câmara fria)
export function TopoSimples({ email, nome, area = "Compras", outra }: { email: string; nome: string; area?: string; outra?: { href: string; nome: string } }) {
  const [senha, setSenha] = useState(false);
  const [completa, setCompleta] = useState<{ href: string; nome: string }[] | null>(null);
  // Quem monta a escala de alguma casa vê também a Escala no menu
  const [ehLider, setEhLider] = useState(false);
  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      sb.rpc("escala_eh_lider", { p_user: user.id }).then(({ data }) => setEhLider(!!data));
      const { data: ok } = await sb.rpc("operacao_completa", { p_user: user.id });
      if (!ok) return;
      const { data: ws } = await sb.from("workspaces").select("id,name").is("removido_em", null).order("name");
      setCompleta([...AREAS_OPERACAO, ...((ws ?? []) as { id: string; name: string }[]).map((w) => ({ href: `/projeto/${w.id}`, nome: w.name }))]);
    })();
  }, []);
  async function sair() {
    await createClient().auth.signOut();
    window.location.href = "/colaboradores";
  }
  const base = completa
    ? (completa.some((p) => p.nome === area) ? completa : [{ href: "", nome: area }, ...completa])
    : outra ? [{ href: "", nome: area }, outra].sort((x, y) => ORDEM_AREAS.indexOf(x.nome) - ORDEM_AREAS.indexOf(y.nome)) : null;
  const paginas = ehLider && !(base ?? [{ nome: area }]).some((p) => p.nome === "Escala")
    ? [...(base ?? [{ href: "", nome: area }]), { href: "/escala", nome: "Escala" }]
    : base;
  return (
    <>
      <header className="topo cp-topo">
        {paginas ? (
          // quem abre duas áreas ou mais (ex.: a Fernanda, Compras e Notas fiscais) tem um menu com elas
          <nav className="cp-menu" aria-label="Páginas">
            <span className="marca">Brasico</span>
            {paginas.map((p) =>
              p.nome === area ? <span key={p.nome} className="cp-menu-item on" aria-current="page">{p.nome}</span>
                : <a key={p.nome} className="cp-menu-item" href={p.href}>{p.nome}</a>)}
          </nav>
        ) : <span className="marca">Brasico · {area}</span>}
        <span className="cp-quem">{nome || email}
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
  const [sit, setSit] = useState<Record<string, SitLista>>({});
  const carregar = useCallback(async () => {
    if (!pessoaId) return;
    const { data: sx } = await supabase.rpc("compras_listas_situacao", { p_semana: semanaId });
    setSit(Object.fromEntries(((sx ?? []) as SitLista[]).map((x) => [x.lista_id, { ...x, total: Number(x.total) }])));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_pedidos" }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(c); };
  }, [supabase, pessoaId, carregar]);
  return { listas, itens, sit, carregar };
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

function Listas({ semana, listas, itens, sit, carregar, gestor }: { semana: Semana; listas: Lista[]; itens: Item[]; sit: Record<string, SitLista>; carregar: () => void; gestor: boolean }) {
  const aberta = semana.status === "aberta";
  // total de todas as listas da pessoa na semana (itens que ficaram, quantidade × preço)
  const vivos = itens.filter((i) => !i.removido && listas.some((l) => l.id === i.lista_id));
  const total = vivos.reduce((s, i) => s + (i.qtd ?? 0) * (i.preco ?? 0), 0);
  const aprovadas = listas.filter((l) => l.status === "aprovada").length;
  const compradas = listas.filter((l) => ["comprada", "recebida"].includes(compra(sit[l.id]) ?? "")).length;
  return (
    <>
      <div className="cp-soma-listas">
        <div className="cp-soma-total"><span className="cp-soma-rotulo">Total {listas.length > 1 ? `das ${listas.length} listas` : "da lista"}</span><b>{brl(total)}</b></div>
        <div><span className="cp-soma-rotulo">Itens</span><b>{vivos.length}</b></div>
        <div><span className="cp-soma-rotulo">Aprovadas</span><b>{aprovadas}<small> de {listas.length}</small></b></div>
        <div className={compradas ? "cp-soma-ok" : ""}><span className="cp-soma-rotulo">Já compradas</span><b>{compradas}<small> de {listas.length}</small></b></div>
      </div>
      {listas.length > 1 && (
        <p className="muted cp-listas-resumo">Confira e aprove cada uma; se preferir, junte duas numa só ou mande uma lista para outra semana.</p>
      )}
      {aberta && <JuntarListas listas={listas} onMudou={carregar} />}
      {listas.map((l) => (
        <EditorLista key={l.id} lista={l} itens={itens.filter((i) => i.lista_id === l.id)} abertaInicial={listas.length === 1 && !compra(sit[l.id])}
          podeEditar={aberta && (gestor || l.status !== "aprovada")} onMudou={carregar} gestor={gestor} sit={sit[l.id]} semanaAberta={aberta} semanaInicio={semana.inicio} />
      ))}
    </>
  );
}

function MinhaLista({ semana, pessoa }: { semana: Semana; pessoa: Pessoa }) {
  const { listas, itens, sit, carregar } = useListas(semana.id, pessoa.id);
  if (listas === undefined) return <p className="muted">Carregando as suas listas…</p>;
  if (!listas.length) {
    return (
      <>
        <section className="av-bloco cp-vazio">
          <h2>Sua lista ainda não saiu</h2>
          <p className="muted">Mande o pedido do seu setor no grupo COMPRAS (texto, planilha, PDF ou foto). Em poucos minutos a lista sugerida aparece aqui para você revisar (você recebe um aviso nesta página).</p>
        </section>
      </>
    );
  }
  return (
    <>
      <AvisoListaNova pessoa={pessoa.id} listas={listas} />
      <Listas semana={semana} listas={listas} itens={itens} sit={sit} carregar={carregar} gestor={false} />
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
function EditorLista({ lista, itens, podeEditar, onMudou, gestor, abertaInicial = true, sit, semanaAberta, semanaInicio }: { lista: Lista; itens: Item[]; podeEditar: boolean; onMudou: () => void; gestor: boolean; abertaInicial?: boolean; sit?: SitLista; semanaAberta: boolean; semanaInicio: string }) {
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
  const comprada = compra(sit);
  // mandar para a semana anterior ou a seguinte (lista com item já pedido ao fornecedor não muda)
  const podeMover = semanaAberta && !sit?.pedidos && (gestor || lista.status !== "aprovada");
  async function moverSemana(direcao: -1 | 1) {
    const d = new Date(`${semanaInicio}T12:00:00`); d.setDate(d.getDate() + 7 * direcao);
    const alvo = d.toISOString().slice(0, 10);
    if (!confirm(`Mandar "${lista.titulo || "Lista"}" para a semana de ${diaSemana(alvo)} a ${fimSemana(alvo)}?`)) return;
    setErro("");
    const { error } = await supabase.rpc("compras_lista_mover_semana", { p_lista: lista.id, p_direcao: direcao });
    if (error) return setErro(error.message);
    onMudou();
  }
  async function aprovar(sim: boolean) {
    setErro("");
    const { error } = await supabase.rpc("compras_lista_aprovar", { p_lista: lista.id, p_aprovar: sim });
    if (error) setErro(error.message);
    onMudou();
  }

  return (
    <section className={`av-bloco cp-lista${aberta ? "" : " cp-fechada"}${comprada === "comprada" || comprada === "recebida" ? " cp-lista-comprada" : ""}`}>
      <div className="cp-lista-cabeca">
        <button type="button" className="cp-abre" onClick={() => setAberta(!aberta)} aria-expanded={aberta}
          aria-label={aberta ? "Fechar a lista" : "Abrir a lista"}><span aria-hidden="true">{aberta ? "▾" : "▸"}</span></button>
        <div className="cp-lista-titulo" onClick={() => !aberta && setAberta(true)}>
          {podeEditar && aberta ? <input defaultValue={lista.titulo ?? ""} placeholder="Nome da lista (ex.: Mercado, Ceasa)" aria-label="Nome da lista"
            onBlur={(v) => v.target.value !== (lista.titulo ?? "") && renomear(v.target.value)} /> : <h3>{lista.titulo || "Lista"}</h3>}
        </div>
        <div className="cp-lista-total"><span>{vivos.length} itens</span><b>{brl(total)}</b></div>
        {comprada ? <span className={`cp-selo-compra ${comprada}`}>{COMPRA[comprada]}{comprada === "parte" && sit ? ` · ${sit.pedidos} de ${sit.itens}` : ""}</span>
          : <span className={`estado ${lista.status === "aprovada" ? "tv-ok" : "tv-revisar"}`}>{STATUS[lista.status] ?? lista.status}</span>}
      </div>
      {comprada && (
        <p className={`cp-faixa-compra ${comprada}`}>
          {comprada === "recebida" ? `Esta lista já foi comprada e chegou${sit?.recebido_em ? ` (${quando(sit.recebido_em)})` : ""}.`
            : comprada === "comprada" ? `Esta lista já foi comprada: todos os itens foram pedidos ao fornecedor${sit?.pedido_em ? ` (${quando(sit.pedido_em)})` : ""}.`
            : `${sit?.pedidos} de ${sit?.itens} itens já foram pedidos ao fornecedor; o resto ainda falta comprar.`}
        </p>
      )}
      {lista.movida_em && <p className="cp-faixa-movida">Esta lista veio de outra semana ({quando(lista.movida_em)}).</p>}
      {aberta && <>
      {lista.pedido_texto && (
        <details className="cp-pedido"><summary>O pedido que veio no grupo</summary><pre>{lista.pedido_texto}</pre></details>
      )}
      {podeEditar && (
        <p className="cp-legenda"><span className="cp-campo-exemplo" aria-hidden="true">12</span>
          Os campos em destaque (<b>Pedir</b>, <b>Unid.</b> e <b>Preço</b>) você pode mudar: clique, escreva e saia do campo para salvar.</p>
      )}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela cp-tabela cp-tabela-lista">
          <thead><tr>
            <th>Item</th><th className="n">Pediu</th>
            <th className="n" title="Pela média de compra das últimas 4 semanas (notas fiscais), mais o % da semana">Sugestão</th>
            <th className="n cp-th-edita">Pedir</th><th className="cp-th-edita">Unid.</th><th className="n cp-th-edita">Preço</th>
            <th className="n">Total</th><th />
          </tr></thead>
          <tbody>
            {itens.map((i) => {
              const difere = i.qtd_sugerida != null && i.qtd_pedida != null && i.qtd_sugerida !== i.qtd_pedida;
              const edita = podeEditar && !i.removido;
              // por que a sugestão: a conta (média, compras, fornecedor) e o aviso da análise
              const porque = [i.motivo, i.base && !i.motivo?.includes("média") ? `Base: ${i.base}.` : null].filter(Boolean).join(" ");
              return (
                <Fragment key={i.id}>
                  <tr className={`${i.removido ? "cp-tirado" : ""} ${porque ? "cp-com-obs" : ""}`}>
                    <td className="cp-item">
                      {gestor && edita ? <input className="cp-nome" defaultValue={i.nome} onBlur={(v) => v.target.value !== i.nome && salvar(i, { nome: v.target.value })} aria-label="Item" />
                        : <b className="cp-nome">{i.nome}</b>}
                      <span className="cp-sub">
                        {i.confianca && <span className={`cp-conf ${i.confianca}`} title={CONFIANCA[i.confianca]}>{i.confianca === "alta" ? "✓" : i.confianca === "media" ? "≈" : "?"}</span>}
                        {i.produto_nota ? i.produto_nota : CONFIANCA[i.confianca ?? ""] ?? ""}
                        {i.fornecedor && <> · <span className="cp-forn-nome">{i.fornecedor}</span></>}
                      </span>
                      {i.incluido_na_revisao && <span className="cp-sub">incluído na revisão</span>}
                    </td>
                    <td className="n cp-pediu">{num(i.qtd_pedida) || "—"}</td>
                    <td className="n"><span className={difere ? "cp-sug difere" : "cp-sug"}>{num(i.qtd_sugerida) || "—"}</span></td>
                    <td className="n">{edita ? <input className="n cp-edita" inputMode="decimal" defaultValue={num(i.qtd)} onBlur={(v) => ler(v.target.value) !== i.qtd && salvar(i, { qtd: ler(v.target.value) })} aria-label={`Quantidade a pedir de ${i.nome}`} /> : <b>{num(i.qtd)}</b>}</td>
                    <td>{edita ? <input className="cp-edita cp-un" defaultValue={i.unidade ?? ""} onBlur={(v) => v.target.value !== (i.unidade ?? "") && salvar(i, { unidade: v.target.value })} aria-label={`Unidade de ${i.nome}`} /> : i.unidade ?? ""}</td>
                    <td className="n">{edita ? <input className="n cp-edita" inputMode="decimal" defaultValue={num(i.preco)} onBlur={(v) => ler(v.target.value) !== i.preco && salvar(i, { preco: ler(v.target.value) })} aria-label={`Preço de ${i.nome}`} /> : brl(i.preco)}</td>
                    <td className="n cp-tot">{brl((i.qtd ?? 0) * (i.preco ?? 0))}</td>
                    <td>{podeEditar && <button className="ghost small" onClick={() => salvar(i, { removido: !i.removido })}>{i.removido ? "Voltar" : "Tirar"}</button>}</td>
                  </tr>
                  {porque && !i.removido && (
                    <tr className="cp-obs"><td colSpan={8}><span aria-hidden="true">💡</span> {porque}</td></tr>
                  )}
                </Fragment>
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
        {lista.status === "aprovada" && !gestor && !comprada && <p className="es-tudo-certo">Lista aprovada. O setor de compras já pode juntá-la na lista final.</p>}
        {podeMover && (
          <span className="cp-mover-semana">
            <button type="button" className="ghost small" onClick={() => moverSemana(-1)}>← Semana passada</button>
            <button type="button" className="ghost small" onClick={() => moverSemana(1)}>Próxima semana →</button>
          </span>
        )}
      </div>
      </>}
    </section>
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
  const [sit, setSit] = useState<SitLista[]>([]);
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(async () => {
    const { data: sx } = await supabase.rpc("compras_listas_situacao", { p_semana: semana.id });
    setSit(((sx ?? []) as SitLista[]).map((x) => ({ ...x, total: Number(x.total) })));
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

  return (
    <>
      <AumentoSemana semana={semana} onSalvo={() => { carregar(); setVersao((v) => v + 1); }} />
      <div className="ip-numeros">
        <div className="ip-numero">
          <span className="ip-rotulo">Listas aprovadas</span>
          <span className="ip-valor">{aprovadas}<small className="cp-de"> de {pessoas.length}</small></span>
          <span className="ip-var neutro">{pct}% das pessoas</span>
          <span className="pd-progresso" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
        </div>
        <div className="ip-numero"><span className="ip-rotulo">Em revisão</span><span className="ip-valor">{revisao}</span><span className="ip-var neutro">a pessoa confere e aprova</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Sem lista ainda</span><span className={semLista ? "ip-valor cf-alerta" : "ip-valor"}>{semLista}</span><span className="ip-var neutro">pedido no grupo COMPRAS</span></div>
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
                  const sp = sit.filter((x) => x.pessoa_id === p.id);
                  const totalP = sp.reduce((s, x) => s + x.total, 0);
                  const compradasP = ls.filter((l) => ["comprada", "recebida"].includes(compra(sp.find((x) => x.lista_id === l.id)) ?? "")).length;
                  return (
                    <li key={p.id}>
                      <button className={aberta === p.id ? "cp-pessoa on" : "cp-pessoa"} onClick={() => setAberta(aberta === p.id ? null : p.id)} aria-expanded={aberta === p.id}>
                        <span className="cp-avatar" aria-hidden="true">{p.nome.slice(0, 1)}</span>
                        <span className="cp-pessoa-nome"><strong>{p.nome}</strong><small>{SETORES[p.setor ?? ""]}{!p.wa_nome ? " · sem nome no WhatsApp" : analises[p.id] ? ` · ${ANALISE[analises[p.id].status] ?? analises[p.id].status}` : ""}</small></span>
                        {ls.length > 0 && <span className="cp-pessoa-total">{brl(totalP)}</span>}
                        {ls.length > 0 && compradasP === ls.length ? <span className="cp-selo-compra comprada">✓ Comprada{ls.length > 1 ? `s (${ls.length})` : ""}</span>
                          : <span className={`estado ${st === "aprovada" ? "tv-ok" : st === "em_revisao" ? "tv-revisar" : ""}`}>{st ? `${ls.length > 1 ? `${ls.length} listas · ` : ""}${STATUS[st]}${compradasP ? ` · ${compradasP} comprada${compradasP > 1 ? "s" : ""}` : ""}` : "sem lista"}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {aberta && <ListaDaPessoa key={`${aberta}-${versao}`} semana={semana} pessoa={pessoas.find((p) => p.id === aberta)!} onFechar={() => setAberta(null)} />}
    </>
  );
}

function ListaDaPessoa({ semana, pessoa, onFechar }: { semana: Semana; pessoa: Pessoa; onFechar: () => void }) {
  const { listas, itens, sit, carregar } = useListas(semana.id, pessoa.id);
  return (
    <div className="cp-da-pessoa">
      <header className="cp-da-pessoa-cabeca">
        <span className="cp-avatar grande" aria-hidden="true">{pessoa.nome.slice(0, 1)}</span>
        <div><h3>{pessoa.nome}</h3><small>{SETORES[pessoa.setor ?? ""]} · {UNIDADES[pessoa.unidade ?? ""]}</small></div>
        <button className="ghost small" onClick={onFechar}>Fechar</button>
      </header>
      {listas === undefined ? <p className="muted">Carregando…</p>
        : !listas.length ? <p className="muted">Ainda sem lista nesta semana. Quando a pessoa pedir no grupo, a lista sugerida aparece aqui depois que for montada.</p>
        : <Listas semana={semana} listas={listas} itens={itens} sit={sit} carregar={carregar} gestor />}
    </div>
  );
}

// % a mais da semana (feriado, evento): entra na projeção de cada item na próxima análise
function AumentoSemana({ semana, onSalvo }: { semana: Semana; onSalvo: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [salvo, setSalvo] = useState<number>(Number(semana.aumento_pct ?? 0));
  const [pct, setPct] = useState(String(semana.aumento_pct ?? 0).replace(".", ","));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState<{ pct: number; itens: number; listas: number; total_antes: number; total_depois: number } | null>(null);
  // lê o % salvo da semana (pode ter mudado depois que a página abriu)
  useEffect(() => {
    setRes(null);
    supabase.from("compras_semanas").select("aumento_pct").eq("id", semana.id).single().then(({ data }) => {
      const v = Number(data?.aumento_pct ?? 0);
      setSalvo(v); setPct(String(v).replace(".", ","));
    });
  }, [supabase, semana.id]);
  async function aplicar(valor: number) {
    setErro(""); setOcupado(true);
    const { data, error } = await supabase.rpc("compras_semana_aumento", { p_semana: semana.id, p_pct: valor });
    setOcupado(false);
    if (error) return setErro(error.message);
    setSalvo(valor); setPct(String(valor).replace(".", ","));
    setRes(data as typeof res);
    onSalvo();
  }
  if (semana.status !== "aberta") return null;
  const digitado = ler(pct) ?? 0;
  const mudou = digitado !== salvo;
  const ATALHOS = [0, 10, 20, 30, 50];
  const sinal = (v: number) => (v > 0 ? `+${num(v)}%` : `${num(v)}%`);
  return (
    <section className="cp-aum">
      <div className="cp-aum-texto">
        <span className="cp-aum-selo" aria-hidden="true">%</span>
        <div>
          <h3>Movimento da semana</h3>
          <p>Feriado, evento ou casa cheia? Coloque quanto a mais (ou a menos) vai precisar. Ao salvar, <b>todas as listas da semana são recalculadas na hora</b>: sugestão, quantidade a pedir e totais.</p>
        </div>
      </div>
      <form className="cp-aum-controle" onSubmit={(ev) => { ev.preventDefault(); aplicar(digitado); }}>
        <div className="cp-aum-atalhos" role="group" aria-label="Atalhos de porcentagem">
          {ATALHOS.map((v) => (
            <button key={v} type="button" className={salvo === v && !mudou ? "on" : ""} disabled={ocupado} onClick={() => aplicar(v)}>{v === 0 ? "Normal" : `+${v}%`}</button>
          ))}
        </div>
        <label className="cp-aum-campo">
          <input inputMode="decimal" value={pct} onChange={(v) => setPct(v.target.value)} aria-label="Porcentagem da semana" />
          <span aria-hidden="true">%</span>
        </label>
        <button className="small" disabled={ocupado || !mudou}>{ocupado ? "Recalculando…" : "Salvar e recalcular"}</button>
      </form>
      <div className="cp-aum-status" role="status">
        {erro ? <span className="tv-alerta">{erro}</span>
          : ocupado ? <span>Recalculando as listas…</span>
          : res ? <span><b>{sinal(res.pct)} aplicado.</b> {res.itens} itens recalculados em {res.listas} {res.listas === 1 ? "lista" : "listas"} · total {brl(res.total_antes)} → <b>{brl(res.total_depois)}</b>. O que cada pessoa já tinha mudado no Pedir ficou como estava.</span>
          : <span>Agora: <b>{salvo === 0 ? "semana normal" : `${sinal(salvo)} sobre a média`}</b>. Itens com pedido já feito ao fornecedor não mudam.</span>}
      </div>
    </section>
  );
}

// Empresas que compram (CNPJ). Cada item nasce na empresa da casa que pediu (compras_empresa_padrao, supabase/compras_lista_unica_empresas.sql)
const EMPRESAS: { cnpj: string; nome: string; razao: string; casas: string }[] = [
  { cnpj: "24021962000276", nome: "Brasico77 · filial 0002", razao: "BRASICO77 EMPREENDIMENTOS TURISTICOS LTDA", casas: "Cicchetti Centro e Produção" },
  { cnpj: "24021962000195", nome: "Brasico77 · matriz", razao: "BRASICO77 EMPREENDIMENTOS TURISTICOS LTDA", casas: "Filha da Lua" },
  { cnpj: "50639716000101", nome: "LAIF Hotelarias", razao: "LAIF HOTELARIAS LTDA", casas: "Sempre Vivo" },
  { cnpj: "36528542000189", nome: "Associação Genesis", razao: "ASSOCIACAO GENESIS", casas: "" },
];
const empresaDe = (cnpj: string) => EMPRESAS.find((e) => e.cnpj === cnpj) ?? { cnpj, nome: cnpj || "Sem empresa", razao: "", casas: "" };
const fmtCnpj = (c: string) => (c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c);
const chavePedido = (empresa: string, fornecedor: string) => `${empresa}|${fornecedor}`;

function ListaUnica({ semana }: { semana: Semana }) {
  const supabase = useMemo(() => createClient(), []);
  const [linhas, setLinhas] = useState<Final[]>([]);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState({ empresa: EMPRESAS[0].cnpj, fornecedor: "", nome: "", unidade: "", qtd: "", preco: "" });
  const [pedidos, setPedidos] = useState<Record<string, Pedido>>({});
  const [imprimir, setImprimir] = useState<string | null>(null);
  const [cadastro, setCadastro] = useState<Forn[]>([]);
  const [movendo, setMovendo] = useState<number | null>(null);      // item com o painel "Mover" aberto
  const [arrastando, setArrastando] = useState<number | null>(null); // item sendo arrastado
  const [alvo, setAlvo] = useState<string | null>(null);             // onde o item vai cair
  // abrir e fechar: empresas começam abertas, fornecedores começam fechados (só o cabeçalho com a situação e o total)
  const [empFechadas, setEmpFechadas] = useState<Set<string>>(new Set());
  const [fornAbertos, setFornAbertos] = useState<Set<string>>(new Set());
  const alternar = (set: (f: (s: Set<string>) => Set<string>) => void, k: string) =>
    set((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const teclaAbre = (fn: () => void) => (ev: React.KeyboardEvent) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fn(); } };
  const aberta = semana.status === "aberta";
  useEffect(() => {
    supabase.from("compras_fornecedores").select("*").eq("ativo", true).then(({ data }) => setCadastro((data ?? []) as Forn[]));
  }, [supabase]);
  // o fornecedor da lista geral no cadastro: pela razão social, pelo nome ou por um apelido
  const doCadastro = (nome: string) => {
    const n = nome.trim().toUpperCase();
    return cadastro.find((f) => (f.razao_social ?? "").toUpperCase() === n || f.nome.toUpperCase() === n || f.apelidos.some((a) => a.toUpperCase() === n));
  };

  const carregar = useCallback(async () => {
    const [{ data }, { data: ps }] = await Promise.all([
      supabase.from("compras_final").select("*").eq("semana_id", semana.id).order("fornecedor").order("nome"),
      supabase.from("compras_pedidos").select("*").eq("semana_id", semana.id),
    ]);
    setLinhas((data ?? []) as Final[]);
    setPedidos(Object.fromEntries(((ps ?? []) as Pedido[]).map((x) => [chavePedido(x.empresa, x.fornecedor), x])));
  }, [supabase, semana.id]);

  // PDF de um pedido só (o que vai para o fornecedor, sem preços): marca qual imprimir, imprime e volta ao normal
  useEffect(() => {
    if (!imprimir) return;
    const fim = () => setImprimir(null);
    window.addEventListener("afterprint", fim);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", fim); };
  }, [imprimir]);
  async function marcar(empresa: string, fornecedor: string, status: Pedido["status"]) {
    setErro("");
    const { error } = await supabase.rpc("compras_pedido_gravar", { p_semana: semana.id, p_fornecedor: fornecedor, p_empresa: empresa, p_status: status });
    if (error) setErro(error.message);
    carregar();
  }
  useEffect(() => { carregar(); }, [carregar]);

  async function salvar(f: Final, m: Partial<Final>) {
    setErro("");
    const x = { ...f, ...m };
    const { error } = await supabase.rpc("compras_final_salvar", { p_id: f.id, p_fornecedor: x.fornecedor, p_nome: x.nome, p_unidade: x.unidade,
      p_qtd: x.qtd, p_preco: x.preco, p_removido: x.removido, p_empresa: x.empresa });
    if (error) setErro(error.message);
    carregar();
  }
  // mover = mudar a empresa e/ou o fornecedor do item (arrastando ou pelo botão Mover)
  async function mover(id: number, empresa: string, fornecedor: string) {
    const f = linhas.find((l) => l.id === id);
    setMovendo(null); setArrastando(null); setAlvo(null);
    if (!f || (f.empresa === empresa && f.fornecedor === fornecedor)) return;
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, empresa, fornecedor, movido: true } : l))); // já mostra no lugar novo
    await salvar(f, { empresa, fornecedor });
  }
  async function incluir(ev: React.FormEvent) {
    ev.preventDefault();
    const { error } = await supabase.rpc("compras_final_incluir", { p_semana: semana.id, p_fornecedor: novo.fornecedor, p_nome: novo.nome, p_unidade: novo.unidade,
      p_qtd: ler(novo.qtd), p_preco: ler(novo.preco), p_empresa: novo.empresa });
    if (error) return setErro(error.message);
    setNovo({ ...novo, fornecedor: "", nome: "", unidade: "", qtd: "", preco: "" });
    carregar();
  }

  const vivas = linhas.filter((l) => !l.removido);
  // retirados à mão pelo setor de compras: ficam apagados no pedido, com o botão Reativar (não entram em totais nem PDFs).
  // Os que saíram sozinhos (lista reaberta) não aparecem: voltam quando a lista for aprovada de novo.
  const tirados = linhas.filter((l) => l.removido && l.editado);
  const soma = (ls: Final[]) => ls.reduce((s, l) => s + (l.qtd ?? 0) * (l.preco ?? 0), 0);
  const total = soma(vivas);
  // Empresa → fornecedor → itens. As empresas sem item aparecem só como lugar para soltar o item arrastado.
  const empresas = [...EMPRESAS.map((e) => e.cnpj), ...[...new Set([...vivas, ...tirados].map((l) => l.empresa))].filter((c) => !EMPRESAS.some((e) => e.cnpj === c))]
    .map((cnpj) => {
      const doEmp = vivas.filter((l) => l.empresa === cnpj);
      const tirEmp = tirados.filter((l) => l.empresa === cnpj);
      const fs = [...new Set([...doEmp, ...tirEmp].map((l) => l.fornecedor))].sort((a, b) => soma(doEmp.filter((l) => l.fornecedor === b)) - soma(doEmp.filter((l) => l.fornecedor === a)));
      return { e: empresaDe(cnpj), itens: doEmp, tirados: tirEmp,
        grupos: fs.map((f) => ({ f, itens: doEmp.filter((l) => l.fornecedor === f), tirados: tirEmp.filter((l) => l.fornecedor === f) })) };
    });
  const comItens = empresas.filter((x) => x.itens.length);
  const nPedidos = comItens.reduce((s, x) => s + x.grupos.filter((g) => g.itens.length).length, 0);
  // Opções do select de fornecedor: todos do cadastro. Se o fornecedor já está na lista geral com o nome da nota,
  // a opção usa esse nome, para o item cair no mesmo pedido (e não abrir um segundo com outro nome).
  const opcoesForn = cadastro.map((c) => ({ nome: c.nome, valor: vivas.find((l) => doCadastro(l.fornecedor)?.id === c.id)?.fornecedor ?? c.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const valorForn = (f: string) => { const c = doCadastro(f); return c ? opcoesForn.find((o) => o.nome === c.nome)?.valor ?? f : f; };
  const fornecedoresConhecidos = [...new Set([...vivas.map((l) => l.fornecedor), ...cadastro.map((f) => f.nome)])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const imprimindo = imprimir ? (() => { const [emp, ...r] = imprimir.split("|"); return { emp, forn: r.join("|") }; })() : null;

  // arrastar e soltar (mouse); no celular, o botão Mover
  const soltarEm = (empresa: string, fornecedor: string | null) => ({
    onDragOver: (ev: React.DragEvent) => { if (arrastando == null) return; ev.preventDefault(); ev.stopPropagation(); setAlvo(chavePedido(empresa, fornecedor ?? "")); },
    onDragLeave: (ev: React.DragEvent) => { if (ev.currentTarget.contains(ev.relatedTarget as Node)) return; setAlvo((a) => (a === chavePedido(empresa, fornecedor ?? "") ? null : a)); },
    onDrop: (ev: React.DragEvent) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = Number(ev.dataTransfer.getData("text/plain") || arrastando);
      const it = linhas.find((l) => l.id === id);
      if (it) mover(id, empresa, fornecedor ?? it.fornecedor);
    },
  });

  return (
    <section className="cp-final">
      <div className="ip-numeros no-print">
        <div className="ip-numero"><span className="ip-rotulo">Itens</span><span className="ip-valor">{vivas.length}</span><span className="ip-var neutro">na lista geral</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Empresas</span><span className="ip-valor">{comItens.length}</span><span className="ip-var neutro">CNPJs que vão comprar</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Pedidos</span><span className="ip-valor">{nPedidos}</span><span className="ip-var neutro">um por empresa e fornecedor</span></div>
        <div className="ip-numero"><span className="ip-rotulo">Total estimado</span><span className="ip-valor">{brl(total)}</span><span className="ip-var neutro">semana {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)} · {aberta ? "aberta" : "fechada"}</span></div>
      </div>
      <div className="es-bloco-cabeca no-print cp-final-acoes">
        <div>
          <h2>Lista Geral por empresa</h2>
          {aberta && vivas.length > 0 && <p className="muted cp-dica">Para mudar um item de empresa ou de fornecedor, arraste-o pela alça <b>⠿</b> ou use <b>Mover</b>. O PDF de cada pedido vai para o fornecedor sem preços.</p>}
        </div>
        <div className="nf-acoes">
          {vivas.length > 0 && <>
            <button className="ghost small" onClick={() => { setEmpFechadas(new Set()); setFornAbertos(new Set(comItens.flatMap((x) => x.grupos.map((g) => chavePedido(x.e.cnpj, g.f))))); }}>Abrir tudo</button>
            <button className="ghost small" onClick={() => { setFornAbertos(new Set()); setEmpFechadas(new Set(comItens.map((x) => x.e.cnpj))); }}>Fechar tudo</button>
          </>}
          <button className="small" onClick={() => window.print()} disabled={!vivas.length}>PDF de tudo (com preços)</button>
        </div>
      </div>
      {erro && <p className="tv-alerta no-print">{erro}</p>}

      <div className={imprimir ? "cp-pdf cp-so-um" : "cp-pdf"}>
        <div className="cp-pdf-cabeca">
          {imprimindo ? (() => {
            const e = empresaDe(imprimindo.emp);
            const its = vivas.filter((l) => l.empresa === imprimindo.emp && l.fornecedor === imprimindo.forn);
            return <>
              <strong>Pedido · {imprimindo.forn} · semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</strong>
              <span>Faturar para: {e.razao || e.nome} · CNPJ {fmtCnpj(e.cnpj)}</span>
              <span>{its.length} itens</span>
            </>;
          })() : <>
            <strong>Lista de compras · semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</strong>
            <span>{vivas.length} itens · {comItens.length} empresas · {nPedidos} pedidos · total {brl(total)}</span>
            <span>Descontar o que já tem no estoque antes de pedir.</span>
          </>}
        </div>
        {!vivas.length && !tirados.length ? <p className="muted">Nada ainda. Os itens entram aqui sozinhos quando cada lista é aprovada.</p> : empresas.map(({ e, itens, tirados: tirEmp, grupos }) => {
          if (!itens.length && !tirEmp.length && arrastando == null) return null;
          if (imprimindo && imprimindo.emp !== e.cnpj) return null;
          const soltaEmpresa = alvo === chavePedido(e.cnpj, "");
          const empAberta = !empFechadas.has(e.cnpj) || arrastando != null || !!imprimindo;
          return (
            <section key={e.cnpj} className={`cp-empresa${soltaEmpresa ? " cp-solta" : ""}${!itens.length ? " cp-empresa-vazia no-print" : ""}`} {...(aberta ? soltarEm(e.cnpj, null) : {})}>
              <header className="cp-empresa-cabeca cp-cab-abre" role="button" tabIndex={0} aria-expanded={empAberta}
                onClick={() => alternar(setEmpFechadas, e.cnpj)} onKeyDown={teclaAbre(() => alternar(setEmpFechadas, e.cnpj))}>
                <span className={`cp-seta no-print${empAberta ? " aberta" : ""}`} aria-hidden="true">›</span>
                <span className="cp-empresa-selo" aria-hidden="true">{e.nome.slice(0, 1)}</span>
                <span className="cp-empresa-nome"><b>{e.nome}</b><small>CNPJ {fmtCnpj(e.cnpj)}{e.casas ? ` · compra para ${e.casas}` : ""}</small></span>
                <span className="cp-empresa-total cp-preco"><b>{brl(soma(itens))}</b><small>{itens.length} itens · {grupos.filter((g) => g.itens.length).length} {grupos.filter((g) => g.itens.length).length === 1 ? "pedido" : "pedidos"}</small></span>
              </header>
              <div className={`cp-corpo${empAberta ? "" : " cp-fechado"}`}>
              {!itens.length && arrastando != null && <p className="cp-empresa-solte">Solte aqui para passar o item para a {e.nome}.</p>}
              {grupos.map((g) => {
                const k = chavePedido(e.cnpj, g.f);
                const ped = pedidos[k];
                const st = ped?.status ?? "a_pedir";
                if (imprimindo && imprimindo.forn !== g.f) return null;
                const fornAberto = fornAbertos.has(k) || !!imprimindo;
                return (
                  <div key={k} className={`cp-forn${imprimir === k ? " cp-imprimir" : ""}${alvo === k ? " cp-solta" : ""}${!g.itens.length ? " cp-forn-so-tirados no-print" : ""}`} {...(aberta ? soltarEm(e.cnpj, g.f) : {})}>
                    <div className="cp-forn-cabeca cp-cab-abre" role="button" tabIndex={0} aria-expanded={fornAberto}
                      onClick={() => alternar(setFornAbertos, k)} onKeyDown={teclaAbre(() => alternar(setFornAbertos, k))}>
                      <span className={`cp-seta no-print${fornAberto ? " aberta" : ""}`} aria-hidden="true">›</span>
                      <strong>{g.f}<small className="cp-forn-qtd no-print">{g.itens.length} {g.itens.length === 1 ? "item" : "itens"}{g.tirados.length ? ` · ${g.tirados.length} ${g.tirados.length === 1 ? "retirado" : "retirados"}` : ""}</small></strong>
                      <span className={`cp-ped no-print ${st}`}>{PEDIDO[st]}{st === "pedido" && ped?.pedido_em ? ` · ${quando(ped.pedido_em)}` : st === "recebido" && ped?.recebido_em ? ` · ${quando(ped.recebido_em)}` : ""}{ped?.nota_chave ? " · nota ligada" : ""}</span>
                      <span className="cp-preco">{brl(soma(g.itens))}</span>
                    </div>
                    <div className={`cp-corpo${fornAberto ? "" : " cp-fechado"}`}>
                    <div className="cp-forn-acoes no-print">
                      <button className="ghost small" onClick={() => setImprimir(k)}>PDF para o fornecedor</button>
                      {st === "a_pedir" && <button className="small" onClick={() => marcar(e.cnpj, g.f, "pedido")}>Marcar pedido feito</button>}
                      {st === "pedido" && <><button className="small" onClick={() => marcar(e.cnpj, g.f, "recebido")}>Marcar recebido</button><button className="ghost small" onClick={() => marcar(e.cnpj, g.f, "a_pedir")}>Voltar para “a pedir”</button></>}
                      {st === "recebido" && <button className="ghost small" onClick={() => marcar(e.cnpj, g.f, "pedido")}>Desfazer recebido</button>}
                    </div>
                    {(() => {
                      const f = doCadastro(g.f);
                      if (!f || !(f.whatsapp || f.telefone || f.como_pedir || f.dias_entrega || f.contato_nome)) return null;
                      return (
                        <p className="cp-forn-contato no-print">
                          {f.contato_nome && <span>👤 {f.contato_nome}</span>}
                          {f.whatsapp && <a href={`https://wa.me/${f.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">💬 {f.whatsapp}</a>}
                          {f.telefone && <span>📞 {f.telefone}</span>}
                          {f.como_pedir && <span>📝 {f.como_pedir}</span>}
                          {f.dias_entrega && <span>🚚 entrega {f.dias_entrega}</span>}
                        </p>
                      );
                    })()}
                    <table className="nf-tabela cp-tabela cp-tabela-unica">
                      <thead><tr>
                        <th className="cp-caixa" aria-label="Marcar" /><th>Item</th><th className="no-print">Fornecedor</th><th className="n">Qtd.</th>
                        <th className="n cp-preco">Preço unit.</th><th className="n cp-preco">Total</th><th className="no-print" />
                      </tr></thead>
                      <tbody>
                        {g.itens.map((l) => (
                          <Fragment key={l.id}>
                            <tr className={arrastando === l.id ? "cp-arrastando" : ""} draggable={aberta}
                              onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", String(l.id)); ev.dataTransfer.effectAllowed = "move"; setArrastando(l.id); }}
                              onDragEnd={() => { setArrastando(null); setAlvo(null); }}>
                              <td className="cp-caixa">
                                {aberta ? <span className="cp-alca no-print" title="Arraste para outro fornecedor ou empresa" aria-hidden="true">⠿</span> : null}
                                <span className={aberta ? "so-print" : ""} aria-hidden="true">☐</span>
                              </td>
                              <td>
                                {aberta ? <input className="no-print-input" defaultValue={l.nome} onBlur={(v) => v.target.value !== l.nome && salvar(l, { nome: v.target.value })} aria-label="Item" /> : null}
                                <span className={aberta ? "so-print" : ""}>{l.nome}</span>
                                <small className="no-print">{(l.origem ?? []).map((o) => `${o.pessoa} ${num(o.qtd)}`).join(" · ")}{l.movido ? " · movido" : l.editado ? " · editado" : ""}</small>
                              </td>
                              <td className="no-print cp-forn-col">{aberta ? (
                                <select value={valorForn(l.fornecedor)} onChange={(v) => mover(l.id, l.empresa, v.target.value)} aria-label={`Fornecedor de ${l.nome}`}>
                                  {!doCadastro(l.fornecedor) && <option value={l.fornecedor}>{l.fornecedor}</option>}
                                  {opcoesForn.map((o) => <option key={o.nome} value={o.valor}>{o.nome}</option>)}
                                </select>) : (doCadastro(l.fornecedor)?.nome ?? l.fornecedor)}</td>
                              <td className="n cp-qtd">{aberta ? <><input className="n no-print-input" inputMode="decimal" defaultValue={num(l.qtd)} onBlur={(v) => ler(v.target.value) !== l.qtd && salvar(l, { qtd: ler(v.target.value) })} aria-label="Quantidade" /><span className="so-print">{num(l.qtd)}</span></> : num(l.qtd)} <span className="cp-un-txt">{l.unidade}</span></td>
                              <td className="n cp-preco">{aberta ? <><input className="n no-print-input" inputMode="decimal" defaultValue={num(l.preco)} placeholder="—" onBlur={(v) => ler(v.target.value) !== l.preco && salvar(l, { preco: ler(v.target.value) })} aria-label={`Preço unitário de ${l.nome}`} /><span className="so-print">{brl(l.preco)}</span></> : brl(l.preco)}</td>
                              <td className="n cp-preco cp-tot">{brl((l.qtd ?? 0) * (l.preco ?? 0))}</td>
                              <td className="no-print cp-item-acoes">{aberta && <>
                                <button className={movendo === l.id ? "ghost small on" : "ghost small"} onClick={() => setMovendo(movendo === l.id ? null : l.id)} aria-expanded={movendo === l.id}>Mover</button>
                                <button className="ghost small" onClick={() => salvar(l, { removido: true })}>Tirar</button>
                              </>}</td>
                            </tr>
                            {movendo === l.id && (
                              <tr className="cp-mover-linha no-print"><td colSpan={7}>
                                <MoverItem item={l} fornecedores={fornecedoresConhecidos} onMover={(emp, forn) => mover(l.id, emp, forn)} onCancelar={() => setMovendo(null)} />
                              </td></tr>
                            )}
                          </Fragment>
                        ))}
                        {g.tirados.map((l) => (
                          <tr key={l.id} className="cp-tirado-linha no-print">
                            <td className="cp-caixa" aria-hidden="true">–</td>
                            <td><span className="cp-tirado-nome">{l.nome}</span><small>retirado{l.atualizado_em ? ` em ${quando(l.atualizado_em)}` : ""}</small></td>
                            <td>{doCadastro(l.fornecedor)?.nome ?? l.fornecedor}</td>
                            <td className="n">{num(l.qtd)} <span className="cp-un-txt">{l.unidade}</span></td>
                            <td className="n">{brl(l.preco)}</td>
                            <td className="n">{brl((l.qtd ?? 0) * (l.preco ?? 0))}</td>
                            <td className="cp-item-acoes">{aberta && <button className="small cp-reativar" onClick={() => salvar(l, { removido: false })}>Reativar</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                );
              })}
              </div>
            </section>
          );
        })}
      </div>

      {aberta && (
        <form className="cp-incluir cp-incluir-emp no-print" onSubmit={incluir}>
          <select value={novo.empresa} onChange={(v) => setNovo({ ...novo, empresa: v.target.value })} aria-label="Empresa">
            {EMPRESAS.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
          </select>
          <input value={novo.fornecedor} onChange={(v) => setNovo({ ...novo, fornecedor: v.target.value })} placeholder="Fornecedor" aria-label="Fornecedor" list="cp-fornecedores" />
          <input value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v.target.value })} placeholder="Item" aria-label="Item" />
          <input value={novo.qtd} onChange={(v) => setNovo({ ...novo, qtd: v.target.value })} inputMode="decimal" placeholder="Qtd." aria-label="Quantidade" />
          <input value={novo.unidade} onChange={(v) => setNovo({ ...novo, unidade: v.target.value })} placeholder="Unid." aria-label="Unidade" />
          <input value={novo.preco} onChange={(v) => setNovo({ ...novo, preco: v.target.value })} inputMode="decimal" placeholder="Preço unit." aria-label="Preço unitário" />
          <button className="ghost small">Incluir na lista geral</button>
        </form>
      )}
      <datalist id="cp-fornecedores">{fornecedoresConhecidos.map((f) => <option key={f} value={f} />)}</datalist>
    </section>
  );
}

// Painel "Mover" de um item da lista geral: escolhe a empresa e o fornecedor
function MoverItem({ item, onMover, onCancelar }: { item: Final; fornecedores: string[]; onMover: (empresa: string, fornecedor: string) => void; onCancelar: () => void }) {
  const [empresa, setEmpresa] = useState(item.empresa);
  const [fornecedor, setFornecedor] = useState(item.fornecedor);
  const mudou = empresa !== item.empresa || fornecedor.trim() !== item.fornecedor;
  return (
    <form className="cp-mover" onSubmit={(ev) => { ev.preventDefault(); if (mudou && fornecedor.trim()) onMover(empresa, fornecedor.trim()); }}>
      <b>Mover “{item.nome}”</b>
      <label>Empresa
        <select value={empresa} onChange={(v) => setEmpresa(v.target.value)}>
          {EMPRESAS.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}{e.casas ? ` (${e.casas})` : ""}</option>)}
        </select>
      </label>
      <label>Fornecedor
        <input value={fornecedor} onChange={(v) => setFornecedor(v.target.value)} list="cp-fornecedores" placeholder="Nome do fornecedor" />
      </label>
      <span className="cp-mover-botoes">
        <button className="small" disabled={!mudou || !fornecedor.trim()}>Mover</button>
        <button type="button" className="ghost small" onClick={onCancelar}>Cancelar</button>
      </span>
    </form>
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
          <button className="ghost small" onClick={() => irPara(a.aprovada ? "final" : "andamento")}>{a.aprovada ? "Lista Geral" : "Ver"}</button>
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
  fornecedores: { fornecedor: string; empresa: string; itens: number; valor: number; status: Pedido["status"]; pedido_em: string | null; recebido_em: string | null; nota: string | null }[];
  alertas_preco: { descricao: string; fornecedor: string; preco: number; media_anterior: number; alta_pct: number; unidade: string; emissao: string }[];
};
type Casa = { unidade: string; pessoas: number; com_lista: number; aprovadas: number; listas: number; valor: number };
function Painel({ semana }: { semana: Semana }) {
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<PainelDados | null>(null);
  const [casas, setCasas] = useState<Casa[]>([]);
  const [erro, setErro] = useState("");
  // nome do fornecedor como a equipe chama (cadastro), no lugar da razão social da nota
  const [nomes, setNomes] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("compras_fornecedores").select("nome,razao_social,apelidos").eq("ativo", true).then(({ data }) => {
      const m: Record<string, string> = {};
      for (const f of (data ?? []) as { nome: string; razao_social: string | null; apelidos: string[] | null }[]) {
        for (const k of [f.razao_social, f.nome, ...(f.apelidos ?? [])]) if (k) m[k.trim().toUpperCase()] = f.nome;
      }
      setNomes(m);
    });
  }, [supabase]);
  const carregar = useCallback(() => {
    supabase.rpc("compras_painel", { p_semana: semana.id }).then(({ data, error }) => {
      if (error) setErro(error.message); else setD(data as PainelDados);
    });
    supabase.rpc("compras_painel_casas", { p_semana: semana.id }).then(({ data }) => setCasas((data ?? []) as Casa[]));
  }, [supabase, semana.id]);
  useEffect(() => { carregar(); }, [carregar]);
  // ao vivo: lista aprovada ou nova muda o painel na hora
  useEffect(() => {
    const c = supabase.channel(`compras-painel-${semana.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_listas", filter: `semana_id=eq.${semana.id}` }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(c); };
  }, [supabase, semana.id, carregar]);
  if (erro) return <p className="tv-alerta">{erro}</p>;
  if (!d) return <p className="muted">Carregando o painel…</p>;

  const fs = [...d.fornecedores].sort((a, b) => Number(b.valor) - Number(a.valor));
  const aPedir = fs.filter((f) => f.status === "a_pedir");
  const pedidos = fs.filter((f) => f.status === "pedido");
  const recebidos = fs.filter((f) => f.status === "recebido");
  const soma = (xs: typeof fs) => xs.reduce((t, f) => t + Number(f.valor ?? 0), 0);
  const totalFinal = soma(fs);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const todas = Number(d.itens.valor_todas), aprovado = Number(d.itens.valor_aprovado);

  // As cinco etapas da semana, cada uma com quanto já foi feito
  const etapas = [
    { t: "Pedidos", v: `${d.listas.com_lista} de ${d.listas.pessoas}`, p: pct(d.listas.com_lista, d.listas.pessoas), d: "pessoas pediram" },
    { t: "Aprovação", v: `${d.listas.pessoas_tudo_aprovado} de ${d.listas.com_lista}`, p: pct(d.listas.pessoas_tudo_aprovado, d.listas.com_lista), d: "aprovaram tudo" },
    { t: "Lista Geral", v: fs.length ? `${fs.length}` : "—", p: fs.length ? 100 : 0, d: fs.length ? "fornecedores" : "ainda vazia" },
    { t: "Pedidos feitos", v: `${fs.length - aPedir.length} de ${fs.length}`, p: pct(fs.length - aPedir.length, fs.length), d: "fornecedores" },
    { t: "Recebido", v: `${recebidos.length} de ${fs.length}`, p: pct(recebidos.length, fs.length), d: "entregas" },
  ];
  const COLUNAS: { k: Pedido["status"]; t: string; xs: typeof fs }[] = [
    { k: "a_pedir", t: "A pedir", xs: aPedir }, { k: "pedido", t: "Pedido feito", xs: pedidos }, { k: "recebido", t: "Recebido", xs: recebidos },
  ];
  return (
    <section className="pn">
      {/* Resumo da semana */}
      <div className="pn-topo">
        <div className="pn-destaque">
          <span className="pn-eyebrow">Semana de {diaSemana(semana.inicio)} a {fimSemana(semana.inicio)}</span>
          <span className="pn-rotulo">Estimado nas listas</span>
          <b className="pn-valor">{brl(todas)}</b>
          <span className="pn-barra-valor" aria-hidden="true"><span style={{ width: `${pct(aprovado, todas)}%` }} /></span>
          <span className="pn-legenda"><i className="ok" /> {brl(aprovado)} aprovado <i /> {brl(Math.max(todas - aprovado, 0))} em revisão</span>
        </div>
        <div className="pn-mini">
          <div><span className="pn-rotulo">Itens nas listas</span><b>{d.itens.total}</b>
            <small className={d.itens.baixa ? "pn-alerta" : ""}>{d.itens.baixa ? `${d.itens.baixa} sem produto nas notas` : "todos ligados às notas"}</small></div>
          <div><span className="pn-rotulo">Lista Geral</span><b>{brl(totalFinal)}</b><small>{fs.length} {fs.length === 1 ? "fornecedor" : "fornecedores"}</small></div>
          <div><span className="pn-rotulo">Entregas</span><b>{recebidos.length}<small> de {fs.length}</small></b><small>{pedidos.length} aguardando chegar</small></div>
        </div>
      </div>

      {/* Andamento */}
      <ol className="pn-trilha" aria-label="Andamento da semana">
        {etapas.map((e, k) => (
          <li key={e.t} className={e.p >= 100 ? "feita" : e.p > 0 ? "andando" : ""}>
            <span className="pn-trilha-n" aria-hidden="true">{e.p >= 100 ? "✓" : k + 1}</span>
            <span className="pn-trilha-txt"><span>{e.t}</span><b>{e.v}</b><small>{e.d}</small></span>
          </li>
        ))}
      </ol>

      <div className="pn-duas">
        {/* Por casa */}
        <section className="pn-bloco">
          <header><h2>Por casa</h2><small>aprovação e valor das listas</small></header>
          <ul className="pn-casas">
            {casas.map((c) => {
              const p = pct(c.aprovadas, c.com_lista || c.pessoas);
              return (
                <li key={c.unidade}>
                  <span className="pn-casa-nome"><b>{UNIDADES[c.unidade] ?? c.unidade}</b><small>{c.com_lista} de {c.pessoas} pediram · {c.listas} {c.listas === 1 ? "lista" : "listas"}</small></span>
                  <span className="pn-casa-valor">{brl(Number(c.valor))}</span>
                  <span className="pn-casa-barra" aria-label={`${p}% aprovado`}><span style={{ width: `${p}%` }} /></span>
                  <small className="pn-casa-pct">{c.aprovadas} de {c.com_lista} aprovaram</small>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Quem ainda não aprovou */}
        <section className="pn-bloco">
          <header><h2>Falta aprovar</h2><small>{d.pendentes.length ? `${d.pendentes.length} ${d.pendentes.length === 1 ? "pessoa" : "pessoas"}` : "ninguém"}</small></header>
          {!d.pendentes.length ? <p className="pn-vazio">Todo mundo aprovou as listas desta semana. ✓</p> : (
            <ul className="pn-pessoas">
              {d.pendentes.map((x) => (
                <li key={x.pessoa}>
                  <span className="pn-avatar" aria-hidden="true">{x.pessoa.slice(0, 1)}</span>
                  <span className="pn-pessoa-nome"><b>{x.pessoa}</b><small>{UNIDADES[x.unidade] ?? x.unidade} · {SETORES[x.setor] ?? x.setor}</small></span>
                  <span className="pn-pessoa-qtd">{x.aprovadas} de {x.listas}<small>{x.listas === 1 ? "lista" : "listas"}</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Pedidos aos fornecedores, por situação */}
      {fs.length > 0 && (
        <section className="pn-bloco">
          <header><h2>Pedidos aos fornecedores</h2><small>um por empresa e fornecedor · {brl(totalFinal)}</small></header>
          <div className="pn-colunas">
            {COLUNAS.map((c) => (
              <div key={c.k} className={`pn-coluna ${c.k}`}>
                <div className="pn-coluna-cab"><b>{c.t}</b><span>{c.xs.length}</span><small>{brl(soma(c.xs))}</small></div>
                {!c.xs.length ? <p className="pn-vazio">Nenhum.</p> : (
                  <ul>
                    {c.xs.map((f) => (
                      <li key={`${f.empresa}|${f.fornecedor}`}>
                        <span className="pn-forn"><b title={f.fornecedor}>{nomes[f.fornecedor.trim().toUpperCase()] ?? f.fornecedor}</b>
                          <small>{empresaDe(f.empresa).nome} · {f.itens} {f.itens === 1 ? "item" : "itens"}{quando(f.status === "recebido" ? f.recebido_em : f.pedido_em) ? ` · ${quando(f.status === "recebido" ? f.recebido_em : f.pedido_em)}` : ""}</small></span>
                        <span className="pn-forn-valor">{brl(Number(f.valor))}{f.nota && <a href={`/api/notas/danfe/${f.nota}`} target="_blank" rel="noreferrer">nota</a>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Fornecedores (cadastro da Fernanda): contato, como pedir, dias, pagamento e as notas de cada um
// (compras_fornecedores, compras_fornecedores_lista, compras_fornecedor_salvar, compras_fornecedor_notas)
// ---------------------------------------------------------------------------------------------------------------
type Forn = { id: string; nome: string; razao_social: string | null; cnpj: string | null; cnpjs: string[]; apelidos: string[]; categoria: string | null;
  contato_nome: string | null; telefone: string | null; whatsapp: string | null; email: string | null; como_pedir: string | null;
  dias_pedido: string | null; dias_entrega: string | null; prazo_pagamento: string | null; forma_pagamento: string | null;
  pedido_minimo: number | null; observacoes: string | null; ativo: boolean;
  // vindos das notas fiscais (compras_fornecedores_dados_notas, todo dia)
  nome_fantasia?: string | null; inscricao_estadual?: string | null; endereco?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null;
  dados_notas?: { notas: number; primeira: string | null; ultima: string | null; valor_12m: number; notas_12m: number } | null;
  notas_90d?: number; valor_90d?: number | null; ultima_compra?: string | null; casas?: string[] };
const docFmt = (c: string | null) => !c ? "" : c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c.length === 11 ? c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : c;
const normalizar = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const dataBR = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
// Campos da ficha, em blocos
const BLOCOS_FORN: { titulo: string; campos: [keyof Forn, string, string][] }[] = [
  { titulo: "Identificação", campos: [["nome", "Nome (como a equipe chama)", "Ex.: Eloi Chaves"], ["razao_social", "Razão social (como vem na nota)", ""],
    ["cnpj", "CNPJ ou CPF principal", "só números"], ["categoria", "Categoria", "Ex.: mercearia, hortifrúti, bebidas"]] },
  { titulo: "Contato", campos: [["contato_nome", "Vendedor ou contato", ""], ["whatsapp", "WhatsApp", "Ex.: 84 99999-9999"],
    ["telefone", "Telefone", ""], ["email", "E-mail", ""]] },
  { titulo: "Pedido e entrega", campos: [["como_pedir", "Como pedir", "Ex.: WhatsApp do vendedor até 10h"], ["dias_pedido", "Dias de pedido", "Ex.: segunda e quinta"],
    ["dias_entrega", "Dias de entrega", "Ex.: terça e sexta"], ["pedido_minimo", "Pedido mínimo (R$)", ""]] },
  { titulo: "Pagamento", campos: [["forma_pagamento", "Forma de pagamento", "Ex.: boleto, Pix"], ["prazo_pagamento", "Prazo", "Ex.: 14 dias"]] },
];
type Ordem = "valor" | "nome" | "ultima";

function Fornecedores() {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Forn[] | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"ativos" | "com_compra" | "sem_contato" | "todos">("ativos");
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [aberto, setAberto] = useState<Forn | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("compras_fornecedores_lista");
    if (error) setErro(error.message);
    setLista((data ?? []) as Forn[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const todos = lista ?? [];
  const temContato = (f: Forn) => !!(f.whatsapp || f.telefone || f.email);
  const termo = normalizar(busca);
  const vistos = todos
    .filter((f) => filtro === "todos" || (f.ativo && (filtro === "ativos" || (filtro === "com_compra" ? (f.valor_90d ?? 0) > 0 : !temContato(f)))))
    .filter((f) => !termo || normalizar([f.nome, f.razao_social, f.categoria, f.contato_nome, ...f.cnpjs, ...f.apelidos].filter(Boolean).join(" ")).includes(termo))
    .sort((a, b) => ordem === "nome" ? a.nome.localeCompare(b.nome) : ordem === "ultima" ? (b.ultima_compra ?? "").localeCompare(a.ultima_compra ?? "") : Number(b.valor_90d ?? 0) - Number(a.valor_90d ?? 0));
  const ativos = todos.filter((f) => f.ativo);
  const comCompra = ativos.filter((f) => (f.valor_90d ?? 0) > 0).length;
  const semContato = ativos.filter((f) => !temContato(f)).length;
  const total90 = ativos.reduce((s, f) => s + Number(f.valor_90d ?? 0), 0);

  return (
    <section className="cp-fz">
      <div className="cp-fz-resumo">
        <div><b>{ativos.length}</b><span>fornecedores ativos</span></div>
        <div><b>{comCompra}</b><span>com compra em 90 dias</span></div>
        <div><b>{brl(total90)}</b><span>comprado em 90 dias</span></div>
        <div className={semContato ? "atencao" : ""}><b>{semContato}</b><span>sem contato cadastrado</span></div>
      </div>

      <div className="cp-fz-barra">
        <input className="cp-fz-busca" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar fornecedor, CNPJ, categoria ou contato" aria-label="Buscar fornecedor" />
        <select value={filtro} onChange={(v) => setFiltro(v.target.value as typeof filtro)} aria-label="Filtrar">
          <option value="ativos">Ativos</option><option value="com_compra">Com compra em 90 dias</option>
          <option value="sem_contato">Sem contato</option><option value="todos">Todos (inclui desativados)</option>
        </select>
        <select value={ordem} onChange={(v) => setOrdem(v.target.value as Ordem)} aria-label="Ordenar">
          <option value="valor">Mais comprados</option><option value="ultima">Compra mais recente</option><option value="nome">Nome (A–Z)</option>
        </select>
        <button className="small" onClick={() => setAberto("novo")}>+ Novo fornecedor</button>
      </div>
      {erro && <p className="tv-alerta">{erro}</p>}

      {!lista ? <p className="muted">Carregando os fornecedores…</p> : !vistos.length ? <p className="muted">Nenhum fornecedor encontrado.</p> : (
        <div className="cp-fz-tabela-caixa">
          <table className="cp-fz-tabela">
            <thead><tr>
              <th>Fornecedor</th><th>Categoria</th><th>Casas</th><th className="n">90 dias</th><th>Última compra</th><th>Contato</th><th>Pedido / entrega</th><th aria-label="Editar" />
            </tr></thead>
            <tbody>
              {vistos.map((f) => (
                <tr key={f.id} className={f.ativo ? "" : "desativado"} onClick={() => setAberto(f)}>
                  <td className="cp-fz-nome">
                    <b>{f.nome}</b>
                    <small>{f.cnpjs.length > 1 ? `${f.cnpjs.length} filiais · ` : ""}{docFmt(f.cnpj)}</small>
                  </td>
                  <td>{f.categoria ?? <span className="muted">—</span>}</td>
                  <td><span className="cp-fz-casas">{(f.casas ?? []).filter((c) => c !== "grupo").map((c) => <span key={c} className="cp-tag">{UNIDADES[c] ?? c}</span>)}
                    {(f.casas ?? []).includes("grupo") && <span className="cp-tag">outra do grupo</span>}</span></td>
                  <td className="n"><b>{brl(Number(f.valor_90d ?? 0))}</b><small>{f.notas_90d ?? 0} notas</small></td>
                  <td>{dataBR(f.ultima_compra)}</td>
                  <td>{temContato(f) ? <span className="cp-fz-contato">{f.contato_nome && <b>{f.contato_nome}</b>}{f.whatsapp ?? f.telefone ?? f.email}</span>
                    : <span className="cp-tag falta">sem contato</span>}</td>
                  <td><span className="cp-fz-pedido">{f.como_pedir ?? "—"}{f.dias_entrega && <small>entrega {f.dias_entrega}</small>}</span></td>
                  <td><button className="ghost small" onClick={(e) => { e.stopPropagation(); setAberto(f); }}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aberto && <FichaFornecedor forn={aberto === "novo" ? null : aberto} onFechar={() => setAberto(null)} onSalvo={() => { setAberto(null); carregar(); }} />}
    </section>
  );
}

function FichaFornecedor({ forn, onFechar, onSalvo }: { forn: Forn | null; onFechar: () => void; onSalvo: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const campos = BLOCOS_FORN.flatMap((b) => b.campos);
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(campos.map(([k]) => [k, forn?.[k] == null ? "" : String(forn[k])])));
  const [apelidos, setApelidos] = useState((forn?.apelidos ?? []).join("\n"));
  const [obs, setObs] = useState(forn?.observacoes ?? "");
  const [ativo, setAtivo] = useState(forn?.ativo ?? true);
  const [notas, setNotas] = useState<{ chave: string; emissao: string; valor: number; casa: string; completa: boolean; situacao: string; itens: number; filial: string }[] | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!forn) { setNotas([]); return; }
    supabase.rpc("compras_fornecedor_notas", { p_id: forn.id }).then(({ data }) => setNotas((data ?? []) as typeof notas));
  }, [supabase, forn]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(""); setSalvando(true);
    const dados = { ...f, pedido_minimo: f.pedido_minimo ? String(ler(f.pedido_minimo)) : "", observacoes: obs,
      apelidos: apelidos.split("\n").map((a) => a.trim()).filter(Boolean), ativo };
    const { error } = await supabase.rpc("compras_fornecedor_salvar", { p_id: forn?.id ?? null, p_dados: dados });
    setSalvando(false);
    if (error) return setErro(error.message);
    onSalvo();
  }
  return (
    <div className="cp-fz-fundo" onClick={onFechar}>
      <form className="cp-fz-ficha" role="dialog" aria-modal="true" aria-label={forn ? `Fornecedor ${forn.nome}` : "Novo fornecedor"}
        onSubmit={salvar} onClick={(e) => e.stopPropagation()}>
        <header className="cp-fz-ficha-topo">
          <div>
            <span className="es-sobre">{forn ? "Editar fornecedor" : "Novo fornecedor"}</span>
            <h2>{f.nome || "Sem nome"}</h2>
            {forn && <small>{brl(Number(forn.valor_90d ?? 0))} em 90 dias · {forn.notas_90d ?? 0} notas · última compra {dataBR(forn.ultima_compra)}</small>}
          </div>
          <button type="button" className="ghost small" onClick={onFechar} aria-label="Fechar">✕</button>
        </header>

        <div className="cp-fz-ficha-corpo">
          {BLOCOS_FORN.map((b) => (
            <fieldset key={b.titulo} className="cp-fz-bloco">
              <legend>{b.titulo}</legend>
              <div className="cp-fz-campos">
                {b.campos.map(([k, rotulo, dica]) => (
                  <label key={k}><span>{rotulo}</span>
                    <input value={f[k]} onChange={(v) => setF({ ...f, [k]: v.target.value })} placeholder={dica}
                      inputMode={k === "pedido_minimo" || k === "cnpj" ? "decimal" : undefined} required={k === "nome"} />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {forn && (forn.endereco || forn.inscricao_estadual || forn.dados_notas) && (
            <fieldset className="cp-fz-bloco cp-fz-das-notas">
              <legend>Dados das notas fiscais</legend>
              <dl>
                {forn.nome_fantasia && <><dt>Nome fantasia</dt><dd>{forn.nome_fantasia}</dd></>}
                {forn.razao_social && <><dt>Razão social</dt><dd>{forn.razao_social}</dd></>}
                {forn.cnpj && <><dt>CNPJ</dt><dd>{docFmt(forn.cnpj)}</dd></>}
                {forn.inscricao_estadual && <><dt>Inscrição estadual</dt><dd>{forn.inscricao_estadual}</dd></>}
                {forn.endereco && <><dt>Endereço</dt><dd>{forn.endereco}{forn.cidade ? ` · ${forn.cidade}` : ""}{forn.uf ? `/${forn.uf}` : ""}{forn.cep ? ` · CEP ${forn.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""}</dd></>}
                {forn.dados_notas && <><dt>Compras</dt><dd>{forn.dados_notas.notas} notas desde {dataBR(forn.dados_notas.primeira)} · {forn.dados_notas.notas_12m} notas e {brl(Number(forn.dados_notas.valor_12m))} nos últimos 12 meses</dd></>}
              </dl>
              <small className="muted">Atualizado todo dia pela nota mais recente. Telefone, forma e prazo de pagamento vêm das notas só quando estão vazios: o que você digitar fica.</small>
            </fieldset>
          )}
          {forn && forn.cnpjs.length > 1 && (
            <fieldset className="cp-fz-bloco">
              <legend>Filiais ({forn.cnpjs.length})</legend>
              <p className="cp-fz-filiais">{forn.cnpjs.map((c) => <span key={c} className="cp-tag">{docFmt(c)}</span>)}</p>
            </fieldset>
          )}
          <fieldset className="cp-fz-bloco">
            <legend>Outros nomes e observações</legend>
            <div className="cp-fz-campos">
              <label className="largo"><span>Outros nomes nas notas e nas listas (um por linha)</span>
                <textarea value={apelidos} onChange={(v) => setApelidos(v.target.value)} rows={2} placeholder="Ex.: ELOI CHAVES ATACADO" /></label>
              <label className="largo"><span>Observações</span>
                <textarea value={obs} onChange={(v) => setObs(v.target.value)} rows={3} placeholder="Ex.: pedir sempre com o Fulano; entrega só pela manhã" /></label>
              <label className="cp-fz-ativo largo"><input type="checkbox" checked={ativo} onChange={(v) => setAtivo(v.target.checked)} />
                <span>Fornecedor ativo (desmarque para esconder da lista, sem apagar)</span></label>
            </div>
          </fieldset>

          {forn && (
            <fieldset className="cp-fz-bloco">
              <legend>Últimas notas</legend>
              {!notas ? <p className="muted">Carregando…</p> : !notas.length ? <p className="muted">Nenhuma nota deste fornecedor ainda.</p> : (
                <div className="cp-fz-tabela-caixa">
                  <table className="cp-fz-tabela pequena">
                    <thead><tr><th>Data</th><th>Casa</th><th>Itens</th><th className="n">Valor</th><th /></tr></thead>
                    <tbody>
                      {notas.map((n) => (
                        <tr key={n.chave}>
                          <td>{new Date(n.emissao).toLocaleDateString("pt-BR")}</td>
                          <td>{UNIDADES[n.casa] ?? "outra do grupo"}</td>
                          <td>{n.situacao === "cancelada" ? <span className="cp-tag">cancelada</span> : n.completa ? n.itens : <span className="cp-tag falta">só resumo</span>}</td>
                          <td className="n">{brl(n.valor)}</td>
                          <td>{n.completa && n.situacao !== "cancelada" && <a href={`/api/notas/danfe/${n.chave}`} target="_blank" rel="noreferrer">PDF</a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </fieldset>
          )}
        </div>

        <footer className="cp-fz-ficha-rodape">
          {erro && <p className="tv-alerta">{erro}</p>}
          <button type="button" className="ghost small" onClick={onFechar}>Cancelar</button>
          <button className="small" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </footer>
      </form>
    </div>
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
    setMsg(`${p.nome} tem o login criado. A equipe entra só em brasico.vercel.app/colaboradores, com usuário e senha (peça aos sócios).`);
    carregar();
  }

  return (
    <section className="av-bloco">
      <header className="av-bloco-cabeca"><div><h3>Pessoas e acesso</h3><p className="muted">quem pede no grupo e a Fernanda</p></div></header>
      <p className="muted cp-ajuda">Cadastre o e-mail e clique em Dar acesso. A equipe entra só pela área dos colaboradores (brasico.vercel.app/colaboradores), com usuário e senha, e só vê a área dela.
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
