"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { nomeCurto } from "@/lib/esocial/rh";
import Topo from "./Topo";

// Receita Federal (Integra Contador do SERPRO): caixa postal, situação fiscal, pagamentos e o gasto de cada empresa.
// Os pedidos vão por receita_consultar e são feitos pelo site em /api/receita (supabase/receita.sql).
// Cada empresa tem o próprio contrato, cobrado por chamada, num ciclo do dia 21 ao dia 20 (supabase/receita_custos.sql):
// o gasto chega ao vivo pelo Realtime (receita_chamadas) e toda consulta cobrada pede confirmação antes.
type Ambiente = "demonstracao" | "producao";
type Tipo = "caixa_postal" | "situacao_fiscal" | "pagamentos";
type Empresa = { id: string; nome: string; cnpj: string | null; cert_validade: string | null };
type Config = { id: string; producao_ligada: boolean; limite_diario_cobradas: number; orcamento_ciclo: number };
type Execucao = { id: string; empresa_id: string; tipo: Tipo; status: string; erro: string; resultado: Record<string, unknown>; origem: string; created_at: string };
type Mensagem = { empresa_id: string; isn: string; assunto: string; remetente: string; enviada_em: string | null; ciencia_em: string | null; lida_na_receita: boolean; corpo: string | null; relevancia: string };
type Relatorio = { id: string; empresa_id: string; tamanho: number; created_at: string };
type Pagamento = { empresa_id: string; numero_documento: string; tipo_documento: string; codigo_receita: string; descricao_receita: string; periodo_apuracao: string | null; data_arrecadacao: string | null; valor_total: number | null };
type Chamada = { id: number; execucao_id: string; empresa_id: string; id_servico: string; categoria: string; cobrada: boolean; custo: number; http_status: number; created_at: string };
type Confirmar = { empresa: string; tipo: Tipo; parametros: Record<string, unknown>; titulo: string; custo: string };

const SECOES = [
  { id: "visao", grupo: "Receita", rotulo: "Visão geral", icone: "inicio", titulo: "Visão geral", texto: "O que a Receita mandou e ainda pede atenção, a situação de cada empresa e quanto já gastamos no ciclo." },
  { id: "caixa", grupo: "Receita", rotulo: "Caixa postal", icone: "caixa", titulo: "Caixa postal do e-CAC", texto: "As mensagens oficiais da Receita para cada empresa: intimações, avisos de parcelamento, Cadin e comunicados." },
  { id: "situacao", grupo: "Receita", rotulo: "Situação fiscal", icone: "folha", titulo: "Situação fiscal", texto: "O relatório de pendências do e-CAC (dívidas, declarações em atraso, parcelamentos), em PDF, como a Receita entrega." },
  { id: "pagamentos", grupo: "Receita", rotulo: "Pagamentos", icone: "salario", titulo: "Pagamentos", texto: "Os impostos federais pagos (DARF, DAS) que já aparecem na Receita." },
  { id: "gastos", grupo: "Custos", rotulo: "Gastos com o SERPRO", icone: "banco", titulo: "Gastos com o SERPRO", texto: "Cada consulta é cobrada pelo SERPRO na conta da própria empresa. Aqui você acompanha o gasto ao vivo, o teto de cada uma e o que cada serviço custa." },
  { id: "pedidos", grupo: "Custos", rotulo: "Histórico de consultas", icone: "leitura", titulo: "Histórico de consultas", texto: "Cada pedido feito à Receita, quem pediu, o que voltou e quanto custou." },
  { id: "ajuda", grupo: "Apoio", rotulo: "Ajuda", icone: "livro", titulo: "Ajuda", texto: "Como esta área funciona, como o SERPRO cobra e o que quer dizer cada termo." },
] as const;
type Secao = (typeof SECOES)[number]["id"];
const SECAO_PADRAO: Secao = "visao";

const NOME_TIPO: Record<Tipo, string> = { caixa_postal: "Caixa postal", situacao_fiscal: "Situação fiscal", pagamentos: "Pagamentos" };
const STATUS: Record<string, { texto: string; classe: string }> = {
  na_fila: { texto: "Na fila", classe: "rf-pilula atencao" },
  rodando: { texto: "Consultando…", classe: "rf-pilula atencao" },
  ok: { texto: "Deu certo", classe: "rf-pilula ok" },
  sem_dados: { texto: "Nada novo", classe: "rf-pilula ok" },
  falha: { texto: "Falhou", classe: "rf-pilula erro" },
};
const SERVICOS: Record<string, string> = {
  INNOVAMSG63: "Caixa postal · tem mensagem nova?",
  MSGCONTRIBUINTE61: "Caixa postal · lista de mensagens",
  MSGDETALHAMENTO62: "Caixa postal · texto de uma mensagem",
  SOLICITARPROTOCOLO91: "Situação fiscal · pedido do relatório",
  RELATORIOSITFIS92: "Situação fiscal · relatório em PDF",
  PAGAMENTOS71: "Pagamentos · consulta",
};
const CATEGORIA: Record<string, string> = { consulta: "Consulta", emissao: "Emissão", declaracao: "Declaração", gratis: "Grátis" };

// Tabela da loja do SERPRO (out/2026), a mesma de receita_preco: a faixa vem do total do ciclo na categoria
const FAIXAS: Record<string, [number, number][]> = {
  consulta: [[300, 0.24], [1000, 0.21], [3000, 0.18], [7000, 0.16], [15000, 0.14], [23000, 0.11], [30000, 0.09], [Infinity, 0.06]],
  emissao: [[500, 0.32], [5000, 0.29], [10000, 0.26], [15000, 0.22], [25000, 0.19], [35000, 0.16], [50000, 0.12], [Infinity, 0.08]],
  declaracao: [[100, 0.4], [500, 0.36], [1000, 0.32], [3000, 0.28], [5000, 0.24], [8000, 0.2], [10000, 0.16], [Infinity, 0.12]],
};
const preco = (categoria: string, n: number) => (FAIXAS[categoria] ?? [[Infinity, 0]]).find(([ate]) => n <= ate)![1];
const MAX_TEXTOS = 20;

// Datas no horário de Brasília
const TZ = "America/Sao_Paulo";
const diaSP = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const hojeSP = () => diaSP(new Date().toISOString());
const somaDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
// Ciclo de faturamento do contrato: do dia 21 ao dia 20 do mês seguinte
function cicloAtual() {
  const h = hojeSP();
  const [a, m, d] = h.split("-").map(Number);
  const ini = d >= 21 ? new Date(Date.UTC(a, m - 1, 21)) : new Date(Date.UTC(a, m - 2, 21));
  const inicio = ini.toISOString().slice(0, 10);
  const proximo = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 21)).toISOString().slice(0, 10);
  return { inicio, fim: somaDias(proximo, -1), total: diasEntre(inicio, proximo), passados: diasEntre(inicio, h) + 1 };
}
const dataCurta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const reais = (v: number | null | undefined) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const cnpjFmt = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
// O texto da mensagem vem em HTML da Receita: mostra só o texto, sem executar nada
const textoDe = (html: string) => {
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
};

