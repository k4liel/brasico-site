"use client";

// Banco de compensas (09/11/2026; supabase/escala_compensas.sql). Uma compensa nasce quando se marca que a pessoa
// trabalhou num feriado (vale 60 dias); a folga compensada (FC) da escala usa a mais antiga e só grava se houver
// compensa em aberto. Na escala fica só um botão com o número (no canto da barra); ele abre um painel lateral com
// os números, os feriados a confirmar, o saldo de cada pessoa, o histórico e (sócios) o lançamento de saldo antigo.
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Gaveta from "./Gaveta";

export type Compensa = { id: number; origem: "feriado" | "ajuste"; feriado: string | null; motivo: string; vence_em: string | null; situacao: "aberta" | "usada" | "cancelada"; usada_dia: string | null };
export type PessoaComp = { cliente_id: number; id: number; nome: string; local: string; setor: string; compensas: Compensa[]; a_confirmar: { dia: string; entrada: string | null; saida: string | null }[] };
export type CompDados = { hoje: string; socio: boolean; gerencia?: boolean; feriados: { dia: string; nome: string; origem: string }[]; pessoas: PessoaComp[] };

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diasAte = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);
const iniciais = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

// Situação de uma compensa em aberto pelo prazo
export function prazo(c: Compensa, hoje: string): "vencida" | "vencendo" | "ok" {
  if (!c.vence_em) return "ok";
  const n = diasAte(hoje, c.vence_em);
  return n < 0 ? "vencida" : n <= 10 ? "vencendo" : "ok";
}
function textoPrazo(c: Compensa, hoje: string) {
  if (!c.vence_em) return "sem prazo";
  const n = diasAte(hoje, c.vence_em);
  return n < 0 ? `venceu há ${-n} ${-n === 1 ? "dia" : "dias"}` : n === 0 ? "vence hoje" : `${n} ${n === 1 ? "dia" : "dias"} · até ${br(c.vence_em)}`;
}

type Aba = "confirmar" | "aberto" | "historico" | "lancar";

