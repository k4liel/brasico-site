"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";

// Câmara fria (Operação · fase 4; rota /estoque). Desde 07/11/2026 tudo é por lote (validade):
// cada item mostra o total e quanto tem de cada validade; uma contagem grava um lote por validade,
// a entrada pede a validade da etiqueta e a saída sai do lote escolhido ou do que vence primeiro.
// Tabelas e funções em supabase/estoque.sql e supabase/estoque_validades.sql (view estoque_lotes).
type Saldo = { item_id: string; nome: string; unidade: string; pacote_nome: string; pacote_tamanho: number | null; minimo: number | null;
  ordem: number; contagem: number | null; contada_em: string | null; entradas: number; saidas: number; saldo: number; ultimo_movimento: string | null };
type Lote = { item_id: string; validade: string | null; quantidade: number };
type Item = Saldo & { lotes: Lote[] };
type Mov = { id: number; item_id: string; tipo: "entrada" | "saida" | "contagem"; quantidade: number; validade: string | null; destino: string | null;
  origem: string; observacao: string | null; quando: string; registrado_por: string | null; removido: boolean };
type Pessoa = { id: string; nome: string; papel: string; unidade: string | null; setor: string | null; email: string | null;
  user_id: string | null; ativo: boolean; registra_estoque: boolean };
type Tipo = "entrada" | "saida" | "contagem";

const DESTINOS: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua", midway: "Cicchetti Midway", outro: "Outro" };
const TIPOS: Record<Tipo, string> = { entrada: "Entrada", saida: "Saída", contagem: "Contagem" };
const ORIGENS: Record<string, string> = { tela: "pela tela", grupo: "pedido do grupo", projeto: "contagem do projeto", producao: "da produção" };
// Grupos da câmara pela ordem do cadastro (10 massas, 20 carnes e peixes, 30 molhos, 40 pães)
const GRUPOS = [{ nome: "Massas", ate: 20 }, { nome: "Carnes e peixes", ate: 30 }, { nome: "Molhos e bases", ate: 40 }, { nome: "Pães", ate: 1000 }];
const LOGO = 7; // dias: "vence logo"

const num = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) : "—");
const diaCurto = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" }) : "—");
const dataVal = (v: string) => { const [a, m, d] = v.split("-"); return `${d}/${m}/${a.slice(2)}`; };
const hojeISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
const unid = (s: { unidade: string }, q: number) => (s.unidade === "porção" ? (Math.abs(q) === 1 ? "porção" : "porções") : s.unidade);
const temPacote = (s: Saldo) => !!s.pacote_tamanho && Number(s.pacote_tamanho) !== 1;
const pct = (s: Saldo) => (s.pacote_nome === "pacote" ? "pct" : s.pacote_nome);
// "22 pct" (principal) e "44 L" (detalhe); sem pacote, só a unidade
// Sempre números inteiros: kg e L quebrados viram "5 kg 500 g"; pacote quebrado vira "7 pct + 1 porção"
function base(s: { unidade: string }, q: number) {
  const n = Math.round(q * 1000) / 1000;
  if ((s.unidade === "kg" || s.unidade === "L") && n % 1 !== 0) {
    const sinal = n < 0 ? "-" : ""; const a = Math.abs(n);
    const int = Math.floor(a); const resto = Math.round((a - int) * 1000);
    const peq = s.unidade === "kg" ? "g" : "ml";
    return int ? `${sinal}${num(int)} ${s.unidade} ${resto} ${peq}` : `${sinal}${resto} ${peq}`;
  }
  return `${num(Math.round(n))} ${unid(s, n)}`;
}
function qtd(s: Saldo, q: number) {
  if (!temPacote(s)) return { pri: base(s, q), sec: "" };
  const t = Number(s.pacote_tamanho); const a = Math.abs(q); const sinal = q < 0 ? "-" : "";
  const p = Math.floor(a / t + 1e-9); const resto = Math.round((a - p * t) * 1000) / 1000;
  if (!p) return { pri: base(s, q), sec: "" };
  const pri = resto ? `${sinal}${num(p)} ${pct(s)} + ${base(s, resto)}` : `${sinal}${num(p)} ${pct(s)}`;
  return { pri, sec: base(s, q) };
}