// O que o assunto diz (para destacar o que pesa: intimação, exclusão de parcelamento, Cadin…)
type Nivel = "erro" | "atencao" | "info";
const TEMAS: { re: RegExp; rotulo: string; nivel: Nivel }[] = [
  { re: /intima/i, rotulo: "Intimação", nivel: "erro" },
  { re: /exclu|rescis|perder/i, rotulo: "Risco de exclusão", nivel: "erro" },
  { re: /cadin/i, rotulo: "Cadin", nivel: "erro" },
  { re: /malha/i, rotulo: "Malha fiscal", nivel: "erro" },
  { re: /parcelamento|negocia|relp/i, rotulo: "Parcelamento", nivel: "atencao" },
  { re: /compensa/i, rotulo: "Compensação", nivel: "atencao" },
  { re: /omiss|declara/i, rotulo: "Declaração", nivel: "atencao" },
];
const temas = (assunto: string) => TEMAS.filter((t) => t.re.test(assunto));
const nivelDe = (m: Mensagem): Nivel => (temas(m.assunto).some((t) => t.nivel === "erro") ? "erro" : temas(m.assunto).length ? "atencao" : "info");
// Mensagem não lida: a Receita dá a ciência sozinha na data de ciencia_em (o prazo de resposta conta dali)
function prazo(m: Mensagem): { texto: string; classe: string } {
  if (m.lida_na_receita) return { texto: m.ciencia_em ? `lida em ${dataCurta(m.ciencia_em)}` : "lida", classe: "muted" };
  if (!m.ciencia_em) return { texto: "não lida", classe: "rf-forte" };
  const n = diasEntre(hojeSP(), m.ciencia_em);
  if (n < 0) return { texto: `ciência automática já correu (${dataCurta(m.ciencia_em)})`, classe: "rf-perigo" };
  if (n === 0) return { texto: "ciência automática hoje", classe: "rf-perigo" };
  return { texto: `ciência automática em ${plural(n, "dia", "dias")} (${dataCurta(m.ciencia_em)})`, classe: n <= 5 ? "rf-perigo" : "rf-forte" };
}

function lerLocal(chave: string) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarLocal(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {}
}

