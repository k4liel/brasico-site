"use client";

// Dados do ponto (RHiD) usados em várias abas do RH: pessoas ativas no relógio, a apuração de cada dia
// (escala prevista, batidas, horas, faltas, atrasos, banco de horas), justificativas, relógios e o
// cruzamento com o RH do eSocial. Carregado uma vez pela página do RH; a escala pede mais dias
// (garantir) quando a pessoa navega para semanas que ainda não foram lidas. Só leitura.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoje, somarDias } from "@/lib/esocial/rh";
import { localESetor } from "@/lib/esocial/locais";

export type PessoaPonto = {
  cliente_id: number; id: number; nome: string; cpf: string; empresa_id: number | null; departamento_id: number | null;
  cargo_id: number | null; centro_custo_id: number | null; escala_id: number | null;
};
export type Batida = { hora: string; tipo: string; origem?: string; classificacao?: string; justificada?: boolean };
export type DiaPonto = {
  cliente_id: number; pessoa_id: number; dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; minutos_falta: number; minutos_abono?: number; saldo_banco: number | null; alerta: string; batidas: Batida[];
};
type EmpresaPonto = { cliente_id: number; id: number; cnpj: string };
type Nome = { cliente_id: number; id: number; nome: string };
export type Relogio = { cliente_id: number; id: number; nome: string; situacao: string; ultima_conexao: string | null; rep_p: boolean };
type Execucao = { id: string; tipo: string; status: string; created_at: string; fim: string | null; erro: string };
type Justificativa = {
  cliente_id: number; id: number; pessoa_id: number | null; tipo_id: number | null; texto: string; descricao: string;
  inicio: string | null; fim: string | null; aprovacao: number | null; tem_arquivo: boolean; inserido_em: string | null;
};
// Ordem e grupo escolhidos à mão na escala (modo Organizar); null = o automático
export type Ordem = { local: string | null; setor: string | null; posicao: number | null };
export type ItemOrdem = { cliente_id: number; pessoa_id: number; posicao: number; local?: string | null; setor?: string | null };
export type Cruzamento = { empresa_id: string; cpf: string; nome: string; unidade: string; ponto_situacao: string; ponto_ultima_batida: string | null; ativo: boolean };

