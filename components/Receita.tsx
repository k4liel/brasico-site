"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { lerSitfis, type Sitfis } from "@/lib/receita/sitfis";
import Topo from "./Topo";
import Gaveta from "./Gaveta";
import PainelDividas, { type Divida } from "./PainelDividas";
import { Acervo, type Capitulo, type Fonte, SITUACAO_FONTE } from "./ReceitaGuia";

// Fiscal do grupo numa tela só: o que pede atenção, as 14 inscrições do grupo e o detalhe de cada uma num painel ao lado.
// Dados: cadastro público de todos os CNPJs (fiscal_empresas, BrasilAPI) e, para quem tem contrato do SERPRO
// (Integra Contador), situação fiscal, caixa postal, pagamentos, DCTFWeb, MIT, Simples e parcelamentos
// (receita_execucoes, receita_respostas, receita_mensagens, receita_pagamentos). Custos ao vivo em receita_chamadas.
// Acervo fiscal (o antigo projeto Organograma Fiscal Brasico) em receita_acervo. Esquema em supabase/receita*.sql.

type Tipo = "caixa_postal" | "situacao_fiscal" | "pagamentos" | "eventos" | "servico";
type FiscalEmpresa = {
  cnpj: string; raiz: string; ordem: number; apelido: string; papel: string; grupo: string; unidades: string; observacao: string;
  razao: string | null; fantasia: string | null; situacao: string | null; municipio: string | null; uf: string | null; cnae: string | null;
  natureza: string | null; porte: string | null; capital: number | null; abertura: string | null; simples: boolean | null;
  simples_desde: string | null; simples_exclusao: string | null; regime: string | null; regime_ano: number | null;
  socios: number | null; socios_exterior: number | null; atualizado_em: string | null;
};
type Config = { id: string; producao_ligada: boolean; limite_diario_cobradas: number; orcamento_ciclo: number };
type Execucao = { id: string; empresa_id: string; tipo: Tipo; status: string; erro: string; origem: string; created_at: string };
type SitfisExec = { id: string; empresa_id: string; created_at: string; texto: string | null };
type Mensagem = { empresa_id: string; isn: string; assunto: string; remetente: string; enviada_em: string | null; ciencia_em: string | null; lida_na_receita: boolean; corpo: string | null };
type Relatorio = { id: string; empresa_id: string; created_at: string };
type Pagamento = { empresa_id: string; numero_documento: string; tipo_documento: string; codigo_receita: string; descricao_receita: string; periodo_apuracao: string | null; data_arrecadacao: string | null; valor_total: number | null };
type Chamada = { id: number; execucao_id: string; empresa_id: string; id_servico: string; cobrada: boolean; custo: number; created_at: string };
type Resposta = { empresa_id: string; servico: string; pedido: Record<string, unknown> | null; dados: Record<string, unknown> | null; tem_pdf: boolean; execucao_id: string; indice: number; created_at: string };
type Certificado = { cnpj: string; validade: string | null };
type Rotina = { id: string; nome: string; quando: string; ligada: boolean; ultima_vez: string | null };
type Confirmar = { empresa: string; tipo: Tipo; parametros: Record<string, unknown>; titulo: string; custo: string };
type Alerta = { nivel: "erro" | "atencao" | "info"; empresa: string; titulo: string; detalhe: string; data?: string | null };

// ---------- formatos (horário de Brasília) ----------
const TZ = "America/Sao_Paulo";
const diaSP = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const hojeSP = () => diaSP(new Date().toISOString());
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const dia = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const diaCurto = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const reais = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const reaisCurto = (v: number) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : reais(v));
const cnpjFmt = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const yyyymmdd = (n: unknown) => { const s = String(n ?? ""); return /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };
const competencia = (n: unknown) => { const s = String(n ?? ""); return /^\d{6}$/.test(s) ? `${s.slice(4, 6)}/${s.slice(0, 4)}` : s; };
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const textoDe = (html: string) => {
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
};
function cicloAtual() {
  const [a, m, d] = hojeSP().split("-").map(Number);
  const ini = d >= 21 ? new Date(Date.UTC(a, m - 1, 21)) : new Date(Date.UTC(a, m - 2, 21));
  const prox = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 20));
  return { inicio: ini.toISOString().slice(0, 10), fim: prox.toISOString().slice(0, 10) };
}
// O que o assunto da mensagem diz
const TEMAS: { re: RegExp; rotulo: string; nivel: "erro" | "atencao" }[] = [
  { re: /intima/i, rotulo: "Intimação", nivel: "erro" },
  { re: /exclu|rescis|perder/i, rotulo: "Risco de exclusão", nivel: "erro" },
  { re: /cadin/i, rotulo: "Cadin", nivel: "erro" },
  { re: /malha/i, rotulo: "Malha", nivel: "erro" },
  { re: /parcelamento|negocia|relp/i, rotulo: "Parcelamento", nivel: "atencao" },
  { re: /compensa/i, rotulo: "Compensação", nivel: "atencao" },
];
const temas = (s: string) => TEMAS.filter((t) => t.re.test(s));
const GRUPOS: Record<string, string> = { operacao: "Operação", social: "Social", holding: "Holding", marca: "Marca", parceira: "Parceira", terceiro: "Terceiro" };

// Tudo o que a Receita disse de uma empresa com contrato, já interpretado
type Leitura = {
  sit: Sitfis | null; sitEm: string | null; relatorio: Relatorio | null;
  parcelasAtraso: number; valorAtraso: number;
  naoLidas: Mensagem[]; importantes: Mensagem[];
  pagamentos: Pagamento[]; pago12m: number; ultimoPagamento: string | null;
  dctf: { mes: string; entregue: boolean; resposta: Resposta }[];
  mit: { periodo: string; valor: number; encerrada: boolean }[];
  simples: { periodo: string; declaracoes: number; dasEmAberto: number }[];
  parcelamentos: { sistema: string; numero: string; situacao: string; desde: string | null; detalhe?: string }[];
  dte: string | null;
};