export default function Receita({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [filtroEmpresa, setFiltroEmpresa] = useState("todas");
  const [ambiente, setAmbiente] = useState<Ambiente>("producao");
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [chamadas, setChamadas] = useState<Chamada[]>([]);
  const [novas, setNovas] = useState<Set<number>>(new Set());
  const [aoVivo, setAoVivo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [filtroCaixa, setFiltroCaixa] = useState<"pendentes" | "importantes" | "todas">("pendentes");
  const [busca, setBusca] = useState("");
  const [ajustando, setAjustando] = useState<{ id: string; limite: string; teto: string } | null>(null);

  const [secao, setSecao] = useState<Secao>(SECAO_PADRAO);
  // A seção fica no endereço (#caixa, #gastos…) para dar para voltar e compartilhar
  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.replace("#", "");
      setSecao(SECOES.some((s) => s.id === h) ? (h as Secao) : SECAO_PADRAO);
      window.scrollTo({ top: 0 });
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);
  function irPara(s: Secao) {
    setSecao(s);
    window.history.replaceState(null, "", `#${s}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const [navFechada, setNavFechada] = useState(false);
  useEffect(() => setNavFechada(lerLocal("brasico-receita-nav") === "fechada"), []);
  function alternarNav() {
    setNavFechada((v) => {
      gravarLocal("brasico-receita-nav", v ? "aberta" : "fechada");
      return !v;
    });
  }

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("receita_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
    })();
  }, [supabase, userId]);

  const carregarConfigs = useCallback(async () => {
    const [e, c] = await Promise.all([
      supabase.from("esocial_empresas").select("id,nome,cnpj,cert_validade").order("ordem").order("nome"),
      supabase.from("receita_empresas").select("id,producao_ligada,limite_diario_cobradas,orcamento_ciclo"),
    ]);
    const cfg = ((c.data ?? []) as Config[]).map((x) => ({ ...x, orcamento_ciclo: Number(x.orcamento_ciclo) }));
    setConfigs(cfg);
    setEmpresas(((e.data ?? []) as Empresa[]).filter((x) => cfg.some((k) => k.id === x.id)));
  }, [supabase]);

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 120 * 86400000).toISOString();
    const [x, m, r, p, c] = await Promise.all([
      supabase.from("receita_execucoes").select("id,empresa_id,tipo,status,erro,resultado,origem,created_at")
        .eq("ambiente", ambiente).order("created_at", { ascending: false }).limit(80),
      supabase.from("receita_mensagens").select("empresa_id,isn,assunto,remetente,enviada_em,ciencia_em,lida_na_receita,corpo,relevancia")
        .eq("ambiente", ambiente).order("enviada_em", { ascending: false }).limit(1000),
      supabase.from("receita_relatorios").select("id,empresa_id,tamanho,created_at")
        .eq("ambiente", ambiente).order("created_at", { ascending: false }).limit(60),
      supabase.from("receita_pagamentos").select("empresa_id,numero_documento,tipo_documento,codigo_receita,descricao_receita,periodo_apuracao,data_arrecadacao,valor_total")
        .eq("ambiente", ambiente).order("data_arrecadacao", { ascending: false }).limit(1000),
      // O gasto é sempre do modo real (o teste não é cobrado)
      supabase.from("receita_chamadas").select("id,execucao_id,empresa_id,id_servico,categoria,cobrada,custo,http_status,created_at")
        .eq("ambiente", "producao").gte("created_at", desde).order("created_at", { ascending: false }).limit(5000),
    ]);
    setExecucoes((x.data ?? []) as Execucao[]);
    setMensagens((m.data ?? []) as Mensagem[]);
    setRelatorios((r.data ?? []) as Relatorio[]);
    setPagamentos((p.data ?? []) as Pagamento[]);
    setChamadas(((c.data ?? []) as Chamada[]).map((k) => ({ ...k, custo: Number(k.custo) })));
    setCarregado(true);
  }, [supabase, ambiente]);

  useEffect(() => {
    if (!acesso) return;
    carregarConfigs();
    carregar();
  }, [acesso, carregarConfigs, carregar]);

  // Ao vivo: cada chamada cobrada aparece na hora; quando um pedido termina, recarrega os dados
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;
  useEffect(() => {
    if (!acesso) return;
    const canal = supabase
      .channel("receita-ao-vivo")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "receita_chamadas" }, (ev) => {
        const k = ev.new as Chamada & { ambiente: string };
        if (k.ambiente !== "producao") return;
        setChamadas((v) => (v.some((x) => x.id === k.id) ? v : [{ ...k, custo: Number(k.custo) }, ...v]));
        setNovas((v) => new Set(v).add(k.id));
        setTimeout(() => setNovas((v) => {
          const n = new Set(v);
          n.delete(k.id);
          return n;
        }), 2500);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "receita_execucoes" }, () => carregarRef.current())
      .subscribe((estado) => setAoVivo(estado === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(canal);
    };
  }, [supabase, acesso]);

  // Reserva: enquanto houver pedido em andamento, confere a cada 3 segundos
  const andamento = execucoes.some((x) => x.status === "na_fila" || x.status === "rodando");
  useEffect(() => {
    if (!andamento) return;
    const t = setInterval(carregar, 3000);
    return () => clearInterval(t);
  }, [andamento, carregar]);

  // ---------------- Contas ----------------
  const ciclo = useMemo(cicloAtual, []);
  const hoje = hojeSP();
  const naEmpresa = <T extends { empresa_id: string }>(l: T[]) => (filtroEmpresa === "todas" ? l : l.filter((x) => x.empresa_id === filtroEmpresa));
  const empresasVisiveis = filtroEmpresa === "todas" ? empresas : empresas.filter((e) => e.id === filtroEmpresa);
  const nomeEmpresa = (id: string) => nomeCurto(empresas.find((e) => e.id === id)?.nome ?? id);
  const cobradas = chamadas.filter((k) => k.cobrada);
  const gastoDe = (id: string | null, de: string, ate = "9999") =>
    cobradas.filter((k) => (!id || k.empresa_id === id) && diaSP(k.created_at) >= de && diaSP(k.created_at) <= ate).reduce((s, k) => s + k.custo, 0);
  const chamadasHoje = (id: string) => cobradas.filter((k) => k.empresa_id === id && diaSP(k.created_at) === hoje).length;
  const noCiclo = (id: string, cat: string) => cobradas.filter((k) => k.empresa_id === id && k.categoria === cat && diaSP(k.created_at) >= ciclo.inicio).length;
  const precoAgora = (id: string, cat: string) => preco(cat, noCiclo(id, cat) + 1);
  const filtroId = filtroEmpresa === "todas" ? null : filtroEmpresa;
  const gastoHoje = gastoDe(filtroId, hoje, hoje);
  const gastoCiclo = gastoDe(filtroId, ciclo.inicio);
  const custoExecucao = (id: string) => chamadas.filter((k) => k.execucao_id === id).reduce((s, k) => s + k.custo, 0);

  const mensagensVis = naEmpresa(mensagens);
  const pendentes = mensagensVis.filter((m) => !m.lida_na_receita);
  const atencao = useMemo(
    () => mensagensVis.filter((m) => !m.lida_na_receita && nivelDe(m) !== "info")
      // Primeiro o que ainda vai vencer (o mais perto antes); depois o que já correu (o mais recente antes)
      .sort((a, b) => {
        const h = hojeSP();
        const fa = (a.ciencia_em ?? "9999") >= h, fb = (b.ciencia_em ?? "9999") >= h;
        if (fa !== fb) return fa ? -1 : 1;
        return fa ? (a.ciencia_em ?? "9999").localeCompare(b.ciencia_em ?? "9999") : (b.ciencia_em ?? "").localeCompare(a.ciencia_em ?? "");
      }),
    [mensagensVis],
  );
  const intimacoes = pendentes.filter((m) => /intima/i.test(m.assunto)).length;

  const config = (id: string) => configs.find((c) => c.id === id);
  const teste = ambiente === "demonstracao";

  // ---------------- Pedidos ----------------
  function pedir(empresa: string, tipo: Tipo, parametros: Record<string, unknown>, titulo: string, custo: string) {
    setAviso("");
    if (teste) return enviar({ empresa, tipo, parametros, titulo, custo });
    setConfirmar({ empresa, tipo, parametros, titulo, custo });
  }
  async function enviar(c: Confirmar) {
    setConfirmar(null);
    const { error } = await supabase.rpc("receita_consultar", { p_empresa: c.empresa, p_ambiente: ambiente, p_tipo: c.tipo, p_parametros: c.parametros });
    if (error) return setAviso(error.message);
    carregar();
  }
  const rodando = (empresa: string, tipo: Tipo) => execucoes.some((x) => x.empresa_id === empresa && x.tipo === tipo && (x.status === "na_fila" || x.status === "rodando"));
  const podeConsultar = (empresa: string) => teste || !!config(empresa)?.producao_ligada;

  // Caixa postal: perguntar se há novidade é grátis; havendo, a lista e cada texto são consultas
  const custoCaixa = (id: string) => `grátis se não houver nada novo; até ${reais(precoAgora(id, "consulta") * 6)} se houver`;
  const semTexto = (id: string) => mensagens.filter((m) => m.empresa_id === id && !m.corpo).length;
  function botaoCaixa(id: string, rotulo = "Ver se há mensagem nova") {
    return (
      <button className="botao-painel" disabled={!podeConsultar(id) || rodando(id, "caixa_postal")}
        onClick={() => pedir(id, "caixa_postal", {}, `Caixa postal · ${nomeEmpresa(id)}`, custoCaixa(id))}>
        {rodando(id, "caixa_postal") ? "Consultando…" : rotulo}
      </button>
    );
  }
  function botaoTextos(id: string) {
    const n = Math.min(semTexto(id), MAX_TEXTOS);
    if (!n) return null;
    return (
      <button className="botao-painel" disabled={!podeConsultar(id) || rodando(id, "caixa_postal")}
        onClick={() => pedir(id, "caixa_postal", { forcar: true, maxDetalhes: n }, `Baixar o texto de ${plural(n, "mensagem", "mensagens")} · ${nomeEmpresa(id)}`,
          `${reais(precoAgora(id, "consulta") * (n + 1))} (a lista + ${plural(n, "texto", "textos")})`)}>
        Baixar {plural(n, "texto que falta", "textos que faltam")}
      </button>
    );
  }
  function botaoSitfis(id: string) {
    return (
      <button className="botao-painel" disabled={!podeConsultar(id) || rodando(id, "situacao_fiscal")}
        onClick={() => pedir(id, "situacao_fiscal", {}, `Relatório de situação fiscal · ${nomeEmpresa(id)}`, reais(precoAgora(id, "emissao")))}>
        {rodando(id, "situacao_fiscal") ? "Gerando…" : "Gerar relatório novo"}
      </button>
    );
  }
  function botaoPagamentos(id: string) {
    return (
      <button className="botao-painel" disabled={!podeConsultar(id) || rodando(id, "pagamentos")}
        onClick={() => pedir(id, "pagamentos", {}, `Pagamentos dos últimos 90 dias · ${nomeEmpresa(id)}`, `${reais(precoAgora(id, "consulta"))} a cada 100 pagamentos`)}>
        {rodando(id, "pagamentos") ? "Consultando…" : "Buscar pagamentos (90 dias)"}
      </button>
    );
  }

  async function abrirPdf(id: string) {
    setAbrindo(id);
    const { data, error } = await supabase.from("receita_relatorios").select("pdf_base64").eq("id", id).single();
    setAbrindo(null);
    if (error || !data) return setAviso("Não consegui abrir o relatório.");
    const bytes = Uint8Array.from(atob((data as { pdf_base64: string }).pdf_base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function salvarAjuste() {
    if (!ajustando) return;
    const limite = Number(ajustando.limite);
    const teto = Number(ajustando.teto.replace(",", "."));
    const { error } = await supabase.rpc("receita_ajustar", { p_empresa: ajustando.id, p_limite_diario: limite, p_orcamento: teto });
    if (error) return setAviso(error.message);
    setAjustando(null);
    carregarConfigs();
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="receita" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à Receita Federal.</p></main>
      </div>
    );
  }

  const ultimaConsulta = execucoes.find((x) => x.status === "ok" || x.status === "sem_dados");

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="receita" />
      <main className="miolo es es-sistema rf">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Companhia · Fiscal</span>
            <h1>Receita Federal{teste && <span className="rf-selo rf-selo-grande">AMBIENTE DE TESTE</span>}</h1>
            <p className="muted">
              Direto do e-CAC, pelo serviço oficial do SERPRO (Integra Contador)
              {ultimaConsulta ? ` · última consulta ${dataHora(ultimaConsulta.created_at)}` : ""}
            </p>
            <p className="rf-aovivo" title="O gasto é atualizado na hora em que cada chamada acontece">
              <span className={aoVivo ? "rf-ponto" : "rf-ponto parado"} aria-hidden="true" />
              {aoVivo ? "Ao vivo" : "Conectando…"}
              <span>· Hoje <b>{reais(gastoHoje)}</b></span>
              <span>· Ciclo {dataCurta(ciclo.inicio)} a {dataCurta(ciclo.fim)} <b>{reais(gastoCiclo)}</b></span>
            </p>
          </div>
          {empresas.length > 1 && (
            <div className="tv-unidades" role="tablist" aria-label="Empresa">
              {[{ id: "todas", nome: "Todas" }, ...empresas].map((x) => (
                <button key={x.id} role="tab" aria-selected={x.id === filtroEmpresa}
                  className={x.id === filtroEmpresa ? "botao-painel on" : "botao-painel"} onClick={() => setFiltroEmpresa(x.id)}>
                  {x.id === "todas" ? "Todas" : nomeCurto(x.nome)}
                </button>
              ))}
            </div>
          )}
        </div>

        {teste && (
          <div className="rf-teste" role="note">
            <span className="rf-teste-icone" aria-hidden="true">⚠</span>
            <div>
              <strong>AMBIENTE DE TESTE · DADOS NÃO REAIS</strong>
              <p>São dados de mentira do SERPRO, iguais para qualquer empresa. Nada é cobrado.{" "}
                <button className="ghost small" onClick={() => setAmbiente("producao")}>Voltar aos dados reais</button></p>
            </div>
          </div>
        )}
        {aviso && <p className="es-aviso" role="alert">{aviso}</p>}

        {!carregado ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : (
          <div className={navFechada ? "es-layout fechado" : "es-layout"}>
            <nav className="es-nav" aria-label="Seções da Receita">
              <button className="es-nav-alternar" onClick={alternarNav} title={navFechada ? "Abrir o menu" : "Recolher o menu"} aria-label={navFechada ? "Abrir o menu" : "Recolher o menu"} aria-expanded={!navFechada}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={navFechada ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} /></svg>
                <span>Recolher</span>
              </button>
              {SECOES.map((s, i) => {
                const n = s.id === "visao" ? atencao.length : s.id === "caixa" ? pendentes.length : 0;
                return (
                  <Fragment key={s.id}>
                    {(i === 0 || SECOES[i - 1].grupo !== s.grupo) && <div className="es-nav-grupo">{s.grupo}</div>}
                    <button className={secao === s.id ? "es-nav-item on" : "es-nav-item"} onClick={() => irPara(s.id)} aria-current={secao === s.id ? "page" : undefined} title={navFechada ? s.rotulo : undefined}>
                      <Icone nome={s.icone} />
                      <span>{s.rotulo}</span>
                      {n > 0 && <b className={s.id === "visao" ? "es-nav-n atencao" : "es-nav-n"}>{n}</b>}
                    </button>
                  </Fragment>
                );
              })}
            </nav>

            <div className="es-conteudo">
              {(() => {
                const s = SECOES.find((x) => x.id === secao)!;
                return <header className="es-secao"><h2>{s.titulo}</h2><p>{s.texto}</p></header>;
              })()}

              {/* ===================== Visão geral ===================== */}
              {secao === "visao" && (
                <>
                  <section className="es-bloco">
                    <div className="es-bloco-cabeca">
                      <h2><Icone nome="atencao" />Precisa de atenção</h2>
                      {atencao.length > 6 && <button className="ghost small" onClick={() => { setFiltroCaixa("importantes"); irPara("caixa"); }}>Ver as {atencao.length}</button>}
                    </div>
                    {atencao.length === 0 ? (
                      <p className="es-tudo-certo">✓ Nenhuma mensagem importante sem ler na caixa postal{filtroEmpresa === "todas" ? " das empresas" : ""}.</p>
                    ) : (
                      <ul className="es-alertas">
                        {atencao.slice(0, 6).map((m) => {
                          const p = prazo(m);
                          return (
                            <li key={m.empresa_id + m.isn} className={`es-alerta ${nivelDe(m)}`}>
                              <span className="es-alerta-icone" aria-hidden="true">!</span>
                              <div>
                                <strong>{m.assunto}</strong>
                                <span className="muted">{nomeEmpresa(m.empresa_id)} · enviada em {dia(m.enviada_em)} · <span className={p.classe}>{p.texto}</span></span>
                              </div>
                              <button className="ghost small" onClick={() => { setAberta(m.empresa_id + m.isn); setFiltroCaixa("todas"); irPara("caixa"); }}>Abrir</button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <div className="es-numeros">
                    <div className="es-numero clicavel" onClick={() => { setFiltroCaixa("pendentes"); irPara("caixa"); }}>
                      <span className="tv-cartao-rotulo">Mensagens não lidas</span>
                      <span className="es-numero-valor">{pendentes.length}</span>
                      <span className="tv-cartao-detalhe">na caixa postal do e-CAC</span>
                    </div>
                    <div className="es-numero">
                      <span className="tv-cartao-rotulo">Intimações sem ler</span>
                      <span className="es-numero-valor">{intimacoes}</span>
                      <span className="tv-cartao-detalhe">o prazo corre a partir da ciência</span>
                    </div>
                    <div className="es-numero clicavel" onClick={() => irPara("gastos")}>
                      <span className="tv-cartao-rotulo">Gasto hoje</span>
                      <span className="es-numero-valor">{reais(gastoHoje)}</span>
                      <span className="tv-cartao-detalhe">com o SERPRO</span>
                    </div>
                    <div className="es-numero clicavel" onClick={() => irPara("gastos")}>
                      <span className="tv-cartao-rotulo">Gasto no ciclo</span>
                      <span className="es-numero-valor">{reais(gastoCiclo)}</span>
                      <span className="tv-cartao-detalhe">{dataCurta(ciclo.inicio)} a {dataCurta(ciclo.fim)} · dia {ciclo.passados} de {ciclo.total}</span>
                    </div>
                  </div>

                  <div className="rf-empresas">
                    {empresasVisiveis.map((e) => {
                      const c = config(e.id);
                      const gasto = gastoDe(e.id, ciclo.inicio);
                      const teto = c?.orcamento_ciclo ?? 0;
                      const naoLidas = mensagens.filter((m) => m.empresa_id === e.id && !m.lida_na_receita).length;
                      const rel = relatorios.find((r) => r.empresa_id === e.id);
                      const ultCaixa = execucoes.find((x) => x.empresa_id === e.id && x.tipo === "caixa_postal" && x.status !== "falha");
                      const certDias = e.cert_validade ? diasEntre(hoje, diaSP(e.cert_validade)) : null;
                      return (
                        <section key={e.id} className="es-bloco rf-empresa">
                          <div className="rf-empresa-cabeca">
                            <div>
                              <h2>{nomeCurto(e.nome)}</h2>
                              <div className="rf-cnpj">CNPJ {cnpjFmt(e.cnpj)}</div>
                            </div>
                            {teste ? <span className="rf-pilula atencao">Teste</span>
                              : c?.producao_ligada ? <span className="rf-pilula ok">Ligada</span> : <span className="rf-pilula">Não ligada</span>}
                          </div>
                          <ul className="rf-linhas">
                            <li><span>Não lidas no e-CAC</span><b className={naoLidas ? "rf-forte" : ""}>{naoLidas}</b></li>
                            <li><span>Caixa postal</span><span>{ultCaixa ? `vista em ${dataHora(ultCaixa.created_at)}` : "ainda não consultada"}</span></li>
                            <li><span>Situação fiscal</span>
                              {rel ? <button className="rf-link" onClick={() => abrirPdf(rel.id)} disabled={abrindo === rel.id}>{abrindo === rel.id ? "Abrindo…" : `relatório de ${dataHora(rel.created_at)}`}</button> : <span>sem relatório</span>}
                            </li>
                            <li><span>Certificado</span><span className={certDias != null && certDias <= 30 ? "rf-perigo" : ""}>{e.cert_validade ? `vale até ${dia(diaSP(e.cert_validade))}` : "não enviado"}</span></li>
                            <li>
                              <span>Gasto no ciclo</span>
                              <span><b>{reais(gasto)}</b> <span className="muted">de {reais(teto)}</span></span>
                            </li>
                          </ul>
                          <Medidor valor={gasto} maximo={teto} />
                          <div className="rf-acoes">
                            {botaoCaixa(e.id)}
                            {botaoSitfis(e.id)}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ===================== Caixa postal ===================== */}
              {secao === "caixa" && (() => {
                const termo = busca.trim().toLowerCase();
                const lista = mensagensVis
                  .filter((m) => filtroCaixa === "todas" || (filtroCaixa === "pendentes" ? !m.lida_na_receita : nivelDe(m) !== "info"))
                  .filter((m) => !termo || m.assunto.toLowerCase().includes(termo) || (m.corpo ?? "").toLowerCase().includes(termo));
                return (
                  <>
                    <section className="es-bloco">
                      <div className="es-bloco-cabeca">
                        <div className="rf-filtros" role="tablist" aria-label="Quais mensagens">
                          {([["pendentes", `Não lidas (${pendentes.length})`], ["importantes", "Importantes"], ["todas", `Todas (${mensagensVis.length})`]] as const).map(([id, r]) => (
                            <button key={id} role="tab" aria-selected={filtroCaixa === id} className={filtroCaixa === id ? "botao-painel on" : "botao-painel"} onClick={() => setFiltroCaixa(id)}>{r}</button>
                          ))}
                          <input type="search" placeholder="Buscar no assunto ou no texto" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar mensagens" />
                        </div>
                      </div>
                      {lista.length === 0 ? (
                        <p className="es-tudo-certo">{filtroCaixa === "pendentes" ? "✓ Nenhuma mensagem sem ler." : "Nenhuma mensagem encontrada."}</p>
                      ) : (
                        <div className="tv-tabela-caixa">
                          <table className="tv-tabela rf-tabela-msg">
                            <thead><tr>{filtroEmpresa === "todas" && <th>Empresa</th>}<th>Assunto</th><th>Enviada</th><th>Leitura</th></tr></thead>
                            <tbody>
                              {lista.map((m) => {
                                const chave = m.empresa_id + m.isn;
                                const p = prazo(m);
                                const abrir = () => setAberta(aberta === chave ? null : chave);
                                return (
                                  <Fragment key={chave}>
                                    <tr onClick={abrir} className="rf-clicavel" aria-expanded={aberta === chave}>
                                      {filtroEmpresa === "todas" && <td className="rf-nowrap">{nomeEmpresa(m.empresa_id)}</td>}
                                      <td>
                                        <span className="rf-tags">{temas(m.assunto).map((t) => <span key={t.rotulo} className={`rf-pilula ${t.nivel}`}>{t.rotulo}</span>)}</span>
                                        {!m.lida_na_receita ? <strong>{m.assunto}</strong> : m.assunto}
                                        <span className="muted"> {aberta === chave ? "▲" : "▼"}</span>
                                      </td>
                                      <td>{dia(m.enviada_em)}</td>
                                      <td className={p.classe}>{p.texto}</td>
                                    </tr>
                                    {aberta === chave && (
                                      <tr className="rf-sem-hover">
                                        <td colSpan={filtroEmpresa === "todas" ? 4 : 3}>
                                          {m.corpo ? <div className="rf-texto">{textoDe(m.corpo)}</div> : (
                                            <p className="muted rf-texto">O texto desta mensagem ainda não foi baixado. Cada texto é uma consulta cobrada
                                              ({reais(precoAgora(m.empresa_id, "consulta"))}); use “Baixar textos que faltam” abaixo.</p>
                                          )}
                                          <p className="muted small">De: {m.remetente} · Para ler e responder oficialmente, entre no e-CAC da empresa.</p>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2><Icone nome="leitura" />Consultar agora</h2></div>
                      <p className="muted rf-explica">Perguntar se há mensagem nova é <b>grátis</b>. Se houver, a lista custa uma consulta e cada texto lido mais uma (até 5 textos por vez).</p>
                      <ul className="rf-consultas">
                        {empresasVisiveis.map((e) => (
                          <li key={e.id}>
                            <span><strong>{nomeCurto(e.nome)}</strong><span className="muted"> · {plural(semTexto(e.id), "mensagem sem texto", "mensagens sem texto")}</span></span>
                            <span className="rf-acoes">{botaoCaixa(e.id)}{botaoTextos(e.id)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                );
              })()}

              {/* ===================== Situação fiscal ===================== */}
              {secao === "situacao" && (
                <>
                  <section className="es-bloco">
                    <div className="es-bloco-cabeca"><h2><Icone nome="folha" />Relatório mais recente de cada empresa</h2></div>
                    <ul className="rf-consultas">
                      {empresasVisiveis.map((e) => {
                        const rel = relatorios.find((r) => r.empresa_id === e.id);
                        return (
                          <li key={e.id}>
                            <span><strong>{nomeCurto(e.nome)}</strong><span className="muted"> · {rel ? `gerado em ${dataHora(rel.created_at)}` : "nenhum relatório ainda"}</span></span>
                            <span className="rf-acoes">
                              {rel && <button className="botao-painel on" onClick={() => abrirPdf(rel.id)} disabled={abrindo === rel.id}>{abrindo === rel.id ? "Abrindo…" : "Abrir PDF"}</button>}
                              {botaoSitfis(e.id)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="muted rf-explica">Cada relatório novo custa {reais(preco("emissao", 1))} (emissão). O PDF é o mesmo que o e-CAC entrega: guarde o de cada mês para comparar.</p>
                  </section>
                  {naEmpresa(relatorios).length > empresasVisiveis.length && (
                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2>Relatórios anteriores</h2></div>
                      <div className="tv-tabela-caixa">
                        <table className="tv-tabela">
                          <thead><tr><th>Empresa</th><th>Gerado em</th><th>Tamanho</th><th></th></tr></thead>
                          <tbody>
                            {naEmpresa(relatorios).map((r) => (
                              <tr key={r.id}>
                                <td>{nomeEmpresa(r.empresa_id)}</td>
                                <td>{dataHora(r.created_at)}</td>
                                <td>{Math.round(r.tamanho / 1024)} KB</td>
                                <td><button className="botao-painel" onClick={() => abrirPdf(r.id)} disabled={abrindo === r.id}>{abrindo === r.id ? "Abrindo…" : "Abrir"}</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* ===================== Pagamentos ===================== */}
              {secao === "pagamentos" && (() => {
                const lista = naEmpresa(pagamentos);
                const total = lista.reduce((s, p) => s + Number(p.valor_total ?? 0), 0);
                return (
                  <>
                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2><Icone nome="salario" />Buscar pagamentos</h2></div>
                      <ul className="rf-consultas">
                        {empresasVisiveis.map((e) => (
                          <li key={e.id}>
                            <span><strong>{nomeCurto(e.nome)}</strong><span className="muted"> · {plural(pagamentos.filter((p) => p.empresa_id === e.id).length, "pagamento guardado", "pagamentos guardados")}</span></span>
                            <span className="rf-acoes">{botaoPagamentos(e.id)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2>Pagamentos registrados</h2><span className="muted">{lista.length ? `${lista.length} · ${reais(total)}` : ""}</span></div>
                      {lista.length === 0 ? (
                        <p className="muted">Nenhum pagamento buscado ainda.</p>
                      ) : (
                        <div className="tv-tabela-caixa">
                          <table className="tv-tabela">
                            <thead><tr>{filtroEmpresa === "todas" && <th>Empresa</th>}<th>Imposto</th><th>Guia</th><th>Competência</th><th>Pago em</th><th>Valor</th></tr></thead>
                            <tbody>
                              {lista.map((p) => (
                                <tr key={p.empresa_id + p.numero_documento}>
                                  {filtroEmpresa === "todas" && <td>{nomeEmpresa(p.empresa_id)}</td>}
                                  <td>{p.codigo_receita} · {p.descricao_receita}</td>
                                  <td>{p.tipo_documento}</td>
                                  <td>{p.periodo_apuracao ? `${p.periodo_apuracao.slice(5, 7)}/${p.periodo_apuracao.slice(0, 4)}` : ""}</td>
                                  <td>{dia(p.data_arrecadacao)}</td>
                                  <td>{reais(p.valor_total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                );
              })()}

              {/* ===================== Gastos ===================== */}
              {secao === "gastos" && (() => {
                const projecao = ciclo.passados > 0 ? (gastoCiclo / ciclo.passados) * ciclo.total : 0;
                const total = gastoDe(filtroId, "0000");
                const dias = Array.from({ length: 15 }, (_, i) => somaDias(hoje, i - 14));
                const porDia = dias.map((d) => ({ d, v: gastoDe(filtroId, d, d) }));
                const maxDia = Math.max(0.01, ...porDia.map((x) => x.v));
                const doCiclo = naEmpresa(chamadas).filter((k) => diaSP(k.created_at) >= ciclo.inicio);
                const servicos = Object.entries(doCiclo.reduce<Record<string, { n: number; cobradas: number; total: number; categoria: string }>>((acc, k) => {
                  const s = (acc[k.id_servico] ??= { n: 0, cobradas: 0, total: 0, categoria: k.categoria });
                  s.n++;
                  if (k.cobrada) s.cobradas++;
                  s.total += k.custo;
                  return acc;
                }, {})).sort((a, b) => b[1].total - a[1].total);
                return (
                  <>
                    <div className="es-numeros">
                      <div className="es-numero">
                        <span className="tv-cartao-rotulo"><span className={aoVivo ? "rf-ponto" : "rf-ponto parado"} aria-hidden="true" /> Hoje</span>
                        <span className="es-numero-valor">{reais(gastoHoje)}</span>
                        <span className="tv-cartao-detalhe">{plural(cobradas.filter((k) => diaSP(k.created_at) === hoje && (!filtroId || k.empresa_id === filtroId)).length, "chamada cobrada", "chamadas cobradas")}</span>
                      </div>
                      <div className="es-numero">
                        <span className="tv-cartao-rotulo">Ciclo atual</span>
                        <span className="es-numero-valor">{reais(gastoCiclo)}</span>
                        <span className="tv-cartao-detalhe">{dia(ciclo.inicio)} a {dia(ciclo.fim)} · vira a nota do SERPRO</span>
                      </div>
                      <div className="es-numero">
                        <span className="tv-cartao-rotulo">Projeção do ciclo</span>
                        <span className="es-numero-valor">{reais(projecao)}</span>
                        <span className="tv-cartao-detalhe">no ritmo de agora, dia {ciclo.passados} de {ciclo.total}</span>
                      </div>
                      <div className="es-numero">
                        <span className="tv-cartao-rotulo">Desde o início</span>
                        <span className="es-numero-valor">{reais(total)}</span>
                        <span className="tv-cartao-detalhe">últimos 120 dias</span>
                      </div>
                    </div>

                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2><Icone nome="banco" />Por empresa</h2><span className="muted">cada uma paga a própria conta</span></div>
                      <div className="tv-tabela-caixa">
                        <table className="tv-tabela rf-tabela-gastos">
                          <thead><tr><th>Empresa</th><th>Hoje</th><th>Ciclo / teto</th><th>Gasto no ciclo</th><th></th></tr></thead>
                          <tbody>
                            {empresasVisiveis.map((e) => {
                              const c = config(e.id);
                              const g = gastoDe(e.id, ciclo.inicio);
                              const editando = ajustando?.id === e.id;
                              return (
                                <Fragment key={e.id}>
                                  <tr>
                                    <td><strong>{nomeCurto(e.nome)}</strong>
                                      <div className="muted small">preço agora: consulta {reais(precoAgora(e.id, "consulta"))} · emissão {reais(precoAgora(e.id, "emissao"))}</div></td>
                                    <td className="rf-nowrap">{reais(gastoDe(e.id, hoje, hoje))}<div className="muted small">{chamadasHoje(e.id)} de {c?.limite_diario_cobradas ?? 0} chamadas</div></td>
                                    <td className="rf-celula-medidor"><Medidor valor={g} maximo={c?.orcamento_ciclo ?? 0} /><div className="muted small">teto {reais(c?.orcamento_ciclo)}</div></td>
                                    <td><b>{reais(g)}</b></td>
                                    <td>{!editando && <button className="ghost small" onClick={() => setAjustando({ id: e.id, limite: String(c?.limite_diario_cobradas ?? 30), teto: String(c?.orcamento_ciclo ?? 30).replace(".", ",") })}>Ajustar</button>}</td>
                                  </tr>
                                  {editando && (
                                    <tr className="rf-sem-hover">
                                      <td colSpan={5}>
                                        <div className="rf-ajuste">
                                          <label>Chamadas cobradas por dia <input inputMode="numeric" value={ajustando.limite} onChange={(ev) => setAjustando({ ...ajustando, limite: ev.target.value })} /></label>
                                          <label>Teto do ciclo (R$) <input inputMode="decimal" value={ajustando.teto} onChange={(ev) => setAjustando({ ...ajustando, teto: ev.target.value })} /></label>
                                          <button className="small" onClick={salvarAjuste}>Salvar</button>
                                          <button className="ghost small" onClick={() => setAjustando(null)}>Cancelar</button>
                                        </div>
                                        <p className="muted small">Passou do limite do dia ou do teto do ciclo, o Brasico recusa novas consultas daquela empresa até virar o dia ou o ciclo.</p>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <div className="es-duas">
                      <section className="es-bloco">
                        <div className="es-bloco-cabeca"><h2><Icone nome="calendario" />Últimos 15 dias</h2></div>
                        <div className="rf-dias">
                          {porDia.map(({ d, v }) => (
                            <div key={d} className={d === hoje ? "rf-dia hoje" : "rf-dia"}>
                              <span>{dataCurta(d)}</span>
                              <span className="rf-dia-barra"><i style={{ width: `${(v / maxDia) * 100}%` }} /></span>
                              <span className="num">{v ? reais(v) : "—"}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section className="es-bloco">
                        <div className="es-bloco-cabeca"><h2><Icone nome="leitura" />Chamadas ao vivo</h2><span className="muted">{aoVivo ? "atualiza sozinho" : "conectando…"}</span></div>
                        {naEmpresa(chamadas).length === 0 ? <p className="muted">Nenhuma chamada ainda.</p> : (
                          <ul className="rf-ao-vivo">
                            {naEmpresa(chamadas).slice(0, 14).map((k) => (
                              <li key={k.id} className={novas.has(k.id) ? "rf-novo" : ""}>
                                <span className="muted rf-nowrap">{diaSP(k.created_at) === hoje ? hora(k.created_at) : dataHora(k.created_at)}</span>
                                <span>{SERVICOS[k.id_servico] ?? k.id_servico}<span className="muted"> · {nomeEmpresa(k.empresa_id)}</span></span>
                                <span className="num">{k.cobrada ? reais(k.custo) : <span className="muted">grátis</span>}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>

                    <section className="es-bloco">
                      <div className="es-bloco-cabeca"><h2>Por serviço neste ciclo</h2></div>
                      {servicos.length === 0 ? <p className="muted">Nenhuma chamada neste ciclo.</p> : (
                        <div className="tv-tabela-caixa">
                          <table className="tv-tabela">
                            <thead><tr><th>Serviço</th><th>Tipo</th><th>Chamadas</th><th>Cobradas</th><th>Total</th></tr></thead>
                            <tbody>
                              {servicos.map(([id, s]) => (
                                <tr key={id}><td>{SERVICOS[id] ?? id}</td><td>{CATEGORIA[s.categoria] ?? s.categoria}</td><td>{s.n}</td><td>{s.cobradas}</td><td>{reais(s.total)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <details className="es-bloco rf-precos">
                      <summary><h2>Tabela de preços do SERPRO</h2></summary>
                      <p className="muted rf-explica">O preço cai conforme a empresa usa mais no ciclo. Quanto custa a chamada número N do ciclo, por tipo:</p>
                      <div className="tv-tabela-caixa">
                        <table className="tv-tabela">
                          <thead><tr><th>Tipo</th><th>Faixas (chamadas no ciclo → preço)</th></tr></thead>
                          <tbody>
                            {Object.entries(FAIXAS).map(([cat, f]) => (
                              <tr key={cat}>
                                <td>{CATEGORIA[cat]}</td>
                                <td className="rf-faixas">{f.map(([ate, v], i) => <span key={i}>{i === 0 ? "até" : ate === Infinity ? "acima de" : "até"} {ate === Infinity ? f[i - 1][0].toLocaleString("pt-BR") : ate.toLocaleString("pt-BR")} → {reais(v)}</span>)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="muted small">“Tem mensagem nova?” e o pedido do relatório de situação fiscal são grátis. Os valores daqui são calculados pelo Brasico; o que vale é a nota fiscal do SERPRO.</p>
                    </details>
                  </>
                );
              })()}

              {/* ===================== Histórico ===================== */}
              {secao === "pedidos" && (
                <section className="es-bloco">
                  <div className="es-bloco-cabeca">
                    <h2><Icone nome="leitura" />Consultas feitas{teste && " (teste)"}</h2>
                    <button className="ghost small" onClick={() => setAmbiente(teste ? "producao" : "demonstracao")}>{teste ? "Voltar aos dados reais" : "Ver o ambiente de teste"}</button>
                  </div>
                  {naEmpresa(execucoes).length === 0 ? <p className="muted">Nenhuma consulta ainda.</p> : (
                    <div className="tv-tabela-caixa">
                      <table className="tv-tabela">
                        <thead><tr><th>Quando</th><th>Empresa</th><th>O quê</th><th>Resultado</th><th>Situação</th><th>Custo</th></tr></thead>
                        <tbody>
                          {naEmpresa(execucoes).map((x) => (
                            <tr key={x.id}>
                              <td className="rf-nowrap">{dataHora(x.created_at)}</td>
                              <td>{nomeEmpresa(x.empresa_id)}</td>
                              <td>{NOME_TIPO[x.tipo] ?? x.tipo}<div className="muted small">{x.origem === "claude" ? "pelo Claude" : "pelo site"}</div></td>
                              <td className="muted">{x.erro || resumo(x)}</td>
                              <td><span className={STATUS[x.status]?.classe ?? "rf-pilula"}>{STATUS[x.status]?.texto ?? x.status}</span></td>
                              <td>{teste ? "grátis" : reais(custoExecucao(x.id))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* ===================== Ajuda ===================== */}
              {secao === "ajuda" && (
                <section className="es-bloco">
                  <dl className="rf-glossario">
                    <dt>e-CAC</dt><dd>O site da Receita Federal onde a empresa vê mensagens, dívidas, declarações e pagamentos. Aqui a gente lê o mesmo conteúdo, sem precisar entrar lá.</dd>
                    <dt>SERPRO · Integra Contador</dt><dd>O serviço oficial do governo que deixa um sistema consultar o e-CAC. Cada empresa tem o próprio contrato, assinado com o certificado digital dela, e as chaves ficam só no cofre do Brasico.</dd>
                    <dt>Como é cobrado</dt><dd>Por chamada, na conta de cada empresa, num ciclo do dia 21 ao dia 20. Antes de toda consulta cobrada o site mostra o custo e pede confirmação. Perguntar se há mensagem nova é grátis.</dd>
                    <dt>Limite do dia e teto do ciclo</dt><dd>Proteções do Brasico: passou do número de chamadas do dia ou do valor do ciclo, novas consultas daquela empresa são recusadas. Ajuste em Gastos com o SERPRO.</dd>
                    <dt>Ciência automática</dt><dd>Se ninguém abre a mensagem no e-CAC, a Receita considera lida depois de 15 dias. Em intimações, o prazo para responder começa a contar dali.</dd>
                    <dt>Intimação (Painel de Conformidade)</dt><dd>A Receita aponta uma divergência e pede que a empresa corrija ou explique. Encaminhe ao contador.</dd>
                    <dt>Cadin</dt><dd>Cadastro de devedores do governo federal. Estar nele trava certidões, financiamentos e alguns pagamentos públicos.</dd>
                    <dt>Situação fiscal</dt><dd>Relatório oficial com as pendências da empresa na Receita e na Procuradoria (dívidas, declarações faltando, parcelamentos).</dd>
                    <dt>Ambiente de teste</dt><dd>Dados de mentira do SERPRO para testar a ligação. Não é cobrado. Fica em Histórico de consultas.</dd>
                  </dl>
                </section>
              )}
            </div>
          </div>
        )}

        {confirmar && (
          <div className="rf-confirmar" role="dialog" aria-label="Confirmar consulta cobrada">
            <div>
              <strong>{confirmar.titulo}</strong>
              <span className="muted">Custo: {confirmar.custo}, na conta do SERPRO desta empresa.</span>
            </div>
            <span className="rf-acoes">
              <button className="small" onClick={() => enviar(confirmar)}>Consultar</button>
              <button className="ghost small" onClick={() => setConfirmar(null)}>Cancelar</button>
            </span>
          </div>
        )}
      </main>
    </div>
  );
}

function Medidor({ valor, maximo }: { valor: number; maximo: number }) {
  const p = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : 0;
  return (
    <div className={p >= 90 ? "rf-medidor erro" : p >= 70 ? "rf-medidor atencao" : "rf-medidor"} role="meter" aria-valuemin={0} aria-valuemax={maximo} aria-valuenow={valor}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

function resumo(x: Execucao): string {
  const r = x.resultado ?? {};
  if (x.tipo === "caixa_postal") {
    if (r.mensagensNovas === false) return "Nenhuma mensagem nova";
    return `${r.listadas ?? 0} mensagens listadas, ${r.detalhadas ?? 0} textos lidos`;
  }
  if (x.tipo === "situacao_fiscal" && r.tamanho) return `PDF de ${Math.round(Number(r.tamanho) / 1024)} KB`;
  if (x.tipo === "pagamentos") return `${r.pagamentos ?? 0} pagamentos`;
  return "";
}

// Ícones de traço fino, os mesmos da área de RH
const ICONES: Record<string, string> = {
  inicio: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z",
  caixa: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z",
  folha: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  salario: "M12 2v20M17 6.5a4 4 0 0 0-4-2.5H11a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5",
  banco: "M3 10h18M3 6h18M7 14h4M5 20h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z",
  leitura: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6M12 7v5l3 2",
  livro: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z",
  atencao: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  calendario: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
};
function Icone({ nome }: { nome: keyof typeof ICONES }) {
  return (
    <span className="es-icone" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONES[nome]} /></svg>
    </span>
  );
}
