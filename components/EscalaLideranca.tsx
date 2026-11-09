"use client";

// Quem monta a escala (09/11/2026; só sócios, no topo da página Escala): cada casa com os líderes e o que cada um
// pode alterar — a casa inteira (escala_lideres_locais, pega também os setores novos) ou só alguns setores
// (escala_lideres). Pôr, mudar e tirar aqui mesmo (escala_lideranca / escala_lideranca_definir, supabase/escala_unica.sql).
// A pessoa precisa ter login de colaborador (criado na página Usuários). Nada se apaga.
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Lider = { pessoa_id: string; nome: string; usuario: string; local: string; tudo: boolean; setores: string[] };
type Dados = { casas: { local: string; setores: string[] }[]; lideres: Lider[]; candidatos: { id: string; nome: string; usuario: string; casa: string }[] };
type Form = { local: string; pessoa: string; tudo: boolean; setores: string[]; novo: boolean };

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");

export default function EscalaLideranca({ supabase, onMudou }: { supabase: SupabaseClient; onMudou?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc("escala_lideranca");
    if (error) return setErro(error.message);
    setDados(data as Dados);
  }, [supabase]);
  useEffect(() => { ler(); }, [ler]);

  async function salvar(f: Form, tirar = false) {
    if (!f.pessoa) return setErro("Escolha a pessoa.");
    if (!tirar && !f.tudo && !f.setores.length) return setErro("Marque ao menos um setor, ou escolha a casa inteira.");
    setOcupado(true);
    setErro("");
    const { error } = await supabase.rpc("escala_lideranca_definir", {
      p_pessoa: f.pessoa, p_local: f.local, p_tudo: tirar ? false : f.tudo, p_setores: tirar ? [] : f.tudo ? [] : f.setores,
    });
    setOcupado(false);
    if (error) return setErro(error.message);
    setForm(null);
    await ler();
    onMudou?.();
  }

  if (!dados) return erro ? <p className="tv-alerta">{erro}</p> : null;
  const total = new Set(dados.lideres.map((l) => l.pessoa_id)).size;
  const casasSem = dados.casas.filter((c) => !dados.lideres.some((l) => l.local === c.local)).length;

  return (
    <section className={`ep-contratados ep-lideranca${aberto ? " aberto" : ""}`}>
      <button className="ep-contratados-cabeca" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <span><b>Quem monta a escala</b> {total ? <>{total} {total === 1 ? "líder" : "líderes"}</> : "ninguém ainda"}
          {casasSem > 0 && <span className="muted"> · {casasSem} {casasSem === 1 ? "casa sem líder" : "casas sem líder"}</span>}</span>
        <span className="muted small">Quem pode editar a escala de cada casa (a casa inteira ou só alguns setores). {aberto ? "Fechar" : "Abrir"}</span>
      </button>
      {aberto && (
        <div className="ep-contratados-corpo">
          {erro && <p className="tv-alerta">{erro}</p>}
          <div className="ep-lid-casas">
            {dados.casas.map((c) => {
              const lids = dados.lideres.filter((l) => l.local === c.local);
              const editando = form?.local === c.local;
              return (
                <div key={c.local} className="ep-lid-casa">
                  <div className="ep-lid-linha">
                    <b className="ep-lid-nome">{c.local}</b>
                    <div className="ep-contratados-lista">
                      {lids.length === 0 && <span className="muted small">Sem líder: só os sócios editam.</span>}
                      {lids.map((l) => (
                        <span key={l.pessoa_id} className="ep-contratados-chip">
                          <button className="ep-lid-chip" onClick={() => setForm({ local: c.local, pessoa: l.pessoa_id, tudo: l.tudo, setores: l.setores, novo: false })}
                            title="Mudar o que esta pessoa edita">
                            {nomeProprio(l.nome)} <small>{l.tudo ? "toda a casa" : l.setores.map((s) => s || "sem setor").join(", ")}</small>
                          </button>
                          <button onClick={() => salvar({ local: c.local, pessoa: l.pessoa_id, tudo: false, setores: [], novo: false }, true)} disabled={ocupado}
                            title="Tirar da liderança desta casa" aria-label={`Tirar ${l.nome} da escala de ${c.local}`}>×</button>
                        </span>
                      ))}
                      {!editando && <button className="ghost small" onClick={() => setForm({ local: c.local, pessoa: "", tudo: true, setores: [], novo: true })}>+ Pôr líder</button>}
                    </div>
                  </div>
                  {editando && form && (
                    <div className="ep-lid-form">
                      <label>Pessoa
                        <select value={form.pessoa} disabled={!form.novo} onChange={(e) => setForm({ ...form, pessoa: e.target.value })}>
                          <option value="">Escolha…</option>
                          {dados.candidatos.map((p) => <option key={p.id} value={p.id}>{nomeProprio(p.nome)}{p.usuario ? ` (${p.usuario})` : ""}</option>)}
                        </select>
                      </label>
                      <div className="ep-lid-alcance" role="radiogroup" aria-label="O que pode editar">
                        <label><input type="radio" checked={form.tudo} onChange={() => setForm({ ...form, tudo: true })} /> Toda a casa <small className="muted">(todos os setores, inclusive os novos)</small></label>
                        <label><input type="radio" checked={!form.tudo} onChange={() => setForm({ ...form, tudo: false })} /> Só alguns setores</label>
                      </div>
                      {!form.tudo && (
                        <div className="ep-lid-setores">
                          {(c.setores.length ? c.setores : [""]).map((s) => (
                            <label key={s || "_"}><input type="checkbox" checked={form.setores.includes(s)}
                              onChange={(e) => setForm({ ...form, setores: e.target.checked ? [...form.setores, s] : form.setores.filter((x) => x !== s) })} /> {s || "Sem setor"}</label>
                          ))}
                        </div>
                      )}
                      <div className="ep-lid-acoes">
                        <button className="ghost small" onClick={() => { setForm(null); setErro(""); }}>Cancelar</button>
                        <button className="small" onClick={() => salvar(form)} disabled={ocupado}>Salvar</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">A pessoa entra com usuário e senha em brasico.vercel.app/colaboradores e cai direto na escala do que ela monta. Quem ainda não tem login aparece depois de criado na página <a href="/usuarios">Usuários</a>.</p>
        </div>
      )}
    </section>
  );
}