type Prazo = { cls: "vencido" | "logo" | "ok" | "sem"; dias: number | null; txt: string; curto: string };
function prazo(v: string | null, hoje: string): Prazo {
  if (!v) return { cls: "sem", dias: null, txt: "sem validade", curto: "sem validade" };
  const dias = Math.round((Date.parse(v) - Date.parse(hoje)) / 864e5);
  const data = dataVal(v);
  if (dias < 0) return { cls: "vencido", dias, txt: `venceu há ${-dias} ${dias === -1 ? "dia" : "dias"} (${data})`, curto: `venceu ${data.slice(0, 5)}` };
  if (dias === 0) return { cls: "logo", dias, txt: `vence hoje (${data})`, curto: "vence hoje" };
  if (dias <= LOGO) return { cls: "logo", dias, txt: `vence em ${dias} ${dias === 1 ? "dia" : "dias"} (${data})`, curto: `vence ${data.slice(0, 5)}` };
  return { cls: "ok", dias, txt: `vence em ${data}`, curto: data.slice(0, 5) + (v.slice(0, 4) !== hoje.slice(0, 4) ? `/${v.slice(2, 4)}` : "") };
}

// Desde 22/11/2026 (pedido do dono, prévia A): uma página só, o estoque em cartões por grupo e, embaixo,
// as saídas, entradas e contagens agrupadas por pedido, que abrem e fecham. Entradas e saídas são lançadas pelo Claude:
// a página não tem mais formulário de registro.
type Filtro = "todos" | "vencido" | "logo" | "zerado";
type Pedido = { chave: string; m: Mov; itens: Mov[] };

const JANELA_PEDIDO = 15 * 60 * 1000; // mesmo tipo, destino e pessoa, lançados em até 15 min = um pedido
function agruparPedidos(movs: Mov[]): Pedido[] {
  const pedidos: Pedido[] = [];
  for (const m of movs) {
    const p = pedidos.find((x) => x.m.tipo === m.tipo && (x.m.destino ?? "") === (m.destino ?? "") && x.m.registrado_por === m.registrado_por
      && Math.abs(Date.parse(x.m.quando) - Date.parse(m.quando)) <= JANELA_PEDIDO);
    if (p) p.itens.push(m); else pedidos.push({ chave: `p${m.id}`, m, itens: [m] });
  }
  return pedidos;
}
const nomeDestino = (d: string | null) => (d ? DESTINOS[d] ?? d : "");

