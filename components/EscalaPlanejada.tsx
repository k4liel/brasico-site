"use client";

// Escala planejada (06/11/2026): a escala que a casa monta, dia a dia e mês a mês, no mesmo visual da escala
// do RH (PontoEscala). Quem pode mexer (sócio, ou líder do grupo) escolhe um "pincel" na paleta — um horário,
// Folga, Folga compensada, Banco de horas, Férias, Atestado, Licença ou Limpar — e arrasta sobre os dias e as
// pessoas. Cada mudança grava na hora (escala_gravar), pode ser desfeita, e é conferida com a lei
// (lib/escala/regras.ts): o que sai do padrão aparece na hora num aviso, no dia, no nome e no painel de avisos.
// Os dados vêm de escala_dados (só os grupos de quem está vendo); o mês começa copiado do RHiD.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PontoEscala, { type Celula, type ColunaExtra, type DiaEscala, type ModoEscala, type PessoaEscala } from "./PontoEscala";
import { ANTECEDENCIA, CODIGOS, avaliar, horasTxt, jornada, type Aviso, type Codigo, type DiaPlano } from "@/lib/escala/regras";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";
import { casaDoLocal, casaPorId } from "@/lib/escala/casas";
import { createPortal } from "react-dom";

type Grupo = { id: string; nome: string; local: string; setor: string; lideres: { pessoa_id: string; nome: string; usuario: string }[] };
type PessoaDado = {
  cliente_id: number; id: number; nome: string; grupo_id: string; cargo: string; posicao: number | null; saldo_banco: number | null;
  comp_creditos: number; comp_debitos: number; comp_ajuste: number;
};
type RealDia = DiaEscala & { cliente_id: number; pessoa_id: number };
type PlanoDia = DiaPlano & { cliente_id: number; pessoa_id: number; dia: string };
type Dados = { socio: boolean; grupos: Grupo[]; pessoas: PessoaDado[]; real: RealDia[]; planejada: PlanoDia[]; feriados: string[] };
// O pincel escolhido na paleta
type Pincel = { codigo: Codigo; entrada?: string; saida?: string; intervalo?: string; rotulo: string };
type Toast = { id: number; nivel: "ok" | "aviso" | "erro"; texto: string; detalhes?: string[]; desfazer?: () => void };

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const chaveDe = (c: number, id: number) => `${c}:${id}`;
const horas = (min: number) => `${min < 0 ? "−" : min > 0 ? "+" : ""}${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, "0")}`;
const SEM_GRUPO = "";
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// Avisos iguais da mesma pessoa (mesma regra e título, em dias diferentes) viram uma linha só
type Grupo_Aviso = Aviso & { vezes: number; todos: string[] };
function agrupar(lista: Aviso[]): Grupo_Aviso[] {
  const m = new Map<string, Grupo_Aviso>();
  for (const a of lista) {
    const k = `${a.chave}|${a.regra}|${a.titulo}`;
    const g = m.get(k);
    if (!g) m.set(k, { ...a, vezes: 1, todos: [...a.dias] });
    else {
      g.vezes++;
      g.todos.push(...a.dias);
      if (a.nivel === "erro") g.nivel = "erro";
    }
  }
  return [...m.values()].map((g) => ({ ...g, todos: [...new Set(g.todos)].sort() }));
}
const resumo = (g: Grupo_Aviso) => (g.vezes > 1 ? `${g.vezes} vezes (${g.todos.slice(0, 6).map(br).join(", ")}${g.todos.length > 6 ? "…" : ""}) — ${g.texto}` : g.texto);

export const MODOS: { id: ModoEscala; nome: string; texto: string }[] = [
  { id: "real", nome: "Ponto (RHiD)", texto: "a escala do relógio e o que foi batido, ao vivo" },
  { id: "planejada", nome: "Planejada", texto: "a escala que a casa monta, com os avisos de lei" },
  { id: "comparar", nome: "Comparar", texto: "planejada × batido: faltas, atrasos e dias fora da escala" },
];

// Troca rápida entre as escalas (topo da aba Escala e da página do líder)
export function ModosEscala({ modo, onMudar, avisos }: { modo: ModoEscala; onMudar: (m: ModoEscala) => void; avisos?: number }) {
  return (
    <div className="ep-modos" role="tablist" aria-label="Qual escala">
      {MODOS.map((m) => (
        <button key={m.id} role="tab" aria-selected={modo === m.id} className={modo === m.id ? "on" : ""} onClick={() => onMudar(m.id)}>
          <span className={`ep-modo-icone m-${m.id}`} aria-hidden="true" />
          <span className="ep-modo-texto"><b>{m.nome}{m.id === "planejada" && avisos ? <i className="ep-modo-n">{avisos}</i> : null}</b><small>{m.texto}</small></span>
        </button>
      ))}
    </div>
  );
}

