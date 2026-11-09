"use client";

// Contratados sem ponto (09/11/2026): quem está ativo no RH (eSocial) e não tem cadastro no relógio (RHiD) não
// aparecia na escala. Na página Escala fica só um botão no canto (com quantos faltam); ele abre um painel lateral:
// "Fora da escala" (escolher casa e setor e incluir; "Não trabalha aqui" tira da lista), "Na escala" (mudar de
// lugar ou tirar) e "Não trabalham aqui" (voltar). A pessoa entra na escala com "fora do ponto" ao lado do nome
// (escala_extras, supabase/escala_extras.sql). Nada se apaga.
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDaUnidadeRH } from "@/lib/esocial/locais";
import { dataBR } from "@/lib/esocial/rh";
import Gaveta from "./Gaveta";

export type Contratado = {
  empresa_id: string; cpf: string; nome: string; cargo: string; unidade: string; admissao: string | null; ponto: string;
  extra_id: number | null; situacao: "na_escala" | "ignorado" | "fora" | null; local: string | null; setor: string | null;
  posicao?: number | null;
};

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const iniciais = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
type Aba = "fora" | "escala" | "ignorados";

export default function EscalaContratados({ supabase, lista, locais, onMudou }: {
  supabase: SupabaseClient; lista: Contratado[];
  // Casas e setores que já existem na grade (para escolher)
  locais: { local: string; setores: string[] }[];
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>("fora");
  const [busca, setBusca] = useState("");
  const [escolha, setEscolha] = useState<Record<string, { local: string; setor: string }>>({});
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");

  const faltam = lista.filter((c) => c.situacao !== "na_escala" && c.situacao !== "ignorado");
  const naEscala = lista.filter((c) => c.situacao === "na_escala");
  const ignorados = lista.filter((c) => c.situacao === "ignorado");
  const chave = (c: Contratado) => `${c.empresa_id}:${c.cpf}`;
  const nomesLocais = locais.map((l) => l.local);
  // Sugestão de casa pela unidade do RH (CICCHETTI → Cicchetti Pipa, FDL → Filha da Lua, SV → Sempre Vivo)
  const sugestao = (c: Contratado) => {
    const l = localDaUnidadeRH(c.unidade);
    return nomesLocais.includes(l) ? l : "";
  };
  const atual = (c: Contratado) => escolha[chave(c)] ?? { local: c.local || sugestao(c), setor: c.setor ?? "" };
  const termo = busca.trim().toLowerCase();
  const filtrar = (xs: Contratado[]) => xs.filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.cargo.toLowerCase().includes(termo) || c.unidade.toLowerCase().includes(termo));

  async function definir(c: Contratado, situacao: "na_escala" | "ignorado" | "fora") {
    const e = atual(c);
    if (situacao === "na_escala" && !e.local) return setErro(`Escolha a casa de ${nomeProprio(c.nome)}.`);
    setOcupado(chave(c));
    setErro("");
    const { error } = await supabase.rpc("escala_contratado_definir", { p_empresa: c.empresa_id, p_cpf: c.cpf, p_situacao: situacao, p_local: e.local, p_setor: e.setor });
    setOcupado("");
    if (error) return setErro(error.message);
    setEscolha((v) => { const n = { ...v }; delete n[chave(c)]; return n; });
    onMudou();
  }

  function linha(c: Contratado, modo: Aba) {
    const e = atual(c);
    const setores = locais.find((l) => l.local === e.local)?.setores ?? [];
    const mudar = (x: Partial<{ local: string; setor: string }>) => setEscolha((v) => ({ ...v, [chave(c)]: { ...e, ...x } }));
    const mexeu = !!escolha[chave(c)];
    return (
      <li key={chave(c)} className="ct-pessoa">
        <i className="cmp-avatar">{iniciais(c.nome)}</i>
        <div className="ct-info">
          <b>{nomeProprio(c.nome)}</b>
          <small>{c.cargo ? nomeProprio(c.cargo) : "Sem cargo"} · {c.unidade || "—"}{c.admissao ? ` · desde ${dataBR(c.admissao)}` : ""}</small>
          {modo !== "ignorados" && (
            <div className="ct-lugar">
              <select value={e.local} onChange={(v) => mudar({ local: v.target.value, setor: "" })} aria-label="Casa">
                <option value="">Casa…</option>
                {nomesLocais.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select value={e.setor} onChange={(v) => mudar({ setor: v.target.value })} aria-label="Setor" disabled={!e.local}>
                <option value="">{setores.length ? "Sem setor" : "—"}</option>
                {setores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="ct-acoes">
          {modo === "fora" && <>
            <button className="small" disabled={ocupado === chave(c) || !e.local} onClick={() => definir(c, "na_escala")}>Incluir</button>
            <button className="ghost small" disabled={ocupado === chave(c)} onClick={() => definir(c, "ignorado")} title="Tira da lista (dá para voltar)">Não trabalha aqui</button>
          </>}
          {modo === "escala" && <>
            {mexeu && <button className="small" disabled={ocupado === chave(c) || !e.local} onClick={() => definir(c, "na_escala")}>Mudar</button>}
            <button className="ghost small" disabled={ocupado === chave(c)} onClick={() => definir(c, "fora")} title="Tira da escala (volta para a lista)">Tirar da escala</button>
          </>}
          {modo === "ignorados" && <button className="ghost small" disabled={ocupado === chave(c)} onClick={() => definir(c, "fora")}>Voltar para a lista</button>}
        </div>
      </li>
    );
  }

  if (!lista.length) return null;
  const vistos = filtrar(aba === "fora" ? faltam : aba === "escala" ? naEscala : ignorados);
  return (
    <>
      <button className={`ep-icone-botao${faltam.length ? " aviso" : ""}`} onClick={() => { setAba(faltam.length ? "fora" : "escala"); setAberto(true); }}
        title="Contratados no RH sem cadastro no relógio (RHiD)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M17 8h5M19.5 5.5v5" /></svg>
        Sem ponto
        {faltam.length > 0 && <b>{faltam.length}</b>}
      </button>
      {aberto && (
        <Gaveta titulo="Contratados sem ponto" sub="Ativos no RH, mas sem cadastro no relógio (RHiD). Inclua na escala escolhendo a casa e o setor; eles aparecem com “fora do ponto” ao lado do nome."
          fechar={() => setAberto(false)}
          topo={
            <nav className="fx-abas" role="tablist">
              {([["fora", `Fora da escala (${faltam.length})`], ["escala", `Na escala (${naEscala.length})`], ["ignorados", `Não trabalham aqui (${ignorados.length})`]] as [Aba, string][]).map(([v, t]) => (
                <button key={v} role="tab" aria-selected={aba === v} className={aba === v ? "on" : ""} onClick={() => setAba(v)}>{t}</button>
              ))}
            </nav>
          }>
          {erro && <p className="tv-alerta">{erro}</p>}
          <input className="ct-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, cargo ou unidade" />
          {vistos.length === 0
            ? <p className="cmp-vazio">{aba === "fora" ? "Ninguém faltando: todos os contratados sem ponto já foram resolvidos." : aba === "escala" ? "Ninguém incluído ainda." : "Ninguém marcado."}</p>
            : <ul className="ct-lista">{vistos.map((c) => linha(c, aba))}</ul>}
        </Gaveta>
      )}
    </>
  );
}