export default function Estoque({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  const [compras, setCompras] = useState(false);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [verPessoas, setVerPessoas] = useState(false);
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    const [s, l, m] = await Promise.all([
      supabase.from("estoque_saldo").select("*").order("ordem").order("nome"),
      supabase.from("estoque_lotes").select("item_id,validade,quantidade"),
      supabase.from("estoque_movimentos").select("*").order("quando", { ascending: false }).order("id", { ascending: false }).limit(400),
    ]);
    setSaldos(((s.data ?? []) as Saldo[]).map((x) => ({ ...x, saldo: Number(x.saldo), minimo: x.minimo == null ? null : Number(x.minimo), pacote_tamanho: x.pacote_tamanho == null ? null : Number(x.pacote_tamanho) })));
    setLotes(((l.data ?? []) as Lote[]).map((x) => ({ ...x, quantidade: Number(x.quantidade) })).filter((x) => x.quantidade !== 0));
    setMovs(((m.data ?? []) as Mov[]).map((x) => ({ ...x, quantidade: Number(x.quantidade) })));
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
      carregar();
    })();
  }, [supabase, userId, carregar]);

  // Registros feitos pelo Claude aparecem na hora
  useEffect(() => {
    if (!papel) return;
    const canal = supabase.channel("estoque").on("postgres_changes", { event: "*", schema: "public", table: "estoque_movimentos" }, () => carregar()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, papel, carregar]);

  const itens: Item[] = useMemo(() => saldos.map((s) => ({
    ...s,
    lotes: lotes.filter((l) => l.item_id === s.item_id && l.quantidade > 0).sort((a, b) => (a.validade ?? "9999").localeCompare(b.validade ?? "9999")),
  })), [saldos, lotes]);
  const pedidos = useMemo(() => agruparPedidos(movs), [movs]);

  const socio = papel === "socio";
  const topo = socio ? <Topo email={userEmail} ativo="estoque" />
    : <TopoSimples email={userEmail} nome={nome} area="Câmara fria" outra={compras ? { href: "/compras", nome: "Compras" } : undefined} />;

  if (papel === undefined) return <div className="pagina"><main className="miolo"><p className="muted vazio">Carregando…</p></main></div>;
  if (papel === null) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="estoque" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à câmara fria.</p></main>
      </div>
    );
  }

  const temLote = (it: Item, cls: Prazo["cls"]) => it.lotes.some((l) => prazo(l.validade, hoje).cls === cls);
  const comSaldo = itens.filter((s) => s.saldo > 0);
  const zerados = itens.filter((s) => s.saldo <= 0);
  const vencidos = itens.filter((it) => it.saldo > 0 && temLote(it, "vencido"));
  const logo = itens.filter((it) => it.saldo > 0 && temLote(it, "logo"));
  const ultimaContagem = saldos.map((s) => s.contada_em).filter(Boolean).sort().pop() ?? null;
  const semana = Date.parse(hoje) - 6 * 864e5;
  const saidasSemana = pedidos.filter((p) => p.m.tipo === "saida" && p.itens.some((x) => !x.removido) && Date.parse(p.m.quando) >= semana);
  const destinosSemana = [...new Set(saidasSemana.map((p) => nomeDestino(p.m.destino)).filter(Boolean))];

  const termo = busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const passa = (it: Item) =>
    (!termo || it.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(termo)) &&
    (filtro === "todos" ? it.saldo > 0 : filtro === "zerado" ? it.saldo <= 0 : it.saldo > 0 && temLote(it, filtro));
  let inicio = 0;
  const grupos = GRUPOS.map((g) => {
    const doGrupo = itens.filter((s) => s.ordem >= inicio && s.ordem < g.ate);
    inicio = g.ate;
    return { ...g, mostrar: doGrupo.filter(passa), semEstoque: doGrupo.filter((s) => s.saldo <= 0) };
  }).filter((g) => g.mostrar.length || (filtro === "todos" && !termo && g.semEstoque.length));

  const itemAberto = itens.find((i) => i.item_id === aberto) ?? null;
  const filtros: [Filtro, string, number][] = [["todos", "Todos", comSaldo.length], ["vencido", "Vencidos", vencidos.length], ["logo", `Vencem em ${LOGO} dias`, logo.length], ["zerado", "Sem estoque", zerados.length]];

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es nf-larga cm">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Câmara fria</h1>
            <p>O estoque em cartões, com quanto tem de cada validade. Embaixo, as saídas e entradas por pedido.</p>
          </div>
        </div>

        <div className="cm-nums">
          <button className={`cm-num ${filtro === "todos" ? "on" : ""}`} onClick={() => setFiltro("todos")}>
            <small>Itens com estoque</small><b>{comSaldo.length}</b><span>contado em {diaCurto(ultimaContagem)}</span></button>
          <button className={`cm-num ${vencidos.length ? "ruim" : ""} ${filtro === "vencido" ? "on" : ""}`} onClick={() => setFiltro("vencido")}>
            <small>Vencidos</small><b>{vencidos.length}</b><span>{vencidos.length ? vencidos.map((s) => s.nome).join(", ") : "nenhum lote vencido"}</span></button>
          <button className={`cm-num ${logo.length ? "atencao" : ""} ${filtro === "logo" ? "on" : ""}`} onClick={() => setFiltro("logo")}>
            <small>Vencem em {LOGO} dias</small><b>{logo.length}</b><span>{logo.length ? logo.map((s) => s.nome).join(", ") : "nada perto de vencer"}</span></button>
          <a className="cm-num" href="#saidas">
            <small>Saídas na semana</small><b>{saidasSemana.length} {saidasSemana.length === 1 ? "pedido" : "pedidos"}</b><span>{destinosSemana.join(", ") || "nenhuma saída"}</span></a>
        </div>

        <div className="cm-ferr">
          <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Procurar item…" aria-label="Procurar item" />
          <div className="cm-chips" role="tablist" aria-label="Filtro">
            {filtros.map(([k, t, n]) => (
              <button key={k} role="tab" aria-selected={filtro === k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{t}<span>{n}</span></button>
            ))}
          </div>
        </div>

        {grupos.map((g) => (
          <section key={g.nome} className="cm-grupo2">
            <header><h2>{g.nome}</h2><span>{g.mostrar.length} {g.mostrar.length === 1 ? "item" : "itens"}</span></header>
            {g.mostrar.length > 0 && (
              <div className="cm-cards">
                {g.mostrar.map((it) => <Cartao key={it.item_id} it={it} hoje={hoje} onAbrir={() => setAberto(it.item_id)} />)}
              </div>
            )}
            {filtro === "todos" && !termo && g.semEstoque.length > 0 && (
              <p className="cm-zerados">Sem estoque: {g.semEstoque.map((z, i) => (
                <span key={z.item_id}>{i > 0 && ", "}<button onClick={() => setAberto(z.item_id)}>{z.nome}</button></span>
              ))}</p>
            )}
          </section>
        ))}
        {!grupos.length && <p className="muted vazio">Nenhum item com esse filtro.</p>}

        <Pedidos pedidos={pedidos} itens={itens} socio={socio} userId={userId} onPronto={carregar} />

        {socio && (
          <section className="cm-pessoas">
            <button className="cm-pessoas-botao" aria-expanded={verPessoas} onClick={() => setVerPessoas((v) => !v)}>
              <span>Quem registra na câmara fria</span><i aria-hidden="true">{verPessoas ? "−" : "+"}</i>
            </button>
            {verPessoas && <QuemRegistra />}
          </section>
        )}
      </main>

      {itemAberto && (
        <Painel it={itemAberto} hoje={hoje} movs={movs.filter((m) => m.item_id === itemAberto.item_id && !m.removido).slice(0, 12)}
          onFechar={() => setAberto(null)} />
      )}
    </div>
  );
}