// Situação de hoje de cada pessoa, na ordem em que aparece
export const ESTADOS = ["Trabalhando", "Atrasado", "Entra mais tarde", "Já saiu", "Afastado", "Folga", "Sem escala"] as const;
export type Estado = (typeof ESTADOS)[number];
export const CLASSE_ESTADO: Record<Estado, string> = {
  Trabalhando: "trabalhando", Atrasado: "atrasado", "Entra mais tarde": "", "Já saiu": "ferias", Afastado: "afastado", Folga: "", "Sem escala": "",
};

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
export const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
export const iniciais = (nome: string) => (nome ? nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "?");
// 436 → "7h16"; −1047 → "−17h27"
export const horas = (min: number, sinal = false) => {
  const m = Math.abs(Math.round(min));
  return `${min < 0 ? "−" : sinal && min > 0 ? "+" : ""}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
export const horaCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const chave = (cliente: number, id: number) => `${cliente}:${id}`;
export const diaFortaleza = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : "");
const agoraHM = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(11, 16);
// Tipo de justificativa que afasta (férias, atestado, licença, auxílio, suspensão), como rhid_tipo_afasta no banco
export const afasta = (nome: string) => /afast|f[ée]rias|licen[çc]a|aux[íi]lio|atestado|maternidade|paternidade|suspens/i.test(nome);

// O banco devolve no máximo 1000 linhas por pedido: busca em páginas
export async function tudo<T>(pedir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pedir(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

const CAMPOS_DIA = "cliente_id,pessoa_id,dia,horario,folga,feriado,falta,justificado,minutos_trabalhados,minutos_atraso,minutos_falta,minutos_abono,saldo_banco,alerta,batidas";
const limparDias = (ds: DiaPonto[]) => {
  // Marcações previstas da escala (classificação "F") não são batidas (linhas antigas podem trazê-las)
  for (const d of ds) d.batidas = (d.batidas ?? []).filter((b) => b.classificacao !== "F");
  return ds;
};

export type LinhaPonto = ReturnType<typeof usePonto>["linhas"][number];

export function usePonto(supabase: SupabaseClient, filtroEmpresa: string) {
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [pessoas, setPessoas] = useState<PessoaPonto[]>([]);
  const [dias, setDias] = useState<DiaPonto[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPonto[]>([]);
  const [nomes, setNomes] = useState<{ deptos: Nome[]; cargos: Nome[]; centros: Nome[]; escalas: Nome[]; tipos: Nome[] }>({ deptos: [], cargos: [], centros: [], escalas: [], tipos: [] });
  const [justificativas, setJustificativas] = useState<Justificativa[]>([]);
  const [relogios, setRelogios] = useState<Relogio[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [cruzamento, setCruzamento] = useState<Cruzamento[]>([]);
  const [ordem, setOrdem] = useState<Map<string, Ordem>>(new Map());
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState("");
  const [relogio, setRelogio] = useState(agoraHM());
  // Trecho de dias já lido do banco: começa 5 semanas para trás e 5 para a frente
  const cobertura = useRef({ de: somarDias(hoje(), -35), ate: somarDias(hoje(), 35) });

  const lerDias = useCallback((de: string, ate: string) =>
    tudo<DiaPonto>((a, b) => supabase.from("rhid_dias").select(CAMPOS_DIA).gte("dia", de).lte("dia", ate).order("dia").range(a, b)).then(limparDias),
  [supabase]);

  const carregar = useCallback(async () => {
    try {
      const { de, ate } = cobertura.current;
      const [pe, em, dp, cg, cc, es, tj, ju, re, ex, cr, di, or] = await Promise.all([
        tudo<PessoaPonto>((a, b) => supabase.from("rhid_pessoas").select("cliente_id,id,nome,cpf,empresa_id,departamento_id,cargo_id,centro_custo_id,escala_id")
          .eq("situacao", 1).eq("presente", true).order("nome").range(a, b)),
        supabase.from("rhid_empresas").select("cliente_id,id,cnpj"),
        supabase.from("rhid_departamentos").select("cliente_id,id,nome"),
        supabase.from("rhid_cargos").select("cliente_id,id,nome"),
        supabase.from("rhid_centros_custo").select("cliente_id,id,nome"),
        supabase.from("rhid_escalas").select("cliente_id,id,nome"),
        supabase.from("rhid_justificativa_tipos").select("cliente_id,id,nome"),
        supabase.from("rhid_justificativas").select("cliente_id,id,pessoa_id,tipo_id,texto,descricao,inicio,fim,aprovacao,tem_arquivo,inserido_em")
          .gte("fim", `${somarDias(hoje(), -60)}T00:00:00`).order("inicio", { ascending: false }).limit(1500),
        supabase.from("rhid_relogios").select("cliente_id,id,nome,situacao,ultima_conexao,rep_p").order("nome"),
        supabase.from("rhid_execucoes").select("id,tipo,status,created_at,fim,erro").in("tipo", ["batidas", "agora"]).order("created_at", { ascending: false }).limit(6),
        tudo<Cruzamento>((a, b) => supabase.from("esocial_trabalhadores").select("empresa_id,cpf,nome,unidade,ponto_situacao,ponto_ultima_batida,ativo")
          .eq("ativo", true).order("nome").range(a, b)),
        lerDias(de, ate),
        supabase.from("rhid_escala_ordem").select("cliente_id,pessoa_id,local,setor,posicao"),
      ]);
      // Cadastros sem departamento nem cargo e sem nenhuma batida (ex.: "ADM", "TESTE") são contas do relógio, não pessoas
      const comPonto = new Set(di.filter((d) => d.batidas.length).map((d) => chave(d.cliente_id, d.pessoa_id)));
      setPessoas(pe.filter((p) => (p.cpf && (p.departamento_id != null || p.cargo_id != null)) || comPonto.has(chave(p.cliente_id, p.id))));
      setEmpresas((em.data ?? []) as EmpresaPonto[]);
      setNomes({
        deptos: (dp.data ?? []) as Nome[], cargos: (cg.data ?? []) as Nome[], centros: (cc.data ?? []) as Nome[],
        escalas: (es.data ?? []) as Nome[], tipos: (tj.data ?? []) as Nome[],
      });
      setJustificativas((ju.data ?? []) as Justificativa[]);
      setRelogios(((re.data ?? []) as Relogio[]).filter((r) => !r.rep_p));
      setExecucoes((ex.data ?? []) as Execucao[]);
      setCruzamento(cr);
      setDias(di);
      setOrdem(new Map(((or.data ?? []) as (Ordem & { cliente_id: number; pessoa_id: number })[])
        .map((o) => [chave(o.cliente_id, o.pessoa_id), { local: o.local, setor: o.setor, posicao: o.posicao }])));
      setRelogio(agoraHM());
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler o ponto.");
    }
    setCarregado(true);
  }, [supabase, lerDias]);

  // A escala pede um trecho de dias: lê do banco só o que ainda falta
  const garantir = useCallback(async (de: string, ate: string) => {
    const c = cobertura.current;
    const faltam: [string, string][] = [];
    if (de < c.de) faltam.push([de, somarDias(c.de, -1)]);
    if (ate > c.ate) faltam.push([somarDias(c.ate, 1), ate]);
    if (!faltam.length) return;
    cobertura.current = { de: de < c.de ? de : c.de, ate: ate > c.ate ? ate : c.ate };
    try {
      const novos = (await Promise.all(faltam.map(([a, b]) => lerDias(a, b)))).flat();
      setDias((v) => [...v, ...novos]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler esses dias.");
    }
  }, [lerDias]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const { data: a } = await supabase.from("rhid_acesso").select("user_id").eq("user_id", data.user?.id ?? "");
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      carregar();
    })();
  }, [supabase, carregar]);

  // Atualiza sozinho quando uma leitura do ponto termina; e o relógio da tela a cada minuto (quem está atrasado)
  useEffect(() => {
    if (!acesso) return;
    const ch = supabase.channel("rhid-ponto")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rhid_execucoes" }, () => carregar())
      .subscribe();
    const t = setInterval(() => setRelogio(agoraHM()), 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [supabase, acesso, carregar]);

  const lendo = execucoes.some((x) => ["na_fila", "rodando"].includes(x.status) && Date.now() - new Date(x.created_at).getTime() < 10 * 60 * 1000);
  useEffect(() => {
    if (!lendo) return;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [lendo, carregar]);

  async function atualizar() {
    const { error } = await supabase.rpc("rhid_atualizar_ponto");
    if (error) setErro(error.message);
    else carregar();
  }

  const mapa = (l: Nome[]) => new Map(l.map((d) => [chave(d.cliente_id, d.id), d.nome]));
  const raizDe = useMemo(() => new Map(empresas.map((e) => [chave(e.cliente_id, e.id), e.cnpj.slice(0, 8)])), [empresas]);
  const n = useMemo(() => ({
    depto: mapa(nomes.deptos), cargo: mapa(nomes.cargos), centro: mapa(nomes.centros), escala: mapa(nomes.escalas), tipo: mapa(nomes.tipos),
  }), [nomes]);
  const diasDe = useMemo(() => {
    const m = new Map<string, Map<string, DiaPonto>>();
    for (const d of dias) {
      const k = chave(d.cliente_id, d.pessoa_id);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(d.dia, d);
    }
    return m;
  }, [dias]);
  const unidadeRH = useMemo(() => new Map(cruzamento.map((c) => [`${c.empresa_id}:${c.cpf}`, c.unidade])), [cruzamento]);

  // Justificativa que afasta cobrindo hoje, por pessoa do relógio
  const agora = hoje();
  const afastadoHoje = useMemo(() => {
    const m = new Map<string, { tipo: string; fim: string }>();
    for (const j of justificativas) {
      if (j.pessoa_id == null || (j.aprovacao ?? 2) !== 2) continue;
      const tipo = j.tipo_id != null ? n.tipo.get(chave(j.cliente_id, j.tipo_id)) ?? "" : "";
      const ini = diaFortaleza(j.inicio), fim = diaFortaleza(j.fim);
      if (ini <= agora && fim >= agora && afasta(tipo || j.texto)) m.set(chave(j.cliente_id, j.pessoa_id), { tipo: tipo || j.texto, fim });
    }
    return m;
  }, [justificativas, n, agora]);

  const linhas = useMemo(() => pessoas.map((p) => {
    const k = chave(p.cliente_id, p.id);
    const raiz = p.empresa_id != null ? raizDe.get(chave(p.cliente_id, p.empresa_id)) ?? "" : "";
    const depto = p.departamento_id != null ? n.depto.get(chave(p.cliente_id, p.departamento_id)) ?? "" : "";
    const centro = p.centro_custo_id != null ? n.centro.get(chave(p.cliente_id, p.centro_custo_id)) ?? "" : "";
    const auto = localESetor(depto, unidadeRH.get(`${raiz}:${p.cpf}`) ?? "", centro);
    const o = ordem.get(k);
    const local = o?.local ?? auto.local;
    const setor = o?.setor ?? auto.setor;
    const cargo = p.cargo_id != null ? nomeProprio(n.cargo.get(chave(p.cliente_id, p.cargo_id)) ?? "") : "";
    const escala = p.escala_id != null ? n.escala.get(chave(p.cliente_id, p.escala_id)) ?? "" : "";
    const ds = diasDe.get(k) ?? new Map<string, DiaPonto>();
    const dHoje = ds.get(agora);
    const batidasHoje = dHoje?.batidas ?? [];
    const entrada = dHoje?.horario.match(/(\d{1,2}):(\d{2})/);
    const entradaHoje = entrada ? `${entrada[1].padStart(2, "0")}:${entrada[2]}` : "";
    const afastado = afastadoHoje.get(k) ?? null;
    const temEscala = !!dHoje && !!dHoje.horario && !dHoje.folga && !dHoje.feriado;
    // Atrasado: a entrada prevista passou há mais de 10 minutos e não há batida
    const passou = entradaHoje && relogio >= somarMinutos(entradaHoje, 10);
    const estado: Estado = batidasHoje.length ? (batidasHoje.length % 2 ? "Trabalhando" : "Já saiu")
      : afastado ? "Afastado"
      : !dHoje ? "Sem escala"
      : !temEscala ? "Folga"
      : passou ? "Atrasado" : "Entra mais tarde";
    // Últimos 30 dias, sem hoje (o dia ainda não acabou)
    const passados = [...ds.values()].filter((d) => d.dia < agora && d.dia >= somarDias(agora, -30));
    const saldo = [...ds.values()].filter((d) => d.dia <= agora && d.saldo_banco != null).sort((a, b) => b.dia.localeCompare(a.dia))[0]?.saldo_banco ?? null;
    return {
      p, k, raiz, local, setor, localAuto: auto.local, setorAuto: auto.setor, posicao: o?.posicao ?? null, cargo, escala, dias: ds,
      estado, batidasHoje, horarioHoje: dHoje?.horario ?? "", entradaHoje, afastado,
      diasTrabalhados: passados.filter((d) => d.minutos_trabalhados > 0).length,
      minutos: passados.reduce((t, d) => t + d.minutos_trabalhados, 0),
      faltas: passados.filter((d) => d.falta && !d.justificado).length,
      atraso: passados.reduce((t, d) => t + d.minutos_atraso, 0),
      saldo, chaveRH: `${raiz}:${p.cpf}`,
    };
  }), [pessoas, raizDe, n, diasDe, unidadeRH, agora, afastadoHoje, relogio, ordem]);

  // Grava a ordem (e o grupo de quem mudou de grupo) na hora, na tela e no banco
  async function ordenar(itens: ItemOrdem[], limpar = false) {
    setOrdem((m) => {
      if (limpar) return new Map();
      const n = new Map(m);
      for (const it of itens) {
        const k = chave(it.cliente_id, it.pessoa_id);
        const a = n.get(k) ?? { local: null, setor: null, posicao: null };
        n.set(k, { posicao: it.posicao, local: "local" in it ? it.local ?? null : a.local, setor: "setor" in it ? it.setor ?? null : a.setor });
      }
      return n;
    });
    const { error } = await supabase.rpc("rhid_escala_ordenar", { p_itens: itens, p_limpar: limpar });
    if (error) {
      setErro(`A ordem não foi salva: ${error.message}`);
      carregar();
    }
  }

  // Tudo filtrado pela empresa escolhida no topo do RH
  const vistas = linhas.filter((l) => filtroEmpresa === "todas" || l.raiz === filtroEmpresa);
  const relogiosVistos = relogios.filter((r) => filtroEmpresa === "todas"
    || empresas.some((e) => e.cliente_id === r.cliente_id && e.cnpj.startsWith(filtroEmpresa)));
  const relogiosOk = relogiosVistos.filter((r) => r.ultima_conexao && Date.now() - new Date(r.ultima_conexao).getTime() < 24 * 3600 * 1000);
  const cruz = cruzamento.filter((c) => filtroEmpresa === "todas" || c.empresa_id === filtroEmpresa);
  const linhaDe = new Map(vistas.map((l) => [l.k, l]));
  const just = justificativas.flatMap((j) => {
    const l = j.pessoa_id != null ? linhaDe.get(chave(j.cliente_id, j.pessoa_id)) : undefined;
    if (!l) return [];
    const tipo = j.tipo_id != null ? n.tipo.get(chave(j.cliente_id, j.tipo_id)) ?? "" : "";
    const inicio = diaFortaleza(j.inicio), fim = diaFortaleza(j.fim);
    return [{ j, l, tipo, inicio, fim, afasta: afasta(tipo || j.texto), hoje: inicio <= agora && fim >= agora }];
  });
  const ultima = execucoes.find((x) => x.status === "ok" && x.fim);

  return {
    acesso, carregado, erro, lendo, ultima, atualizar, garantir, ordenar, linhas, vistas,
    relogiosVistos, relogiosOk, cruz, just, agora, relogio,
  };
}

export type Ponto = ReturnType<typeof usePonto>;

function somarMinutos(hm: string, min: number) {
  const [h, m] = hm.split(":").map(Number);
  const t = Math.min(h * 60 + m + min, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
