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
// Destinos que não recebem mais saídas (o nome continua valendo no histórico): o Midway encerrou em 31/10/2026
const DESTINOS_ENCERRADOS = new Set(["midway"]);
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
function qtd(s: Saldo, q: number) {
  if (temPacote(s)) return { pri: `${num(q / Number(s.pacote_tamanho))} ${pct(s)}`, sec: `${num(q)} ${unid(s, q)}` };
  return { pri: `${num(q)} ${unid(s, q)}`, sec: "" };
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

export default function Estoque({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  const [compras, setCompras] = useState(false);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [aba, setAba] = useState<"estoque" | "registrar" | "movimentos" | "pessoas">("estoque");
  const [reg, setReg] = useState<{ item: string; tipo: Tipo; n: number }>({ item: "", tipo: "entrada", n: 0 });
  const [filtro, setFiltro] = useState<"todos" | "vencido" | "logo" | "minimo">("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    const [s, l, m] = await Promise.all([
      supabase.from("estoque_saldo").select("*").order("ordem").order("nome"),
      supabase.from("estoque_lotes").select("item_id,validade,quantidade"),
      supabase.from("estoque_movimentos").select("*").order("quando", { ascending: false }).order("id", { ascending: false }).limit(300),
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

  // Registros de outras pessoas aparecem na hora
  useEffect(() => {
    if (!papel) return;
    const canal = supabase.channel("estoque").on("postgres_changes", { event: "*", schema: "public", table: "estoque_movimentos" }, () => carregar()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, papel, carregar]);

  const itens: Item[] = useMemo(() => saldos.map((s) => ({
    ...s,
    lotes: lotes.filter((l) => l.item_id === s.item_id).sort((a, b) => (a.validade ?? "9999").localeCompare(b.validade ?? "9999")),
  })), [saldos, lotes]);

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

  // Lotes que pedem atenção: vencidos e os que vencem nos próximos 7 dias
  const atencao = itens.flatMap((it) => it.lotes.filter((l) => l.quantidade > 0).map((l) => ({ it, l, p: prazo(l.validade, hoje) })))
    .filter((x) => x.p.cls === "vencido" || x.p.cls === "logo")
    .sort((a, b) => (a.l.validade ?? "").localeCompare(b.l.validade ?? ""));
  const vencidos = atencao.filter((x) => x.p.cls === "vencido");
  const logo = atencao.filter((x) => x.p.cls === "logo");
  const abaixo = itens.filter((s) => s.minimo != null && s.saldo < s.minimo);
  const comSaldo = itens.filter((s) => s.saldo > 0);
  const ultimaContagem = saldos.map((s) => s.contada_em).filter(Boolean).sort().pop() ?? null;
  const temLote = (it: Item, cls: Prazo["cls"]) => it.lotes.some((l) => l.quantidade > 0 && prazo(l.validade, hoje).cls === cls);

  const termo = busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const passa = (it: Item) =>
    (!termo || it.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(termo)) &&
    (filtro === "todos" || (filtro === "vencido" && temLote(it, "vencido")) || (filtro === "logo" && temLote(it, "logo")) ||
      (filtro === "minimo" && it.minimo != null && it.saldo < it.minimo));
  let inicio = 0;
  const grupos = GRUPOS.map((g) => {
    const doGrupo = itens.filter((s) => s.ordem >= inicio && s.ordem < g.ate && passa(s));
    inicio = g.ate;
    return { ...g, comSaldo: doGrupo.filter((s) => s.saldo !== 0), zerados: doGrupo.filter((s) => s.saldo === 0) };
  }).filter((g) => g.comSaldo.length || (g.zerados.length && filtro === "todos"));

  const registrar = (item: string, tipo: Tipo) => {
    setReg((r) => ({ item, tipo, n: r.n + 1 }));
    setAberto(null);
    setAba("registrar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const itemAberto = itens.find((i) => i.item_id === aberto) ?? null;

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es et nf-larga cm">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Câmara fria</h1>
            <p>Cada item com o total e quanto tem de cada validade. O que vence primeiro sai primeiro.</p>
          </div>
        </div>

        <div className="ip-numeros cm-numeros">
          <div className="ip-numero"><span className="ip-rotulo">Itens com estoque</span><span className="ip-valor">{comSaldo.length}</span>
            <span className="ip-var neutro">{num(comSaldo.reduce((t, s) => t + s.lotes.length, 0))} lotes · contado em {diaCurto(ultimaContagem)}</span></div>
          <button className={`ip-numero cm-num-botao ${vencidos.length ? "cm-num-ruim" : ""}`} onClick={() => { setAba("estoque"); setFiltro("vencido"); }}>
            <span className="ip-rotulo">Vencidos</span><span className="ip-valor">{vencidos.length}</span>
            <span className="ip-var neutro">{vencidos.length ? `${vencidos.length === 1 ? "lote" : "lotes"} para tirar da câmara` : "nenhum lote vencido"}</span></button>
          <button className={`ip-numero cm-num-botao ${logo.length ? "cm-num-atencao" : ""}`} onClick={() => { setAba("estoque"); setFiltro("logo"); }}>
            <span className="ip-rotulo">Vencem em {LOGO} dias</span><span className="ip-valor">{logo.length}</span>
            <span className="ip-var neutro">{logo.length ? "usar primeiro" : "nada perto de vencer"}</span></button>
          <button className={`ip-numero cm-num-botao ${abaixo.length ? "cm-num-atencao" : ""}`} onClick={() => { setAba("estoque"); setFiltro("minimo"); }}>
            <span className="ip-rotulo">Abaixo do mínimo</span><span className="ip-valor">{abaixo.length}</span>
            <span className="ip-var neutro">{abaixo.length ? abaixo.slice(0, 3).map((s) => s.nome).join(", ") : "nada faltando"}</span></button>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "estoque"} className={aba === "estoque" ? "on" : ""} onClick={() => setAba("estoque")}>Estoque</button>
          <button role="tab" aria-selected={aba === "registrar"} className={aba === "registrar" ? "on" : ""} onClick={() => setAba("registrar")}>Registrar</button>
          <button role="tab" aria-selected={aba === "movimentos"} className={aba === "movimentos" ? "on" : ""} onClick={() => setAba("movimentos")}>Movimentos</button>
          {socio && <button role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "on" : ""} onClick={() => setAba("pessoas")}>Quem registra</button>}
        </div>

        {aba === "estoque" && (
          <>
            {atencao.length > 0 && filtro === "todos" && !termo && (
              <section className="cm-atencao" aria-label="Validades que pedem atenção">
                <h2>Pede atenção</h2>
                <ul>
                  {atencao.map(({ it, l, p }) => {
                    const q = qtd(it, l.quantidade);
                    return (
                      <li key={`${it.item_id}-${l.validade}`}>
                        <button className={`cm-aviso ${p.cls}`} onClick={() => setAberto(it.item_id)}>
                          <i aria-hidden="true" />
                          <span className="cm-aviso-nome"><strong>{it.nome}</strong><small>{q.pri}{q.sec && ` · ${q.sec}`}</small></span>
                          <span className="cm-aviso-prazo">{p.txt}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="cm-ferramentas">
              <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Procurar item…" aria-label="Procurar item" />
              <div className="ft-chips" role="tablist" aria-label="Filtro">
                {([["todos", "Todos", itens.length], ["vencido", "Vencidos", vencidos.length], ["logo", `Vencem em ${LOGO} dias`, logo.length], ["minimo", "Abaixo do mínimo", abaixo.length]] as const).map(([k, t, n]) => (
                  <button key={k} role="tab" aria-selected={filtro === k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{t}<span>{n}</span></button>
                ))}
              </div>
            </div>

            <div className="cm-legenda" aria-hidden="true">
              <span><i className="vencido" />vencido</span><span><i className="logo" />vence em até {LOGO} dias</span><span><i className="ok" />dentro da validade</span><span><i className="sem" />sem validade</span>
            </div>

            {grupos.map((g) => (
              <section key={g.nome} className="cm-grupo">
                <h2>{g.nome}<span>{g.comSaldo.length} com estoque</span></h2>
                {g.comSaldo.length > 0 && (
                  <ul className="cm-lista">
                    {g.comSaldo.map((it) => <Linha key={it.item_id} it={it} hoje={hoje} onAbrir={() => setAberto(it.item_id)} />)}
                  </ul>
                )}
                {g.zerados.length > 0 && (
                  <p className="cm-zerados">Sem estoque: {g.zerados.map((z, i) => (
                    <span key={z.item_id}>{i > 0 && ", "}<button onClick={() => setAberto(z.item_id)}>{z.nome}</button></span>
                  ))}</p>
                )}
              </section>
            ))}
            {!grupos.length && <p className="muted vazio">Nenhum item com esse filtro.</p>}
          </>
        )}

        {aba === "registrar" && <Registrar key={reg.n} itens={itens} hoje={hoje} inicial={reg.item} tipoInicial={reg.tipo} onPronto={carregar} />}

        {aba === "movimentos" && <Movimentos movs={movs} itens={itens} hoje={hoje} socio={socio} userId={userId} onPronto={carregar} />}

        {aba === "pessoas" && socio && <QuemRegistra />}
      </main>

      {itemAberto && (
        <Painel it={itemAberto} hoje={hoje} movs={movs.filter((m) => m.item_id === itemAberto.item_id && !m.removido).slice(0, 12)}
          onFechar={() => setAberto(null)} onRegistrar={(t) => registrar(itemAberto.item_id, t)} />
      )}
    </div>
  );
}

// Uma linha do estoque: nome, total, barra dos lotes e um selo por validade
function Linha({ it, hoje, onAbrir }: { it: Item; hoje: string; onAbrir: () => void }) {
  const total = qtd(it, it.saldo);
  const positivos = it.lotes.filter((l) => l.quantidade > 0);
  const soma = positivos.reduce((t, l) => t + l.quantidade, 0) || 1;
  const baixo = it.minimo != null && it.saldo < it.minimo;
  return (
    <li>
      <button className="cm-item" onClick={onAbrir}>
        <span className="cm-item-nome">
          <strong>{it.nome}</strong>
          <small>{it.lotes.length} {it.lotes.length === 1 ? "validade" : "validades"}{it.minimo != null && ` · mínimo ${num(it.minimo)}`}</small>
          {baixo && <em className="cm-selo-min">abaixo do mínimo</em>}
        </span>
        <span className="cm-item-total">
          <b>{total.pri}</b>{total.sec && <small>{total.sec}</small>}
          <span className="cm-barra" aria-hidden="true">
            {positivos.map((l) => <i key={l.validade ?? "sem"} className={prazo(l.validade, hoje).cls} style={{ flexGrow: l.quantidade / soma }} />)}
          </span>
        </span>
        <span className="cm-lotes">
          {it.lotes.map((l) => {
            const p = prazo(l.validade, hoje);
            return (
              <span key={l.validade ?? "sem"} className={`cm-lote ${p.cls}`} title={p.txt}>
                <b>{qtd(it, l.quantidade).pri}</b><span>{p.curto}</span>
              </span>
            );
          })}
        </span>
      </button>
    </li>
  );
}

// Painel lateral de um item: lotes por validade, ações e últimos movimentos
function Painel({ it, hoje, movs, onFechar, onRegistrar }: { it: Item; hoje: string; movs: Mov[]; onFechar: () => void; onRegistrar: (t: Tipo) => void }) {
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
          <b>{total.pri}</b>{total.sec && <span>{total.sec}</span>}
          <small>contado em {diaCurto(it.contada_em)}{(it.entradas > 0 || it.saidas > 0) && ` · depois: +${num(it.entradas)} / −${num(it.saidas)}`}</small>
        </div>
        <div className="cm-acoes">
          <button onClick={() => onRegistrar("entrada")}>+ Entrada</button>
          <button className="ghost" onClick={() => onRegistrar("saida")}>− Saída</button>
          <button className="ghost" onClick={() => onRegistrar("contagem")}>= Contar</button>
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
                  <span>{TIPOS[m.tipo]}{m.validade && ` · validade ${dataVal(m.validade)}`}<small>{quando(m.quando)}{m.destino ? ` · ${DESTINOS[m.destino] ?? m.destino}` : ""}</small></span>
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

type LinhaLote = { qtd: string; validade: string };

function Registrar({ itens, hoje, inicial, tipoInicial, onPronto }: { itens: Item[]; hoje: string; inicial: string; tipoInicial: Tipo; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [itemId, setItemId] = useState(inicial);
  const [emPacotes, setEmPacotes] = useState(true);
  const [qtdTxt, setQtdTxt] = useState("");
  const [validade, setValidade] = useState("");
  const [lote, setLote] = useState(""); // saída: "" = o que vence primeiro
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");
  const [linhas, setLinhas] = useState<LinhaLote[]>([]);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);
  const item = itens.find((s) => s.item_id === itemId);
  const pac = !!item && temPacote(item) && emPacotes;
  const fator = pac ? Number(item!.pacote_tamanho) : 1;
  const nomeQtd = pac ? `${pct(item!)}` : item ? unid(item, 2) : "";
  const ler = (t: string) => { const n = Number(t.replace(",", ".")); return t.trim() && !Number.isNaN(n) ? n * fator : null; };

  // Contagem: começa com os lotes que o item tem hoje
  const preencher = useCallback((it: Item | undefined, emPac: boolean) => {
    if (!it) return setLinhas([{ qtd: "", validade: "" }]);
    const f = temPacote(it) && emPac ? Number(it.pacote_tamanho) : 1;
    const ls = it.lotes.filter((l) => l.quantidade > 0).map((l) => ({ qtd: String(Number((l.quantidade / f).toFixed(2))).replace(".", ","), validade: l.validade ?? "" }));
    setLinhas(ls.length ? ls : [{ qtd: "", validade: "" }]);
  }, []);
  useEffect(() => { if (tipo === "contagem") preencher(item, emPacotes); }, [tipo, itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = tipo === "contagem" ? linhas.reduce((t, l) => t + (ler(l.qtd) ?? 0), 0) : ler(qtdTxt);
  const depois = item && total != null ? (tipo === "contagem" ? total : item.saldo + (tipo === "entrada" ? total : -total)) : null;
  const loteEscolhido = item?.lotes.find((l) => (l.validade ?? "") === lote && lote !== "");

  function trocarPacotes(v: boolean) {
    if (tipo === "contagem" && item && temPacote(item)) {
      const f = Number(item.pacote_tamanho);
      setLinhas((ls) => ls.map((l) => {
        const n = Number(l.qtd.replace(",", "."));
        if (!l.qtd.trim() || Number.isNaN(n)) return l;
        return { ...l, qtd: String(Number((v ? n / f : n * f).toFixed(2))).replace(".", ",") };
      }));
    }
    setEmPacotes(v);
  }

  async function registrar() {
    setMsg(""); setOk("");
    if (!item) return setMsg("Escolha o item.");
    setEnviando(true);
    let error: { message: string } | null = null;
    if (tipo === "contagem") {
      const lotes = linhas.filter((l) => l.qtd.trim()).map((l) => ({ quantidade: ler(l.qtd), validade: l.validade || null }));
      if (lotes.some((l) => l.quantidade == null || l.quantidade < 0)) { setEnviando(false); return setMsg("Confira as quantidades."); }
      if (lotes.some((l) => !l.validade) && !confirm("Há lote sem validade. Gravar assim mesmo?")) { setEnviando(false); return; }
      const datas = lotes.map((l) => l.validade ?? "");
      if (new Set(datas).size !== datas.length) { setEnviando(false); return setMsg("Duas linhas com a mesma validade: some as quantidades numa linha só."); }
      ({ error } = await supabase.rpc("estoque_contar", { p_item: item.item_id, p_lotes: lotes, p_observacao: obs }));
    } else {
      if (total == null || total <= 0) { setEnviando(false); return setMsg("Informe a quantidade."); }
      if (tipo === "entrada" && !validade) { setEnviando(false); return setMsg("Informe a validade que está na etiqueta."); }
      if (tipo === "saida" && !destino) { setEnviando(false); return setMsg("Escolha para onde foi."); }
      ({ error } = await supabase.rpc("estoque_registrar_lote", { p_item: item.item_id, p_tipo: tipo, p_quantidade: total,
        p_validade: tipo === "entrada" ? validade : lote || null, p_destino: tipo === "saida" ? destino : "", p_observacao: obs }));
    }
    setEnviando(false);
    if (error) return setMsg(error.message);
    setOk(`${TIPOS[tipo]} registrada: ${qtd(item, total ?? 0).pri} de ${item.nome}.`);
    setQtdTxt(""); setObs(""); setValidade(""); setLote("");
    onPronto();
  }

  return (
    <div className="av cf-registro cm-registro">
      <div className="av-principal">
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">1</span><div><h3>O que aconteceu</h3><p className="muted">guardou, tirou ou contou</p></div></header>
          <div className="et-tipos" role="radiogroup" aria-label="Tipo de movimento">
            {(Object.keys(TIPOS) as Tipo[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} className={tipo === t ? `on ${t}` : t} onClick={() => setTipo(t)}>
                <span className="et-tipo-sinal" aria-hidden="true">{t === "entrada" ? "+" : t === "saida" ? "−" : "="}</span>
                {TIPOS[t]}<small>{t === "entrada" ? "guardei na câmara" : t === "saida" ? "tirei da câmara" : "contei o que tem"}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">2</span><div><h3>O item</h3><p className="muted">{tipo === "contagem" ? "uma linha para cada validade" : "quantidade e validade da etiqueta"}</p></div></header>
          <div className="av-campos">
            <label className="av-largo">Item
              <select value={itemId} onChange={(v) => { setItemId(v.target.value); setLote(""); }}>
                <option value="">Escolha…</option>
                {itens.map((s) => <option key={s.item_id} value={s.item_id}>{s.nome} · hoje {qtd(s, s.saldo).pri}</option>)}
              </select>
            </label>
            {item && temPacote(item) && (
              <label className="et-check av-largo"><input type="checkbox" checked={emPacotes} onChange={(v) => trocarPacotes(v.target.checked)} />
                Contar em {item.pacote_nome}s ({num(item.pacote_tamanho)} {unid(item, Number(item.pacote_tamanho))} cada)</label>
            )}

            {tipo !== "contagem" && (
              <>
                <label>Quantidade{nomeQtd && ` (${nomeQtd})`}
                  <input inputMode="decimal" value={qtdTxt} onChange={(v) => setQtdTxt(v.target.value)} placeholder="0" />
                </label>
                {tipo === "entrada" ? (
                  <label>Validade (da etiqueta)
                    <input type="date" value={validade} min={hoje} onChange={(v) => setValidade(v.target.value)} />
                  </label>
                ) : (
                  <label>De qual validade
                    <select value={lote} onChange={(v) => setLote(v.target.value)}>
                      <option value="">A que vence primeiro (automático)</option>
                      {item?.lotes.filter((l) => l.quantidade > 0 && l.validade).map((l) => (
                        <option key={l.validade!} value={l.validade!}>{dataVal(l.validade!)} · {qtd(item, l.quantidade).pri}</option>
                      ))}
                    </select>
                  </label>
                )}
                {tipo === "saida" && (
                  <label>Para onde foi
                    <select value={destino} onChange={(v) => setDestino(v.target.value)}>
                      <option value="">Escolha…</option>
                      {Object.entries(DESTINOS).filter(([k]) => !DESTINOS_ENCERRADOS.has(k)).map(([k, d]) => <option key={k} value={k}>{d}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}

            {tipo === "contagem" && item && (
              <div className="av-largo cm-linhas">
                <div className="cm-linha cm-linha-cabeca" aria-hidden="true"><span>Quantidade ({nomeQtd})</span><span>Validade</span><span /></div>
                {linhas.map((l, i) => {
                  const p = l.validade ? prazo(l.validade, hoje) : null;
                  return (
                    <div key={i} className="cm-linha">
                      <input inputMode="decimal" value={l.qtd} placeholder="0" aria-label={`Quantidade do lote ${i + 1}`}
                        onChange={(v) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, qtd: v.target.value } : x)))} />
                      <span className="cm-linha-val">
                        <input type="date" value={l.validade} aria-label={`Validade do lote ${i + 1}`}
                          onChange={(v) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, validade: v.target.value } : x)))} />
                        {p && p.cls !== "ok" && <small className={`cm-situacao ${p.cls}`}>{p.curto}</small>}
                      </span>
                      <button type="button" className="ghost small" aria-label="Tirar esta linha"
                        onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ qtd: "", validade: "" }]))}>✕</button>
                    </div>
                  );
                })}
                <button type="button" className="ghost small cm-mais" onClick={() => setLinhas((ls) => [...ls, { qtd: "", validade: "" }])}>+ Outra validade</button>
                <p className="muted cm-nota">A contagem substitui tudo o que o sistema tinha deste item. Deixe em branco ou tire as linhas que acabaram.</p>
              </div>
            )}

            <label className="av-largo">Observação<input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="opcional" /></label>
          </div>
        </section>
      </div>
      <aside className="av-lado">
        <section className="av-bloco av-resumo">
          <div className="av-total"><span>{item ? item.nome : "Escolha um item"}</span><b>{item ? qtd(item, item.saldo).pri : "—"}</b></div>
          {item && total != null && depois != null && (
            <p className="cf-depois">
              {tipo === "contagem" ? "O total passa a ser" : tipo === "entrada" ? `Entram ${qtd(item, total).pri} e o total fica` : `Saem ${qtd(item, total).pri} e o total fica`}
              <b className={depois < 0 ? "es-ruim" : ""}>{qtd(item, depois).pri}</b>
            </p>
          )}
          {tipo === "saida" && loteEscolhido && total != null && total > loteEscolhido.quantidade && (
            <p className="tv-alerta">Esse lote tem só {qtd(item!, loteEscolhido.quantidade).pri}.</p>
          )}
          {tipo === "entrada" && validade && prazo(validade, hoje).cls !== "ok" && (
            <p className="tv-alerta">Atenção: {prazo(validade, hoje).txt}.</p>
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

// Movimentos: a contagem aparece numa linha só, com cada validade
function Movimentos({ movs, itens, hoje, socio, userId, onPronto }: { movs: Mov[]; itens: Item[]; hoje: string; socio: boolean; userId: string; onPronto: () => void }) {
  const nomes = Object.fromEntries(itens.map((s) => [s.item_id, s]));
  const blocos: { chave: string; m: Mov; lotes: Mov[] }[] = [];
  for (const m of movs) {
    const chave = m.tipo === "contagem" ? `c|${m.item_id}|${m.quando}` : `m|${m.id}`;
    const b = blocos.find((x) => x.chave === chave);
    if (b) b.lotes.push(m); else blocos.push({ chave, m, lotes: [m] });
  }
  return (
    <section className="sf-andamento cf-movs">
      <h3>Últimos movimentos</h3>
      {!blocos.length ? <p className="muted">Nenhum movimento ainda.</p> : (
        <ol className="sf-linha-tempo">
          {blocos.map(({ chave, m, lotes }) => {
            const s = nomes[m.item_id];
            const soma = lotes.reduce((t, x) => t + x.quantidade, 0);
            return (
              <li key={chave} className={`cf-mov ${m.tipo} ${m.removido ? "desfeito" : ""}`}>
                <span className="cf-mov-sinal" aria-hidden="true">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}</span>
                <div className="cf-mov-corpo">
                  <div>
                    <strong>{TIPOS[m.tipo]} · {s?.nome ?? "—"}</strong>
                    <small>{quando(m.quando)} · {ORIGENS[m.origem] ?? m.origem}{m.destino ? ` · para ${DESTINOS[m.destino] ?? m.destino}` : ""}
                      {m.tipo !== "contagem" && (m.validade ? ` · validade ${dataVal(m.validade)}` : m.tipo === "saida" ? " · da que vence primeiro" : "")}{m.removido ? " · desfeito" : ""}</small>
                    {m.tipo === "contagem" && s && lotes.some((x) => x.validade) && (
                      <span className="cm-lotes cm-lotes-mov">
                        {lotes.slice().sort((a, b) => (a.validade ?? "9").localeCompare(b.validade ?? "9")).map((x) => {
                          const p = prazo(x.validade, hoje);
                          return <span key={x.id} className={`cm-lote ${p.cls}`}><b>{qtd(s, x.quantidade).pri}</b><span>{x.validade ? dataVal(x.validade).slice(0, 5) : "sem validade"}</span></span>;
                        })}
                      </span>
                    )}
                    {m.observacao && lotes.length === 1 && <small className="cf-obs">{m.observacao}</small>}
                  </div>
                  <span className="cf-mov-qtd">{m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "="}{s ? qtd(s, soma).pri : num(soma)}</span>
                  {!m.removido && (socio || m.registrado_por === userId) && <Desfazer id={m.id} onPronto={onPronto} />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted es-nota">Desfazer não apaga: o movimento fica riscado e sai da conta. Numa contagem, desfaz todas as validades dela.</p>
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
