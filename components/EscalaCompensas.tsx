"use client";

// Banco de compensas (09/11/2026; supabase/escala_compensas.sql). Uma compensa nasce quando se marca que a pessoa
// trabalhou num feriado (vale 60 dias); a folga compensada (FC) da escala usa a mais antiga e só grava se houver
// compensa em aberto. Este quadro mostra, de quem o usuário vê: os feriados a confirmar (estava na escala trabalhando),
// as compensas em aberto (com o prazo), as já dadas e, para sócios, o saldo antigo lançado à mão.
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Compensa = { id: number; origem: "feriado" | "ajuste"; feriado: string | null; motivo: string; vence_em: string | null; situacao: "aberta" | "usada" | "cancelada"; usada_dia: string | null };
export type PessoaComp = { cliente_id: number; id: number; nome: string; local: string; setor: string; compensas: Compensa[]; a_confirmar: { dia: string; entrada: string | null; saida: string | null }[] };
export type CompDados = { hoje: string; socio: boolean; feriados: { dia: string; nome: string; origem: string }[]; pessoas: PessoaComp[] };

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diasAte = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);

// Situação de uma compensa em aberto pelo prazo
export function prazo(c: Compensa, hoje: string): "vencida" | "vencendo" | "ok" {
  if (!c.vence_em) return "ok";
  const n = diasAte(hoje, c.vence_em);
  return n < 0 ? "vencida" : n <= 10 ? "vencendo" : "ok";
}

