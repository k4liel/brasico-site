"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";

// Produção (Operação · fase 5): o plano de produção dia a dia, copiado do projeto Produção Sempre Vivo
// (que continua como está). Quem produz marca cada tarefa e, se guardou na câmara fria, a quantidade
// vira entrada no estoque. Tabelas e funções em supabase/producao.sql.
type Plano = { id: string; nome: string; inicio: string; fim: string; origem: string | null };
type Tarefa = { id: number; semana: string; semana_titulo: string | null; entrega: string | null; dia: string; ordem: number;
  tipo: "tarefa" | "rotina" | "feriado"; atencao: boolean; produto: string; quantidade_texto: string | null; detalhe: string | null;
  status: Status; observacao: string | null; feito_em: string | null; estoque_item_id: string | null; estoque_mov_id: number | null };
type Status = "a_fazer" | "feito" | "parcial" | "nao_feito";
type Meta = { id: string; ordem: number; categoria: string | null; produto: string; total_texto: string | null; unidade: string | null;
  detalhe: string | null; destinos: { destino: string; texto: string }[]; ficha_casa: boolean; estoque_item_id: string | null };
type Item = { item_id: string; nome: string; unidade: string; pacote_nome: string; pacote_tamanho: number | null; saldo: number;
  minimo: number | null; ordem: number; saida_semanal: number; repor: number };

const STATUS: Record<Status, string> = { a_fazer: "a fazer", feito: "feito", parcial: "parcial", nao_feito: "não feito" };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const unid = (u: string, q: number) => (u === "porção" ? (q === 1 ? "porção" : "porções") : u);
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
const dataCurta = (d: string) => { const x = new Date(d + "T12:00:00"); return `${DIAS[x.getDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`; };
const sem = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Item da câmara que combina com a tarefa (pela palavra principal do nome): só uma sugestão, a pessoa troca
function sugerirItem(produto: string, itens: Item[]) {
  const p = sem(produto);
  return itens.find((i) => p.includes(sem(i.nome))) ?? itens.find((i) => p.includes(sem(i.nome).split(" ")[0]) && sem(i.nome).split(" ")[0].length > 4);
}

