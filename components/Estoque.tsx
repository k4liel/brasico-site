"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";

// Câmara fria (Operação · fase 4; rota /estoque): o saldo se calcula sozinho.
// Entrada e saída: lançadas à mão nesta tela (por enquanto; ler os pedidos do grupo PEDIDOS/PRODUÇÃO pelo
// conector fica para o futuro). Contagem: de vez em quando, substitui o saldo. Tabelas e funções em supabase/estoque.sql.
type Saldo = { item_id: string; nome: string; unidade: string; pacote_nome: string; pacote_tamanho: number | null; minimo: number | null;
  ordem: number; contagem: number | null; contada_em: string | null; entradas: number; saidas: number; saldo: number; ultimo_movimento: string | null };
type Mov = { id: number; item_id: string; tipo: "entrada" | "saida" | "contagem"; quantidade: number; destino: string | null; origem: string;
  observacao: string | null; quando: string; registrado_por: string | null; removido: boolean };
type Pessoa = { id: string; nome: string; papel: string; unidade: string | null; setor: string | null; email: string | null;
  user_id: string | null; ativo: boolean; registra_estoque: boolean };

const DESTINOS: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua", midway: "Cicchetti Midway", outro: "Outro" };
const TIPOS = { entrada: "Entrada", saida: "Saída", contagem: "Contagem" } as const;
const ORIGENS: Record<string, string> = { tela: "pela tela", grupo: "pedido do grupo", projeto: "contagem do projeto", producao: "da produção" };
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) : "—");
const diaCurto = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" }) : "—");
const unid = (s: { unidade: string }, q: number) => (s.unidade === "porção" ? (q === 1 ? "porção" : "porções") : s.unidade);
const pacotes = (s: Saldo) => (s.pacote_tamanho && s.pacote_tamanho !== 1 ? `${num(s.saldo / s.pacote_tamanho)} ${s.pacote_nome}s` : "");
// Grupos da câmara pela ordem do cadastro (10 massas, 20 carnes e peixes, 30 molhos, 40 pães)
const GRUPOS = [
  { nome: "Massas", ate: 20 }, { nome: "Carnes e peixes", ate: 30 }, { nome: "Molhos e bases", ate: 40 }, { nome: "Pães", ate: 1000 },
];
// Situação do item frente ao mínimo
function situacao(s: Saldo) {
  if (s.minimo == null || s.minimo <= 0) return { cls: "sem", txt: "sem mínimo", pct: s.saldo > 0 ? 60 : 0 };
  const pct = Math.min(100, (s.saldo / (s.minimo * 2)) * 100);
  if (s.saldo < s.minimo) return { cls: "falta", txt: "abaixo do mínimo", pct };
  if (s.saldo < s.minimo * 1.5) return { cls: "perto", txt: "perto do mínimo", pct };
  return { cls: "ok", txt: "em dia", pct };
}