export default function Receita({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [empresas, setEmpresas] = useState<FiscalEmpresa[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [certs, setCerts] = useState<Certificado[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [sitfis, setSitfis] = useState<SitfisExec[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [chamadas, setChamadas] = useState<Chamada[]>([]);
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [acervo, setAcervo] = useState<Capitulo[]>([]);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [levantamento, setLevantamento] = useState<Divida[]>([]);
  const [aberta, setAberta] = useState<string | null>(null); // cnpj no painel
  const [aba, setAba] = useState("resumo");
  const [leitor, setLeitor] = useState<string | null>(null); // seção do acervo aberta
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [aviso, setAviso] = useState("");
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [aoVivo, setAoVivo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("receita_acesso").select("user_id").eq("user_id", userId);
      setAcesso(!!data?.length);
    })();
  }, [supabase, userId]);

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 400 * 86400000).toISOString();
    const [fe, cf, ce, x, sf, m, rl, pg, rs, ch, ro, dv] = await Promise.all([
      supabase.from("fiscal_empresas").select("cnpj,raiz,ordem,apelido,papel,grupo,unidades,observacao,razao,fantasia,situacao,municipio,uf,cnae,natureza,porte,capital,abertura,simples,simples_desde,simples_exclusao,regime,regime_ano,socios,socios_exterior,atualizado_em").order("ordem"),
      supabase.from("receita_empresas").select("id,producao_ligada,limite_diario_cobradas,orcamento_ciclo"),
      supabase.from("certificados").select("cnpj,validade"),
      supabase.from("receita_execucoes").select("id,empresa_id,tipo,status,erro,origem,created_at").eq("ambiente", "producao").order("created_at", { ascending: false }).limit(150),
      supabase.from("receita_execucoes").select("id,empresa_id,created_at,texto:resultado->>texto").eq("ambiente", "producao").eq("tipo", "situacao_fiscal").eq("status", "ok").order("created_at", { ascending: false }).limit(30),
      supabase.from("receita_mensagens").select("empresa_id,isn,assunto,remetente,enviada_em,ciencia_em,lida_na_receita,corpo").eq("ambiente", "producao").order("enviada_em", { ascending: false }).limit(1000),
      supabase.from("receita_relatorios").select("id,empresa_id,created_at").eq("ambiente", "producao").order("created_at", { ascending: false }).limit(60),
      supabase.from("receita_pagamentos").select("empresa_id,numero_documento,tipo_documento,codigo_receita,descricao_receita,periodo_apuracao,data_arrecadacao,valor_total").eq("ambiente", "producao").order("data_arrecadacao", { ascending: false }).limit(2000),
      supabase.from("receita_respostas").select("empresa_id,servico,pedido,dados,tem_pdf,execucao_id,indice,created_at"),
      supabase.from("receita_chamadas").select("id,execucao_id,empresa_id,id_servico,cobrada,custo,created_at").eq("ambiente", "producao").gte("created_at", desde).order("created_at", { ascending: false }).limit(5000),
      supabase.from("receita_rotinas").select("id,nome,quando,ligada,ultima_vez").order("ordem"),
      supabase.from("fiscal_dividas").select("id,cnpj,orgao,categoria,detalhe,competencia,vencimento,principal,multa,juros,total,situacao,sensivel,fonte,data_base").is("arquivado_em", null),
    ]);
    setEmpresas((fe.data ?? []) as FiscalEmpresa[]);
    setConfigs(((cf.data ?? []) as Config[]).map((c) => ({ ...c, orcamento_ciclo: Number(c.orcamento_ciclo) })));
    setCerts((ce.data ?? []) as Certificado[]);
    setExecucoes((x.data ?? []) as Execucao[]);
    setSitfis((sf.data ?? []) as SitfisExec[]);
    setMensagens((m.data ?? []) as Mensagem[]);
    setRelatorios((rl.data ?? []) as Relatorio[]);
    setPagamentos((pg.data ?? []) as Pagamento[]);
    setRespostas((rs.data ?? []) as Resposta[]);
    setChamadas(((ch.data ?? []) as Chamada[]).map((k) => ({ ...k, custo: Number(k.custo) })));
    setRotinas((ro.data ?? []) as Rotina[]);
    // Guia do levantamento que já passou do vencimento conta como vencida até a Receita dizer o contrário
    const hoje = hojeSP();
    setLevantamento(((dv.data ?? []) as (Omit<Divida, "aoVivo" | "dataBase" | "id"> & { id: number; data_base: string })[]).map((d) => ({
      ...d, id: String(d.id), dataBase: d.data_base, aoVivo: false,
      ...(d.situacao === "a_vencer" && d.vencimento && d.vencimento < hoje
        ? { situacao: "vencido" as const, detalhe: `${d.detalhe} · venceu em ${dia(d.vencimento)}; confirmar se foi pago` } : {}),
      principal: d.principal == null ? null : Number(d.principal), multa: d.multa == null ? null : Number(d.multa),
      juros: d.juros == null ? null : Number(d.juros), total: d.total == null ? null : Number(d.total),
    })));
    setCarregado(true);
  }, [supabase]);

  const carregarAcervo = useCallback(async () => {
    const [a, f] = await Promise.all([
      supabase.from("receita_acervo").select("id,secao,ordem,titulo,conteudo,atualizado_na_origem,titulo_en,conteudo_en,titulo_pl,conteudo_pl,titulo_fr,conteudo_fr,titulo_de,conteudo_de").order("ordem"),
      supabase.from("fiscal_fontes").select("id,area,nome,o_que_da,situacao,como,falta,custo,prioridade,onde,ordem").order("ordem"),
    ]);
    setAcervo((a.data ?? []) as Capitulo[]);
    setFontes((f.data ?? []) as Fonte[]);
  }, [supabase]);

  useEffect(() => {
    if (!acesso) return;
    carregar();
    carregarAcervo();
  }, [acesso, carregar, carregarAcervo]);

  // Ao vivo: cada chamada cobrada e cada pedido que termina
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;
  useEffect(() => {
    if (!acesso) return;
    const canal = supabase
      .channel("fiscal-ao-vivo")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "receita_chamadas" }, (ev) => {
        const k = ev.new as Chamada & { ambiente: string };
        if (k.ambiente === "producao") setChamadas((v) => (v.some((x) => x.id === k.id) ? v : [{ ...k, custo: Number(k.custo) }, ...v]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "receita_execucoes" }, () => carregarRef.current())
      .subscribe((s) => setAoVivo(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(canal); };
  }, [supabase, acesso]);

  // O painel abre pelo endereço (?empresa=<cnpj>), para dar para voltar e compartilhar
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("empresa");
    if (c) setAberta(c);
  }, []);
  function abrir(cnpj: string | null, novaAba = "resumo") {
    setAberta(cnpj);
    setAba(novaAba);
    const u = new URL(window.location.href);
    if (cnpj) u.searchParams.set("empresa", cnpj); else u.searchParams.delete("empresa");
    window.history.replaceState(null, "", u.toString());
  }

  // ---------- leituras por empresa (raiz) ----------
  const ligadas = new Set(configs.filter((c) => c.producao_ligada).map((c) => c.id));
  const leituras = useMemo(() => {
    const out = new Map<string, Leitura>();
    const um = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    for (const raiz of ligadas) {
      const ultSit = sitfis.find((s) => s.empresa_id === raiz && s.texto);
      const sit = ultSit?.texto ? lerSitfis(ultSit.texto) : null;
      let parcelasAtraso = 0, valorAtraso = 0;
      for (const s of sit?.secoes ?? []) {
        if (s.suspensa) continue;
        for (const m of s.texto.matchAll(/Parcelas em atraso:?\s*(\d+)/gi)) parcelasAtraso += Number(m[1]);
        for (const m of s.texto.matchAll(/Valor em Atraso:\s*([\d.]+,\d{2})/gi)) valorAtraso += Number(m[1].replace(/\./g, "").replace(",", "."));
      }
      const msgs = mensagens.filter((m) => m.empresa_id === raiz);
      const pags = pagamentos.filter((p) => p.empresa_id === raiz);
      const resp = respostas.filter((r) => r.empresa_id === raiz);
      const dctf = resp.filter((r) => r.servico === "DCTFWEB/CONSRECIBO32")
        .map((r) => ({ mes: `${(r.pedido as { anoPA?: string })?.anoPA}-${(r.pedido as { mesPA?: string })?.mesPA}`, entregue: r.tem_pdf, resposta: r }))
        .sort((a, b) => b.mes.localeCompare(a.mes));
      const mit = resp.filter((r) => r.servico === "MIT/LISTAAPURACOES317")
        .flatMap((r) => ((r.dados?.Apuracoes as { periodoApuracao: number; valorTotalApurado: number; situacao: number }[]) ?? []))
        .map((a) => ({ periodo: String(a.periodoApuracao), valor: Number(a.valorTotalApurado ?? 0), encerrada: a.situacao === 3 }))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));
      type Op = { tipoOperacao: string; indiceDas: { dasPago: boolean } | null; indiceDeclaracao: unknown };
      const simples = resp.filter((r) => r.servico === "PGDASD/CONSDECLARACAO13")
        .flatMap((r) => ((r.dados?.periodos as { periodoApuracao: number; operacoes: Op[] }[]) ?? []))
        .map((p) => ({
          periodo: String(p.periodoApuracao),
          declaracoes: p.operacoes.filter((o) => o.indiceDeclaracao).length,
          dasEmAberto: p.operacoes.some((o) => o.indiceDas?.dasPago) ? 0 : p.operacoes.filter((o) => o.indiceDas && !o.indiceDas.dasPago).length,
        }))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));
      const parcelamentos = resp.filter((r) => /PEDIDOSPARC/.test(r.servico))
        .flatMap((r) => ((r.dados?.parcelamentos as { numero: number; situacao: string; dataDoPedido: number; dataDaSituacao: number }[]) ?? [])
          .map((p) => ({ sistema: r.servico.split("/")[0], numero: String(p.numero), situacao: p.situacao, desde: yyyymmdd(p.dataDaSituacao), detalhe: undefined as string | undefined })));
      const det = resp.find((r) => r.servico === "PARCSN/OBTERPARC164")?.dados as { numero?: number; consolidacaoOriginal?: { parcelaBasica?: number; quantidadeParcelas?: number } } | undefined;
      if (det?.numero) {
        const p = parcelamentos.find((x) => x.sistema === "PARCSN" && x.numero === String(det.numero));
        if (p && det.consolidacaoOriginal) p.detalhe = `${det.consolidacaoOriginal.quantidadeParcelas} parcelas de cerca de ${reais(det.consolidacaoOriginal.parcelaBasica)}`;
      }
      const dte = (resp.find((r) => r.servico === "DTE/CONSULTASITUACAODTE111")?.dados?.statusEnquadramento as string) ?? null;
      const pags12 = pags.filter((p) => (p.data_arrecadacao ?? "") >= um);
      out.set(raiz, {
        sit, sitEm: ultSit?.created_at ?? null, relatorio: relatorios.find((r) => r.empresa_id === raiz) ?? null,
        parcelasAtraso, valorAtraso,
        naoLidas: msgs.filter((m) => !m.lida_na_receita),
        importantes: msgs.filter((m) => temas(m.assunto).some((t) => t.nivel === "erro")),
        pagamentos: pags, pago12m: pags12.reduce((s, p) => s + Number(p.valor_total ?? 0), 0), ultimoPagamento: pags[0]?.data_arrecadacao ?? null,
        dctf, mit, simples, parcelamentos, dte,
      });
    }
    return out;
  }, [ligadas, sitfis, mensagens, pagamentos, respostas, relatorios]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- o que pede atenção ----------
  const alertas = useMemo(() => {
    const a: Alerta[] = [];
    const hoje = hojeSP();
    // Alerta de uma raiz aponta para a matriz (0001)
    const matriz = (raiz: string) => empresas.find((e) => e.raiz === raiz && e.cnpj.slice(8, 12) === "0001") ?? empresas.find((e) => e.raiz === raiz);
    const nome = (raiz: string) => matriz(raiz)?.apelido ?? raiz;
    for (const [r0, l] of leituras) {
      const raiz = matriz(r0)?.cnpj ?? r0;
      const nomeR = nome(r0);
      if (l.sit?.certidao?.vencida) a.push({ nivel: "erro", empresa: raiz, titulo: `Certidão federal vencida desde ${dia(l.sit.certidao.validade)}`, detalhe: `${nomeR} · a última era ${l.sit.certidao.tipo.toLowerCase()}` });
      if (l.parcelasAtraso) a.push({ nivel: "erro", empresa: raiz, titulo: `${plural(l.parcelasAtraso, "parcela", "parcelas")} de parcelamento em atraso`, detalhe: `${nomeR}${l.valorAtraso ? ` · ${reais(l.valorAtraso)} em atraso nos parcelamentos simplificados` : ""} · pela situação fiscal de ${l.sitEm ? dataHora(l.sitEm) : "—"}` });
      if (l.sit && l.sit.totalDebitos > 0) a.push({ nivel: "atencao", empresa: raiz, titulo: `${reais(l.sit.totalDebitos)} em débitos em aberto na Receita`, detalhe: `${nomeR} · ${plural(l.sit.debitos.length, "débito", "débitos")}, o mais antigo de ${l.sit.debitos.map((d) => d.periodo).sort((x, y) => x.slice(-4) + x.slice(0, 2) < y.slice(-4) + y.slice(0, 2) ? -1 : 1)[0] ?? "—"}` });
      for (const p of l.parcelamentos.filter((p) => /rescis/i.test(p.situacao) && p.desde && diasEntre(p.desde, hoje) < 120))
        a.push({ nivel: "erro", empresa: raiz, titulo: `${p.sistema} nº ${p.numero} encerrado por rescisão`, detalhe: `${nomeR} · em ${dia(p.desde)}`, data: p.desde });
      for (const m of l.naoLidas.filter((m) => temas(m.assunto).length)) {
        const n = m.ciencia_em ? diasEntre(hoje, m.ciencia_em) : null;
        a.push({
          nivel: temas(m.assunto).some((t) => t.nivel === "erro") ? "erro" : "atencao", empresa: raiz, titulo: m.assunto,
          detalhe: `${nomeR} · caixa postal, sem ler · ${n == null ? "" : n < 0 ? `ciência automática já correu (${diaCurto(m.ciencia_em)})` : `ciência automática em ${plural(n, "dia", "dias")}`}`, data: m.ciencia_em,
        });
      }
    }
    for (const c of certs) {
      if (!c.validade) continue;
      const n = diasEntre(hoje, diaSP(c.validade));
      const e = empresas.find((x) => x.cnpj === c.cnpj);
      if (n <= 45) a.push({ nivel: n < 0 ? "erro" : "atencao", empresa: c.cnpj, titulo: n < 0 ? "Certificado digital vencido" : `Certificado digital vence em ${plural(n, "dia", "dias")}`, detalhe: `${e?.apelido ?? cnpjFmt(c.cnpj)} · ${dia(diaSP(c.validade))}` });
    }
    const peso = { erro: 0, atencao: 1, info: 2 };
    return a.sort((x, y) => peso[x.nivel] - peso[y.nivel]);
  }, [leituras, certs, empresas]);

  // ---------- custos ----------
  const ciclo = useMemo(cicloAtual, []);
  const cobradas = chamadas.filter((k) => k.cobrada);
  const gasto = (raiz: string | null, de: string, ate = "9999") => cobradas.filter((k) => (!raiz || k.empresa_id === raiz) && diaSP(k.created_at) >= de && diaSP(k.created_at) <= ate).reduce((s, k) => s + k.custo, 0);

  // ---------- pedidos à Receita (com confirmação do custo) ----------
  function pedir(empresa: string, tipo: Tipo, parametros: Record<string, unknown>, titulo: string, custo: string) {
    setAviso("");
    setConfirmar({ empresa, tipo, parametros, titulo, custo });
  }
  async function enviar(c: Confirmar) {
    setConfirmar(null);
    const { error } = await supabase.rpc("receita_consultar", { p_empresa: c.empresa, p_ambiente: "producao", p_tipo: c.tipo, p_parametros: c.parametros });
    if (error) return setAviso(error.message);
    carregar();
  }
  const rodando = (raiz: string) => execucoes.some((x) => x.empresa_id === raiz && (x.status === "na_fila" || x.status === "rodando"));

  async function abrirPdf(base64: string | null) {
    if (!base64) return setAviso("Não consegui abrir o PDF.");
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function abrirRelatorio(id: string) {
    const { data } = await supabase.from("receita_relatorios").select("pdf_base64").eq("id", id).single();
    abrirPdf((data as { pdf_base64?: string } | null)?.pdf_base64 ?? null);
  }
  async function abrirRecibo(r: Resposta) {
    const { data } = await supabase.rpc("receita_resposta_pdf", { p_execucao: r.execucao_id, p_indice: r.indice });
    abrirPdf((data as string | null) ?? null);
  }
  async function alternarRotina(id: string, ligada: boolean) {
    const { error } = await supabase.rpc("receita_rotina_ligar", { p_id: id, p_ligada: ligada });
    if (error) return setAviso(error.message);
    setRotinas((v) => v.map((r) => (r.id === id ? { ...r, ligada } : r)));
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="receita" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à área fiscal.</p></main>
      </div>
    );
  }

  const ultimaLeitura = execucoes.find((x) => x.status === "ok")?.created_at;
  const comAcesso = empresas.filter((e) => ligadas.has(e.raiz));
  const semAcesso = empresas.filter((e) => !ligadas.has(e.raiz));
  const empresaAberta = empresas.find((e) => e.cnpj === aberta) ?? null;
  // Dívidas do painel central: o relatório de hoje da Receita substitui o levantamento da Receita e da PGFN daquela empresa
  const dividas: Divida[] = [];
  const releu = new Set<string>();
  for (const e of empresas.filter((x) => x.cnpj.slice(8, 12) === "0001")) {
    const l = leituras.get(e.raiz);
    if (!l?.sit || !l.sitEm) continue;
    releu.add(e.raiz);
    dividas.push(...sitfisParaDividas(e.cnpj, l.sit, l.sitEm));
  }
  dividas.push(...levantamento.filter((d) => !(releu.has(d.cnpj.slice(0, 8)) && (d.orgao === "Receita Federal" || d.orgao === "PGFN"))));
  const totalDebitos = [...leituras.values()].reduce((s, l) => s + (l.sit?.totalDebitos ?? 0), 0);
  const certVencidas = [...leituras.values()].filter((l) => l.sit?.certidao?.vencida).length;
  const naoLidasTotal = [...leituras.values()].reduce((s, l) => s + l.naoLidas.length, 0);

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="receita" />
      <main className="miolo fx es">
        <header className="fx-topo">
          <div>
            <span className="es-sobre">Companhia · Fiscal</span>
            <h1>Fiscal do grupo</h1>
            <p className="muted">
              {empresas.length} inscrições · {comAcesso.length} ligadas à Receita pelo SERPRO
              {ultimaLeitura ? ` · última leitura da Receita ${dataHora(ultimaLeitura)}` : ""}
            </p>
          </div>
          <button className="fx-gasto" onClick={() => setLeitor("custos")} title="Gastos com o SERPRO e rotina automática">
            <span className={aoVivo ? "rf-ponto" : "rf-ponto parado"} aria-hidden="true" />
            <span>SERPRO hoje <b>{reais(gasto(null, hojeSP(), hojeSP()))}</b></span>
            <span className="fx-gasto-sep">ciclo {diaCurto(ciclo.inicio)}–{diaCurto(ciclo.fim)} <b>{reais(gasto(null, ciclo.inicio))}</b></span>
          </button>
        </header>

        {aviso && <p className="es-aviso" role="alert">{aviso}</p>}

        {!carregado ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : (
          <>
            <PainelDividas dividas={dividas} empresas={empresas} />

            {/* Números do grupo, num relance */}
            <div className="fx-numeros">
              <div><span>Débitos em aberto na Receita</span><b className={totalDebitos ? "fx-perigo" : ""}>{reaisCurto(totalDebitos)}</b><small>situação fiscal de hoje, {comAcesso.length > 0 ? "empresas ligadas" : "—"}</small></div>
              <div><span>Certidões federais</span><b className={certVencidas ? "fx-perigo" : "fx-ok"}>{certVencidas ? `${certVencidas} vencida${certVencidas > 1 ? "s" : ""}` : "em dia"}</b><small>prévia do relatório da Receita</small></div>
              <div><span>Caixa postal sem ler</span><b className={naoLidasTotal ? "fx-alerta" : ""}>{naoLidasTotal}</b><small>mensagens no e-CAC</small></div>
              <div><span>Pago à Receita em 12 meses</span><b>{reaisCurto([...leituras.values()].reduce((s, l) => s + l.pago12m, 0))}</b><small>DARF e DAS das empresas ligadas</small></div>
            </div>

            {/* O que pede atenção */}
            <section className="fx-bloco">
              <div className="fx-bloco-cabeca">
                <h2>O que pede atenção</h2>
                <span className="muted">{alertas.length ? plural(alertas.length, "ponto", "pontos") : "nada pendente"}</span>
              </div>
              {alertas.length === 0 ? <p className="es-tudo-certo">✓ Nada pendente nas empresas ligadas à Receita.</p> : (
                <ul className="fx-alertas">
                  {(mostrarTodos ? alertas : alertas.slice(0, 7)).map((x, i) => {
                    const e = empresas.find((y) => y.cnpj === x.empresa);
                    return (
                      <li key={i} className={`fx-alerta-item ${x.nivel}`}>
                        <button onClick={() => e && abrir(e.cnpj, /caixa postal/.test(x.detalhe) ? "mensagens" : /débito|parcela|certid/i.test(x.titulo) ? "debitos" : "resumo")}>
                          <span className="fx-marca" aria-hidden="true" />
                          <span className="fx-alerta-texto"><strong>{x.titulo}</strong><span>{x.detalhe}</span></span>
                          <span className="fx-seta" aria-hidden="true">›</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {alertas.length > 7 && <button className="ghost small fx-mais" onClick={() => setMostrarTodos(!mostrarTodos)}>{mostrarTodos ? "Mostrar menos" : `Ver os ${alertas.length}`}</button>}
            </section>

            {/* Empresas ligadas à Receita */}
            <section className="fx-bloco">
              <div className="fx-bloco-cabeca"><h2>Ligadas à Receita</h2><span className="muted">contrato do SERPRO e certificado no Brasico · clique para ver tudo</span></div>
              <div className="fx-cartoes">
                {comAcesso.map((e) => {
                  const l = leituras.get(e.raiz);
                  const matriz = e.cnpj.slice(8, 12) === "0001";
                  return (
                    <button key={e.cnpj} className="fx-cartao rico" onClick={() => abrir(e.cnpj)}>
                      <div className="fx-cartao-topo">
                        <div><strong>{e.apelido}</strong><span className="fx-cnpj">{cnpjFmt(e.cnpj)}</span></div>
                        <span className="fx-tag">{e.simples ? "Simples" : e.regime ? e.regime.replace("LUCRO ", "L. ").toLowerCase() : "—"}</span>
                      </div>
                      <p className="fx-papel">{e.papel}</p>
                      {matriz && l ? (
                        <dl className="fx-medidas">
                          <div><dt>Certidão</dt><dd className={l.sit?.certidao?.vencida ? "fx-perigo" : "fx-ok"}>{l.sit?.certidao ? (l.sit.certidao.vencida ? "vencida" : `até ${diaCurto(l.sit.certidao.validade)}`) : "—"}</dd></div>
                          <div><dt>Débitos em aberto</dt><dd className={l.sit?.totalDebitos ? "fx-perigo" : ""}>{l.sit ? reaisCurto(l.sit.totalDebitos) : "—"}</dd></div>
                          <div><dt>Parcelas em atraso</dt><dd className={l.parcelasAtraso ? "fx-perigo" : ""}>{l.sit ? l.parcelasAtraso : "—"}</dd></div>
                          <div><dt>Sem ler no e-CAC</dt><dd className={l.naoLidas.length ? "fx-alerta" : ""}>{l.naoLidas.length}</dd></div>
                          <div><dt>DCTFWeb entregues</dt><dd>{l.dctf.length ? `${l.dctf.filter((d) => d.entregue).length} de ${l.dctf.length} meses` : "—"}</dd></div>
                          <div><dt>Pago em 12 meses</dt><dd>{reaisCurto(l.pago12m)}</dd></div>
                        </dl>
                      ) : (
                        <p className="fx-nota">Impostos federais apurados pela matriz. {e.observacao}</p>
                      )}
                      <span className="fx-rodape">{l?.sitEm ? `Receita lida em ${dataHora(l.sitEm)}` : "ainda sem relatório lido"}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Demais empresas do grupo */}
            <section className="fx-bloco">
              <div className="fx-bloco-cabeca"><h2>Demais empresas do grupo</h2><span className="muted">cadastro oficial da Receita, atualizado todo mês</span></div>
              <div className="fx-cartoes compactos">
                {semAcesso.map((e) => (
                  <button key={e.cnpj} className="fx-cartao" onClick={() => abrir(e.cnpj)}>
                    <div className="fx-cartao-topo">
                      <div><strong>{e.apelido}</strong><span className="fx-cnpj">{cnpjFmt(e.cnpj)}</span></div>
                      <span className={e.situacao === "ATIVA" ? "fx-tag ok" : "fx-tag perigo"}>{(e.situacao ?? "—").toLowerCase()}</span>
                    </div>
                    <p className="fx-papel">{e.papel}</p>
                    <span className="fx-rodape">{GRUPOS[e.grupo] ?? e.grupo} · {(e.municipio ?? "").toLowerCase()} · {e.regime ? e.regime.toLowerCase() : e.simples ? "simples" : "regime não informado"}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Biblioteca e mapa */}
            <section className="fx-bloco fx-biblioteca">
              <div className="fx-bloco-cabeca"><h2>Consulta</h2><span className="muted">o guia fiscal do grupo e o que ainda falta ligar</span></div>
              <div className="fx-atalhos">
                {[
                  { id: "acessos", t: "O que temos e o que falta", d: `${fontes.filter((f) => f.situacao === "temos").length} fontes ligadas · ${fontes.filter((f) => f.situacao !== "temos").length} por ligar` },
                  { id: "dividas", t: "Levantamento de dívidas e plano", d: "fotografia de 20/10/2026 e o plano de pagamento" },
                  { id: "empresas", t: "Mapa societário e organograma", d: "quem é sócio de quem e as obrigações de cada um" },
                  { id: "mapa", t: "Órgãos e obrigações", d: "Receita, eSocial, notas, Estado, prefeituras, certidões, bancos" },
                  { id: "calendario", t: "Calendário fiscal", d: "os prazos de cada mês" },
                  { id: "reforma", t: "Reforma tributária", d: "IBS e CBS para restaurantes e hotéis" },
                  { id: "roteiro", t: "Roteiro e perguntas ao contador", d: "as fases até a área fiscal ficar completa" },
                  { id: "referencias", t: "Glossário e fontes", d: "cada sigla explicada" },
                ].map((x) => (
                  <button key={x.id} className="fx-atalho" onClick={() => setLeitor(x.id)}><strong>{x.t}</strong><span>{x.d}</span></button>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ===== Painel da empresa ===== */}
        {empresaAberta && (
          <PainelEmpresa
            e={empresaAberta} l={leituras.get(empresaAberta.raiz) ?? null} ligada={ligadas.has(empresaAberta.raiz)}
            config={configs.find((c) => c.id === empresaAberta.raiz)} certs={certs} aba={aba} setAba={setAba}
            fechar={() => abrir(null)} gasto={gasto} ciclo={ciclo} rodando={rodando(empresaAberta.raiz)}
            pedir={pedir} abrirRelatorio={abrirRelatorio} abrirRecibo={abrirRecibo}
          />
        )}

        {/* ===== Leitor do guia, mapa e custos ===== */}
        {leitor && (
          <Gaveta titulo={leitor === "custos" ? "Gastos com o SERPRO e rotina" : leitor === "acessos" ? "O que temos e o que falta" : ({ dividas: "Dívidas e plano de pagamento", empresas: "Mapa societário e organograma", mapa: "Órgãos e obrigações", calendario: "Calendário fiscal", reforma: "Reforma tributária", roteiro: "Roteiro e perguntas", referencias: "Glossário e fontes" } as Record<string, string>)[leitor] ?? ""} fechar={() => setLeitor(null)}>
            {leitor === "custos" ? (
              <Custos empresas={comAcesso.filter((e) => e.cnpj.slice(8, 12) === "0001")} configs={configs} gasto={gasto} ciclo={ciclo} chamadas={chamadas} rotinas={rotinas} alternar={alternarRotina} />
            ) : leitor === "acessos" ? (
              <Acessos fontes={fontes} />
            ) : (
              <Acervo capitulos={acervo.filter((c) => c.secao === leitor)} aviso={leitor === "dividas" ? "Levantamento de 20/10/2026, feito à mão. Os débitos de hoje estão em cada empresa, lidos do relatório oficial da Receita." : undefined} />
            )}
          </Gaveta>
        )}

        {confirmar && (
          <div className="rf-confirmar" role="dialog" aria-label="Confirmar consulta cobrada">
            <div><strong>{confirmar.titulo}</strong><span className="muted">Custo: {confirmar.custo}, na conta do SERPRO desta empresa.</span></div>
            <span className="rf-acoes"><button className="small" onClick={() => enviar(confirmar)}>Consultar</button><button className="ghost small" onClick={() => setConfirmar(null)}>Cancelar</button></span>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Painel de uma empresa
// ---------------------------------------------------------------------
function PainelEmpresa({ e, l, ligada, config, certs, aba, setAba, fechar, gasto, ciclo, rodando, pedir, abrirRelatorio, abrirRecibo }: {
  e: FiscalEmpresa; l: Leitura | null; ligada: boolean; config?: Config; certs: Certificado[]; aba: string; setAba: (a: string) => void; fechar: () => void;
  gasto: (raiz: string | null, de: string, ate?: string) => number; ciclo: { inicio: string; fim: string }; rodando: boolean;
  pedir: (empresa: string, tipo: Tipo, p: Record<string, unknown>, titulo: string, custo: string) => void;
  abrirRelatorio: (id: string) => void; abrirRecibo: (r: Resposta) => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const cert = certs.find((c) => c.cnpj === e.cnpj);
  const abas = ligada && l ? [["resumo", "Resumo"], ["debitos", "Débitos"], ["mensagens", "Caixa postal"], ["declaracoes", "Declarações"], ["pagamentos", "Pagamentos"], ["cadastro", "Cadastro"]] : [["resumo", "Resumo"], ["cadastro", "Cadastro"]];
  const atual = abas.some(([id]) => id === aba) ? aba : "resumo";
  return (
    <Gaveta titulo={e.apelido} sub={`${cnpjFmt(e.cnpj)} · ${e.razao ?? ""}`} fechar={fechar}
      topo={<nav className="fx-abas" role="tablist">{abas.map(([id, t]) => <button key={id} role="tab" aria-selected={atual === id} className={atual === id ? "on" : ""} onClick={() => setAba(id)}>{t}</button>)}</nav>}>
      {atual === "resumo" && (
        <>
          {e.observacao && <p className="fx-obs">{e.observacao}</p>}
          {ligada && l ? (
            <>
              <dl className="fx-medidas grande">
                <div><dt>Certidão federal</dt><dd className={l.sit?.certidao?.vencida ? "fx-perigo" : "fx-ok"}>{l.sit?.certidao ? (l.sit.certidao.vencida ? `vencida em ${dia(l.sit.certidao.validade)}` : `${l.sit.certidao.tipo.toLowerCase()}, até ${dia(l.sit.certidao.validade)}`) : "—"}</dd></div>
                <div><dt>Débitos em aberto</dt><dd className={l.sit?.totalDebitos ? "fx-perigo" : ""}>{l.sit ? reais(l.sit.totalDebitos) : "—"}</dd></div>
                <div><dt>Parcelas em atraso</dt><dd className={l.parcelasAtraso ? "fx-perigo" : ""}>{l.sit ? `${l.parcelasAtraso}${l.valorAtraso ? ` · ${reais(l.valorAtraso)}` : ""}` : "—"}</dd></div>
                <div><dt>Dívida ativa (PGFN)</dt><dd className={l.sit && !l.sit.pgfnLimpo ? "fx-alerta" : "fx-ok"}>{l.sit ? (l.sit.pgfnLimpo ? "nada inscrito" : "há inscrição (ver Débitos)") : "—"}</dd></div>
                <div><dt>Caixa postal</dt><dd>{plural(l.naoLidas.length, "mensagem sem ler", "mensagens sem ler")}</dd></div>
                <div><dt>DTE (caixa postal vale como intimação)</dt><dd>{l.dte ?? "—"}</dd></div>
                <div><dt>Certificado digital</dt><dd className={cert?.validade && diasEntre(hojeSP(), diaSP(cert.validade)) < 45 ? "fx-alerta" : ""}>{cert?.validade ? `vale até ${dia(diaSP(cert.validade))}` : "—"}</dd></div>
                <div><dt>Gasto SERPRO no ciclo</dt><dd>{reais(gasto(e.raiz, ciclo.inicio))} de {reais(config?.orcamento_ciclo)}</dd></div>
              </dl>
              <div className="fx-acoes">
                <button className="botao-painel" disabled={rodando} onClick={() => pedir(e.raiz, "situacao_fiscal", {}, `Situação fiscal · ${e.apelido}`, "R$ 0,32")}>{rodando ? "Consultando…" : "Gerar situação fiscal de hoje"}</button>
                <button className="botao-painel" disabled={rodando} onClick={() => pedir(e.raiz, "caixa_postal", {}, `Caixa postal · ${e.apelido}`, "grátis se não houver nada novo; até R$ 1,44")}>Ver se há mensagem nova</button>
                {l.relatorio && <button className="botao-painel" onClick={() => abrirRelatorio(l.relatorio!.id)}>Abrir o PDF da Receita</button>}
              </div>
              <p className="muted small">A rotina já atualiza sozinha toda manhã: eventos e caixa postal todo dia, pagamentos quando mudam, situação fiscal toda semana.</p>
            </>
          ) : (
            <section className="fx-falta">
              <h3>Para ler a Receita desta empresa</h3>
              <p>Hoje o Brasico só tem o cadastro público. Para ver débitos, caixa postal, declarações e pagamentos é preciso:</p>
              <ol>
                <li>o certificado digital e-CNPJ A1 da empresa (Menu → Certificados digitais), e</li>
                <li>um contrato próprio do Integra Contador no SERPRO, assinado com esse certificado (as chaves vão para o cofre, como nas outras três).</li>
              </ol>
              <p className="muted small">Alternativa sem contrato novo: a empresa dá procuração eletrônica no e-CAC para uma das empresas com contrato (exige um ajuste no Brasico).</p>
            </section>
          )}
        </>
      )}

      {atual === "debitos" && l && (
        <>
          {!l.sit ? <p className="muted">Ainda não há relatório de situação fiscal lido para esta empresa. Gere um no Resumo.</p> : (
            <>
              <p className="muted small">Do relatório oficial da Receita de {l.sitEm ? dataHora(l.sitEm) : "—"}. “Suspenso” quer dizer em parcelamento ou discussão: não impede a certidão.</p>
              {l.sit.debitos.length > 0 && (
                <div className="tv-tabela-caixa">
                  <table className="tv-tabela">
                    <thead><tr><th>Tributo</th><th>Competência</th><th>Vencimento</th><th>Total hoje</th></tr></thead>
                    <tbody>
                      {l.sit.debitos.map((d, i) => (
                        <tr key={i}><td>{d.receita}</td><td>{d.periodo}</td><td>{dia(d.vencimento)}</td><td>{reais(d.total)}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={3}>Total em aberto</td><td>{reais(l.sit.totalDebitos)}</td></tr></tfoot>
                  </table>
                </div>
              )}
              {l.sit.secoes.filter((s) => !/Débito/i.test(s.titulo) || s.suspensa).map((s, i) => (
                <div key={i} className={s.suspensa ? "fx-secao suspensa" : "fx-secao"}>
                  <div className="fx-secao-topo"><strong>{s.titulo}</strong><span className={s.suspensa ? "fx-tag ok" : "fx-tag perigo"}>{s.orgao} · {s.suspensa ? "suspenso" : "pendente"}</span></div>
                  <p>{s.texto}</p>
                </div>
              ))}
              {l.sit.pgfnLimpo && <p className="es-tudo-certo">✓ Procuradoria (PGFN): nada inscrito em dívida ativa.</p>}
            </>
          )}
          {l.parcelamentos.length > 0 && (
            <>
              <h3 className="fx-h3">Parcelamentos do Simples (PARCSN, Relp, Pert)</h3>
              <ul className="fx-lista">
                {l.parcelamentos.map((p, i) => (
                  <li key={i}><span><strong>{p.sistema} nº {p.numero}</strong> · {p.situacao}{p.detalhe ? ` · ${p.detalhe}` : ""}</span><span className="muted">{p.desde ? `desde ${dia(p.desde)}` : ""}</span></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {atual === "mensagens" && l && (
        <ul className="fx-msgs">
          {l.naoLidas.length + l.importantes.length === 0 && <p className="muted">Nada sem ler nem importante na caixa postal.</p>}
          {[...new Map([...l.naoLidas, ...l.importantes].map((m) => [m.isn, m])).values()]
            .sort((a, b) => (b.enviada_em ?? "").localeCompare(a.enviada_em ?? "")).slice(0, 40).map((m) => (
            <li key={m.isn} className={m.lida_na_receita ? "" : "nova"}>
              <button onClick={() => setAberta(aberta === m.isn ? null : m.isn)}>
                <span className="fx-msg-topo">
                  {temas(m.assunto).map((t) => <span key={t.rotulo} className={`fx-tag ${t.nivel === "erro" ? "perigo" : "alerta"}`}>{t.rotulo}</span>)}
                  <strong>{m.assunto}</strong>
                </span>
                <span className="muted small">{dia(m.enviada_em)} · {m.lida_na_receita ? `lida (${diaCurto(m.ciencia_em)})` : m.ciencia_em ? `sem ler · ciência automática ${diasEntre(hojeSP(), m.ciencia_em) < 0 ? "já correu" : `em ${diaCurto(m.ciencia_em)}`}` : "sem ler"}</span>
              </button>
              {aberta === m.isn && <div className="rf-texto">{m.corpo ? textoDe(m.corpo) : "Texto ainda não baixado (cada texto custa R$ 0,24)."}</div>}
            </li>
          ))}
        </ul>
      )}

      {atual === "declaracoes" && l && (
        <>
          <h3 className="fx-h3">DCTFWeb (INSS da folha e retenções)</h3>
          {l.dctf.length === 0 ? <p className="muted">Ainda não lida.</p> : (
            <div className="fx-meses">
              {l.dctf.map((d) => (
                <button key={d.mes} className={d.entregue ? "ok" : "falta"} onClick={() => d.entregue && abrirRecibo(d.resposta)} title={d.entregue ? "Abrir o recibo" : "Sem recibo"}>
                  <b>{d.mes.slice(5, 7)}/{d.mes.slice(2, 4)}</b><span>{d.entregue ? "entregue" : "sem recibo"}</span>
                </button>
              ))}
            </div>
          )}
          {l.mit.length > 0 && (
            <>
              <h3 className="fx-h3">MIT · IRPJ, CSLL, PIS e COFINS apurados</h3>
              <div className="tv-tabela-caixa"><table className="tv-tabela">
                <thead><tr><th>Competência</th><th>Situação</th><th>Valor apurado</th></tr></thead>
                <tbody>{l.mit.map((m) => <tr key={m.periodo}><td>{competencia(m.periodo)}</td><td>{m.encerrada ? "encerrada" : "em andamento"}</td><td>{reais(m.valor)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
          {l.simples.length > 0 && (
            <>
              <h3 className="fx-h3">Simples Nacional · declarações mensais (PGDAS-D)</h3>
              <div className="tv-tabela-caixa"><table className="tv-tabela">
                <thead><tr><th>Competência</th><th>Declarações</th><th>DAS sem pagamento</th></tr></thead>
                <tbody>{l.simples.map((s) => <tr key={s.periodo}><td>{competencia(s.periodo)}</td><td>{s.declaracoes}</td><td className={s.dasEmAberto ? "fx-perigo" : ""}>{s.dasEmAberto ? s.dasEmAberto : "pago"}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </>
      )}

      {atual === "pagamentos" && l && (
        l.pagamentos.length === 0 ? <p className="muted">Nenhum pagamento lido.</p> : (
          <div className="tv-tabela-caixa"><table className="tv-tabela">
            <thead><tr><th>Imposto</th><th>Competência</th><th>Pago em</th><th>Valor</th></tr></thead>
            <tbody>{l.pagamentos.slice(0, 200).map((p) => (
              <tr key={p.numero_documento}><td>{p.codigo_receita} · {p.descricao_receita}<div className="muted small">{p.tipo_documento}</div></td><td>{p.periodo_apuracao ? `${p.periodo_apuracao.slice(5, 7)}/${p.periodo_apuracao.slice(0, 4)}` : ""}</td><td>{dia(p.data_arrecadacao)}</td><td>{reais(p.valor_total)}</td></tr>
            ))}</tbody>
          </table></div>
        )
      )}

      {atual === "cadastro" && (
        <dl className="fx-kv">
          <div><dt>Razão social</dt><dd>{e.razao ?? "—"}</dd></div>
          {e.fantasia && <div><dt>Nome fantasia</dt><dd>{e.fantasia}</dd></div>}
          <div><dt>Situação</dt><dd>{e.situacao ?? "—"}</dd></div>
          <div><dt>Papel no grupo</dt><dd>{e.papel}{e.unidades ? ` · ${e.unidades}` : ""}</dd></div>
          <div><dt>Município</dt><dd>{e.municipio ?? "—"}/{e.uf ?? ""}</dd></div>
          <div><dt>Atividade</dt><dd>{e.cnae ?? "—"}</dd></div>
          <div><dt>Natureza</dt><dd>{e.natureza ?? "—"}</dd></div>
          <div><dt>Porte</dt><dd>{e.porte ?? "—"}</dd></div>
          <div><dt>Capital social</dt><dd>{reais(e.capital)}</dd></div>
          <div><dt>Abertura</dt><dd>{dia(e.abertura)}</dd></div>
          <div><dt>Regime</dt><dd>{e.simples ? `Simples Nacional desde ${dia(e.simples_desde)}` : e.regime ? `${e.regime.toLowerCase()} (ECF ${e.regime_ano})` : "não informado"}{e.simples_exclusao && !e.simples ? ` · saiu do Simples em ${dia(e.simples_exclusao)}` : ""}</dd></div>
          <div><dt>Quadro societário</dt><dd>{e.socios ?? "—"} pessoas{e.socios_exterior ? ` (${e.socios_exterior} no exterior)` : ""}</dd></div>
          <div><dt>Atualizado</dt><dd>{e.atualizado_em ? `${dataHora(e.atualizado_em)} · cadastro público da Receita` : "—"}</dd></div>
        </dl>
      )}
    </Gaveta>
  );
}

// ---------------------------------------------------------------------
// Gastos e rotina
// ---------------------------------------------------------------------
function Custos({ empresas, configs, gasto, ciclo, chamadas, rotinas, alternar }: {
  empresas: FiscalEmpresa[]; configs: Config[]; gasto: (raiz: string | null, de: string, ate?: string) => number; ciclo: { inicio: string; fim: string };
  chamadas: Chamada[]; rotinas: Rotina[]; alternar: (id: string, ligada: boolean) => void;
}) {
  const hoje = hojeSP();
  return (
    <>
      <p className="muted small">Cada consulta paga é cobrada na conta do SERPRO da própria empresa, num ciclo do dia 21 ao dia 20. Toda consulta pelo site pede confirmação com o custo antes.</p>
      <div className="tv-tabela-caixa"><table className="tv-tabela">
        <thead><tr><th>Empresa</th><th>Hoje</th><th>Ciclo {diaCurto(ciclo.inicio)}–{diaCurto(ciclo.fim)}</th><th>Teto do ciclo</th></tr></thead>
        <tbody>{empresas.map((e) => {
          const c = configs.find((x) => x.id === e.raiz);
          return <tr key={e.cnpj}><td>{e.apelido}</td><td>{reais(gasto(e.raiz, hoje, hoje))}</td><td>{reais(gasto(e.raiz, ciclo.inicio))}</td><td>{reais(c?.orcamento_ciclo)}</td></tr>;
        })}</tbody>
        <tfoot><tr><td>Total</td><td>{reais(gasto(null, hoje, hoje))}</td><td>{reais(gasto(null, ciclo.inicio))}</td><td></td></tr></tfoot>
      </table></div>
      <h3 className="fx-h3">Rotina automática (toda manhã, só gasta quando há novidade)</h3>
      <ul className="fx-lista">
        {rotinas.map((r) => (
          <li key={r.id}>
            <span><strong>{r.nome}</strong> · {r.quando}<span className="muted small">{r.ultima_vez ? ` · última ${dataHora(r.ultima_vez)}` : ""}</span></span>
            <label className="rf-chave"><input type="checkbox" checked={r.ligada} onChange={(ev) => alternar(r.id, ev.target.checked)} /><span>{r.ligada ? "ligada" : "desligada"}</span></label>
          </li>
        ))}
      </ul>
      <h3 className="fx-h3">Últimas chamadas</h3>
      <ul className="fx-lista">
        {chamadas.slice(0, 15).map((k) => (
          <li key={k.id}><span>{k.id_servico}<span className="muted small"> · {dataHora(k.created_at)}</span></span><span>{k.cobrada ? reais(k.custo) : <span className="muted">grátis</span>}</span></li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------
// O que temos e o que falta (mapa de acessos)
// ---------------------------------------------------------------------
function Acessos({ fontes }: { fontes: Fonte[] }) {
  const ordem = ["temos", "pronto", "falta", "manual", "futuro"];
  return (
    <>
      {ordem.map((s) => {
        const lista = fontes.filter((f) => f.situacao === s);
        if (!lista.length) return null;
        return (
          <section key={s} className="fx-acesso-grupo">
            <h3 className="fx-h3"><span className={SITUACAO_FONTE[s].classe}>{SITUACAO_FONTE[s].rotulo}</span> <span className="muted">{lista.length}</span></h3>
            <ul className="fx-lista larga">
              {lista.map((f) => (
                <li key={f.id}>
                  <span><strong>{f.nome}</strong> <span className="muted small">· {f.area}</span><br /><span className="small">{f.o_que_da}</span>{f.falta && f.falta !== "—" && <><br /><span className="small muted">→ {f.falta}</span></>}</span>
                  <span className="muted small fx-custo">{f.custo}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------
// Relatório de situação fiscal de hoje → lançamentos do painel de dívidas
// ---------------------------------------------------------------------
const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
function categoriaDe(receita: string): { categoria: string; sensivel: boolean } {
  const r = receita.toUpperCase();
  if (/IRRF/.test(r)) return { categoria: "IRRF retido", sensivel: true };
  if (/CP.?SEGUR|SEGURADO/.test(r)) return { categoria: "INSS descontado dos funcionários", sensivel: true };
  if (/CSRF|PIS.COFINS.CSLL/.test(r)) return { categoria: "CSRF retida", sensivel: true };
  if (/TERCEIROS|OUTRAS ENT/.test(r)) return { categoria: "INSS de terceiros", sensivel: false };
  if (/CP.?PATRONAL|PATRONAL|CP-EMPRESA/.test(r)) return { categoria: "INSS patronal", sensivel: false };
  if (/SIMPLES/.test(r)) return { categoria: "Simples Nacional", sensivel: false };
  if (/IRPJ/.test(r)) return { categoria: "IRPJ", sensivel: false };
  if (/CSLL/.test(r)) return { categoria: "CSLL", sensivel: false };
  if (/COFINS/.test(r)) return { categoria: "COFINS", sensivel: false };
  if (/PIS/.test(r)) return { categoria: "PIS", sensivel: false };
  return { categoria: receita.replace(/^\d{4}-\d{2}\s*-\s*/, "") || "Outros", sensivel: false };
}
function sitfisParaDividas(cnpj: string, sit: Sitfis, em: string): Divida[] {
  const fonte = `Situação fiscal da Receita · ${dataHora(em)}`;
  const base = { cnpj, fonte, dataBase: em.slice(0, 10), aoVivo: true };
  const hoje = hojeSP();
  const out: Divida[] = sit.debitos.map((d, i) => {
    const c = categoriaDe(d.receita);
    const compet = /^\d{2}\/\d{4}$/.test(d.periodo) ? `${d.periodo.slice(3)}-${d.periodo.slice(0, 2)}` : d.periodo;
    return {
      ...base, id: `v${cnpj}d${i}`, orgao: "Receita Federal", categoria: c.categoria, sensivel: c.sensivel, detalhe: d.receita,
      competencia: compet, vencimento: d.vencimento, principal: d.saldo, multa: d.multa, juros: d.juros, total: d.total,
      situacao: d.vencimento < hoje ? "vencido" : "a_vencer",
    };
  });
  sit.secoes.forEach((s, k) => {
    if (/Débito|Processo/i.test(s.titulo) && !s.suspensa) return;
    const orgao = s.orgao === "PGFN" ? "PGFN" : "Receita Federal";
    const numeros = [...s.texto.matchAll(/(?:Parcelamento:|Conta|Inscrição)\s*([\d.-]+)/g)];
    const vazio = { competencia: null, vencimento: null, principal: null, multa: null, juros: null };
    if (s.suspensa) {
      // Em parcelamento ou negociado, sem atraso: entra como "parcelado em dia"
      const categoria = orgao === "PGFN" ? "Dívida ativa negociada" : "Parcelamento (em dia)";
      const valores = [...s.texto.matchAll(/Valor Suspenso:\s*([\d.]+,\d{2})/gi)];
      if (valores.length) valores.forEach((v, i) => out.push({ ...base, ...vazio, id: `v${cnpj}s${k}${i}`, orgao, categoria, sensivel: false,
        detalhe: `${s.titulo} · ${numeros[i]?.[1] ?? ""}`, total: numero(v[1]), situacao: "parcelado" }));
      else out.push({ ...base, ...vazio, id: `v${cnpj}s${k}`, orgao, categoria, sensivel: false,
        detalhe: `${s.titulo} · ${s.texto.slice(0, 160)}`, total: null, situacao: "parcelado" });
      return;
    }
    if (/Parcelamento/i.test(s.titulo)) {
      const valores = [...s.texto.matchAll(/Valor em Atraso:\s*([\d.]+,\d{2})/gi)];
      const parcelas = [...s.texto.matchAll(/Parcelas em atraso:?\s*(\d+)/gi)];
      parcelas.forEach((p, i) => out.push({ ...base, ...vazio, id: `v${cnpj}p${k}${i}`, orgao, sensivel: false,
        categoria: /PARCSN|SIMPLES/i.test(s.titulo + s.texto) && !valores[i] ? "Parcelamento do Simples" : "Parcelamento simplificado",
        detalhe: `${numeros[i]?.[1] ?? s.texto.slice(0, 60)} · ${p[1]} parcelas em atraso${valores[i] ? "" : " (valor não informado no relatório)"}`,
        total: valores[i] ? numero(valores[i][1]) : null, situacao: "parcela_atraso" }));
    }
  });
  return out;
}
