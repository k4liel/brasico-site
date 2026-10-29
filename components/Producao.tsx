"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
    : <TopoSimples email={userEmail} nome={nome} area="Produção" outra={{ href: "/estoque", nome: "Estoque" }} />;

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

  return (
    <div className="pagina">
      {topo}
      <main className="miolo tv es pd">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Produção</h1>
            <p>{plano ? <>{plano.nome}: {dataCurta(plano.inicio)} a {dataCurta(plano.fim)}. Marque cada tarefa ao terminar; o que for guardado na câmara fria entra no estoque.</> : "Nenhum plano de produção ativo."}</p>
          </div>
        </div>

        <div className="es-numeros">
          <div className="es-numero"><span className="tv-cartao-rotulo">Tarefas</span><span className="es-numero-valor">{feitas} de {deFazer.length}</span><span className="tv-cartao-detalhe">feitas</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Atrasadas</span><span className={atrasadas ? "es-numero-valor es-ruim" : "es-numero-valor"}>{atrasadas}</span><span className="tv-cartao-detalhe">dias que já passaram, sem marcar</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Repor na câmara</span><span className="es-numero-valor">{repor.length}</span><span className="tv-cartao-detalhe">itens abaixo do alvo</span></div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "hoje"} className={aba === "hoje" ? "on" : ""} onClick={() => setAba("hoje")}>Dia a dia</button>
          <button role="tab" aria-selected={aba === "cronograma"} className={aba === "cronograma" ? "on" : ""} onClick={() => setAba("cronograma")}>Cronograma</button>
          <button role="tab" aria-selected={aba === "metas"} className={aba === "metas" ? "on" : ""} onClick={() => setAba("metas")}>O que produzir</button>
          <button role="tab" aria-selected={aba === "repor"} className={aba === "repor" ? "on" : ""} onClick={() => setAba("repor")}>Repor a câmara</button>
        </div>

        {aba === "hoje" && (
          <section className="es-bloco">
            <div className="pd-dias" role="tablist" aria-label="Dia">
              {dias.map((d) => {
                const ts = tarefas.filter((t) => t.dia === d && t.tipo === "tarefa");
                const ok = ts.length > 0 && ts.every((t) => t.status !== "a_fazer");
                return (
                  <button key={d} role="tab" aria-selected={d === dia} className={[d === dia ? "on" : "", d === hoje() ? "hoje" : "", ok ? "ok" : ""].join(" ")} onClick={() => setDia(d)}>
                    {dataCurta(d)}
                  </button>
                );
              })}
            </div>
            <Dia tarefas={tarefas.filter((t) => t.dia === dia)} itens={itens} onMudou={carregar} />
          </section>
        )}

        {aba === "cronograma" && (
          <section className="es-bloco">
            {[...new Set(tarefas.map((t) => t.semana))].map((s) => {
              const ts = tarefas.filter((t) => t.semana === s);
              return (
                <div key={s} className="pd-semana">
                  <h3>{s} · {ts[0]?.semana_titulo}<small>{ts[0]?.entrega}</small></h3>
                  <div className="pd-grade">
                    {[...new Set(ts.map((t) => t.dia))].map((d) => (
                      <div key={d} className={d === hoje() ? "pd-dia hoje" : "pd-dia"}>
                        <button className="pd-dia-cabeca" onClick={() => { setDia(d); setAba("hoje"); }}>{dataCurta(d)}</button>
                        {ts.filter((t) => t.dia === d).map((t) => (
                          <p key={t.id} className={`pd-mini ${t.tipo} ${t.status}`}>
                            <span>{t.produto}</span>{t.quantidade_texto && <b>{t.quantidade_texto}</b>}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {aba === "metas" && (
          <section className="es-bloco">
            <div className="nf-tabela-wrap">
              <table className="nf-tabela">
                <thead><tr><th>Produto</th><th className="n">Total</th><th>Para cada casa</th><th>Na câmara agora</th></tr></thead>
                <tbody>
                  {metas.map((m, i) => {
                    const it = itens.find((x) => x.item_id === m.estoque_item_id);
                    return (
                      <Fragment key={m.id}>
                        {m.categoria !== metas[i - 1]?.categoria && <tr className="pd-cat"><td colSpan={4}>{m.categoria}</td></tr>}
                        <tr>
                          <td><strong>{m.produto}</strong><small>{m.detalhe}{m.ficha_casa ? " · ficha da casa" : ""}</small></td>
                          <td className="n">{m.total_texto} {m.unidade}</td>
                          <td>{m.destinos.map((d) => <span key={d.destino} className="pd-destino">{d.destino} <b>{d.texto}</b></span>)}</td>
                          <td>{it ? `${num(it.saldo)} ${unid(it.unidade, it.saldo)}` : <span className="muted">não é item da câmara</span>}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted es-nota">Copiado da aba 02 do projeto Produção Sempre Vivo. Folhas e tomate fresco não entram aqui: são comprados 1 a 2 dias antes de cada serviço.</p>
          </section>
        )}

        {aba === "repor" && (
          <section className="es-bloco">
            <div className="nf-tabela-wrap">
              <table className="nf-tabela">
                <thead><tr><th>Item</th><th className="n">Na câmara</th><th className="n">Sai por semana</th><th className="n">Mínimo</th><th className="n">Produzir</th></tr></thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.item_id}>
                      <td><strong>{i.nome}</strong></td>
                      <td className="n">{num(i.saldo)} {unid(i.unidade, i.saldo)}</td>
                      <td className="n">{i.saida_semanal ? num(i.saida_semanal) : "—"}</td>
                      <td className="n">{i.minimo != null ? num(i.minimo) : "—"}</td>
                      <td className="n">{i.repor > 0 ? <span className="es-ruim">{num(i.repor)} {unid(i.unidade, i.repor)}{i.pacote_tamanho && i.pacote_tamanho !== 1 ? <small>{num(Math.ceil(i.repor / i.pacote_tamanho))} {i.pacote_nome}s</small> : null}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted es-nota">Produzir = o maior entre o mínimo e a média de saídas das últimas 4 semanas, menos o que está na câmara.
              Enquanto as saídas não forem lançadas no Estoque, a conta usa só o mínimo.</p>
          </section>
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
    <div className={`pd-tarefa ${t.status}${t.atencao ? " atencao" : ""}`}>
      <button className="pd-tarefa-cabeca" onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
        <span><strong>{t.produto}</strong>{t.detalhe && <small>{t.detalhe}</small>}{t.observacao && <small className="pd-obs">“{t.observacao}”</small>}</span>
        <span className="pd-qtd">{t.quantidade_texto}</span>
        <span className={`estado ${t.status === "feito" ? "tv-ok" : t.status === "nao_feito" ? "es-ruim" : ""}`}>{STATUS[t.status]}{t.estoque_mov_id ? " · na câmara" : ""}</span>
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
          {item && total != null && <p className="et-resumo">Entram <strong>{num(total)} {unid(item.unidade, total)}</strong> de {item.nome} no estoque.</p>}
          {t.estoque_mov_id && <p className="muted et-resumo">Marcar de novo troca a entrada anterior no estoque (não soma duas vezes).</p>}
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