// Cartão de um item: nome, total, barra das validades e quanto tem de cada uma
function Cartao({ it, hoje, onAbrir }: { it: Item; hoje: string; onAbrir: () => void }) {
  const total = qtd(it, it.saldo);
  const soma = it.lotes.reduce((t, l) => t + l.quantidade, 0) || 1;
  const venc = it.saldo > 0 && it.lotes.some((l) => prazo(l.validade, hoje).cls === "vencido");
  const logo = it.saldo > 0 && !venc && it.lotes.some((l) => prazo(l.validade, hoje).cls === "logo");
  const MAX = 4;
  return (
    <button className={`cm-card ${venc ? "vencido" : logo ? "logo" : ""} ${it.saldo <= 0 ? "zerado" : ""}`} onClick={onAbrir}>
      <span className="cm-card-topo">
        <strong>{it.nome}</strong>
        {venc ? <em className="cm-selo vencido">vencido</em> : logo ? <em className="cm-selo logo">vence logo</em> : null}
      </span>
      <span className="cm-card-total">
        <b>{it.saldo > 0 ? total.pri : "Sem estoque"}</b>
        <small>{it.saldo > 0 ? (total.sec || `${it.lotes.length} ${it.lotes.length === 1 ? "validade" : "validades"}`) : `contado em ${diaCurto(it.contada_em)}`}</small>
      </span>
      {it.lotes.length > 0 && (
        <>
          <span className="cm-card-barra" aria-hidden="true">
            {it.lotes.map((l) => <i key={l.validade ?? "sem"} className={prazo(l.validade, hoje).cls} style={{ flexGrow: l.quantidade / soma }} />)}
          </span>
          <span className="cm-card-lotes">
            {it.lotes.slice(0, MAX).map((l) => {
              const p = prazo(l.validade, hoje);
              return (
                <span key={l.validade ?? "sem"} className={p.cls} title={p.txt}>
                  <span><i aria-hidden="true" />{l.validade ? dataVal(l.validade) : "sem validade"}</span>
                  <b>{qtd(it, l.quantidade).pri}</b>
                </span>
              );
            })}
            {it.lotes.length > MAX && <span className="mais">+ {it.lotes.length - MAX} validades</span>}
          </span>
        </>
      )}
    </button>
  );
}

