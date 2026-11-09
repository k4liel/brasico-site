"use client";

// Escala planejada (06/11/2026): a escala que a casa monta, dia a dia e mês a mês, no mesmo visual da escala
// do RH (PontoEscala). Quem pode mexer (sócio, ou líder do grupo) escolhe um "pincel" na paleta — um horário,
// Folga, Folga compensada, Banco de horas, Férias, Atestado, Licença ou Limpar — e arrasta sobre os dias e as
// pessoas. Cada mudança grava na hora (escala_gravar), pode ser desfeita, e é conferida com a lei
// (lib/escala/regras.ts): o que sai do padrão aparece na hora num aviso, no dia, no nome e no painel de avisos.
// Os dados vêm de escala_dados (só os grupos de quem está vendo); o mês começa copiado do RHiD.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PontoEscala, { AFASTADOS, ordemDaGrade, type Celula, type ColunaExtra, type DiaEscala, type ModoEscala, type PessoaEscala } from "./PontoEscala";
import { ANTECEDENCIA, CODIGOS, avaliar, horasTxt, jornada, type Aviso, type Codigo, type DiaPlano } from "@/lib/escala/regras";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";
import { casaDoLocal, casaPorId } from "@/lib/escala/casas";
import EscalaCompensas, { prazo, type CompDados, type PessoaComp } from "./EscalaCompensas";
import { ChipsLideres, EditorLideres, useLideranca } from "./EscalaLideres";
import { createPortal } from "react-dom";

type Grupo = { id: string; nome: string; local: string; setor: string; fixo?: boolean; postos?: string[]; lideres: { pessoa_id: string; nome: string; usuario: string }[] };
type PessoaDado = {
  cliente_id: number; id: number; nome: string; grupo_id: string; cargo: string; posicao: number | null; saldo_banco: number | null;
  comp_creditos: number; comp_debitos: number; comp_ajuste: number;
  // Afastado hoje (tipo da justificativa do RHiD): vai para a área "Afastados" no fim do local
  afastado?: string | null;
  // Contratado do RH sem cadastro no relógio (escala_extras, cliente_id = 0)
  fora_do_ponto?: boolean;
  // Apelido na escala (escala_apelidos): a linha mostra só ele
  apelido?: string | null;
};
type RealDia = DiaEscala & { cliente_id: number; pessoa_id: number };
type PlanoDia = DiaPlano & { cliente_id: number; pessoa_id: number; dia: string };
type Dados = { socio: boolean; grupos: Grupo[]; pessoas: PessoaDado[]; real: RealDia[]; planejada: PlanoDia[]; feriados: string[] };
// O pincel escolhido na paleta
type Pincel = { codigo: Codigo; entrada?: string; saida?: string; intervalo?: string; rotulo: string; posto?: string };
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
];
// O modo "comparar" (planejada × batido) saiu da tela em 09/11/2026, a pedido do dono; o código dele continua no PontoEscala

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

