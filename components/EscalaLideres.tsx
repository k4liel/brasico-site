"use client";

// Líderes direto na grade da escala (09/11/2026, pedido do dono): no cabeçalho de cada casa e de cada setor aparecem
// as bolinhas de quem monta a escala ali; clicar abre uma janelinha com os usuários (login de colaborador) para marcar.
// Casa = escala_lideres_locais (toda a casa, pega setores novos); setor = escala_lideres. Só sócios
// (escala_lideranca / escala_lideranca_definir, supabase/escala_unica.sql).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Lider = { pessoa_id: string; nome: string; usuario: string; local: string; tudo: boolean; setores: string[] };
export type Lideranca = { casas: { local: string; setores: string[] }[]; lideres: Lider[]; candidatos: { id: string; nome: string; usuario: string; casa: string }[] };

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const iniciais = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export function useLideranca(supabase: SupabaseClient, ativo: boolean) {
  const [dados, setDados] = useState<Lideranca | null>(null);
  const ler = useCallback(async () => {
    if (!ativo) return;
    const { data } = await supabase.rpc("escala_lideranca");
    if (data) setDados(data as Lideranca);
  }, [supabase, ativo]);
  useEffect(() => { ler(); }, [ler]);
  return { dados, ler };
}

// As bolinhas no cabeçalho: quem monta a escala daqui (ou um "+ líder" discreto)
export function ChipsLideres({ lideres, titulo, onAbrir }: { lideres: Lider[]; titulo: string; onAbrir: (x: number, y: number) => void }) {
  return (
    <button type="button" className={`ep-lid-bolas${lideres.length ? "" : " vazio"}`} title={lideres.length ? `${titulo}: ${lideres.map((l) => nomeProprio(l.nome)).join(", ")} (clique para mudar)` : `Escolher quem monta a escala (${titulo.toLowerCase()})`}
      onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onAbrir(r.left, r.bottom); }}>
      {lideres.length ? lideres.slice(0, 3).map((l) => <i key={l.pessoa_id}>{iniciais(l.nome)}</i>) : <span>+ líder</span>}
      {lideres.length > 3 && <i className="mais">+{lideres.length - 3}</i>}
    </button>
  );
}

// A janelinha: marcar os usuários que montam a escala da casa (toda) ou do setor
export function EditorLideres({ dados, local, setor, x, y, onFechar, onMudou, supabase }: {
  dados: Lideranca; local: string; setor: string | null; x: number; y: number; onFechar: () => void; onMudou: () => void; supabase: SupabaseClient;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [pos, setPos] = useState({ left: x, top: y + 6 });
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: y + r.height + 14 > window.innerHeight ? Math.max(8, y - r.height - 30) : y + 6 });
  }, [x, y]);
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) onFechar(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    const t = setTimeout(() => window.addEventListener("pointerdown", fora, true), 0);
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", fora, true); window.removeEventListener("keydown", esc); };
  }, [onFechar]);

  const daCasa = new Map(dados.lideres.filter((l) => l.local === local).map((l) => [l.pessoa_id, l]));
  const termo = busca.trim().toLowerCase();
  const lista = dados.candidatos.filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.usuario.toLowerCase().includes(termo));

  async function mudar(pessoa: string, marcar: boolean) {
    const atual = daCasa.get(pessoa);
    let tudo = false, setores: string[] = [];
    if (setor === null) tudo = marcar;
    else {
      setores = (atual && !atual.tudo ? atual.setores : []).filter((x) => x !== setor);
      if (marcar) setores.push(setor);
    }
    setOcupado(pessoa);
    setErro("");
    const { error } = await supabase.rpc("escala_lideranca_definir", { p_pessoa: pessoa, p_local: local, p_tudo: tudo, p_setores: setores });
    setOcupado("");
    if (error) return setErro(error.message);
    onMudou();
  }

  return (
    <div ref={caixa} className="ep-editor ep-lid-editor" role="dialog" aria-label="Quem monta a escala" style={pos}>
      <div className="ep-editor-cabeca">
        <b>Quem monta a escala</b>
        <button onClick={onFechar} aria-label="Fechar">×</button>
      </div>
      <p className="ep-lid-alvo">{setor === null ? <><b>{local}</b> · a casa inteira (todos os setores)</> : <><b>{setor}</b> · {local}</>}</p>
      {dados.candidatos.length > 6 && <input className="ep-lid-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar usuário" />}
      {erro && <p className="tv-alerta">{erro}</p>}
      <ul className="ep-lid-usuarios">
        {lista.map((c) => {
          const l = daCasa.get(c.id);
          const pelaCasa = setor !== null && !!l?.tudo;
          const marcado = setor === null ? !!l?.tudo : pelaCasa || !!l?.setores.includes(setor);
          return (
            <li key={c.id}>
              <label className={pelaCasa ? "pela-casa" : ""}>
                <input type="checkbox" checked={marcado} disabled={pelaCasa || ocupado === c.id} onChange={(e) => mudar(c.id, e.target.checked)} />
                <i>{iniciais(c.nome)}</i>
                <span><b>{nomeProprio(c.nome)}</b><small>{c.usuario}{pelaCasa ? " · já monta a casa inteira" : setor === null && l && !l.tudo ? ` · hoje: ${l.setores.join(", ")}` : ""}</small></span>
              </label>
            </li>
          );
        })}
        {lista.length === 0 && <li className="muted small">Ninguém com esse nome.</li>}
      </ul>
      <p className="muted small">Só aparece quem tem login de colaborador; quem não tem é criado na página <a href="/usuarios">Usuários</a>.</p>
    </div>
  );
}