// Saídas, entradas e contagens por pedido, cada um abre e fecha
function Pedidos({ pedidos, itens, socio, userId, onPronto }: { pedidos: Pedido[]; itens: Item[]; socio: boolean; userId: string; onPronto: () => void }) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(pedidos[0] ? [pedidos[0].chave] : []));
  const [mostrar, setMostrar] = useState(15);
  const [tipo, setTipo] = useState<"todos" | Tipo>("todos");
  useEffect(() => { if (pedidos[0]) setAbertos((a) => (a.size ? a : new Set([pedidos[0].chave]))); }, [pedidos]);
  const nomes = Object.fromEntries(itens.map((s) => [s.item_id, s]));
  const lista = pedidos.filter((p) => tipo === "todos" || p.m.tipo === tipo);
  const visiveis = lista.slice(0, mostrar);
  const todosAbertos = visiveis.length > 0 && visiveis.every((p) => abertos.has(p.chave));
  const alternar = (k: string) => setAbertos((a) => { const n = new Set(a); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <section className="cm-peds" id="saidas">
      <header className="cm-peds-topo">
        <div><h2>Saídas e entradas</h2><span>clique num pedido para abrir ou fechar</span></div>
        <div className="cm-peds-acoes">
          <div className="cm-chips">
            {([["todos", "Tudo"], ["saida", "Saídas"], ["entrada", "Entradas"], ["contagem", "Contagens"]] as const).map(([k, t]) => (
              <button key={k} className={tipo === k ? "on" : ""} onClick={() => setTipo(k)}>{t}</button>
            ))}
          </div>
          <button className="ghost small" onClick={() => setAbertos(todosAbertos ? new Set() : new Set(visiveis.map((p) => p.chave)))}>{todosAbertos ? "Fechar todos" : "Abrir todos"}</button>
        </div>
      </header>
      {!visiveis.length && <p className="muted">Nenhum movimento ainda.</p>}
      <div className="cm-peds-lista">
        {visiveis.map((p) => {
          const ativos = p.itens.filter((x) => !x.removido);
          const aberto = abertos.has(p.chave);
          const sinal = p.m.tipo === "entrada" ? "+" : p.m.tipo === "saida" ? "−" : "=";
          const titulo = p.m.tipo === "saida" ? `Saída para ${nomeDestino(p.m.destino) || "—"}` : p.m.tipo === "entrada" ? "Entrada na câmara" : "Contagem";
          // contagem: um item pode ter várias validades na mesma contagem; junta por item
          const porItem = new Map<string, Mov[]>();
          for (const x of p.itens) porItem.set(x.item_id, [...(porItem.get(x.item_id) ?? []), x]);
          const nomesItens = [...porItem.keys()].map((k) => nomes[k]?.nome ?? "—");
          return (
            <article key={p.chave} className={`cm-ped ${p.m.tipo} ${aberto ? "aberto" : ""} ${!ativos.length ? "desfeito" : ""}`}>
              <button className="cm-ped-cabeca" aria-expanded={aberto} onClick={() => alternar(p.chave)}>
                <span className="cm-ped-sinal" aria-hidden="true">{sinal}</span>
                <span className="cm-ped-titulo">
                  <strong>{titulo}</strong>
                  <small>{diaCurto(p.m.quando)} · {porItem.size} {porItem.size === 1 ? "item" : "itens"}{!ativos.length ? " · desfeito" : ""}
                    {!aberto && <span className="cm-ped-resumo"> · {nomesItens.slice(0, 4).join(", ")}{nomesItens.length > 4 ? "…" : ""}</span>}</small>
                </span>
                <span className="cm-ped-seta" aria-hidden="true" />
              </button>
              <div className="cm-ped-corpo" hidden={!aberto}>
                <ul>
                  {[...porItem.entries()].sort((a, b) => (nomes[a[0]]?.nome ?? "").localeCompare(nomes[b[0]]?.nome ?? "")).map(([itemId, ms]) => {
                    const s = nomes[itemId];
                    const vivos = ms.filter((x) => !x.removido);
                    const soma = (vivos.length ? vivos : ms).reduce((t, x) => t + x.quantidade, 0);
                    const validades = ms.map((x) => x.validade).filter(Boolean) as string[];
                    const primeiro = ms[0];
                    return (
                      <li key={itemId} className={!vivos.length ? "desfeito" : ""}>
                        <span className="cm-ped-item">{s?.nome ?? "—"}</span>
                        <span className="cm-ped-val">{validades.length ? `val. ${validades.map((v) => dataVal(v).slice(0, 5)).join(", ")}` : p.m.tipo === "saida" ? "o que vence primeiro" : ""}</span>
                        <b className="cm-ped-qtd">{sinal}{s ? (soma === 0 && p.m.tipo === "contagem" ? "zerado" : qtd(s, soma).pri) : num(soma)}</b>
                        {vivos.length > 0 && (socio || primeiro.registrado_por === userId) ? <Desfazer id={primeiro.id} onPronto={onPronto} /> : <span />}
                      </li>
                    );
                  })}
                </ul>
                <p className="cm-ped-rodape">{quando(p.m.quando)} · {ORIGENS[p.m.origem] ?? p.m.origem}</p>
              </div>
            </article>
          );
        })}
      </div>
      {lista.length > mostrar && <button className="ghost cm-peds-mais" onClick={() => setMostrar((n) => n + 15)}>Mostrar mais ({lista.length - mostrar})</button>}
      <p className="muted es-nota">Desfazer não apaga: o movimento fica riscado e sai da conta. Numa contagem, desfaz todas as validades daquele item.</p>
    </section>
  );
}