export default function EscalaCompensas({ supabase, dados, local, nomeDe, onMudou }: {
  supabase: SupabaseClient; dados: CompDados; local: string;
  nomeDe: (cliente: number, id: number, nome: string) => string; onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [lancar, setLancar] = useState<{ chave: string; qtd: string; motivo: string } | null>(null);
  const nomeFer = new Map(dados.feriados.map((f) => [f.dia, f.nome]));
  const pessoas = dados.pessoas.filter((p) => !local || p.local === local);
  const abertas = pessoas.flatMap((p) => p.compensas.filter((c) => c.situacao === "aberta").map((c) => ({ p, c })));
  const vencidas = abertas.filter((x) => prazo(x.c, dados.hoje) === "vencida").length;
  const vencendo = abertas.filter((x) => prazo(x.c, dados.hoje) === "vencendo").length;
  const confirmar = pessoas.flatMap((p) => p.a_confirmar.map((a) => ({ p, a })));
  const comMovimento = pessoas.filter((p) => p.compensas.some((c) => c.situacao !== "cancelada"));

  async function rpc(chave: string, nome: string, args: Record<string, unknown>) {
    setOcupado(chave);
    setErro("");
    const { error } = await supabase.rpc(nome, args);
    setOcupado("");
    if (error) return setErro(error.message);
    onMudou();
  }

  return (
    <section className={`ep-contratados ep-comp-banco${aberto ? " aberto" : ""}`}>
      <button className="ep-contratados-cabeca" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <span><b>Banco de compensas</b> {abertas.length} em aberto
          {vencendo > 0 && <span className="ep-comp-tag vencendo">{vencendo} vencendo</span>}
          {vencidas > 0 && <span className="ep-comp-tag vencida">{vencidas} vencidas</span>}
          {confirmar.length > 0 && <span className="ep-comp-tag confirmar">{confirmar.length} feriado{confirmar.length === 1 ? "" : "s"} a confirmar</span>}</span>
        <span className="muted small">Feriado trabalhado vira compensa (60 dias); a folga compensada (FC) só sai com compensa em aberto. {aberto ? "Fechar" : "Abrir"}</span>
      </button>
      {aberto && (
        <div className="ep-contratados-corpo">
          {erro && <p className="tv-alerta">{erro}</p>}

          {confirmar.length > 0 && (
            <div className="ep-comp-bloco">
              <h4>Feriados a confirmar <small className="muted">estava na escala trabalhando: trabalhou mesmo?</small></h4>
              <ul className="ep-comp-lista">
                {confirmar.map(({ p, a }) => {
                  const k = `${p.cliente_id}:${p.id}:${a.dia}`;
                  return (
                    <li key={k}>
                      <span><b>{nomeDe(p.cliente_id, p.id, p.nome)}</b> <small className="muted">{p.setor || p.local}</small></span>
                      <span>{br(a.dia)} · {nomeFer.get(a.dia) ?? "Feriado"}{a.entrada ? <small className="muted"> · {a.entrada}–{a.saida}</small> : null}</span>
                      <span className="ep-comp-acoes">
                        <button className="small" disabled={ocupado === k} onClick={() => rpc(k, "escala_compensa_feriado", { p_cliente: p.cliente_id, p_pessoa: p.id, p_feriado: a.dia, p_trabalhou: true })}>Trabalhou</button>
                        <button className="ghost small" disabled={ocupado === k} onClick={() => rpc(k, "escala_compensa_feriado", { p_cliente: p.cliente_id, p_pessoa: p.id, p_feriado: a.dia, p_trabalhou: false })}>Não trabalhou</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="ep-comp-bloco">
            <h4>Por pessoa</h4>
            {comMovimento.length === 0 && <p className="muted small">Nenhuma compensa ainda. Ela nasce quando você marca, no bloquinho de um feriado, que a pessoa trabalhou.</p>}
            <ul className="ep-comp-lista">
              {comMovimento.map((p) => {
                const k = `${p.cliente_id}:${p.id}`;
                const ab = p.compensas.filter((c) => c.situacao === "aberta");
                const dadas = p.compensas.filter((c) => c.situacao === "usada");
                return (
                  <li key={k} className="ep-comp-pessoa">
                    <span><b>{nomeDe(p.cliente_id, p.id, p.nome)}</b> <small className="muted">{p.setor || p.local}</small></span>
                    <span className="ep-comp-chips">
                      <span className="ep-comp-saldo" title="Compensas em aberto">{ab.length}</span>
                      {ab.map((c) => (
                        <span key={c.id} className={`ep-contratados-chip ep-comp-${prazo(c, dados.hoje)}`}>
                          {c.origem === "feriado" && c.feriado ? <>Feriado {br(c.feriado)}</> : <>Saldo: {c.motivo}</>}
                          {c.vence_em && <small>{prazo(c, dados.hoje) === "vencida" ? `venceu ${br(c.vence_em)}` : `até ${br(c.vence_em)}`}</small>}
                          {dados.socio && c.origem === "ajuste" && (
                            <button onClick={() => rpc(`c${c.id}`, "escala_compensa_cancelar", { p_id: c.id })} disabled={ocupado === `c${c.id}`} title="Cancelar este lançamento">×</button>
                          )}
                        </span>
                      ))}
                      {dadas.map((c) => (
                        <span key={c.id} className="ep-contratados-chip apagado" title="Compensa já dada">
                          Folga {c.usada_dia ? br(c.usada_dia) : ""} <small>← {c.feriado ? `feriado ${br(c.feriado)}` : c.motivo}</small>
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {dados.socio && (
            <div className="ep-comp-bloco">
              <h4>Lançar saldo antigo <small className="muted">compensa que a pessoa já tinha antes do Brasico</small></h4>
              {!lancar ? (
                <button className="ghost small" onClick={() => setLancar({ chave: "", qtd: "1", motivo: "" })}>+ Lançar saldo</button>
              ) : (
                <div className="ep-lid-form">
                  <label>Pessoa
                    <select value={lancar.chave} onChange={(e) => setLancar({ ...lancar, chave: e.target.value })}>
                      <option value="">Escolha…</option>
                      {pessoas.map((p) => <option key={`${p.cliente_id}:${p.id}`} value={`${p.cliente_id}:${p.id}`}>{nomeDe(p.cliente_id, p.id, p.nome)} · {p.setor || p.local}</option>)}
                    </select>
                  </label>
                  <label>Quantas compensas<input type="number" min={1} max={30} value={lancar.qtd} onChange={(e) => setLancar({ ...lancar, qtd: e.target.value })} /></label>
                  <label>Motivo<input value={lancar.motivo} onChange={(e) => setLancar({ ...lancar, motivo: e.target.value })} placeholder="Ex.: saldo de outubro" /></label>
                  <div className="ep-lid-acoes">
                    <button className="ghost small" onClick={() => setLancar(null)}>Cancelar</button>
                    <button className="small" disabled={!lancar.chave || !lancar.motivo.trim() || ocupado === "lancar"} onClick={async () => {
                      const [c, id] = lancar.chave.split(":").map(Number);
                      await rpc("lancar", "escala_compensa_lancar", { p_cliente: c, p_pessoa: id, p_qtd: Number(lancar.qtd) || 1, p_motivo: lancar.motivo });
                      setLancar(null);
                    }}>Lançar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