export default function Estoque({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  const [compras, setCompras] = useState(false);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [aba, setAba] = useState<"saldo" | "registrar" | "movimentos" | "pessoas">("saldo");
  const [itemEscolhido, setItemEscolhido] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "falta">("todos");

  const carregar = useCallback(async () => {
    const [s, m] = await Promise.all([
      supabase.from("estoque_saldo").select("*").order("ordem").order("nome"),
      supabase.from("estoque_movimentos").select("*").order("quando", { ascending: false }).order("id", { ascending: false }).limit(150),
    ]);
    setSaldos((s.data ?? []) as Saldo[]);
    setMovs((m.data ?? []) as Mov[]);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const [{ data: pode }, { data: eu }] = await Promise.all([
        supabase.rpc("estoque_pode", { p_user: userId }),
        supabase.rpc("operacao_eu"),
      ]);
      if (!pode) return setPapel(null);
      const r = (eu ?? {}) as { papel: string | null; pessoa: { nome: string; papel: string } | null };
      setPapel(r.papel ?? "estoque");
      setNome(r.pessoa?.nome ?? "");
      setCompras(r.papel === "solicitante" || r.papel === "compras");
      if (r.papel !== "socio") setAba("registrar");
      carregar();
    })();
  }, [supabase, userId, carregar]);

  // Registros de outras pessoas aparecem na hora
  useEffect(() => {
    if (!papel) return;
    const canal = supabase.channel("estoque").on("postgres_changes", { event: "*", schema: "public", table: "estoque_movimentos" }, () => carregar()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, papel, carregar]);

  const socio = papel === "socio";
  const topo = socio ? <Topo email={userEmail} ativo="estoque" />
    : <TopoSimples email={userEmail} nome={nome} area="Câmara fria" outra={compras ? { href: "/compras", nome: "Compras" } : { href: "/producao", nome: "Produção" }} />;

  if (papel === undefined) return <div className="pagina"><main className="miolo"><p className="muted vazio">Carregando…</p></main></div>;
  if (papel === null) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="estoque" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à câmara fria.</p></main>
      </div>
    );
  }

  const acabando = saldos.filter((s) => s.minimo != null && s.saldo < s.minimo);
  const ultimaContagem = saldos.map((s) => s.contada_em).filter(Boolean).sort().pop() ?? null;
  const nomes = Object.fromEntries(saldos.map((s) => [s.item_id, s]));
  const semana = movs.filter((m) => !m.removido && m.tipo !== "contagem" && new Date(m.quando).getTime() > Date.now() - 7 * 864e5);
  const registrar = (id: string) => { setItemEscolhido(id); setAba("registrar"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  let inicio = 0;
  const grupos = GRUPOS.map((g) => {
    const itens = saldos.filter((s) => s.ordem >= inicio && s.ordem < g.ate && (filtro === "todos" || situacao(s).cls === "falta"));
    inicio = g.ate;
    return { ...g, itens };
  }).filter((g) => g.itens.length);

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es et nf-larga">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Câmara fria</h1>
            <p>O saldo se calcula sozinho: a última contagem, mais o que entrou da produção, menos o que saiu para as unidades. Uma contagem de vez em quando acerta a diferença.</p>
          </div>
        </div>

        <div className="ip-numeros">
          <div className="ip-numero"><span className="ip-rotulo">Itens na câmara</span><span className="ip-valor">{saldos.length}</span><span className="ip-var neutro">{saldos.filter((s) => s.saldo > 0).length} com saldo</span></div>
          <div className="ip-numero"><span className="ip-rotulo">Abaixo do mínimo</span><span className={acabando.length ? "ip-valor cf-alerta" : "ip-valor"}>{acabando.length}</span><span className={acabando.length ? "ip-var sobe" : "ip-var neutro"}>{acabando.length ? acabando.slice(0, 3).map((s) => s.nome).join(", ") : "nada faltando"}</span></div>
          <div className="ip-numero"><span className="ip-rotulo">Movimentos em 7 dias</span><span className="ip-valor">{semana.length}</span><span className="ip-var neutro">{semana.filter((m) => m.tipo === "entrada").length} entradas · {semana.filter((m) => m.tipo === "saida").length} saídas</span></div>
          <div className="ip-numero"><span className="ip-rotulo">Última contagem</span><span className="ip-valor">{diaCurto(ultimaContagem)}</span><span className="ip-var neutro">o resto é calculado</span></div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "saldo"} className={aba === "saldo" ? "on" : ""} onClick={() => setAba("saldo")}>Saldo</button>
          <button role="tab" aria-selected={aba === "registrar"} className={aba === "registrar" ? "on" : ""} onClick={() => setAba("registrar")}>Registrar</button>
          <button role="tab" aria-selected={aba === "movimentos"} className={aba === "movimentos" ? "on" : ""} onClick={() => setAba("movimentos")}>Movimentos</button>
          {socio && <button role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "on" : ""} onClick={() => setAba("pessoas")}>Quem registra</button>}
        </div>

        {aba === "saldo" && (
          <>
            <div className="ft-chips cf-filtro" role="tablist" aria-label="Filtro">
              <button role="tab" aria-selected={filtro === "todos"} className={filtro === "todos" ? "on" : ""} onClick={() => setFiltro("todos")}>Todos<span>{saldos.length}</span></button>
              <button role="tab" aria-selected={filtro === "falta"} className={filtro === "falta" ? "on" : ""} onClick={() => setFiltro("falta")}>Abaixo do mínimo<span>{acabando.length}</span></button>
            </div>
            {grupos.map((g) => (
              <section key={g.nome} className="ft-secao">
                <h2>{g.nome}<span className="muted">{g.itens.length} {g.itens.length === 1 ? "item" : "itens"}</span></h2>
                <div className="cf-itens">
                  {g.itens.map((s) => {
                    const st = situacao(s);
                    return (
                      <article key={s.item_id} className={`cf-item ${st.cls}`}>
                        <header><strong>{s.nome}</strong><span className={`cf-selo ${st.cls}`}>{st.txt}</span></header>
                        <div className="cf-saldo"><b>{num(s.saldo)}</b><span>{unid(s, s.saldo)}</span></div>
                        <div className="cf-barra" aria-hidden="true"><span style={{ width: `${st.pct}%` }} /></div>
                        <p className="cf-meta">
                          {pacotes(s) && <span>{pacotes(s)}</span>}
                          {s.minimo != null && <span>mínimo {num(s.minimo)}</span>}
                          <span>{s.contada_em ? `contado em ${diaCurto(s.contada_em)}` : "nunca contado"}</span>
                          {(s.entradas > 0 || s.saidas > 0) && <span>+{num(s.entradas)} / −{num(s.saidas)} desde a contagem</span>}
                        </p>
                        <button className="ghost small cf-registrar" onClick={() => registrar(s.item_id)}>Registrar</button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            {!grupos.length && <p className="muted vazio">Nenhum item abaixo do mínimo.</p>}
          </>
        )}

        {aba === "registrar" && <Registrar key={itemEscolhido} saldos={saldos} inicial={itemEscolhido} onPronto={carregar} />}

        {aba === "movimentos" && (
          <section className="sf-andamento cf-movs">
            <h3>Últimos movimentos</h3>
            {!movs.length ? <p className="muted">Nenhum movimento ainda.</p> : (
              <ol className="sf-linha-tempo">
                {movs.map((m) => {
                  const s = nomes[m.item_id];
                  return (
                    <li key={m.id} className={`cf-mov ${m.tipo} ${m.removido ? "desfeito" : ""}`}>
                      <span className="cf-mov-sinal" aria-hidden="true">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}</span>
                      <div className="cf-mov-corpo">
                        <div>
                          <strong>{TIPOS[m.tipo]} · {s?.nome ?? "—"}</strong>
                          <small>{quando(m.quando)} · {ORIGENS[m.origem] ?? m.origem}{m.destino ? ` · para ${DESTINOS[m.destino] ?? m.destino}` : ""}{m.removido ? " · desfeito" : ""}</small>
                          {m.observacao && <small className="cf-obs">{m.observacao}</small>}
                        </div>
                        <span className="cf-mov-qtd">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}{num(m.quantidade)} {s ? unid(s, m.quantidade) : ""}</span>
                        {!m.removido && (socio || m.registrado_por === userId) && <Desfazer id={m.id} onPronto={carregar} />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="muted es-nota">Desfazer não apaga: o movimento fica riscado e sai da conta.</p>
          </section>
        )}

        {aba === "pessoas" && socio && <QuemRegistra />}
      </main>
    </div>
  );
}

function Registrar({ saldos, inicial, onPronto }: { saldos: Saldo[]; inicial: string; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [tipo, setTipo] = useState<keyof typeof TIPOS>("entrada");
  const [itemId, setItemId] = useState(inicial);
  const [qtd, setQtd] = useState("");
  const [emPacotes, setEmPacotes] = useState(true);
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);
  const item = saldos.find((s) => s.item_id === itemId);
  const temPacote = !!item?.pacote_tamanho && item.pacote_tamanho !== 1;
  const n = Number(qtd.replace(",", "."));
  const total = item && qtd.trim() && !Number.isNaN(n) ? (temPacote && emPacotes ? n * item.pacote_tamanho! : n) : null;
  const depois = item && total != null ? (tipo === "contagem" ? total : item.saldo + (tipo === "entrada" ? total : -total)) : null;

  async function registrar() {
    setMsg(""); setOk("");
    if (!item) return setMsg("Escolha o item.");
    if (total == null || total < 0 || (tipo !== "contagem" && total === 0)) return setMsg("Informe a quantidade.");
    if (tipo === "saida" && !destino) return setMsg("Escolha para onde foi.");
    setEnviando(true);
    const { error } = await supabase.rpc("estoque_registrar_tela", { p_item: item.item_id, p_tipo: tipo, p_quantidade: total,
      p_destino: tipo === "saida" ? destino : "", p_observacao: obs });
    setEnviando(false);
    if (error) return setMsg(error.message);
    setOk(`${TIPOS[tipo]} registrada: ${num(total)} ${unid(item, total)} de ${item.nome}.`);
    setQtd(""); setObs("");
    onPronto();
  }

  return (
    <div className="av cf-registro">
      <div className="av-principal">
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">1</span><div><h3>O que aconteceu</h3><p className="muted">guardou, tirou ou contou</p></div></header>
          <div className="et-tipos" role="radiogroup" aria-label="Tipo de movimento">
            {(Object.keys(TIPOS) as (keyof typeof TIPOS)[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} className={tipo === t ? `on ${t}` : t} onClick={() => setTipo(t)}>
                <span className="et-tipo-sinal" aria-hidden="true">{t === "entrada" ? "+" : t === "saida" ? "−" : "="}</span>
                {TIPOS[t]}<small>{t === "entrada" ? "guardei na câmara" : t === "saida" ? "tirei da câmara" : "contei o que tem"}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">2</span><div><h3>O item e a quantidade</h3><p className="muted">em pacotes ou na unidade do item</p></div></header>
          <div className="av-campos">
            <label className="av-largo">Item
              <select value={itemId} onChange={(v) => setItemId(v.target.value)}>
                <option value="">Escolha…</option>
                {saldos.map((s) => <option key={s.item_id} value={s.item_id}>{s.nome} · hoje {num(s.saldo)} {unid(s, s.saldo)}</option>)}
              </select>
            </label>
            <label>Quantidade{temPacote && emPacotes ? ` (${item!.pacote_nome}s)` : item ? ` (${unid(item, 2)})` : ""}
              <input inputMode="decimal" value={qtd} onChange={(v) => setQtd(v.target.value)} placeholder="0" />
            </label>
            {tipo === "saida" ? (
              <label>Para onde foi
                <select value={destino} onChange={(v) => setDestino(v.target.value)}>
                  <option value="">Escolha…</option>
                  {Object.entries(DESTINOS).map(([k, d]) => <option key={k} value={k}>{d}</option>)}
                </select>
              </label>
            ) : <label>Observação<input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="opcional" /></label>}
            {temPacote && (
              <label className="et-check av-largo"><input type="checkbox" checked={emPacotes} onChange={(v) => setEmPacotes(v.target.checked)} />
                Contar em {item!.pacote_nome}s ({num(item!.pacote_tamanho)} {unid(item!, item!.pacote_tamanho!)} cada)</label>
            )}
            {tipo === "saida" && <label className="av-largo">Observação<input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="opcional" /></label>}
          </div>
        </section>
      </div>
      <aside className="av-lado">
        <section className="av-bloco av-resumo">
          <div className="av-total"><span>{item ? item.nome : "Escolha um item"}</span><b>{item ? `${num(item.saldo)}` : "—"}</b></div>
          {item && total != null && depois != null && (
            <p className="cf-depois">
              {tipo === "contagem" ? "O saldo passa a ser" : tipo === "entrada" ? `Entram ${num(total)} ${unid(item, total)} e o saldo fica` : `Saem ${num(total)} ${unid(item, total)} e o saldo fica`}
              <b className={depois < 0 ? "es-ruim" : ""}>{num(depois)} {unid(item, depois)}</b>
            </p>
          )}
          {msg && <p className="tv-alerta">{msg}</p>}
          {ok && <p className="es-aviso">{ok}</p>}
          <button onClick={registrar} disabled={enviando}>{enviando ? "Registrando…" : `Registrar ${TIPOS[tipo].toLowerCase()}`}</button>
          <p className="muted av-nota">Errou? Em Movimentos dá para desfazer: o registro fica riscado e sai da conta.</p>
        </section>
      </aside>
    </div>
  );
}

function Desfazer({ id, onPronto }: { id: number; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [certeza, setCerteza] = useState(false);
  if (!certeza) return <button className="ghost small" onClick={() => setCerteza(true)}>Desfazer</button>;
  return (
    <span className="et-desfazer">
      <button className="ghost small" onClick={async () => { await supabase.rpc("estoque_desfazer", { p_mov: id }); onPronto(); }}>Confirmar</button>
      <button className="ghost small" onClick={() => setCerteza(false)}>Não</button>
    </span>
  );
}

function QuemRegistra() {
  const supabase = useMemo(() => createClient(), []);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [novo, setNovo] = useState({ nome: "", email: "" });
  const [msg, setMsg] = useState("");
  const carregar = useCallback(async () => {
    const { data } = await supabase.from("operacao_pessoas").select("id,nome,papel,unidade,setor,email,user_id,ativo,registra_estoque").eq("ativo", true).order("papel").order("nome");
    setPessoas((data ?? []) as Pessoa[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function ligar(p: Pessoa, sim: boolean) {
    setMsg("");
    const { error } = await supabase.rpc("estoque_pessoa_ligar", { p_pessoa: p.id, p_sim: sim });
    if (error) setMsg(error.message);
    carregar();
  }
  async function incluir() {
    setMsg("");
    const { error } = await supabase.rpc("operacao_pessoa_salvar", { p_id: null, p_nome: novo.nome, p_unidade: "", p_setor: "producao",
      p_papel: "estoque", p_email: novo.email, p_wa_nome: "", p_ativo: true });
    if (error) return setMsg(error.message);
    setNovo({ nome: "", email: "" });
    carregar();
  }
  async function darAcesso(p: Pessoa) {
    setMsg("");
    const { data, error } = await supabase.functions.invoke("operacao-convidar", { body: { pessoa: p.id } });
    const r = (data ?? {}) as { ok?: boolean; erro?: string };
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
      <header className="av-bloco-cabeca"><div><h3>Quem registra na câmara fria</h3><p className="muted">entradas, saídas e contagens</p></div></header>
      <p className="muted cp-ajuda">Ligue quem pode registrar. Quem já pede no grupo COMPRAS continua vendo as Compras e ganha a Câmara fria.
        Para alguém da produção que não pede compras, inclua abaixo: essa pessoa só vê a Câmara fria e a Produção.</p>
      {msg && <p className="es-aviso">{msg}</p>}
      <ul className="cf-pessoas">
        {pessoas.map((p) => (
          <li key={p.id}>
            <span className="nf-grupo-icone" aria-hidden="true">{p.nome.slice(0, 1)}</span>
            <span className="cf-pessoa-nome"><strong>{p.nome}</strong><small>{p.papel === "estoque" ? "Câmara fria" : p.papel === "compras" ? "Setor de compras" : `${p.setor ?? ""} · ${DESTINOS[p.unidade ?? ""] ?? ""}`}</small></span>
            <span className={p.user_id ? "estado tv-ok" : "estado"}>{p.user_id ? "com acesso" : "sem acesso"}</span>
            <label className="sf-chave">
              <input type="checkbox" checked={p.registra_estoque} disabled={p.papel === "estoque"} onChange={(v) => ligar(p, v.target.checked)} />
              <span className="sf-chave-trilho" aria-hidden="true" /><span>Registra</span>
            </label>
            {!p.user_id ? <button className="ghost small" disabled={!p.email} title={p.email ? "" : "Cadastre o e-mail em Compras → Pessoas e acesso"} onClick={() => darAcesso(p)}>Dar acesso</button> : <span />}
          </li>
        ))}
      </ul>
      <div className="cp-incluir et-incluir">
        <input value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v.target.value })} placeholder="Nome (só Câmara fria)" aria-label="Nome" />
        <input type="email" value={novo.email} onChange={(v) => setNovo({ ...novo, email: v.target.value })} placeholder="nome@email.com" aria-label="E-mail" />
        <button className="ghost" disabled={!novo.nome.trim()} onClick={incluir}>Incluir pessoa</button>
      </div>
    </section>
  );
}