// Painel lateral de um item: lotes por validade e últimos movimentos
function Painel({ it, hoje, movs, onFechar }: { it: Item; hoje: string; movs: Mov[]; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  const total = qtd(it, it.saldo);
  return (
    <div className="cm-fundo" onClick={onFechar}>
      <aside className="cm-painel" role="dialog" aria-modal="true" aria-label={it.nome} onClick={(e) => e.stopPropagation()}>
        <header className="cm-painel-topo">
          <div>
            <span className="es-sobre">Câmara fria</span>
            <h2>{it.nome}</h2>
          </div>
          <button className="ghost small" onClick={onFechar} aria-label="Fechar">✕</button>
        </header>
        <div className="cm-painel-total">
          <b>{it.saldo > 0 ? total.pri : "Sem estoque"}</b>{it.saldo > 0 && total.sec && <span>{total.sec}</span>}
          <small>contado em {diaCurto(it.contada_em)}{(it.entradas > 0 || it.saidas > 0) && ` · depois: +${qtd(it, it.entradas).pri} / −${qtd(it, it.saidas).pri}`}</small>
        </div>
        <h3>Por validade</h3>
        {it.lotes.length ? (
          <table className="cm-tabela">
            <thead><tr><th>Validade</th><th>Situação</th><th className="num">Quantidade</th></tr></thead>
            <tbody>
              {it.lotes.map((l) => {
                const p = prazo(l.validade, hoje);
                const q = qtd(it, l.quantidade);
                return (
                  <tr key={l.validade ?? "sem"} className={p.cls}>
                    <td>{l.validade ? dataVal(l.validade) : "—"}</td>
                    <td><span className={`cm-situacao ${p.cls}`}>{p.cls === "ok" ? (p.dias != null ? `faltam ${p.dias} dias` : "") : p.txt.replace(/ \(.*\)$/, "")}</span></td>
                    <td className="num"><b>{q.pri}</b>{q.sec && <small>{q.sec}</small>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num"><b>{total.pri}</b>{total.sec && <small>{total.sec}</small>}</td></tr></tfoot>
          </table>
        ) : <p className="muted">Sem estoque.</p>}
        {movs.length > 0 && (
          <>
            <h3>Últimos movimentos</h3>
            <ul className="cm-painel-movs">
              {movs.map((m) => (
                <li key={m.id}>
                  <span className={`cm-sinal ${m.tipo}`} aria-hidden="true">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}</span>
                  <span>{TIPOS[m.tipo]}{m.validade && ` · validade ${dataVal(m.validade)}`}<small>{quando(m.quando)}{m.destino ? ` · ${nomeDestino(m.destino)}` : ""}</small></span>
                  <b>{qtd(it, m.quantidade).pri}</b>
                </li>
              ))}
            </ul>
          </>
        )}
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
    setMsg(`${p.nome} tem o login criado. A equipe entra só em brasico.vercel.app/colaboradores, com usuário e senha (peça aos sócios).`);
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
