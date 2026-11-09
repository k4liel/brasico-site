"use client";

// Contratados sem ponto (09/11/2026): quem está ativo no RH (eSocial) e não tem cadastro no relógio (RHiD) não
// aparecia na escala. Esta lista (só sócios, página Escala) mostra essas pessoas; o sócio escolhe o local e o setor e
// clica em Incluir: a pessoa entra na escala do Ponto e na Planejada com "fora do ponto" ao lado do nome
// (escala_extras, supabase/escala_extras.sql). "Não trabalha aqui" tira da lista; nada se apaga.
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDaUnidadeRH } from "@/lib/esocial/locais";
import { dataBR } from "@/lib/esocial/rh";

export type Contratado = {
  empresa_id: string; cpf: string; nome: string; cargo: string; unidade: string; admissao: string | null; ponto: string;
  extra_id: number | null; situacao: "na_escala" | "ignorado" | "fora" | null; local: string | null; setor: string | null;
  posicao?: number | null;
};

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");

export default function EscalaContratados({ supabase, lista, locais, onMudou }: {
  supabase: SupabaseClient; lista: Contratado[];
  // Locais e setores que já existem na grade (para escolher)
  locais: { local: string; setores: string[] }[];
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [verIgnorados, setVerIgnorados] = useState(false);
  const [escolha, setEscolha] = useState<Record<string, { local: string; setor: string }>>({});
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");

  const faltam = lista.filter((c) => c.situacao !== "na_escala" && c.situacao !== "ignorado");
  const naEscala = lista.filter((c) => c.situacao === "na_escala");
  const ignorados = lista.filter((c) => c.situacao === "ignorado");
  const chave = (c: Contratado) => `${c.empresa_id}:${c.cpf}`;
  const nomesLocais = locais.map((l) => l.local);
  // Sugestão de local pela unidade do RH (CICCHETTI → Cicchetti Pipa, FDL → Filha da Lua, SV → Sempre Vivo)
  const sugestao = (c: Contratado) => {
    const l = localDaUnidadeRH(c.unidade);
    return nomesLocais.includes(l) ? l : "";
  };
  const atual = (c: Contratado) => escolha[chave(c)] ?? { local: c.local || sugestao(c), setor: c.setor ?? "" };

  async function definir(c: Contratado, situacao: "na_escala" | "ignorado" | "fora") {
    const e = atual(c);
    if (situacao === "na_escala" && !e.local) return setErro(`Escolha o local de ${nomeProprio(c.nome)}.`);
    setOcupado(chave(c));
    setErro("");
    const { error } = await supabase.rpc("escala_contratado_definir", { p_empresa: c.empresa_id, p_cpf: c.cpf, p_situacao: situacao, p_local: e.local, p_setor: e.setor });
    setOcupado("");
    if (error) return setErro(error.message);
    onMudou();
  }

  if (!lista.length) return null;
  return (
    <section className={`ep-contratados${aberto ? " aberto" : ""}`}>
      <button className="ep-contratados-cabeca" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <span><b>Contratados sem ponto</b> {faltam.length > 0
          ? <><i className="ep-contratados-n">{faltam.length}</i> fora da escala</>
          : "todos na escala"}{naEscala.length > 0 && <span className="muted"> · {naEscala.length} já incluídos</span>}</span>
        <span className="muted small">Estão ativos no RH, mas não têm cadastro no relógio (RHiD). {aberto ? "Fechar" : "Abrir"}</span>
      </button>
      {aberto && (
        <div className="ep-contratados-corpo">
          {erro && <p className="tv-alerta">{erro}</p>}
          {faltam.length === 0 ? <p className="muted">Ninguém faltando.</p> : (
            <table className="ep-contratados-tabela">
              <thead><tr><th>Pessoa</th><th>No RH</th><th>Local</th><th>Setor</th><th /></tr></thead>
              <tbody>
                {faltam.map((c) => {
                  const e = atual(c);
                  const setores = locais.find((l) => l.local === e.local)?.setores ?? [];
                  const mudar = (x: Partial<{ local: string; setor: string }>) => setEscolha((v) => ({ ...v, [chave(c)]: { ...e, ...x } }));
                  return (
                    <tr key={chave(c)}>
                      <td><b>{nomeProprio(c.nome)}</b><small>{c.cargo ? nomeProprio(c.cargo) : "—"}</small></td>
                      <td><small>{c.unidade || "—"}{c.admissao ? ` · desde ${dataBR(c.admissao)}` : ""}</small></td>
                      <td>
                        <select value={e.local} onChange={(v) => mudar({ local: v.target.value, setor: "" })} aria-label="Local">
                          <option value="">Escolha…</option>
                          {nomesLocais.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={e.setor} onChange={(v) => mudar({ setor: v.target.value })} aria-label="Setor" disabled={!e.local}>
                          <option value="">{setores.length ? "Sem setor" : "—"}</option>
                          {setores.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="ep-contratados-acoes">
                        <button className="small" disabled={ocupado === chave(c) || !e.local} onClick={() => definir(c, "na_escala")}>Incluir</button>
                        <button className="ghost small" disabled={ocupado === chave(c)} onClick={() => definir(c, "ignorado")} title="Tira da lista (dá para voltar)">Não trabalha aqui</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {naEscala.length > 0 && (
            <div className="ep-contratados-lista">
              <span className="muted small">Já na escala, com “fora do ponto” ao lado do nome:</span>
              {naEscala.map((c) => (
                <span key={chave(c)} className="ep-contratados-chip">
                  {nomeProprio(c.nome)} <small>{[c.local, c.setor].filter(Boolean).join(" · ")}</small>
                  <button onClick={() => definir(c, "fora")} disabled={ocupado === chave(c)} title="Tirar da escala (volta para a lista)" aria-label={`Tirar ${c.nome} da escala`}>×</button>
                </span>
              ))}
            </div>
          )}
          {ignorados.length > 0 && (
            <div className="ep-contratados-lista">
              <button className="ghost small" onClick={() => setVerIgnorados((v) => !v)}>{verIgnorados ? "Esconder" : "Ver"} os {ignorados.length} marcados como “não trabalha aqui”</button>
              {verIgnorados && ignorados.map((c) => (
                <span key={chave(c)} className="ep-contratados-chip apagado">
                  {nomeProprio(c.nome)}
                  <button onClick={() => definir(c, "fora")} disabled={ocupado === chave(c)} title="Voltar para a lista">↩</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