export default function Producao({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [aba, setAba] = useState<"hoje" | "cronograma" | "metas" | "repor">("hoje");
  const [dia, setDia] = useState(hoje());

  const carregar = useCallback(async () => {
    const { data: p } = await supabase.from("producao_planos").select("*").eq("ativo", true).order("inicio", { ascending: false }).limit(1);
    const pl = ((p ?? []) as Plano[])[0] ?? null;
    setPlano(pl);
    const [t, m, r] = await Promise.all([
      pl ? supabase.from("producao_tarefas").select("*").eq("plano_id", pl.id).eq("removido", false).order("dia").order("ordem") : Promise.resolve({ data: [] }),
      pl ? supabase.from("producao_metas").select("*").eq("plano_id", pl.id).eq("removido", false).order("ordem") : Promise.resolve({ data: [] }),
      supabase.from("producao_repor").select("*").order("ordem").order("nome"),
    ]);
    setTarefas((t.data ?? []) as Tarefa[]);
    setMetas((m.data ?? []) as Meta[]);
    setItens((r.data ?? []) as Item[]);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const [{ data: pode }, { data: eu }] = await Promise.all([supabase.rpc("estoque_pode", { p_user: userId }), supabase.rpc("operacao_eu")]);
      if (!pode) return setPapel(null);
      const r = (eu ?? {}) as { papel: string | null; pessoa: { nome: string } | null };
      setPapel(r.papel ?? "estoque");
      setNome(r.pessoa?.nome ?? "");
      carregar();
    })();
  }, [supabase, userId, carregar]);

  useEffect(() => {
    if (!papel) return;
    const canal = supabase.channel("producao").on("postgres_changes", { event: "*", schema: "public", table: "producao_tarefas" }, () => carregar()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, papel, carregar]);

  // Abre no dia de hoje se ele estiver no plano; senão no primeiro dia com tarefa a fazer
  useEffect(() => {
    if (!tarefas.length) return;
    const dias = [...new Set(tarefas.map((t) => t.dia))];
    if (!dias.includes(dia)) setDia(dias.find((d) => d >= hoje()) ?? dias[dias.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarefas.length]);

  const socio = papel === "socio";
  const topo = socio ? <Topo email={userEmail} ativo="producao" />
    : <TopoSimples email={userEmail} nome={nome} area="Produção" outra={{ href: "/estoque", nome: "Câmara fria" }} />;

  if (papel === undefined) return <div className="pagina"><main className="miolo"><p className="muted vazio">Carregando…</p></main></div>;
  if (papel === null) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="producao" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à produção.</p></main>
      </div>
    );
  }

  const deFazer = tarefas.filter((t) => t.tipo === "tarefa");
  const feitas = deFazer.filter((t) => t.status === "feito").length;
  const atrasadas = deFazer.filter((t) => t.status === "a_fazer" && t.dia < hoje()).length;
  const repor = itens.filter((i) => i.repor > 0);
  const dias = [...new Set(tarefas.map((t) => t.dia))];
  const pctGeral = deFazer.length ? Math.round((feitas / deFazer.length) * 100) : 0;
  const doDia = tarefas.filter((t) => t.dia === dia);
  const doDiaFazer = doDia.filter((t) => t.tipo === "tarefa");
  const semanas = [...new Set(tarefas.map((t) => t.semana))];
  const infoDia = doDia[0];
  const categorias = [...new Set(metas.map((m) => m.categoria ?? "Outros"))];
  const deHoje = tarefas.filter((t) => t.dia === hoje() && t.tipo === "tarefa");

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es pd nf-larga">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Produção</h1>
            <p>{plano ? <>{plano.nome}: {dataCurta(plano.inicio)} a {dataCurta(plano.fim)}. Marque cada tarefa ao terminar; o que for guardado na câmara fria entra no saldo dela.</> : "Nenhum plano de produção ativo."}</p>
          </div>
        </div>

        <div className="ip-numeros">
          <div className="ip-numero">
            <span className="ip-rotulo">Andamento do plano</span>
            <span className="ip-valor">{pctGeral}%</span>
            <span className="ip-var neutro">{feitas} de {deFazer.length} tarefas feitas</span>
            <span className="pd-progresso" aria-hidden="true"><span style={{ width: `${pctGeral}%` }} /></span>
          </div>
          <div className="ip-numero">
            <span className="ip-rotulo">Hoje · {dataCurta(hoje())}</span>
            <span className="ip-valor">{deHoje.length}</span>
            <span className="ip-var neutro">{deHoje.length ? `${deHoje.filter((t) => t.status !== "a_fazer").length} já marcadas` : "nada no plano hoje"}</span>
          </div>
          <div className="ip-numero">
            <span className="ip-rotulo">Atrasadas</span>
            <span className={atrasadas ? "ip-valor cf-alerta" : "ip-valor"}>{atrasadas}</span>
            <span className={atrasadas ? "ip-var sobe" : "ip-var neutro"}>{atrasadas ? "de dias que passaram sem marcar" : "nada atrasado"}</span>
          </div>
          <div className="ip-numero">
            <span className="ip-rotulo">Repor a câmara</span>
            <span className="ip-valor">{repor.length}</span>
            <span className="ip-var neutro">{repor.length ? repor.slice(0, 3).map((r) => r.nome).join(", ") : "tudo acima do alvo"}</span>
          </div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "hoje"} className={aba === "hoje" ? "on" : ""} onClick={() => setAba("hoje")}>Dia a dia</button>
          <button role="tab" aria-selected={aba === "cronograma"} className={aba === "cronograma" ? "on" : ""} onClick={() => setAba("cronograma")}>Cronograma</button>
          <button role="tab" aria-selected={aba === "metas"} className={aba === "metas" ? "on" : ""} onClick={() => setAba("metas")}>O que produzir</button>
          <button role="tab" aria-selected={aba === "repor"} className={aba === "repor" ? "on" : ""} onClick={() => setAba("repor")}>Repor a câmara</button>
        </div>

        {aba === "hoje" && (
          <>
            <div className="pd-faixa" role="tablist" aria-label="Dia">
              {dias.map((d) => {
                const ts = tarefas.filter((t) => t.dia === d && t.tipo === "tarefa");
                const marcadas = ts.filter((t) => t.status !== "a_fazer").length;
                const feriado = tarefas.some((t) => t.dia === d && t.tipo === "feriado");
                const x = new Date(`${d}T12:00:00`);
                const cls = ["pd-dia-chip", d === dia ? "on" : "", d === hoje() ? "hoje" : "", feriado ? "feriado" : "",
                  ts.length && marcadas === ts.length ? "ok" : "", d < hoje() && marcadas < ts.length ? "atraso" : ""].filter(Boolean).join(" ");
                return (
                  <button key={d} role="tab" aria-selected={d === dia} className={cls} onClick={() => setDia(d)} title={dataCurta(d)}>
                    <small>{DIAS[x.getDay()]}</small>
                    <b>{d.slice(8, 10)}</b>
                    <i aria-hidden="true">{ts.length ? <span style={{ width: `${(marcadas / ts.length) * 100}%` }} /> : null}</i>
                  </button>
                );
              })}
            </div>
            {infoDia && (
              <header className="pd-dia-cabeca2">
                <div>
                  <span className="es-sobre">{infoDia.semana} · {infoDia.semana_titulo}</span>
                  <h2>{new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</h2>
                  {infoDia.entrega && <p className="muted">{infoDia.entrega}</p>}
                </div>
                {doDiaFazer.length > 0 && <span className="pd-dia-conta"><b>{doDiaFazer.filter((t) => t.status !== "a_fazer").length}</b> de {doDiaFazer.length} marcadas</span>}
              </header>
            )}
            <Dia tarefas={doDia} itens={itens} onMudou={carregar} />
          </>
        )}

        {aba === "cronograma" && (
          <div className="pd-semanas">
            {semanas.map((s) => {
              const ts = tarefas.filter((t) => t.semana === s);
              const tf = ts.filter((t) => t.tipo === "tarefa");
              const pct = tf.length ? Math.round((tf.filter((t) => t.status === "feito").length / tf.length) * 100) : 0;
              return (
                <section key={s} className="pd-semana">
                  <header className="pd-semana-cabeca">
                    <span className="pd-semana-n">{s}</span>
                    <div><h3>{ts[0]?.semana_titulo}</h3><small>{dataCurta(ts[0].dia)} a {dataCurta(ts[ts.length - 1].dia)}{ts[0]?.entrega ? ` · ${ts[0].entrega}` : ""}</small></div>
                    <span className="pd-semana-pct"><b>{pct}%</b><span className="pd-progresso" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span></span>
                  </header>
                  <div className="pd-grade">
                    {[...new Set(ts.map((t) => t.dia))].map((d) => (
                      <button key={d} className={d === hoje() ? "pd-dia hoje" : "pd-dia"} onClick={() => { setDia(d); setAba("hoje"); }}>
                        <span className="pd-dia-titulo">{dataCurta(d)}</span>
                        {ts.filter((t) => t.dia === d).map((t) => (
                          <span key={t.id} className={`pd-mini ${t.tipo} ${t.status}`}>
                            <i aria-hidden="true" /><span>{t.produto}</span>{t.quantidade_texto && <b>{t.quantidade_texto}</b>}
                          </span>
                        ))}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {aba === "metas" && (
          <>
            {categorias.map((c) => (
              <section key={c} className="ft-secao">
                <h2>{c}<span className="muted">{metas.filter((m) => (m.categoria ?? "Outros") === c).length} produtos</span></h2>
                <div className="pd-metas">
                  {metas.filter((m) => (m.categoria ?? "Outros") === c).map((m) => {
                    const it = itens.find((x) => x.item_id === m.estoque_item_id);
                    return (
                      <article key={m.id} className="pd-meta">
                        <header><strong>{m.produto}</strong>{m.ficha_casa && <span className="cf-selo ok">ficha da casa</span>}</header>
                        <div className="cf-saldo"><b>{m.total_texto}</b><span>{m.unidade}</span></div>
                        {m.detalhe && <p className="cf-meta">{m.detalhe}</p>}
                        <ul className="pd-destinos">{m.destinos.map((d) => <li key={d.destino}><span>{d.destino}</span><b>{d.texto}</b></li>)}</ul>
                        {it && <p className="pd-na-camara">Na câmara agora: <b>{num(it.saldo)} {unid(it.unidade, it.saldo)}</b></p>}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="muted es-nota">Copiado da aba 02 do projeto Produção Sempre Vivo. Folhas e tomate fresco não entram aqui: são comprados 1 a 2 dias antes de cada serviço.</p>
          </>
        )}

        {aba === "repor" && (
          <>
            <div className="cf-itens">
              {[...itens].sort((a, b) => b.repor - a.repor).map((i) => {
                const falta = i.repor > 0;
                return (
                  <article key={i.item_id} className={falta ? "cf-item falta" : "cf-item ok"}>
                    <header><strong>{i.nome}</strong><span className={falta ? "cf-selo falta" : "cf-selo ok"}>{falta ? "produzir" : "em dia"}</span></header>
                    <div className="cf-saldo">{falta ? <><b>{num(i.repor)}</b><span>{unid(i.unidade, i.repor)} a produzir</span></> : <><b>{num(i.saldo)}</b><span>{unid(i.unidade, i.saldo)} na câmara</span></>}</div>
                    <p className="cf-meta">
                      {falta && <span>na câmara {num(i.saldo)}</span>}
                      {i.minimo != null && <span>mínimo {num(i.minimo)}</span>}
                      {i.saida_semanal > 0 && <span>sai {num(i.saida_semanal)} por semana</span>}
                      {falta && i.pacote_tamanho && i.pacote_tamanho !== 1 && <span>{num(Math.ceil(i.repor / i.pacote_tamanho))} {i.pacote_nome}s</span>}
                    </p>
                  </article>
                );
              })}
            </div>
            <p className="muted es-nota">Produzir = o maior entre o mínimo e a média de saídas das últimas 4 semanas, menos o que está na câmara.
              Enquanto as saídas não forem lançadas na Câmara fria, a conta usa só o mínimo.</p>
          </>
        )}
      </main>
    </div>
  );
}

function Dia({ tarefas, itens, onMudou }: { tarefas: Tarefa[]; itens: Item[]; onMudou: () => void }) {
  if (!tarefas.length) return <p className="muted">Nada neste dia.</p>;
  if (tarefas[0].tipo === "feriado") return <p className="pd-feriado">Feriado</p>;
  return (
    <div className="pd-tarefas">
      {tarefas.map((t) => (t.tipo === "rotina"
        ? <p key={t.id} className="pd-rotina">{t.produto}{t.detalhe ? ` · ${t.detalhe}` : ""}</p>
        : <TarefaLinha key={t.id} t={t} itens={itens} onMudou={onMudou} />))}
    </div>
  );
}

function TarefaLinha({ t, itens, onMudou }: { t: Tarefa; itens: Item[]; onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [aberta, setAberta] = useState(false);
  const [itemId, setItemId] = useState(t.estoque_item_id ?? sugerirItem(t.produto, itens)?.item_id ?? "");
  const [qtd, setQtd] = useState("");
  const [emPacotes, setEmPacotes] = useState(true);
  const [obs, setObs] = useState(t.observacao ?? "");
  const [msg, setMsg] = useState("");
  const item = itens.find((i) => i.item_id === itemId);
  const temPacote = !!item?.pacote_tamanho && item.pacote_tamanho !== 1;
  const n = Number(qtd.replace(",", "."));
  const total = item && qtd.trim() && !Number.isNaN(n) ? (temPacote && emPacotes ? n * item.pacote_tamanho! : n) : null;

  async function marcar(status: Status) {
    setMsg("");
    const { error } = await supabase.rpc("producao_tarefa_marcar", { p_tarefa: t.id, p_status: status, p_observacao: obs,
      p_item: total ? itemId || null : null, p_quantidade: total });
    if (error) return setMsg(error.message);
    setAberta(false); setQtd("");
    onMudou();
  }

  return (
    <div className={`pd-tarefa ${t.status}${t.atencao ? " atencao" : ""}${aberta ? " aberto" : ""}`}>
      <button className="pd-tarefa-cabeca" onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
        <span className={`pd-marca ${t.status}`} aria-hidden="true" />
        <span><strong>{t.produto}</strong>{t.detalhe && <small>{t.detalhe}</small>}{t.observacao && <small className="pd-obs">“{t.observacao}”</small>}</span>
        <span className="pd-qtd">{t.quantidade_texto}</span>
        <span className={`estado ${t.status === "feito" ? "tv-ok" : t.status === "nao_feito" ? "es-ruim" : ""}`}>{STATUS[t.status]}{t.estoque_mov_id ? " · na câmara" : ""}</span>
        <span className="ip-seta" aria-hidden="true" />
      </button>
      {aberta && (
        <div className="pd-marcar">
          <div className="nf-campos et-campos">
            <label>Guardei na câmara (opcional)
              <select value={itemId} onChange={(v) => setItemId(v.target.value)}>
                <option value="">Não vai para a câmara</option>
                {itens.map((i) => <option key={i.item_id} value={i.item_id}>{i.nome}</option>)}
              </select>
            </label>
            {itemId && (
              <label>Quantidade{temPacote && emPacotes ? ` (${item!.pacote_nome}s)` : item ? ` (${unid(item.unidade, 2)})` : ""}
                <input inputMode="decimal" value={qtd} onChange={(v) => setQtd(v.target.value)} placeholder="0" />
              </label>
            )}
            {itemId && temPacote && (
              <label className="et-check"><input type="checkbox" checked={emPacotes} onChange={(v) => setEmPacotes(v.target.checked)} />
                Contar em {item!.pacote_nome}s ({num(item!.pacote_tamanho)} {unid(item!.unidade, item!.pacote_tamanho!)} cada)</label>
            )}
            <label>Observação
              <input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="rendeu menos, faltou insumo…" />
            </label>
          </div>
          {item && total != null && <p className="et-resumo">Entram <strong>{num(total)} {unid(item.unidade, total)}</strong> de {item.nome} na câmara fria.</p>}
          {t.estoque_mov_id && <p className="muted et-resumo">Marcar de novo troca a entrada anterior na câmara fria (não soma duas vezes).</p>}
          {msg && <p className="es-aviso">{msg}</p>}
          <div className="pd-botoes">
            <button onClick={() => marcar("feito")}>Feito</button>
            <button className="ghost" onClick={() => marcar("parcial")}>Parcial</button>
            <button className="ghost" onClick={() => marcar("nao_feito")}>Não feito</button>
            {t.status !== "a_fazer" && <button className="ghost" onClick={() => marcar("a_fazer")}>Voltar para a fazer</button>}
          </div>
        </div>
      )}
    </div>
  );
}