export default function EscalaCompensas({ supabase, dados, local, nomeDe, onMudou }: {
  supabase: SupabaseClient; dados: CompDados; local: string;
  nomeDe: (cliente: number, id: number, nome: string) => string; onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>("aberto");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [lancar, setLancar] = useState({ chave: "", qtd: "1", motivo: "" });
  const gerencia = dados.gerencia ?? dados.socio;
  const nomeFer = new Map(dados.feriados.map((f) => [f.dia, f.nome]));
  const pessoas = dados.pessoas.filter((p) => !local || p.local === local);
  const abertas = pessoas.flatMap((p) => p.compensas.filter((c) => c.situacao === "aberta").map((c) => ({ p, c })));
  const vencidas = abertas.filter((x) => prazo(x.c, dados.hoje) === "vencida");
  const vencendo = abertas.filter((x) => prazo(x.c, dados.hoje) === "vencendo");
  const confirmar = pessoas.flatMap((p) => p.a_confirmar.map((a) => ({ p, a })));
  const dadas = pessoas.flatMap((p) => p.compensas.filter((c) => c.situacao === "usada").map((c) => ({ p, c })))
    .sort((a, b) => (b.c.usada_dia ?? "").localeCompare(a.c.usada_dia ?? ""));
  // Feriados a confirmar agrupados por feriado
  const porFeriado = [...new Set(confirmar.map((x) => x.a.dia))].sort().reverse().map((dia) => ({ dia, lista: confirmar.filter((x) => x.a.dia === dia) }));
  // Saldo de cada pessoa com compensa em aberto (as vencidas primeiro)
  const comSaldo = pessoas.map((p) => ({ p, ab: p.compensas.filter((c) => c.situacao === "aberta") })).filter((x) => x.ab.length)
    .sort((a, b) => Number(b.ab.some((c) => prazo(c, dados.hoje) === "vencida")) - Number(a.ab.some((c) => prazo(c, dados.hoje) === "vencida"))
      || (a.ab[0].vence_em ?? "9").localeCompare(b.ab[0].vence_em ?? "9"));
  const alerta = vencidas.length ? "erro" : confirmar.length || vencendo.length ? "aviso" : "";

  async function rpc(chave: string, nome: string, args: Record<string, unknown>) {
    setOcupado(chave);
    setErro("");
    const { error } = await supabase.rpc(nome, args);
    setOcupado("");
    if (error) { setErro(error.message); return false; }
    onMudou();
    return true;
  }
  function abrir() {
    setAba(confirmar.length ? "confirmar" : "aberto");
    setAberto(true);
  }

  return (
    <>
      <button className={`ep-icone-botao${alerta ? ` ${alerta}` : ""}`} onClick={abrir} title="Banco de compensas: feriados trabalhados e folgas compensadas">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="m9 15 2 2 4-4" /></svg>
        Compensas
        <b>{abertas.length}</b>
        {confirmar.length > 0 && <em title="Feriados a confirmar">{confirmar.length}</em>}
      </button>

      {aberto && (
        <Gaveta titulo="Banco de compensas" sub="Feriado trabalhado vira uma compensa de 60 dias; a folga compensada (FC) só sai com compensa em aberto." fechar={() => setAberto(false)}
          topo={
            <>
              <div className="cmp-numeros">
                <div><span>Em aberto</span><b>{abertas.length}</b></div>
                <div className={vencendo.length ? "aviso" : ""}><span>Vencendo</span><b>{vencendo.length}</b><small>em até 10 dias</small></div>
                <div className={vencidas.length ? "erro" : ""}><span>Vencidas</span><b>{vencidas.length}</b></div>
                <div className={confirmar.length ? "aviso" : ""}><span>A confirmar</span><b>{confirmar.length}</b><small>feriados</small></div>
              </div>
              <nav className="fx-abas" role="tablist">
                {([["confirmar", `A confirmar${confirmar.length ? ` (${confirmar.length})` : ""}`], ["aberto", "Em aberto"], ["historico", "Já dadas"],
                  ...(gerencia ? [["lancar", "Lançar saldo"]] : [])] as [Aba, string][]).map(([v, t]) => (
                  <button key={v} role="tab" aria-selected={aba === v} className={aba === v ? "on" : ""} onClick={() => setAba(v)}>{t}</button>
                ))}
              </nav>
            </>
          }>
          {erro && <p className="tv-alerta">{erro}</p>}

          {aba === "confirmar" && (porFeriado.length === 0
            ? <p className="cmp-vazio">Nenhum feriado a confirmar. Quando alguém estiver na escala trabalhando num feriado, ele aparece aqui depois do dia.</p>
            : porFeriado.map(({ dia, lista }) => (
              <section key={dia} className="cmp-cartao">
                <header><b>{nomeFer.get(dia) ?? "Feriado"}</b><span>{br(dia)}</span></header>
                <ul>
                  {lista.map(({ p, a }) => {
                    const k = `${p.cliente_id}:${p.id}:${a.dia}`;
                    return (
                      <li key={k}>
                        <i className="cmp-avatar">{iniciais(nomeDe(p.cliente_id, p.id, p.nome))}</i>
                        <span className="cmp-quem"><b>{nomeDe(p.cliente_id, p.id, p.nome)}</b><small>{p.setor || p.local}{a.entrada ? ` · estava ${a.entrada}–${a.saida}` : ""}</small></span>
                        <span className="cmp-acoes">
                          <button className="small" disabled={ocupado === k} onClick={() => rpc(k, "escala_compensa_feriado", { p_cliente: p.cliente_id, p_pessoa: p.id, p_feriado: a.dia, p_trabalhou: true })}>Trabalhou</button>
                          <button className="ghost small" disabled={ocupado === k} onClick={() => rpc(k, "escala_compensa_feriado", { p_cliente: p.cliente_id, p_pessoa: p.id, p_feriado: a.dia, p_trabalhou: false })}>Não</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )))}

          {aba === "aberto" && (comSaldo.length === 0
            ? <p className="cmp-vazio">Ninguém com compensa em aberto. A compensa nasce quando você marca, no bloquinho de um feriado (ou em “A confirmar”), que a pessoa trabalhou.</p>
            : (
              <ul className="cmp-pessoas">
                {comSaldo.map(({ p, ab }) => (
                  <li key={`${p.cliente_id}:${p.id}`} className="cmp-pessoa">
                    <i className="cmp-avatar">{iniciais(nomeDe(p.cliente_id, p.id, p.nome))}</i>
                    <span className="cmp-quem"><b>{nomeDe(p.cliente_id, p.id, p.nome)}</b><small>{p.setor || p.local}</small></span>
                    <span className="cmp-saldo" title="Compensas em aberto">{ab.length}</span>
                    <ul className="cmp-itens">
                      {ab.map((c) => (
                        <li key={c.id} className={`cmp-item p-${prazo(c, dados.hoje)}`}>
                          <span>{c.origem === "feriado" && c.feriado ? <>{nomeFer.get(c.feriado) ?? "Feriado"} <small>{br(c.feriado)}</small></> : <>Saldo antigo <small>{c.motivo}</small></>}</span>
                          <em>{textoPrazo(c, dados.hoje)}</em>
                          {gerencia && (
                            <button onClick={() => { if (confirm("Cancelar esta compensa? Ela sai do saldo da pessoa.")) rpc(`c${c.id}`, "escala_compensa_cancelar", { p_id: c.id }); }} disabled={ocupado === `c${c.id}`} title="Cancelar esta compensa" aria-label="Cancelar compensa">×</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ))}

          {aba === "historico" && (dadas.length === 0
            ? <p className="cmp-vazio">Nenhuma folga compensada dada ainda.</p>
            : (
              <ul className="cmp-historico">
                {dadas.map(({ p, c }) => (
                  <li key={c.id}>
                    <span className="cmp-data">{c.usada_dia ? br(c.usada_dia) : "—"}</span>
                    <span className="cmp-quem"><b>{nomeDe(p.cliente_id, p.id, p.nome)}</b><small>{p.setor || p.local}</small></span>
                    <span className="muted small">folga do {c.feriado ? `${nomeFer.get(c.feriado) ?? "feriado"} (${br(c.feriado)})` : `saldo antigo (${c.motivo})`}</span>
                  </li>
                ))}
              </ul>
            ))}

          {aba === "lancar" && gerencia && (
            <section className="cmp-cartao cmp-lancar">
              <header><b>Lançar saldo antigo</b><span>compensas que a pessoa já tinha antes do Brasico</span></header>
              <label>Pessoa
                <select value={lancar.chave} onChange={(e) => setLancar({ ...lancar, chave: e.target.value })}>
                  <option value="">Escolha…</option>
                  {pessoas.map((p) => <option key={`${p.cliente_id}:${p.id}`} value={`${p.cliente_id}:${p.id}`}>{nomeDe(p.cliente_id, p.id, p.nome)} · {p.setor || p.local}</option>)}
                </select>
              </label>
              <div className="cmp-lancar-linha">
                <label>Quantas<input type="number" min={1} max={30} value={lancar.qtd} onChange={(e) => setLancar({ ...lancar, qtd: e.target.value })} /></label>
                <label className="cmp-motivo">Motivo<input value={lancar.motivo} onChange={(e) => setLancar({ ...lancar, motivo: e.target.value })} placeholder="Ex.: saldo de outubro" /></label>
              </div>
              <button className="small" disabled={!lancar.chave || !lancar.motivo.trim() || ocupado === "lancar"} onClick={async () => {
                const [c, id] = lancar.chave.split(":").map(Number);
                if (await rpc("lancar", "escala_compensa_lancar", { p_cliente: c, p_pessoa: id, p_qtd: Number(lancar.qtd) || 1, p_motivo: lancar.motivo })) {
                  setLancar({ chave: "", qtd: "1", motivo: "" });
                  setAba("aberto");
                }
              }}>Lançar</button>
            </section>
          )}
        </Gaveta>
      )}
    </>
  );
}