export default function EscalaPlanejada({ supabase, modo, casa, sincronizar, onAbrirPessoa, cabecalho }: {
  supabase: SupabaseClient; modo: ModoEscala;
  // Só os grupos desta casa (lib/escala/casas.ts); sem casa = todos os grupos de quem está vendo
  casa?: string;
  // Página do RH (sócio): o local e o setor de cada pessoa, para os grupos acompanharem a escala do RH
  sincronizar?: { cliente_id: number; pessoa_id: number; local: string; setor: string }[];
  onAbrirPessoa?: (chave: string) => void; cabecalho?: ReactNode;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [grupo, setGrupo] = useState(SEM_GRUPO);
  const [pincel, setPincel] = useState<Pincel | null>(null);
  const [outro, setOutro] = useState({ entrada: "08:00", saida: "16:20", intervalo: "12:00-13:00" });
  const [periodo, setPeriodo] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [verAvisos, setVerAvisos] = useState(false);
  const [ajuste, setAjuste] = useState<PessoaDado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const lidos = useRef<{ de: string; ate: string } | null>(null);
  const sincronizado = useRef(false);
  const agora = hoje();

  // ---------- Dados ----------
  const juntar = useCallback((novo: Dados, de: string, ate: string) => {
    setDados((v) => {
      if (!v) return novo;
      const fora = (d: string) => d < de || d > ate;
      return {
        ...novo,
        real: [...v.real.filter((x) => fora(x.dia)), ...novo.real],
        planejada: [...v.planejada.filter((x) => fora(x.dia)), ...novo.planejada],
        feriados: [...new Set([...v.feriados.filter(fora), ...novo.feriados])],
      };
    });
  }, []);
  const ler = useCallback(async (de: string, ate: string) => {
    const { data, error } = await supabase.rpc("escala_dados", { p_de: de, p_ate: ate });
    if (error) return setErro(error.message);
    setErro("");
    juntar(data as Dados, de, ate);
  }, [supabase, juntar]);

  // Lê o período da tela com 2 semanas antes e 1 depois (as regras olham os dias vizinhos)
  const garantir = useCallback(async (de: string, ate: string) => {
    const a = somarDias(de, -14), b = somarDias(ate, 7);
    const l = lidos.current;
    if (l && a >= l.de && b <= l.ate) return;
    if (sincronizar && !sincronizado.current) {
      sincronizado.current = true;
      await supabase.rpc("escala_membros_sincronizar", { p_itens: sincronizar });
    }
    lidos.current = l ? { de: a < l.de ? a : l.de, ate: b > l.ate ? b : l.ate } : { de: a, ate: b };
    // Lê em trechos de até 75 dias (limite da função)
    for (let x = a; x <= b; x = somarDias(x, 76)) await ler(x, somarDias(x, 75) < b ? somarDias(x, 75) : b);
  }, [ler, supabase, sincronizar]);

  // A leitura do RHiD a cada minuto: recarrega ontem e hoje quando termina
  useEffect(() => {
    const ch = supabase.channel("escala-planejada")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rhid_execucoes" }, (m) => {
        if ((m.new as { status?: string }).status === "ok") ler(somarDias(hoje(), -1), hoje());
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, ler]);

  // ---------- Montagem ----------
  const grupos = useMemo(() => (dados?.grupos ?? []).filter((g) => !casa || casaDoLocal(g.local) === casa), [dados?.grupos, casa]);
  const grupoDe = useMemo(() => new Map(grupos.map((g) => [g.id, g])), [grupos]);
  const daCasa = (dados?.pessoas ?? []).filter((p) => grupoDe.has(p.grupo_id));
  const vistas = daCasa.filter((p) => !grupo || p.grupo_id === grupo)
    .slice().sort((a, b) => (a.posicao ?? 1e6) - (b.posicao ?? 1e6) || a.nome.localeCompare(b.nome));
  const realDe = useMemo(() => {
    const m = new Map<string, Map<string, DiaEscala>>();
    for (const d of dados?.real ?? []) {
      const k = chaveDe(d.cliente_id, d.pessoa_id);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(d.dia, d);
    }
    return m;
  }, [dados?.real]);
  const plano = useMemo(() => {
    const m = new Map<string, Map<string, DiaPlano>>();
    for (const d of dados?.planejada ?? []) {
      const k = chaveDe(d.cliente_id, d.pessoa_id);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(d.dia, { codigo: d.codigo, entrada: d.entrada, saida: d.saida, intervalo: d.intervalo, obs: d.obs });
    }
    return m;
  }, [dados?.planejada]);
  const feriados = useMemo(() => new Set(dados?.feriados ?? []), [dados?.feriados]);
  const pessoaDe = useMemo(() => new Map((dados?.pessoas ?? []).map((p) => [chaveDe(p.cliente_id, p.id), p])), [dados?.pessoas]);

  const pessoas: PessoaEscala[] = vistas.map((p) => {
    const g = grupoDe.get(p.grupo_id);
    return {
      chave: chaveDe(p.cliente_id, p.id), nome: nomeProprio(p.nome), cargo: p.cargo ? nomeProprio(p.cargo) : "",
      local: g?.local ?? "", setor: g?.setor ?? "", dias: realDe.get(chaveDe(p.cliente_id, p.id)) ?? new Map(),
    };
  });

  // Avisos de lei de cada pessoa (só os que tocam o período da tela contam no painel)
  const avisos = useMemo(() => {
    const m = new Map<string, Aviso[]>();
    for (const p of pessoas) m.set(p.chave, avaliar(p.chave, p.nome, plano.get(p.chave) ?? new Map(), feriados));
    return m;
  }, [pessoas, plano, feriados]);
  const naTela = new Set(periodo);
  const avisosTela = [...avisos.values()].flat().filter((a) => a.dias.some((d) => naTela.has(d)));
  const agrupados = agrupar(avisosTela.filter((a) => a.nivel !== "info"));
  const erros = agrupados.filter((a) => a.nivel === "erro");
  const atencoes = agrupados.filter((a) => a.nivel === "aviso");
  const planejadosTela = pessoas.reduce((t, p) => t + periodo.filter((d) => plano.get(p.chave)?.get(d)?.codigo).length, 0);

  // Pincéis de horário: os horários mais usados nas pessoas da tela (planejada e RHiD)
  const pinceisHorario = useMemo(() => {
    const conta = new Map<string, { n: number; p: Pincel }>();
    const somar = (e?: string | null, s?: string | null, i?: string | null) => {
      if (!e || !s) return;
      const k = `${e}-${s}|${i ?? ""}`;
      const atual = conta.get(k);
      if (atual) atual.n++;
      else conta.set(k, { n: 1, p: { codigo: "T", entrada: e, saida: s, intervalo: i ?? undefined, rotulo: `${e}–${s}` } });
    };
    for (const p of pessoas) {
      for (const d of plano.get(p.chave)?.values() ?? []) if (d.codigo === "T") somar(d.entrada, d.saida, d.intervalo);
      for (const d of p.dias.values()) {
        const f = d.horario.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?:\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?/);
        if (f) somar(f[1].padStart(5, "0"), (f[4] ?? f[2]).padStart(5, "0"), f[3] ? `${f[2].padStart(5, "0")}-${f[3].padStart(5, "0")}` : null);
      }
    }
    return [...conta.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((x) => x.p).sort((a, b) => (a.entrada ?? "").localeCompare(b.entrada ?? ""));
  }, [pessoas, plano]);

  // ---------- Avisos na tela ----------
  const toastId = useRef(0);
  function avisar(t: Omit<Toast, "id">) {
    const id = ++toastId.current;
    setToasts((v) => [...v.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((v) => v.filter((x) => x.id !== id)), t.nivel === "ok" ? 5000 : 12000);
  }

  // ---------- Gravar ----------
  async function gravar(itens: { cliente_id: number; pessoa_id: number; dia: string; codigo: Codigo; entrada?: string | null; saida?: string | null; intervalo?: string | null }[]) {
    // Na tela na hora; no banco em seguida
    setDados((v) => v && {
      ...v,
      planejada: [
        ...v.planejada.filter((x) => !itens.some((i) => i.cliente_id === x.cliente_id && i.pessoa_id === x.pessoa_id && i.dia === x.dia)),
        ...itens.filter((i) => i.codigo).map((i) => ({ ...i, obs: "" })),
      ],
    });
    const { error } = await supabase.rpc("escala_gravar", { p_itens: itens });
    if (error) {
      avisar({ nivel: "erro", texto: `Não salvou: ${error.message}` });
      const l = lidos.current;
      if (l) ler(l.de, somarDias(l.de, 75) < l.ate ? somarDias(l.de, 75) : l.ate);
      return false;
    }
    return true;
  }

  async function pintar(celulas: Celula[]) {
    if (!pincel) return;
    const antes = new Map<string, Aviso[]>();
    for (const c of celulas) if (!antes.has(c.chave)) antes.set(c.chave, avisos.get(c.chave) ?? []);
    const itens = celulas.map((c) => {
      const p = pessoaDe.get(c.chave)!;
      return {
        cliente_id: p.cliente_id, pessoa_id: p.id, dia: c.dia, codigo: pincel.codigo,
        entrada: pincel.codigo === "T" ? pincel.entrada : null, saida: pincel.codigo === "T" ? pincel.saida : null,
        intervalo: pincel.codigo === "T" ? pincel.intervalo ?? null : null,
      };
    }).filter((i) => {
      // Não grava o que já está igual
      const d = plano.get(chaveDe(i.cliente_id, i.pessoa_id))?.get(i.dia);
      return (d?.codigo ?? "") !== i.codigo || (i.codigo === "T" && (d?.entrada !== i.entrada || d?.saida !== i.saida || (d?.intervalo ?? null) !== i.intervalo));
    });
    if (!itens.length) return;
    const desfazer = itens.map((i) => {
      const d = plano.get(chaveDe(i.cliente_id, i.pessoa_id))?.get(i.dia);
      return { cliente_id: i.cliente_id, pessoa_id: i.pessoa_id, dia: i.dia, codigo: (d?.codigo ?? "") as Codigo, entrada: d?.entrada ?? null, saida: d?.saida ?? null, intervalo: d?.intervalo ?? null };
    });
    const ok = await gravar(itens);
    if (!ok) return;

    // Conferir de novo só quem mudou e avisar o que apareceu de novo
    const novoPlano = new Map(plano);
    for (const i of itens) {
      const k = chaveDe(i.cliente_id, i.pessoa_id);
      const m = new Map(novoPlano.get(k) ?? []);
      m.set(i.dia, { codigo: i.codigo, entrada: i.entrada, saida: i.saida, intervalo: i.intervalo });
      novoPlano.set(k, m);
    }
    const novos: Aviso[] = [];
    for (const [k, velhos] of antes) {
      const p = pessoas.find((x) => x.chave === k);
      if (!p) continue;
      const agoraAv = avaliar(k, p.nome, novoPlano.get(k) ?? new Map(), feriados).filter((a) => a.nivel !== "info");
      novos.push(...agoraAv.filter((a) => !velhos.some((v) => v.regra === a.regra && v.texto === a.texto)));
    }
    const curtos = itens.some((i) => i.dia >= agora && i.dia < somarDias(agora, ANTECEDENCIA.dias));
    const grupos_ = agrupar(novos);
    const detalhes = [
      ...grupos_.slice(0, 4).map((a) => `${a.nome.split(" ")[0]} — ${a.titulo}: ${resumo(a)} (${a.lei})`),
      ...(grupos_.length > 4 ? [`e mais ${grupos_.length - 4} no painel de avisos`] : []),
      ...(curtos ? [`Mudança com menos de ${ANTECEDENCIA.dias} dias: combine com a pessoa e registre o aceite (${ANTECEDENCIA.lei}).`] : []),
    ];
    const n = itens.length;
    avisar({
      nivel: novos.some((a) => a.nivel === "erro") ? "erro" : novos.length || curtos ? "aviso" : "ok",
      texto: grupos_.length ? `Salvo, mas ${grupos_.length === 1 ? "apareceu 1 aviso" : `apareceram ${grupos_.length} avisos`}` : `${n} ${n === 1 ? "dia salvo" : "dias salvos"}`,
      detalhes, desfazer: () => gravar(desfazer).then((x) => x && avisar({ nivel: "ok", texto: "Desfeito" })),
    });
  }

  async function copiarRhid() {
    if (!periodo.length || !dados) return;
    const ids = grupo ? [grupo] : grupos.map((g) => g.id);
    if (!window.confirm(`Preencher os dias ainda vazios de ${dataBR(periodo[0])} a ${dataBR(periodo[periodo.length - 1])} com a escala do RHiD? O que já foi montado não muda.`)) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc("escala_copiar_rhid", { p_grupos: ids, p_de: periodo[0], p_ate: periodo[periodo.length - 1], p_sobrescrever: false });
    setOcupado(false);
    if (error) return avisar({ nivel: "erro", texto: error.message });
    await ler(somarDias(periodo[0], -14), somarDias(periodo[periodo.length - 1], 7) < somarDias(periodo[0], 61) ? somarDias(periodo[periodo.length - 1], 7) : somarDias(periodo[0], 61));
    avisar({ nivel: "ok", texto: data ? `${data} dias copiados do RHiD` : "Nada a copiar: os dias já estavam montados (ou o RHiD ainda não leu esse período)" });
  }

  async function salvarAjuste(dias: number, motivo: string) {
    if (!ajuste) return;
    const { error } = await supabase.rpc("escala_compensacao_ajustar", { p_cliente: ajuste.cliente_id, p_pessoa: ajuste.id, p_dias: dias, p_motivo: motivo });
    if (error) return avisar({ nivel: "erro", texto: error.message });
    setAjuste(null);
    const l = lidos.current;
    if (l) await ler(somarDias(agora, -14), somarDias(agora, 14));
    avisar({ nivel: "ok", texto: "Saldo de folgas acertado" });
  }

  // Esc larga o pincel
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPincel(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // ---------- Colunas a mais ----------
  const colunas: ColunaExtra[] = modo === "real" ? [] : [
    {
      titulo: "Comp.", dica: "Folgas a compensar: feriados trabalhados desde 01/11/2026 + acertos − folgas compensadas (FC) já marcadas",
      valor: (p) => {
        const d = pessoaDe.get(p.chave);
        if (!d) return null;
        const s = d.comp_creditos + Number(d.comp_ajuste) - d.comp_debitos;
        return <button className={`ep-comp${s > 0 ? " deve" : s < 0 ? " neg" : ""}`} onClick={() => setAjuste(d)} title={`${d.comp_creditos} feriado(s) trabalhado(s), ${d.comp_debitos} FC marcada(s), acerto ${d.comp_ajuste}. Clique para acertar.`}>{s > 0 ? `+${s}` : s}</button>;
      },
    },
    {
      titulo: "Banco", dica: "Saldo do banco de horas no RHiD",
      valor: (p) => {
        const s = pessoaDe.get(p.chave)?.saldo_banco;
        return s == null ? <span className="muted">—</span> : <span className={s < 0 ? "es-ruim" : ""}>{horas(s)}</span>;
      },
    },
  ];
  const horasPlanejadas = (k: string) => periodo.reduce((t, d) => t + (jornada(plano.get(k)?.get(d))?.liquido ?? 0), 0);
  if (modo !== "real") colunas.unshift({
    titulo: "Horas", dica: "Horas de trabalho planejadas no período da tela (sem o intervalo)",
    valor: (p) => { const h = horasPlanejadas(p.chave); return h ? horasTxt(h) : <span className="muted">—</span>; },
  });

  // ---------- Mandar para a equipe ----------
  const tituloEnvio = grupo && grupoDe.get(grupo) ? grupoDe.get(grupo)!.nome : casaPorId(casa ?? "")?.nome ?? "Escala";
  const faixa = periodo.length ? `${br(periodo[0])} a ${br(periodo[periodo.length - 1])}` : "";
  async function copiarWhatsApp() {
    const linhas = [`*Escala · ${tituloEnvio}*`, faixa, ""];
    for (const d of periodo) {
      const porRotulo = new Map<string, string[]>();
      for (const p of pessoas) {
        const x = plano.get(p.chave)?.get(d);
        if (!x?.codigo) continue;
        const r = rotuloDia(x, false);
        porRotulo.set(r, [...(porRotulo.get(r) ?? []), p.nome.split(" ")[0] + (p.nome.split(" ").length > 1 ? ` ${p.nome.split(" ").slice(-1)[0][0]}.` : "")]);
      }
      if (!porRotulo.size) continue;
      linhas.push(`*${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${br(d)}*${feriados.has(d) ? " (feriado)" : ""}`);
      const ordem = [...porRotulo.entries()].sort((a, b) => (/^\d/.test(a[0]) ? 0 : 1) - (/^\d/.test(b[0]) ? 0 : 1) || a[0].localeCompare(b[0]));
      for (const [r, nomes] of ordem) linhas.push(`${/^\d/.test(r) ? r : `${r}:`} ${nomes.join(", ")}`);
      linhas.push("");
    }
    if (linhas.length <= 3) return avisar({ nivel: "aviso", texto: "Nada planejado no período da tela para mandar." });
    try {
      await navigator.clipboard.writeText(linhas.join("\n").trim());
      avisar({ nivel: "ok", texto: "Escala copiada: cole na conversa do WhatsApp" });
    } catch {
      avisar({ nivel: "erro", texto: "O navegador não deixou copiar. Use o Baixar PDF." });
    }
  }
  const [imprimindo, setImprimindo] = useState(false);
  function baixarPdf() {
    if (!planejadosTela) return avisar({ nivel: "aviso", texto: "Nada planejado no período da tela para mandar." });
    setImprimindo(true);
  }
  useEffect(() => {
    if (!imprimindo) return;
    const antes = document.title;
    const fim = () => { document.title = antes; document.body.classList.remove("ep-imprimindo"); setImprimindo(false); };
    window.addEventListener("afterprint", fim, { once: true });
    document.body.classList.add("ep-imprimindo");
    document.title = `Escala ${tituloEnvio} ${faixa}`.replace(/\//g, "-");
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [imprimindo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro && !dados) return <section className="es-bloco"><p className="tv-alerta">{erro}</p></section>;
  const podeEditar = modo !== "real";
  const semEscala = !!dados && modo !== "real" && periodo.length > 0 && planejadosTela === 0 && pessoas.length > 0;

  return (
    <section className="es-bloco pt-escala-bloco ep">
      {cabecalho}
      {erro && <p className="tv-alerta">{erro}</p>}

      {grupos.length > 1 && (
        <div className="ep-grupos" role="group" aria-label="Grupo da escala">
          <button className={grupo === SEM_GRUPO ? "on" : ""} onClick={() => setGrupo(SEM_GRUPO)}>Todos os grupos <span>{daCasa.length}</span></button>
          {grupos.map((g) => (
            <button key={g.id} className={grupo === g.id ? "on" : ""} onClick={() => setGrupo(g.id)}
              title={g.lideres.length ? `Líder: ${g.lideres.map((l) => l.nome).join(", ")}` : "Sem líder"}>
              {g.nome} <span>{dados?.pessoas.filter((p) => p.grupo_id === g.id).length}</span>
              {g.lideres.length > 0 && <em>{g.lideres.map((l) => l.nome.split(" ")[0]).join(", ")}</em>}
            </button>
          ))}
        </div>
      )}

      {podeEditar && (
        <div className={`ep-paleta${pincel ? " ativa" : ""}`}>
          <span className="ep-paleta-rotulo">{pincel ? <>Pintando com <b>{pincel.rotulo}</b> · arraste sobre os dias · <kbd>Esc</kbd> solta</> : "Escolha um pincel e arraste sobre os dias"}</span>
          <div className="ep-pinceis" role="group" aria-label="Pincéis">
            {pinceisHorario.map((p) => (
              <button key={`${p.entrada}${p.saida}${p.intervalo}`} className={`ep-pincel t${pincel?.codigo === "T" && pincel.entrada === p.entrada && pincel.saida === p.saida && pincel.intervalo === p.intervalo ? " on" : ""}`}
                onClick={() => setPincel((x) => (x?.codigo === "T" && x.entrada === p.entrada && x.saida === p.saida && x.intervalo === p.intervalo ? null : p))}
                title={p.intervalo ? `Intervalo ${p.intervalo.replace("-", "–")}` : "Sem intervalo"}>
                {p.rotulo}
              </button>
            ))}
            <span className="ep-outro">
              <input type="time" value={outro.entrada} onChange={(e) => setOutro({ ...outro, entrada: e.target.value })} aria-label="Entrada" />
              <span>–</span>
              <input type="time" value={outro.saida} onChange={(e) => setOutro({ ...outro, saida: e.target.value })} aria-label="Saída" />
              <input className="ep-intervalo" value={outro.intervalo} onChange={(e) => setOutro({ ...outro, intervalo: e.target.value })} placeholder="12:00-13:00" aria-label="Intervalo" title="Intervalo (início-fim)" />
              <button className={`ep-pincel t${pincel?.rotulo === "Outro horário" ? " on" : ""}`}
                onClick={() => setPincel({ codigo: "T", entrada: outro.entrada, saida: outro.saida, intervalo: /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(outro.intervalo) ? outro.intervalo : undefined, rotulo: "Outro horário" })}>
                Usar
              </button>
            </span>
            <span className="ep-sep" aria-hidden="true" />
            {CODIGOS.map((c) => (
              <button key={c.codigo} className={`ep-pincel c-${c.codigo}${pincel?.codigo === c.codigo ? " on" : ""}`}
                onClick={() => setPincel((x) => (x?.codigo === c.codigo ? null : { codigo: c.codigo, rotulo: c.nome }))} title={c.nome}>
                <b>{c.curto}</b><span>{c.nome.replace(" (feriado)", "")}</span>
              </button>
            ))}
            <button className={`ep-pincel limpar${pincel?.codigo === "" ? " on" : ""}`} onClick={() => setPincel((x) => (x?.codigo === "" ? null : { codigo: "", rotulo: "Limpar" }))}>Limpar</button>
          </div>
          <div className="ep-acoes">
            <button className="ghost small" onClick={copiarRhid} disabled={ocupado}>Copiar do RHiD</button>
            <span className="ep-enviar" role="group" aria-label="Mandar para a equipe">
              <button className="ghost small" onClick={baixarPdf} title="Gera o PDF do período da tela para mandar no grupo">Baixar PDF</button>
              <button className="ghost small" onClick={copiarWhatsApp} title="Copia a escala em texto, dia a dia, para colar no WhatsApp">Copiar p/ WhatsApp</button>
            </span>
            <button className={`ep-avisos-botao${erros.length ? " erro" : atencoes.length ? " aviso" : " ok"}`} onClick={() => setVerAvisos((v) => !v)} aria-expanded={verAvisos}>
              {erros.length + atencoes.length ? <><b>{erros.length}</b> fora da lei · <b>{atencoes.length}</b> atenção</> : "✓ Dentro da lei"}
            </button>
          </div>
        </div>
      )}

      {semEscala && (
        <div className="ep-vazio">
          <div><b>Este período ainda não tem escala planejada.</b><span className="muted"> Comece com a escala que já está no RHiD e ajuste em cima.</span></div>
          <button className="small" onClick={copiarRhid} disabled={ocupado}>Começar copiando do RHiD</button>
        </div>
      )}

      {podeEditar && verAvisos && (
        <PainelAvisos avisos={agrupados} onIr={(k) => {
          const tr = document.querySelector(`tr[data-chave="${k}"]`) as HTMLElement | null;
          tr?.scrollIntoView({ block: "center", behavior: "smooth" });
          tr?.classList.add("ep-piscar");
          setTimeout(() => tr?.classList.remove("ep-piscar"), 1800);
        }} />
      )}

      {!dados ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div> : pessoas.length === 0 ? (
        <p className="muted tv-nada">{dados.socio ? "Ninguém desta casa nos grupos da escala ainda. Os grupos seguem a escala do RH (local e setor de cada pessoa): abra RH › Escala uma vez para montá-los." : "Nenhuma pessoa no seu grupo."}</p>
      ) : null}
      {dados && pessoas.length > 0 && (
        <PontoEscala modo={modo} pessoas={pessoas} plano={plano} avisos={avisos} feriados={feriados} garantir={garantir}
          onPeriodo={setPeriodo} pintar={podeEditar && pincel ? pintar : undefined} colunasExtras={colunas}
          onAbrir={onAbrirPessoa} />
      )}
      {!dados && <PontoEscala modo={modo} pessoas={[]} garantir={garantir} onPeriodo={setPeriodo} />}

      <div className="ep-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ep-toast ${t.nivel}`}>
            <div className="ep-toast-cabeca">
              <b>{t.texto}</b>
              {t.desfazer && <button onClick={() => { t.desfazer!(); setToasts((v) => v.filter((x) => x.id !== t.id)); }}>Desfazer</button>}
              <button className="ep-toast-x" onClick={() => setToasts((v) => v.filter((x) => x.id !== t.id))} aria-label="Fechar">×</button>
            </div>
            {t.detalhes?.map((d, i) => <p key={i}>{d}</p>)}
          </div>
        ))}
      </div>

      {imprimindo && createPortal(
        <div className="ep-impressao">
          <style>{"@page { size: A4 landscape; margin: 9mm; }"}</style>
          <header><b>Escala · {tituloEnvio}</b><span>{faixa}</span></header>
          <table>
            <thead>
              <tr><th>Nome</th>{periodo.map((d) => <th key={d} className={feriados.has(d) ? "fer" : ""}>{SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}<br />{br(d)}</th>)}</tr>
            </thead>
            <tbody>
              {pessoas.map((p, i) => (
                <Fragment key={p.chave}>
                  {!grupo && (i === 0 || pessoas[i - 1].setor !== p.setor) && <tr key={`s${p.chave}`} className="setor"><td colSpan={periodo.length + 1}>{p.setor || p.local}</td></tr>}
                  <tr key={p.chave}>
                    <td className="nome">{p.nome}</td>
                    {periodo.map((d) => {
                      const x = plano.get(p.chave)?.get(d);
                      return <td key={d} className={x?.codigo && x.codigo !== "T" ? `c-${x.codigo}` : ""}>{x?.codigo ? rotuloDia(x, true) : ""}</td>;
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          <footer>F folga · FC folga compensada · BH folga do banco de horas · FÉR férias · AT atestado · LIC licença · Gerada no Brasico em {dataBR(hoje())}</footer>
        </div>, document.body)}

      {ajuste && <AjusteCompensacao pessoa={ajuste} onSalvar={salvarAjuste} onFechar={() => setAjuste(null)} />}
    </section>
  );
}

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// O dia em texto: horário (07:00–15:20) ou o nome do código (Folga, Férias…); curto = a sigla, para a tabela
function rotuloDia(x: DiaPlano, curto: boolean) {
  if (x.codigo === "T") return x.entrada && x.saida ? `${x.entrada}–${x.saida}` : "Trabalho";
  const c = CODIGOS.find((k) => k.codigo === x.codigo);
  return curto ? c?.curto ?? x.codigo : c?.nome.replace(" (feriado)", "") ?? x.codigo;
}

function PainelAvisos({ avisos, onIr }: { avisos: Grupo_Aviso[]; onIr: (chave: string) => void }) {
  const porPessoa = new Map<string, Grupo_Aviso[]>();
  for (const a of avisos) porPessoa.set(a.chave, [...(porPessoa.get(a.chave) ?? []), a]);
  const ordem = [...porPessoa.entries()].sort((a, b) => b[1].filter((x) => x.nivel === "erro").length - a[1].filter((x) => x.nivel === "erro").length || a[1][0].nome.localeCompare(b[1][0].nome));
  return (
    <div className="ep-painel">
      {ordem.length === 0 ? <p className="muted">Nada fora do padrão no período da tela. As regras: até 10 h por dia, 11 h entre jornadas, intervalo de 30 min a 2 h, nunca 7 dias seguidos, folgas e horas da semana, domingos, feriados e férias.</p> : (
        <ul>
          {ordem.map(([k, lista]) => (
            <li key={k}>
              <button className="ep-painel-nome" onClick={() => onIr(k)}>{lista[0].nome}</button>
              <ul>
                {lista.map((a, i) => (
                  <li key={i} className={a.nivel}><b>{a.titulo}</b> {resumo(a)} <small>{a.lei}</small></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="muted ep-painel-nota">Regras da CLT, da convenção de Pipa (RN000194/2026 e aditivo RN000207/2026) e da EC 141/2026, como no capítulo 16 do RH Inteligente. O RHiD não informa o sexo: a regra do domingo das mulheres (a cada 2 semanas) aparece como atenção.</p>
    </div>
  );
}

function AjusteCompensacao({ pessoa, onSalvar, onFechar }: { pessoa: PessoaDado; onSalvar: (dias: number, motivo: string) => void; onFechar: () => void }) {
  const [dias, setDias] = useState("1");
  const [motivo, setMotivo] = useState("");
  const saldo = pessoa.comp_creditos + Number(pessoa.comp_ajuste) - pessoa.comp_debitos;
  return (
    <div className="ep-fundo" onClick={onFechar}>
      <div className="ep-dialogo" role="dialog" aria-label="Acertar folgas a compensar" onClick={(e) => e.stopPropagation()}>
        <h3>Folgas a compensar · {nomeProprio(pessoa.nome)}</h3>
        <dl>
          <div><dt>Feriados trabalhados</dt><dd>{pessoa.comp_creditos}</dd></div>
          <div><dt>Folgas compensadas (FC)</dt><dd>{pessoa.comp_debitos}</dd></div>
          <div><dt>Acertos</dt><dd>{Number(pessoa.comp_ajuste)}</dd></div>
          <div className="total"><dt>Saldo</dt><dd>{saldo}</dd></div>
        </dl>
        <p className="muted">Para o saldo que já existia antes da escala no Brasico, ou folga dada fora dela. Use número negativo para tirar.</p>
        <label>Dias<input type="number" step="0.5" value={dias} onChange={(e) => setDias(e.target.value)} /></label>
        <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: saldo de outubro" /></label>
        <div className="ep-dialogo-acoes">
          <button className="ghost small" onClick={onFechar}>Cancelar</button>
          <button className="small" disabled={!Number(dias) || !motivo.trim()} onClick={() => onSalvar(Number(dias), motivo)}>Salvar acerto</button>
        </div>
      </div>
    </div>
  );
}