export default function EscalaPlanejada({ supabase, modo, casa, sincronizar, onAbrirPessoa, cabecalho, recarga = 0 }: {
  supabase: SupabaseClient; modo: ModoEscala;
  // Só os grupos desta casa (lib/escala/casas.ts); sem casa = todos os grupos de quem está vendo
  casa?: string;
  // Página do RH (sócio): o local e o setor de cada pessoa, para os grupos acompanharem a escala do RH
  sincronizar?: { cliente_id: number; pessoa_id: number; local: string; setor: string }[];
  onAbrirPessoa?: (chave: string) => void; cabecalho?: ReactNode;
  // Muda quando a organização do Ponto mudou (grupos sincronizados): relê o período da tela
  recarga?: number;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  // Filtro do topo: um botão por local (os setores ficam dentro da grade); "" = todos
  const [grupo, setGrupo] = useState(SEM_GRUPO);
  // Edição no bloquinho: clicar (ou arrastar sobre vários dias) abre a janelinha para escolher o que eles viram
  const [editor, setEditor] = useState<{ celulas: Celula[]; x: number; y: number } | null>(null);
  const ponteiro = useRef({ x: 0, y: 0 });
  const [outro, setOutro] = useState({ entrada: "08:00", saida: "16:20", intervalo: "12:00-13:00" });
  const [periodo, setPeriodo] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [verAvisos, setVerAvisos] = useState(false);
  // Banco de compensas (escala_compensas_dados): saldo de cada pessoa, feriados a confirmar
  const [comp, setComp] = useState<CompDados | null>(null);
  // Líderes direto na grade: bolinhas no cabeçalho da casa e do setor (só sócios)
  const lid = useLideranca(supabase, !!dados?.socio && modo === "planejada");
  const [lidEditor, setLidEditor] = useState<{ local: string; setor: string | null; x: number; y: number } | null>(null);
  // Apelido: clicar no nome abre a caixinha para escrever
  const [apelidoDe, setApelidoDe] = useState<{ chave: string; nome: string; apelido: string; x: number; y: number } | null>(null);
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

  const lerComp = useCallback(async () => {
    const { data } = await supabase.rpc("escala_compensas_dados");
    if (data) setComp(data as CompDados);
  }, [supabase]);
  useEffect(() => { lerComp(); }, [lerComp, recarga]);

  // A organização do Ponto mudou: relê o período que está na tela
  const periodoRef = useRef<string[]>([]);
  const mudarPeriodo = useCallback((ds: string[]) => { periodoRef.current = ds; setPeriodo(ds); }, []);
  useEffect(() => {
    if (!recarga) return;
    const ps = periodoRef.current;
    lidos.current = null;
    if (ps.length) garantir(ps[0], ps[ps.length - 1]);
  }, [recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  // Onde o dedo/mouse soltou (a janelinha abre ali)
  useEffect(() => {
    const f = (e: PointerEvent) => { ponteiro.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerup", f, true);
    return () => window.removeEventListener("pointerup", f, true);
  }, []);

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
  // Um botão por local no topo (antes era um por local + setor: ficava comprido demais)
  const locais = useMemo(() => {
    const m = new Map<string, { local: string; pessoas: number; lideres: string[] }>();
    for (const g of grupos) if (!m.has(g.local)) m.set(g.local, { local: g.local, pessoas: 0, lideres: [] });
    for (const p of daCasa) { const l = m.get(grupoDe.get(p.grupo_id)?.local ?? ""); if (l) l.pessoas++; }
    for (const g of grupos) for (const l of g.lideres) { const x = m.get(g.local)!; if (!x.lideres.includes(l.nome)) x.lideres.push(l.nome); }
    return [...m.values()].filter((l) => l.pessoas > 0).sort((a, b) => a.local.localeCompare(b.local));
  }, [grupos, grupoDe, daCasa]);
  const vistas = daCasa.filter((p) => !grupo || grupoDe.get(p.grupo_id)?.local === grupo)
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
      m.get(k)!.set(d.dia, { codigo: d.codigo, entrada: d.entrada, saida: d.saida, intervalo: d.intervalo, obs: d.obs, posto: d.posto });
    }
    return m;
  }, [dados?.planejada]);
  const feriados = useMemo(() => new Set(dados?.feriados ?? []), [dados?.feriados]);
  const pessoaDe = useMemo(() => new Map((dados?.pessoas ?? []).map((p) => [chaveDe(p.cliente_id, p.id), p])), [dados?.pessoas]);

  const pessoas: PessoaEscala[] = vistas.map((p) => {
    const g = grupoDe.get(p.grupo_id);
    return {
      chave: chaveDe(p.cliente_id, p.id), nome: p.apelido || nomeProprio(p.nome), completo: nomeProprio(p.nome), cargo: p.cargo ? nomeProprio(p.cargo) : "",
      // Espelho do Ponto: quem o RHiD afasta hoje fica na área "Afastados" no fim do local
      local: g?.local ?? "", setor: p.afastado ? AFASTADOS : g?.setor ?? "", dias: realDe.get(chaveDe(p.cliente_id, p.id)) ?? new Map(),
      hoje: p.afastado ? { texto: `Afastado (${p.afastado})`, classe: "afastado" } : undefined,
      obs: p.fora_do_ponto ? "fora do ponto" : undefined,
    };
  });

  // Grupos criados à mão ainda sem ninguém (Reservas, Financeiro…): aparecem vazios, como no Ponto
  const gruposVazios = grupos.filter((g) => g.fixo && !daCasa.some((p) => p.grupo_id === g.id) && (!grupo || g.local === grupo))
    .map((g) => ({ local: g.local, setor: g.setor }));

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
  async function gravar(itens: { cliente_id: number; pessoa_id: number; dia: string; codigo: Codigo; entrada?: string | null; saida?: string | null; intervalo?: string | null; posto?: string | null }[]) {
    // Na tela na hora; no banco em seguida
    setDados((v) => v && {
      ...v,
      planejada: [
        ...v.planejada.filter((x) => !itens.some((i) => i.cliente_id === x.cliente_id && i.pessoa_id === x.pessoa_id && i.dia === x.dia)),
        ...itens.filter((i) => i.codigo).map((i) => ({ ...i, obs: "" })),
      ],
    });
    const { error } = await supabase.rpc("escala_gravar", { p_itens: itens });
    lerComp();
    if (error) {
      avisar({ nivel: "erro", texto: `Não salvou: ${error.message}` });
      const l = lidos.current;
      if (l) ler(l.de, somarDias(l.de, 75) < l.ate ? somarDias(l.de, 75) : l.ate);
      return false;
    }
    return true;
  }

  const compDe = useMemo(() => new Map((comp?.pessoas ?? []).map((x) => [chaveDe(x.cliente_id, x.id), x] as [string, PessoaComp])), [comp]);
  // FC só com compensa em aberto: quantas FC novas cada pessoa ganharia × quantas compensas ela tem
  function fcSemSaldo(celulas: Celula[]) {
    const novas = new Map<string, number>();
    for (const c of celulas) if (plano.get(c.chave)?.get(c.dia)?.codigo !== "FC") novas.set(c.chave, (novas.get(c.chave) ?? 0) + 1);
    const faltam = [...novas].filter(([k, n]) => n > (compDe.get(k)?.compensas.filter((x) => x.situacao === "aberta").length ?? 0));
    return faltam.map(([k]) => pessoas.find((p) => p.chave === k)?.nome.split(" ")[0] ?? "");
  }
  // Feriados entre os dias escolhidos: o que já se disse (trabalhou → compensa) de cada um
  function feriadosDe(celulas: Celula[]) {
    return celulas.filter((c) => feriados.has(c.dia)).map((c) => {
      const x = compDe.get(c.chave)?.compensas.find((k) => k.origem === "feriado" && k.feriado === c.dia);
      return { celula: c, passou: c.dia <= agora, compensa: x && x.situacao !== "cancelada" ? x : null, naoTrabalhou: x?.situacao === "cancelada" };
    });
  }
  async function marcarFeriado(celulas: Celula[], trabalhou: boolean) {
    setEditor(null);
    for (const c of celulas) {
      const p = pessoaDe.get(c.chave);
      if (!p) continue;
      const { error } = await supabase.rpc("escala_compensa_feriado", { p_cliente: p.cliente_id, p_pessoa: p.id, p_feriado: c.dia, p_trabalhou: trabalhou });
      if (error) { avisar({ nivel: "erro", texto: error.message }); break; }
    }
    await lerComp();
    avisar({ nivel: "ok", texto: trabalhou ? `${celulas.length === 1 ? "Compensa lançada" : `${celulas.length} compensas lançadas`}: vale 60 dias` : "Marcado: não trabalhou no feriado" });
  }

  // Onde a pessoa fica no dia, nos grupos que revezam (escala_grupos.postos): só quando todos os escolhidos têm postos
  function postosDe(celulas: Celula[]) {
    const listas = [...new Set(celulas.map((c) => c.chave))].map((k) => grupoDe.get(pessoaDe.get(k)?.grupo_id ?? "")?.postos ?? []);
    if (!listas.length || listas.some((l) => !l.length)) return [];
    return [...new Set(listas.flat())];
  }

  function pintar(celulas: Celula[]) {
    if (!celulas.length) return;
    const { x, y } = ponteiro.current;
    setEditor({ celulas, x, y });
  }

  async function aplicar(celulas: Celula[], pincel: Pincel) {
    setEditor(null);
    const antes = new Map<string, Aviso[]>();
    for (const c of celulas) if (!antes.has(c.chave)) antes.set(c.chave, avisos.get(c.chave) ?? []);
    const itens = celulas.map((c) => {
      const p = pessoaDe.get(c.chave)!;
      return {
        cliente_id: p.cliente_id, pessoa_id: p.id, dia: c.dia, codigo: pincel.codigo,
        entrada: pincel.codigo === "T" ? pincel.entrada : null, saida: pincel.codigo === "T" ? pincel.saida : null,
        intervalo: pincel.codigo === "T" ? pincel.intervalo ?? null : null,
        posto: pincel.codigo === "T" ? pincel.posto ?? "" : "",
      };
    }).filter((i) => {
      // Não grava o que já está igual
      const d = plano.get(chaveDe(i.cliente_id, i.pessoa_id))?.get(i.dia);
      return (d?.codigo ?? "") !== i.codigo || (i.codigo === "T" && (d?.entrada !== i.entrada || d?.saida !== i.saida || (d?.intervalo ?? null) !== i.intervalo || (d?.posto ?? "") !== i.posto));
    });
    if (!itens.length) return;
    const desfazer = itens.map((i) => {
      const d = plano.get(chaveDe(i.cliente_id, i.pessoa_id))?.get(i.dia);
      return { cliente_id: i.cliente_id, pessoa_id: i.pessoa_id, dia: i.dia, codigo: (d?.codigo ?? "") as Codigo, entrada: d?.entrada ?? null, saida: d?.saida ?? null, intervalo: d?.intervalo ?? null, posto: d?.posto ?? "" };
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
    const ids = grupos.filter((g) => !grupo || g.local === grupo).map((g) => g.id);
    if (!window.confirm(`Preencher os dias ainda vazios de ${dataBR(periodo[0])} a ${dataBR(periodo[periodo.length - 1])} com a escala do RHiD? O que já foi montado não muda.`)) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc("escala_copiar_rhid", { p_grupos: ids, p_de: periodo[0], p_ate: periodo[periodo.length - 1], p_sobrescrever: false });
    setOcupado(false);
    if (error) return avisar({ nivel: "erro", texto: error.message });
    await ler(somarDias(periodo[0], -14), somarDias(periodo[periodo.length - 1], 7) < somarDias(periodo[0], 61) ? somarDias(periodo[periodo.length - 1], 7) : somarDias(periodo[0], 61));
    avisar({ nivel: "ok", texto: data ? `${data} dias copiados do RHiD` : "Nada a copiar: os dias já estavam montados (ou o RHiD ainda não leu esse período)" });
  }



  // Esc fecha a janelinha
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setEditor(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // ---------- Colunas a mais ----------
  // Comp. e Banco vêm do RHiD: só para sócios (o líder não vê nada do RHiD)
  // Comp. = compensas em aberto do banco de compensas (todos veem); Banco = banco de horas do RHiD (só sócios)
  const colunas: ColunaExtra[] = modo === "real" ? [] : [
    {
      titulo: "Comp.", dica: "Compensas em aberto: feriados trabalhados ainda sem a folga compensada (FC)",
      valor: (p) => {
        const c = compDe.get(p.chave);
        const ab = c?.compensas.filter((x) => x.situacao === "aberta") ?? [];
        if (!ab.length) return <span className="muted">0</span>;
        const pior = ab.some((x) => prazo(x, comp!.hoje) === "vencida") ? " vencida" : ab.some((x) => prazo(x, comp!.hoje) === "vencendo") ? " vencendo" : "";
        return <span className={`ep-comp deve${pior}`} title={ab.map((x) => (x.feriado ? `Feriado ${dataBR(x.feriado)}` : `Saldo: ${x.motivo}`) + (x.vence_em ? ` · até ${dataBR(x.vence_em)}` : "")).join("\n")}>{ab.length}</span>;
      },
    },
    ...(dados?.socio ? [{
      titulo: "Banco", dica: "Saldo do banco de horas no RHiD",
      valor: (p: PessoaEscala) => {
        const sb = pessoaDe.get(p.chave)?.saldo_banco;
        return sb == null ? <span className="muted">—</span> : <span className={sb < 0 ? "es-ruim" : ""}>{horas(sb)}</span>;
      },
    }] : []),
  ];

  const horasPlanejadas = (k: string) => periodo.reduce((t, d) => t + (jornada(plano.get(k)?.get(d))?.liquido ?? 0), 0);
  if (modo !== "real") colunas.unshift({
    titulo: "Horas", dica: "Horas de trabalho planejadas no período da tela (sem o intervalo)",
    valor: (p) => { const h = horasPlanejadas(p.chave); return h ? horasTxt(h) : <span className="muted">—</span>; },
  });

  // ---------- Mandar para a equipe ----------
  const tituloEnvio = grupo || casaPorId(casa ?? "")?.nome || "";
  const cabecaEnvio = tituloEnvio ? `Escala · ${tituloEnvio}` : "Escala";
  const faixa = periodo.length ? `${br(periodo[0])} a ${br(periodo[periodo.length - 1])}` : "";
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
    document.title = `${cabecaEnvio} ${faixa}`.replace(/\//g, "-");
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [imprimindo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro && !dados) return <section className="es-bloco"><p className="tv-alerta">{erro}</p></section>;
  const podeEditar = modo !== "real";

  return (
    <section className="es-bloco pt-escala-bloco ep">
      {cabecalho}
      {erro && <p className="tv-alerta">{erro}</p>}

      {locais.length > 1 && (
        <div className="ep-grupos" role="group" aria-label="Local da escala">
          <button className={grupo === SEM_GRUPO ? "on" : ""} onClick={() => setGrupo(SEM_GRUPO)}>Todos <span>{daCasa.length}</span></button>
          {locais.map((l) => (
            <button key={l.local} className={grupo === l.local ? "on" : ""} onClick={() => setGrupo(l.local)}
              title={l.lideres.length ? `Líderes: ${l.lideres.join(", ")}` : "Sem líder"}>
              {l.local} <span>{l.pessoas}</span>
            </button>
          ))}
        </div>
      )}

      {podeEditar && (
        <div className="ep-paleta ep-barra-acoes">
          <span className="ep-paleta-rotulo">Clique num dia para escolher o que ele vira; arraste sobre vários dias para mudar todos de uma vez.</span>
          <div className="ep-acoes">
            {dados?.socio && <button className="ghost small" onClick={copiarRhid} disabled={ocupado}>Copiar do RHiD</button>}
            {/* Imprimir só na visão Semana (o texto para o WhatsApp saiu, pedido do dono); 2 semanas e Mês são só para ver (pedido do dono) */}
            {periodo.length === 7 ? (
              <span className="ep-enviar" role="group" aria-label="Mandar para a equipe">
                <button className="ghost small" onClick={baixarPdf} title="Gera o PDF da semana para mandar no grupo">Baixar PDF</button>
              </span>
            ) : <span className="muted small">Para imprimir, use a visão Semana.</span>}
            {comp && (
              <EscalaCompensas supabase={supabase} dados={comp} local={grupo} onMudou={lerComp}
                nomeDe={(c, id, nome) => pessoas.find((p) => p.chave === chaveDe(c, id))?.nome ?? nomeProprio(nome)} />
            )}
            <button className={`ep-avisos-botao${erros.length ? " erro" : atencoes.length ? " aviso" : " ok"}`} onClick={() => setVerAvisos((v) => !v)} aria-expanded={verAvisos}>
              {erros.length + atencoes.length ? <><b>{erros.length}</b> fora da lei · <b>{atencoes.length}</b> atenção</> : "✓ Dentro da lei"}
            </button>
          </div>
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
          onPeriodo={mudarPeriodo} pintar={podeEditar ? pintar : undefined} colunasExtras={colunas}
          gruposVazios={gruposVazios}
          extraLocal={lid.dados ? (local) => (
            <ChipsLideres titulo={`${local} inteiro`} lideres={lid.dados!.lideres.filter((l) => l.local === local && l.tudo)}
              onAbrir={(x, y) => setLidEditor({ local, setor: null, x, y })} />
          ) : undefined}
          extraSetor={lid.dados ? (local, setor) => (
            <ChipsLideres titulo={setor} lideres={lid.dados!.lideres.filter((l) => l.local === local && !l.tudo && l.setores.includes(setor))}
              onAbrir={(x, y) => setLidEditor({ local, setor, x, y })} />
          ) : undefined}
          onAbrir={modo === "real" ? onAbrirPessoa : (k) => {
            const d = pessoaDe.get(k);
            if (d) setApelidoDe({ chave: k, nome: nomeProprio(d.nome), apelido: d.apelido ?? "", x: ponteiro.current.x, y: ponteiro.current.y });
          }} />
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
          <header><b>{cabecaEnvio}</b><span>{faixa}</span></header>
          <table>
            <thead>
              <tr><th>Nome</th>{periodo.map((d) => <th key={d} className={feriados.has(d) ? "fer" : ""}>{SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}<br />{br(d)}</th>)}</tr>
            </thead>
            <tbody>
              {ordemDaGrade(pessoas).map((p, i, lista) => (
                <Fragment key={p.chave}>
                  {(i === 0 || lista[i - 1].setor !== p.setor || lista[i - 1].local !== p.local) && <tr key={`s${p.chave}`} className="setor"><td colSpan={periodo.length + 1}>{grupo ? p.setor || p.local : [p.local, p.setor].filter(Boolean).join(" · ")}</td></tr>}
                  <tr key={p.chave}>
                    <td className="nome">{p.nome}</td>
                    {periodo.map((d) => {
                      const x = plano.get(p.chave)?.get(d);
                      return (
                        <td key={d} className={x?.codigo && x.codigo !== "T" ? `c-${x.codigo}` : ""}>
                          {x?.codigo ? rotuloDia(x, true) : ""}
                          {x && descanso(x) && <small className="desc">desc. {descanso(x)}</small>}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          <footer>desc. = horário de descanso (intervalo) · F folga · FC folga compensada · BH folga do banco de horas · FÉR férias · AT atestado · LIC licença · Gerada no Brasico em {dataBR(hoje())}</footer>
        </div>, document.body)}

      {lidEditor && lid.dados && (
        <EditorLideres supabase={supabase} dados={lid.dados} local={lidEditor.local} setor={lidEditor.setor} x={lidEditor.x} y={lidEditor.y}
          onFechar={() => setLidEditor(null)} onMudou={lid.ler} />
      )}

      {apelidoDe && (
        <CaixaApelido {...apelidoDe} onFechar={() => setApelidoDe(null)} onSalvar={async (apelido) => {
          const d = pessoaDe.get(apelidoDe.chave);
          if (!d) return;
          const { error } = await supabase.rpc("escala_apelido_definir", { p_cliente: d.cliente_id, p_pessoa: d.id, p_apelido: apelido });
          if (error) return avisar({ nivel: "erro", texto: error.message });
          setDados((v) => v && { ...v, pessoas: v.pessoas.map((x) => (x.cliente_id === d.cliente_id && x.id === d.id ? { ...x, apelido: apelido.trim() || null } : x)) });
          setApelidoDe(null);
          avisar({ nivel: "ok", texto: apelido.trim() ? `Na escala: ${apelido.trim()}` : "Apelido tirado: volta o nome" });
        }} />
      )}

      {editor && (
        <EditorDia celulas={editor.celulas} x={editor.x} y={editor.y} horarios={pinceisHorario} outro={outro} setOutro={setOutro}
          postos={postosDe(editor.celulas)} fcSemSaldo={fcSemSaldo(editor.celulas)} feriadosDia={feriadosDe(editor.celulas)}
          nomeFeriado={(d) => comp?.feriados.find((f) => f.dia === d)?.nome ?? "Feriado"} onFeriado={(cs, t) => marcarFeriado(cs, t)}
          atual={editor.celulas.length === 1 ? plano.get(editor.celulas[0].chave)?.get(editor.celulas[0].dia) : undefined}
          nome={editor.celulas.length === 1 ? pessoas.find((p) => p.chave === editor.celulas[0].chave)?.nome ?? "" : ""}
          onEscolher={(p) => aplicar(editor.celulas, p)} onFechar={() => setEditor(null)} />
      )}

    </section>
  );
}

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// O dia em texto: horário (07:00–15:20) ou o nome do código (Folga, Férias…); curto = a sigla, para a tabela
// O descanso (intervalo) do dia: "12:00–13:00"
const descanso = (x: DiaPlano) => (x.codigo === "T" && x.intervalo ? x.intervalo.replace("-", "–") : "");
function rotuloDia(x: DiaPlano, curto: boolean) {
  if (x.codigo === "T") return (x.entrada && x.saida ? `${x.entrada}–${x.saida}` : "Trabalho")
    + (!curto && descanso(x) ? ` (descanso ${descanso(x)})` : "")
    + (x.posto ? (curto ? ` ${x.posto[0]}` : ` · ${x.posto}`) : "");
  const c = CODIGOS.find((k) => k.codigo === x.codigo);
  return curto ? c?.curto ?? x.codigo : c?.nome.replace(" (feriado)", "") ?? x.codigo;
}

// A janelinha do bloquinho: o que o dia (ou os dias escolhidos) vira
// Caixinha do apelido (clicar no nome na escala)
function CaixaApelido({ nome, apelido, x, y, onSalvar, onFechar }: { nome: string; apelido: string; x: number; y: number; onSalvar: (a: string) => void; onFechar: () => void }) {
  const [valor, setValor] = useState(apelido);
  const left = Math.max(8, Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1000) - 300));
  return (
    <div className="ep-editor ep-apelido" role="dialog" aria-label="Apelido na escala" style={{ left, top: y + 10 }}>
      <div className="ep-editor-cabeca"><b>Apelido na escala</b><button onClick={onFechar} aria-label="Fechar">×</button></div>
      <p className="muted small">{nome}</p>
      <form onSubmit={(e) => { e.preventDefault(); onSalvar(valor); }} className="ep-apelido-form">
        <input autoFocus value={valor} maxLength={30} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: Dani, Zé, Tio Paulo" />
        <button className="small" type="submit">Salvar</button>
      </form>
      <p className="muted small">A escala e o PDF mostram só o apelido. Deixe em branco para voltar o nome.</p>
    </div>
  );
}

type FeriadoDia = { celula: Celula; passou: boolean; compensa: { situacao: string; vence_em: string | null; usada_dia: string | null } | null; naoTrabalhou: boolean };
function EditorDia({ celulas, x, y, horarios, outro, setOutro, atual, nome, onEscolher, onFechar, postos = [], fcSemSaldo = [], feriadosDia = [], nomeFeriado, onFeriado }: {
  celulas: Celula[]; x: number; y: number; horarios: Pincel[]; postos?: string[];
  fcSemSaldo?: string[]; feriadosDia?: FeriadoDia[]; nomeFeriado?: (d: string) => string; onFeriado?: (cs: Celula[], trabalhou: boolean) => void;
  outro: { entrada: string; saida: string; intervalo: string }; setOutro: (o: { entrada: string; saida: string; intervalo: string }) => void;
  atual?: DiaPlano; nome: string; onEscolher: (p: Pincel) => void; onFechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Grupos que revezam: onde a pessoa fica (vai junto com o horário escolhido)
  const [posto, setPosto] = useState(atual?.posto && postos.includes(atual.posto) ? atual.posto : postos[0] ?? "");
  // Horário do dia para ajustar (entrada, saída e descanso): começa com o do dia, se já tiver, ou com o último usado
  const [h, setH] = useState(() => {
    const [di, df] = (atual?.codigo === "T" && atual.intervalo ? atual.intervalo : outro.intervalo).split("-");
    return atual?.codigo === "T" && atual.entrada && atual.saida
      ? { entrada: atual.entrada, saida: atual.saida, desc: !!atual.intervalo, di: di ?? "12:00", df: df ?? "13:00" }
      : { entrada: outro.entrada, saida: outro.saida, desc: /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(outro.intervalo), di: di ?? "12:00", df: df ?? "13:00" };
  });
  // Fica dentro da tela
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8));
    const top = y + r.height + 16 > window.innerHeight ? Math.max(8, y - r.height - 12) : y + 12;
    setPos({ left, top });
  }, [x, y]);
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) onFechar(); };
    const t = setTimeout(() => window.addEventListener("pointerdown", fora, true), 0);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", fora, true); };
  }, [onFechar]);
  const dias = [...new Set(celulas.map((c) => c.dia))].sort();
  const pessoasN = new Set(celulas.map((c) => c.chave)).size;
  const titulo = celulas.length === 1
    ? `${nome.split(" ")[0]} · ${SEMANA[new Date(`${dias[0]}T12:00:00Z`).getUTCDay()]} ${br(dias[0])}`
    : `${celulas.length} dias · ${pessoasN} ${pessoasN === 1 ? "pessoa" : "pessoas"} · ${br(dias[0])}${dias.length > 1 ? ` a ${br(dias[dias.length - 1])}` : ""}`;
  const igual = (h: Pincel) => atual?.codigo === "T" && atual.entrada === h.entrada && atual.saida === h.saida && (atual.intervalo ?? undefined) === h.intervalo && (atual.posto ?? "") === posto;

  return (
    <div ref={caixa} className="ep-editor" role="dialog" aria-label="Escolher o que o dia vira" style={{ left: pos.left, top: pos.top }}>
      <div className="ep-editor-cabeca"><b>{titulo}</b><button onClick={onFechar} aria-label="Fechar">×</button></div>
      {feriadosDia.length > 0 && (() => {
        const um = feriadosDia.length === 1 ? feriadosDia[0] : null;
        const passados = feriadosDia.filter((f) => f.passou);
        const semResposta = passados.filter((f) => !f.compensa && !f.naoTrabalhou).map((f) => f.celula);
        return (
          <div className="ep-editor-grupo ep-editor-feriado">
            <span>Feriado{um ? ` · ${nomeFeriado?.(um.celula.dia) ?? ""}` : "s"}</span>
            {um && !um.passou ? <p className="muted small">A compensa se lança depois do feriado, dizendo se a pessoa trabalhou.</p>
              : um?.compensa ? (
                <p className="small">{um.compensa.situacao === "usada"
                  ? <>✓ Trabalhou. Compensa já dada: folga em {um.compensa.usada_dia ? br(um.compensa.usada_dia) : "—"}.</>
                  : <>✓ Trabalhou. Compensa em aberto{um.compensa.vence_em ? <> até {br(um.compensa.vence_em)}</> : null}.
                    <button className="ghost small" onClick={() => onFeriado?.([um.celula], false)}>Não trabalhou</button></>}</p>
              ) : um?.naoTrabalhou ? (
                <p className="small muted">Marcado: não trabalhou. <button className="ghost small" onClick={() => onFeriado?.([um.celula], true)}>Trabalhou</button></p>
              ) : semResposta.length > 0 ? (
                <div className="ep-editor-opcoes">
                  <button className="small" onClick={() => onFeriado?.(semResposta, true)}>{semResposta.length === 1 ? "Trabalhou no feriado (gera compensa)" : `Trabalharam (${semResposta.length} compensas)`}</button>
                  <button className="ghost small" onClick={() => onFeriado?.(semResposta, false)}>Não trabalhou</button>
                </div>
              ) : <p className="muted small">Feriados já respondidos.</p>}
          </div>
        );
      })()}
      {postos.length > 0 && (
        <div className="ep-editor-grupo">
          <span>Onde trabalha</span>
          <div className="ep-casas ep-editor-postos" role="radiogroup" aria-label="Onde trabalha">
            {postos.map((p) => <button key={p} role="radio" aria-checked={posto === p} className={posto === p ? "on" : ""} onClick={() => setPosto(p)}>{p}</button>)}
          </div>
        </div>
      )}
      {horarios.length > 0 && (
        <div className="ep-editor-grupo">
          <span>Trabalha</span>
          <div className="ep-editor-opcoes">
            {horarios.map((h) => (
              <button key={`${h.entrada}${h.saida}${h.intervalo}`} className={`ep-pincel t${igual(h) ? " on" : ""}`} onClick={() => onEscolher({ ...h, posto: posto || undefined })}
                title={h.intervalo ? `Descanso ${h.intervalo.replace("-", "–")}` : "Sem descanso"}>
                {h.rotulo}<small className="ep-desc">{h.intervalo ? `desc. ${h.intervalo.replace("-", "–")}` : "sem descanso"}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="ep-editor-grupo">
        <span>Definir o horário e o descanso</span>
        <div className="ep-horario">
          <label>Entra<input type="time" value={h.entrada} onChange={(e) => setH({ ...h, entrada: e.target.value })} /></label>
          <label>Sai<input type="time" value={h.saida} onChange={(e) => setH({ ...h, saida: e.target.value })} /></label>
          <label className="ep-horario-desc"><span><input type="checkbox" checked={h.desc} onChange={(e) => setH({ ...h, desc: e.target.checked })} /> Descanso</span>
            <span className="ep-horario-faixa">
              <input type="time" value={h.di} disabled={!h.desc} onChange={(e) => setH({ ...h, di: e.target.value })} aria-label="Descanso começa" />
              <span>até</span>
              <input type="time" value={h.df} disabled={!h.desc} onChange={(e) => setH({ ...h, df: e.target.value })} aria-label="Descanso termina" />
            </span>
          </label>
          <button className="small" disabled={!h.entrada || !h.saida || (h.desc && (!h.di || !h.df))} onClick={() => {
            const intervalo = h.desc ? `${h.di}-${h.df}` : undefined;
            setOutro({ entrada: h.entrada, saida: h.saida, intervalo: intervalo ?? "" });
            onEscolher({ codigo: "T", entrada: h.entrada, saida: h.saida, intervalo, rotulo: `${h.entrada}–${h.saida}`, posto: posto || undefined });
          }}>Salvar</button>
        </div>
      </div>
      <div className="ep-editor-grupo">
        <span>Não trabalha</span>
        <div className="ep-editor-opcoes">
          {CODIGOS.map((c) => (
            <button key={c.codigo} className={`ep-pincel c-${c.codigo}${atual?.codigo === c.codigo ? " on" : ""}`} onClick={() => onEscolher({ codigo: c.codigo, rotulo: c.nome })}
              disabled={c.codigo === "FC" && fcSemSaldo.length > 0}
              title={c.codigo === "FC" && fcSemSaldo.length ? `Sem compensa em aberto: ${fcSemSaldo.join(", ")}. Marque antes o feriado trabalhado.` : c.nome}>
              <b>{c.curto}</b><span>{c.nome.replace(" (feriado)", "")}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ep-editor-rodape">
        <button className="ghost small" onClick={() => onEscolher({ codigo: "", rotulo: "Limpar" })}>Deixar sem escala</button>
      </div>
    </div>
  );
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

