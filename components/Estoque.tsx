"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";

// Estoque da câmara fria (Operação · fase 4): o saldo se calcula sozinho.
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
const ORIGENS: Record<string, string> = { tela: "pela tela", grupo: "pedido do grupo", projeto: "projeto Estoque Câmara Fria" };
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) : "—");
const unid = (s: { unidade: string }, q: number) => (s.unidade === "porção" ? (q === 1 ? "porção" : "porções") : s.unidade);
const pacotes = (s: Saldo) => (s.pacote_tamanho && s.pacote_tamanho !== 1 ? `${num(s.saldo / s.pacote_tamanho)} ${s.pacote_nome}s` : "");

export default function Estoque({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  const [compras, setCompras] = useState(false);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [aba, setAba] = useState<"saldo" | "registrar" | "movimentos" | "pessoas">("saldo");

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

  // Saídas do grupo e registros de outras pessoas aparecem na hora
  useEffect(() => {
    if (!papel) return;
    const canal = supabase.channel("estoque").on("postgres_changes", { event: "*", schema: "public", table: "estoque_movimentos" }, () => carregar()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, papel, carregar]);

  const socio = papel === "socio";
  const topo = socio ? <Topo email={userEmail} ativo="estoque" />
    : <TopoSimples email={userEmail} nome={nome} area="Estoque" outra={compras ? { href: "/compras", nome: "Compras" } : undefined} />;

  if (papel === undefined) return <div className="pagina"><main className="miolo"><p className="muted vazio">Carregando…</p></main></div>;
  if (papel === null) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="estoque" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso ao estoque.</p></main>
      </div>
    );
  }

  const acabando = saldos.filter((s) => s.minimo != null && s.saldo < s.minimo);
  const ultimaContagem = saldos.map((s) => s.contada_em).filter(Boolean).sort().pop() ?? null;
  const nomes = Object.fromEntries(saldos.map((s) => [s.item_id, s]));

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es et">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Estoque da câmara fria</h1>
            <p>O saldo se calcula sozinho: a última contagem, mais o que entrou da produção, menos o que saiu para as unidades. Tudo é lançado aqui, na aba Registrar. Uma contagem de vez em quando acerta a diferença.</p>
          </div>
        </div>

        <div className="es-numeros">
          <div className="es-numero"><span className="tv-cartao-rotulo">Itens</span><span className="es-numero-valor">{saldos.length}</span><span className="tv-cartao-detalhe">na câmara fria</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Acabando</span><span className={acabando.length ? "es-numero-valor es-ruim" : "es-numero-valor"}>{acabando.length}</span><span className="tv-cartao-detalhe">abaixo do mínimo</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Última contagem</span><span className="es-numero-valor">{ultimaContagem ? quando(ultimaContagem).slice(0, 5) : "—"}</span><span className="tv-cartao-detalhe">o resto é calculado</span></div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "saldo"} className={aba === "saldo" ? "on" : ""} onClick={() => setAba("saldo")}>Saldo</button>
          <button role="tab" aria-selected={aba === "registrar"} className={aba === "registrar" ? "on" : ""} onClick={() => setAba("registrar")}>Registrar</button>
          <button role="tab" aria-selected={aba === "movimentos"} className={aba === "movimentos" ? "on" : ""} onClick={() => setAba("movimentos")}>Movimentos</button>
          {socio && <button role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "on" : ""} onClick={() => setAba("pessoas")}>Quem registra</button>}
        </div>

        {aba === "saldo" && (
          <section className="es-bloco">
            <div className="nf-tabela-wrap">
              <table className="nf-tabela">
                <thead><tr><th>Item</th><th className="n">Saldo</th><th className="n">Mínimo</th><th className="n">Desde a contagem</th><th>Contado em</th></tr></thead>
                <tbody>
                  {saldos.map((s) => (
                    <tr key={s.item_id}>
                      <td><strong>{s.nome}</strong>{s.pacote_tamanho && s.pacote_tamanho !== 1 ? <small>{s.pacote_nome} de {num(s.pacote_tamanho)} {unid(s, s.pacote_tamanho)}</small> : null}</td>
                      <td className="n"><span className={s.minimo != null && s.saldo < s.minimo ? "es-ruim" : ""}>{num(s.saldo)} {unid(s, s.saldo)}</span>{pacotes(s) && <small>{pacotes(s)}</small>}</td>
                      <td className="n">{s.minimo != null ? `${num(s.minimo)} ${unid(s, s.minimo)}` : "—"}</td>
                      <td className="n">{s.entradas || s.saidas ? <>+{num(s.entradas)} / −{num(s.saidas)}</> : "—"}</td>
                      <td>{s.contada_em ? quando(s.contada_em) : <span className="muted">nunca contado</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted es-nota">Itens sem contagem começam do zero e só somam o que entrar. Em vermelho: abaixo do mínimo.
              Entradas, saídas e contagens são lançadas na aba Registrar e aparecem em Movimentos.</p>
          </section>
        )}

        {aba === "registrar" && <Registrar saldos={saldos} onPronto={carregar} />}

        {aba === "movimentos" && (
          <section className="es-bloco">
            <div className="nf-tabela-wrap">
              <table className="nf-tabela">
                <thead><tr><th>Quando</th><th>Item</th><th>Movimento</th><th className="n">Quantidade</th><th>De onde veio</th><th /></tr></thead>
                <tbody>
                  {movs.map((m) => {
                    const s = nomes[m.item_id];
                    return (
                      <tr key={m.id} className={m.removido ? "cp-tirado" : ""}>
                        <td>{quando(m.quando)}</td>
                        <td><strong>{s?.nome ?? "—"}</strong>{m.observacao && <small>{m.observacao}</small>}</td>
                        <td>{TIPOS[m.tipo]}{m.destino && <small>para {DESTINOS[m.destino] ?? m.destino}</small>}</td>
                        <td className="n">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}{num(m.quantidade)} {s ? unid(s, m.quantidade) : ""}</td>
                        <td>{ORIGENS[m.origem] ?? m.origem}</td>
                        <td>{!m.removido && (socio || m.registrado_por === userId) && <Desfazer id={m.id} onPronto={carregar} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted es-nota">Desfazer não apaga: o movimento fica riscado e sai da conta.</p>
          </section>
        )}

        {aba === "pessoas" && socio && <QuemRegistra />}
      </main>
    </div>
  );
}

function Registrar({ saldos, onPronto }: { saldos: Saldo[]; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [tipo, setTipo] = useState<keyof typeof TIPOS>("entrada");
  const [itemId, setItemId] = useState("");
  const [qtd, setQtd] = useState("");
  const [emPacotes, setEmPacotes] = useState(true);
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const item = saldos.find((s) => s.item_id === itemId);
  const temPacote = !!item?.pacote_tamanho && item.pacote_tamanho !== 1;
  const n = Number(qtd.replace(",", "."));
  const total = item && qtd.trim() && !Number.isNaN(n) ? (temPacote && emPacotes ? n * item.pacote_tamanho! : n) : null;

  async function registrar() {
    setMsg("");
    if (!item) return setMsg("Escolha o item.");
    if (total == null || total < 0 || (tipo !== "contagem" && total === 0)) return setMsg("Informe a quantidade.");
    if (tipo === "saida" && !destino) return setMsg("Escolha para onde foi.");
    setEnviando(true);
    const { error } = await supabase.rpc("estoque_registrar_tela", { p_item: item.item_id, p_tipo: tipo, p_quantidade: total,
      p_destino: tipo === "saida" ? destino : "", p_observacao: obs });
    setEnviando(false);
    if (error) return setMsg(error.message);
    setMsg(`${TIPOS[tipo]} registrada: ${num(total)} ${unid(item, total)} de ${item.nome}.`);
    setQtd(""); setObs("");
    onPronto();
  }

  return (
    <section className="es-bloco et-registrar">
      <div className="et-tipos" role="radiogroup" aria-label="Tipo de movimento">
        {(Object.keys(TIPOS) as (keyof typeof TIPOS)[]).map((t) => (
          <button key={t} role="radio" aria-checked={tipo === t} className={tipo === t ? "on" : ""} onClick={() => setTipo(t)}>
            {TIPOS[t]}<small>{t === "entrada" ? "guardei na câmara" : t === "saida" ? "tirei da câmara" : "contei o que tem"}</small>
          </button>
        ))}
      </div>
      <div className="nf-campos et-campos">
        <label>Item
          <select value={itemId} onChange={(v) => setItemId(v.target.value)}>
            <option value="">Escolha…</option>
            {saldos.map((s) => <option key={s.item_id} value={s.item_id}>{s.nome}</option>)}
          </select>
        </label>
        <label>Quantidade{temPacote && emPacotes ? ` (${item!.pacote_nome}s)` : item ? ` (${unid(item, 2)})` : ""}
          <input inputMode="decimal" value={qtd} onChange={(v) => setQtd(v.target.value)} placeholder="0" />
        </label>
        {temPacote && (
          <label className="et-check"><input type="checkbox" checked={emPacotes} onChange={(v) => setEmPacotes(v.target.checked)} />
            Contar em {item!.pacote_nome}s ({num(item!.pacote_tamanho)} {unid(item!, item!.pacote_tamanho!)} cada)</label>
        )}
        {tipo === "saida" && (
          <label>Para onde foi
            <select value={destino} onChange={(v) => setDestino(v.target.value)}>
              <option value="">Escolha…</option>
              {Object.entries(DESTINOS).map(([k, d]) => <option key={k} value={k}>{d}</option>)}
            </select>
          </label>
        )}
        <label>Observação
          <input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="opcional" />
        </label>
      </div>
      {item && total != null && (
        <p className="et-resumo">
          {tipo === "contagem" ? <>O saldo de {item.nome} passa a ser <strong>{num(total)} {unid(item, total)}</strong> (hoje a conta diz {num(item.saldo)}).</>
            : <>{tipo === "entrada" ? "Entram" : "Saem"} <strong>{num(total)} {unid(item, total)}</strong>; o saldo fica {num(item.saldo + (tipo === "entrada" ? total : -total))}.</>}
        </p>
      )}
      {msg && <p className="es-aviso">{msg}</p>}
      <button onClick={registrar} disabled={enviando}>{enviando ? "Registrando…" : `Registrar ${TIPOS[tipo].toLowerCase()}`}</button>
    </section>
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
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Quem registra</h2><span className="muted">entradas e contagens da câmara fria</span></div>
      <p className="muted cp-ajuda">Marque quem pode registrar o que guarda na câmara fria. Quem já pede no grupo COMPRAS continua vendo as Compras e ganha o Estoque.
        Para alguém da produção que não pede compras, inclua abaixo: essa pessoa só vê o Estoque.</p>
      {msg && <p className="es-aviso">{msg}</p>}
      <div className="nf-tabela-wrap">
        <table className="nf-tabela cp-tabela">
          <thead><tr><th>Pessoa</th><th>Registra o estoque</th><th>Acesso</th><th /></tr></thead>
          <tbody>
            {pessoas.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.nome}</strong><small>{p.papel === "estoque" ? "Câmara fria" : p.papel === "compras" ? "Setor de compras" : `${p.setor ?? ""} · ${DESTINOS[p.unidade ?? ""] ?? ""}`}</small></td>
                <td><label className="et-check"><input type="checkbox" checked={p.registra_estoque} disabled={p.papel === "estoque"} onChange={(v) => ligar(p, v.target.checked)} /> {p.registra_estoque ? "sim" : "não"}</label></td>
                <td>{p.user_id ? <span className="estado tv-ok">com acesso</span> : <span className="estado">sem acesso</span>}</td>
                <td>{!p.user_id && <button className="ghost small" disabled={!p.email} title={p.email ? "" : "Cadastre o e-mail em Compras → Pessoas e acesso"} onClick={() => darAcesso(p)}>Dar acesso</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cp-incluir et-incluir">
        <input value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v.target.value })} placeholder="Nome (só Estoque)" aria-label="Nome" />
        <input type="email" value={novo.email} onChange={(v) => setNovo({ ...novo, email: v.target.value })} placeholder="nome@email.com" aria-label="E-mail" />
        <button className="ghost" disabled={!novo.nome.trim()} onClick={incluir}>Incluir pessoa</button>
      </div>
    </section>
  );
}
