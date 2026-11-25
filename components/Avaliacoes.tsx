"use client";

// Central de avaliações (/avaliacoes; 24/11/2026, pedido do dono: "ver todas as avaliações no mesmo lugar", com o Google
// de todas as casas, TripAdvisor e os canais de venda dos hotéis). Só os sócios veem (RLS: notas_pode_ver).
// Dados: avaliacoes_fontes (cada casa em cada site, com nota e total do site), avaliacoes (cada avaliação) e
// avaliacoes_notas (nota e total de cada dia, para a evolução). Quem lê: o robô do PMS na VPS (robos/avaliacoes),
// cada fonte a cada 6 h. Esquema em supabase/avaliacoes.sql. CSS no bloco "Avaliações" de app/globals.css (av-*).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import Gaveta from "./Gaveta";

type Fonte = {
  id: string; casa: string; site: string; tipo: string; nome_no_site: string | null; url: string | null; escala: number;
  ativa: boolean; observacao: string | null; nota: number | null; total: number | null; distribuicao: Record<string, number> | null;
  posicao: string | null; lida_em: string | null; tentou_em: string | null; intervalo_minutos: number; robo: boolean; erro: string | null; erro_em: string | null; ordem: number;
};
// mais nova primeiro (data da avaliação; no mesmo dia, a que chegou por último)
const ordemAvaliacoes = (a: { data_avaliacao: string | null; id: number }, b: { data_avaliacao: string | null; id: number }) =>
  (b.data_avaliacao ?? "").localeCompare(a.data_avaliacao ?? "") || b.id - a.id;
type Avaliacao = {
  id: number; fonte_id: string; autor: string | null; autor_info: string | null; pais: string | null; nota: number | null; escala: number;
  nota5: number | null; titulo: string | null; texto: string | null; positivo: string | null; negativo: string | null; resposta: string | null;
  data_avaliacao: string | null; data_aproximada: boolean; data_texto: string | null; estadia: string | null; perfil: string | null;
  quarto: string | null; link: string | null; primeira_leitura: string;
};

export const CASAS = [
  { id: "filha_da_lua", nome: "Filha da Lua", tipo: "Hotel" },
  { id: "sempre_vivo", nome: "Sempre Vivo", tipo: "Hotel" },
  { id: "cicchetti_pipa", nome: "Cicchetti Pipa", tipo: "Restaurante" },
  { id: "cicchetti_ponta_negra", nome: "Cicchetti Ponta Negra", tipo: "Restaurante" },
];
const SITES: Record<string, { nome: string; curto: string }> = {
  google: { nome: "Google", curto: "G" },
  tripadvisor: { nome: "Tripadvisor", curto: "T" },
  booking: { nome: "Booking.com", curto: "B" },
  expedia: { nome: "Expedia", curto: "E" },
};
const ORDEM_SITES = ["google", "tripadvisor", "booking", "expedia"];
// Assuntos que mais aparecem (busca simples no texto; sem IA)
const TEMAS: { id: string; nome: string; termos: RegExp }[] = [
  { id: "atendimento", nome: "Atendimento", termos: /atend|gar[çc]om|gar[çc]onete|equipe|staff|servi[çc]o|recep[çc]|simp[áa]tic|atencios|service|friendly/i },
  { id: "comida", nome: "Comida", termos: /comida|prato|sabor|delicios|gostos|risoto|massa|pizza|ravioli|food|tasty|meal/i },
  { id: "preco", nome: "Preço", termos: /pre[çc]o|caro|cara\b|valor|conta\b|barato|price|expensive/i },
  { id: "porcao", nome: "Porções", termos: /por[çc][õo]es|por[çc][ãa]o|pequen|small portion|tapas/i },
  { id: "drinks", nome: "Drinks e bar", termos: /drink|bebida|coquetel|caipirinha|cocktail|bar\b|vinho|wine/i },
  { id: "ambiente", nome: "Ambiente", termos: /ambiente|decora|lindo|bonit|aconchegante|atmosfera|vista|view|beautiful/i },
  { id: "espera", nome: "Demora", termos: /demor|espera|lento|slow|wait/i },
  { id: "cafe", nome: "Café da manhã", termos: /caf[ée] da manh[ãa]|breakfast|desayuno|petit[- ]d[ée]jeuner/i },
  { id: "quarto", nome: "Quarto", termos: /quarto|bangal|su[íi]te|cama|chuveiro|banheiro|room|bed|shower/i },
  { id: "limpeza", nome: "Limpeza", termos: /limp|sujo|clean|dirty/i },
  { id: "piscina", nome: "Piscina e praia", termos: /piscina|praia|mar\b|pool|beach/i },
  { id: "barulho", nome: "Barulho", termos: /barulh|ru[íi]do|noise|noisy/i },
];
type Periodo = "30" | "90" | "365" | "tudo";
const PERIODOS: { id: Periodo; nome: string }[] = [
  { id: "30", nome: "30 dias" }, { id: "90", nome: "90 dias" }, { id: "365", nome: "12 meses" }, { id: "tudo", nome: "Tudo" },
];

const fmt = (n: number | null | undefined, casas = 1) => n == null ? "–" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const inteiro = (n: number | null | undefined) => n == null ? "–" : n.toLocaleString("pt-BR");
const nomeCasa = (id: string) => CASAS.find((c) => c.id === id)?.nome ?? id;
function hojeIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function diasAtras(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function haQuanto(iso: string | null) {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora"; if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
function dataCurta(a: Avaliacao) {
  if (a.data_aproximada && a.data_texto) return a.data_texto;
  if (!a.data_avaliacao) return a.data_texto ?? "";
  const [y, m, d] = a.data_avaliacao.split("-");
  return `${d}/${m}/${y}`;
}
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Média da casa: nota de cada site convertida para 0–5, pesada pelo nº de avaliações do site
function mediaCasa(fs: Fonte[]) {
  let soma = 0, peso = 0, total = 0;
  for (const f of fs) if (f.nota != null && f.total) { soma += (f.nota * 5 / f.escala) * f.total; peso += f.total; total += f.total; }
  return { nota: peso ? soma / peso : null, total };
}

function Estrelas({ n, tam = 14 }: { n: number | null; tam?: number }) {
  const p = n == null ? 0 : Math.max(0, Math.min(100, (n / 5) * 100));
  return (
    <span className="av-estrelas" style={{ fontSize: tam }} aria-label={n == null ? "sem nota" : `${fmt(n)} de 5`}>
      <span className="av-estrelas-fundo">★★★★★</span>
      <span className="av-estrelas-cheias" style={{ width: `${p}%` }}>★★★★★</span>
    </span>
  );
}
function Selo({ site }: { site: string }) {
  return <i className={`av-selo av-s-${site}`} title={SITES[site]?.nome}>{SITES[site]?.curto ?? "?"}</i>;
}
function NotaSite({ f }: { f: Fonte }) {
  return <>{fmt(f.nota, 1)}<small>/{f.escala}</small></>;
}

export default function Avaliacoes({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [avs, setAvs] = useState<Avaliacao[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [semAcesso, setSemAcesso] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>("90");
  const [casa, setCasa] = useState<string>("todas");
  const [site, setSite] = useState<string>("todos");
  const [faixa, setFaixa] = useState<string>("todas");
  const [semResposta, setSemResposta] = useState(false);
  const [tema, setTema] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(30);
  const [aberta, setAberta] = useState<Avaliacao | null>(null);
  const [verSites, setVerSites] = useState(false);
  const [aoVivo, setAoVivo] = useState(false);
  const [recemChegadas, setRecemChegadas] = useState<Set<number>>(new Set());
  const [avisos, setAvisos] = useState<{ id: number; a: Avaliacao }[]>([]);
  const [ultimaVisita, setUltimaVisita] = useState<string | null>(null);
  const [, setTique] = useState(0);

  const carregar = useCallback(async () => {
    const f = await supabase.from("avaliacoes_fontes").select("*").order("ordem");
    if (f.error) { setSemAcesso(true); setCarregado(true); return; }
    const todas: Avaliacao[] = [];
    for (let de = 0; ; de += 1000) {
      const r = await supabase.from("avaliacoes")
        .select("id,fonte_id,autor,autor_info,pais,nota,escala,nota5,titulo,texto,positivo,negativo,resposta,data_avaliacao,data_aproximada,data_texto,estadia,perfil,quarto,link,primeira_leitura")
        .order("data_avaliacao", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(de, de + 999);
      if (r.error || !r.data?.length) break;
      todas.push(...(r.data as Avaliacao[]));
      if (r.data.length < 1000) break;
    }
    setFontes((f.data ?? []) as Fonte[]);
    setAvs(todas);
    setCarregado(true);
  }, [supabase]);

  useEffect(() => {
    carregar();
    const t = setInterval(() => document.visibilityState === "visible" && carregar(), 10 * 60 * 1000);
    const vis = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [carregar]);

  // Ao vivo (Supabase Realtime): avaliação nova aparece na hora, com aviso no canto e destaque no cartão;
  // nota e total de cada site e a hora da leitura também mudam sozinhos.
  useEffect(() => {
    const canal = supabase.channel("avaliacoes-ao-vivo")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "avaliacoes" }, (p) => {
        const a = p.new as Avaliacao;
        setAvs((v) => (v.some((x) => x.id === a.id) ? v : [a, ...v].sort(ordemAvaliacoes)));
        setRecemChegadas((s) => new Set(s).add(a.id));
        setAvisos((l) => [...l.slice(-3), { id: a.id, a }]);
        setTimeout(() => setAvisos((l) => l.filter((x) => x.id !== a.id)), 12000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "avaliacoes" }, (p) => {
        const a = p.new as Avaliacao;
        setAvs((v) => v.map((x) => (x.id === a.id ? { ...x, ...a } : x)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "avaliacoes_fontes" }, (p) => {
        const f = p.new as Fonte;
        setFontes((v) => v.map((x) => (x.id === f.id ? { ...x, ...f } : x)));
      })
      .subscribe((status) => setAoVivo(status === "SUBSCRIBED"));
    return () => { supabase.removeChannel(canal); };
  }, [supabase]);

  // relógio da tela ("há 3 min", "próxima olhada em…") e a última visita (o que chegou depois dela ganha "nova")
  useEffect(() => {
    const t = setInterval(() => setTique((n) => n + 1), 20000);
    try {
      const antes = localStorage.getItem("brasico-av-visita");
      if (antes) setUltimaVisita(antes);
      localStorage.setItem("brasico-av-visita", new Date().toISOString());
    } catch {}
    return () => clearInterval(t);
  }, []);

  const fontePorId = useMemo(() => Object.fromEntries(fontes.map((f) => [f.id, f])), [fontes]);
  const desde = periodo === "tudo" ? "0000" : diasAtras(Number(periodo));
  const noPeriodo = useMemo(() => avs.filter((a) => (a.data_avaliacao ?? "") >= desde), [avs, desde]);
  const ultimaLeitura = useMemo(() => fontes.reduce<string | null>((m, f) => (f.lida_em && (!m || f.lida_em > m) ? f.lida_em : m), null), [fontes]);
  // quando o robô olha o Google de novo (a vigia confere a cada 1–2 min o que já passou do intervalo)
  const proximaGoogle = (() => {
    const g = fontes.filter((f) => f.robo && f.ativa && f.tentou_em);
    if (!g.length) return null;
    const prox = Math.min(...g.map((f) => new Date(f.tentou_em!).getTime() + (f.intervalo_minutos || 10) * 60000));
    return Math.max(0, Math.ceil((prox - Date.now()) / 60000));
  })();
  const ehNova = (a: Avaliacao) => recemChegadas.has(a.id) || (!!ultimaVisita && new Date(a.primeira_leitura) > new Date(ultimaVisita));

  // números do topo (todas as casas)
  const topo = useMemo(() => {
    const ativas = fontes.filter((f) => f.ativa);
    const g = mediaCasa(ativas);
    const notas = noPeriodo.filter((a) => a.nota5 != null);
    const media = notas.length ? notas.reduce((s, a) => s + (a.nota5 ?? 0), 0) / notas.length : null;
    const ruins = noPeriodo.filter((a) => (a.nota5 ?? 5) <= 3);
    const respondidas = noPeriodo.filter((a) => a.resposta).length;
    return { nota: g.nota, total: g.total, novas: noPeriodo.length, media, ruins: ruins.length, ruinsSem: ruins.filter((a) => !a.resposta).length,
      taxa: noPeriodo.length ? respondidas / noPeriodo.length : null };
  }, [fontes, noPeriodo]);

  // gráfico: avaliações por mês (12 meses) por site e a nota média
  const porMes = useMemo(() => {
    const meses: { chave: string; nome: string; [k: string]: number | string | null }[] = [];
    const d = new Date(); d.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      meses.push({ chave: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`, nome: `${MES[x.getMonth()]}/${String(x.getFullYear()).slice(2)}`, media: null });
    }
    const somas: Record<string, { s: number; n: number }> = {};
    for (const a of avs) {
      const f = fontePorId[a.fonte_id]; if (!f || !a.data_avaliacao) continue;
      if (casa !== "todas" && f.casa !== casa) continue;
      const k = a.data_avaliacao.slice(0, 7); const m = meses.find((x) => x.chave === k); if (!m) continue;
      m[f.site] = ((m[f.site] as number) || 0) + 1;
      if (a.nota5 != null) { somas[k] = somas[k] || { s: 0, n: 0 }; somas[k].s += a.nota5; somas[k].n++; }
    }
    for (const m of meses) m.media = somas[m.chave] ? Math.round((somas[m.chave].s / somas[m.chave].n) * 100) / 100 : null;
    return meses;
  }, [avs, fontePorId, casa]);

  // pede atenção: nota até 3 de 5 nos últimos 30 dias, sem resposta primeiro
  const atencao = useMemo(() => avs.filter((a) => (a.nota5 ?? 5) <= 3 && (a.data_avaliacao ?? "") >= diasAtras(30)
    && (casa === "todas" || fontePorId[a.fonte_id]?.casa === casa))
    .sort((a, b) => Number(!!a.resposta) - Number(!!b.resposta) || (b.data_avaliacao ?? "").localeCompare(a.data_avaliacao ?? "")).slice(0, 6),
  [avs, fontePorId, casa]);

  // assuntos: quantas avaliações do período citam cada um, e quantas delas foram boas (4–5) ou ruins (até 3)
  const temas = useMemo(() => {
    const base = noPeriodo.filter((a) => casa === "todas" || fontePorId[a.fonte_id]?.casa === casa);
    return TEMAS.map((t) => {
      const cit = base.filter((a) => t.termos.test([a.titulo, a.texto, a.positivo, a.negativo].filter(Boolean).join(" ")));
      return { ...t, n: cit.length, boas: cit.filter((a) => (a.nota5 ?? 0) >= 4).length, ruins: cit.filter((a) => (a.nota5 ?? 5) <= 3).length };
    }).filter((t) => t.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
  }, [noPeriodo, fontePorId, casa]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const t = tema ? TEMAS.find((x) => x.id === tema) : null;
    return noPeriodo.filter((a) => {
      const f = fontePorId[a.fonte_id]; if (!f) return false;
      if (casa !== "todas" && f.casa !== casa) return false;
      if (site !== "todos" && f.site !== site) return false;
      const n = a.nota5 ?? 0;
      if (faixa === "5" && n < 4.75) return false;
      if (faixa === "4" && (n < 3.75 || n >= 4.75)) return false;
      if (faixa === "3" && (n < 2.75 || n >= 3.75)) return false;
      if (faixa === "ruins" && n >= 2.75) return false;
      if (semResposta && a.resposta) return false;
      const corpo = [a.autor, a.titulo, a.texto, a.positivo, a.negativo].filter(Boolean).join(" ");
      if (t && !t.termos.test(corpo)) return false;
      if (q && !corpo.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [noPeriodo, fontePorId, casa, site, faixa, semResposta, busca, tema]);
  useEffect(() => setMostrar(30), [casa, site, faixa, semResposta, busca, tema, periodo]);

  if (semAcesso) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="avaliacoes" />
        <main className="miolo"><p className="vazio muted">Só os sócios veem as avaliações.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="avaliacoes" />
      <main className="miolo av-pagina">
        <header className="fx-topo">
          <div>
            <h1>Avaliações</h1>
            <p className="muted">Google, Tripadvisor, Booking e Expedia das casas, num lugar só. Avaliação nova aparece aqui sozinha, sem recarregar.</p>
            <p className="av-vivo">
              <span className={aoVivo ? "av-vivo-ponto on" : "av-vivo-ponto"} />
              <b>{aoVivo ? "Ao vivo" : "Conectando…"}</b>
              <span className="muted">· última leitura {haQuanto(ultimaLeitura)}{proximaGoogle != null ? ` · próxima leitura automática ${proximaGoogle <= 0 ? "agora" : `em ${proximaGoogle} min`}` : ""}</span>
            </p>
          </div>
          <div className="av-seg" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.id} role="tab" aria-selected={periodo === p.id} className={periodo === p.id ? "on" : ""} onClick={() => setPeriodo(p.id)}>{p.nome}</button>
            ))}
          </div>
        </header>

        {!carregado ? <p className="vazio muted">Carregando as avaliações…</p> : (<>
          <section className="fx-numeros av-numeros">
            <div><span>Nota geral das casas</span><b>{fmt(topo.nota, 2)} <Estrelas n={topo.nota} tam={18} /></b><small>média dos sites, pesada pelo nº de avaliações</small></div>
            <div><span>Avaliações nos sites</span><b>{inteiro(topo.total)}</b><small>somando todos os sites ligados</small></div>
            <div><span>Novas no período</span><b>{inteiro(topo.novas)}</b><small>{topo.media != null ? <>média {fmt(topo.media, 2)} de 5</> : "—"}</small></div>
            <div><span>Notas baixas (até 3)</span><b className={topo.ruinsSem ? "fx-perigo" : ""}>{inteiro(topo.ruins)}</b><small>{topo.ruinsSem} sem resposta · {topo.taxa != null ? `${Math.round(topo.taxa * 100)}% respondidas` : ""}</small></div>
          </section>

          <section className="av-casas">
            {CASAS.map((c) => {
              const fs = fontes.filter((f) => f.casa === c.id);
              const ativas = fs.filter((f) => f.ativa && f.nota != null);
              const m = mediaCasa(ativas);
              const novas = noPeriodo.filter((a) => fontePorId[a.fonte_id]?.casa === c.id).length;
              const on = casa === c.id;
              return (
                <button key={c.id} className={`av-casa${on ? " on" : ""}${ativas.length ? "" : " sem"}`} onClick={() => setCasa(on ? "todas" : c.id)} aria-pressed={on}>
                  <span className="av-casa-tipo">{c.tipo}</span>
                  <strong>{c.nome}</strong>
                  {ativas.length ? (<>
                    <span className="av-casa-nota"><b>{fmt(m.nota, 1)}</b><Estrelas n={m.nota} tam={15} /></span>
                    <span className="av-casa-sub">{inteiro(m.total)} avaliações · {novas} novas no período</span>
                    <span className="av-casa-sites">
                      {ORDEM_SITES.map((s) => fs.filter((f) => f.site === s && f.ativa && f.nota != null).map((f) => (
                        <span key={f.id} className="av-casa-site" title={`${SITES[s].nome}${f.tipo === "restaurante" && c.tipo === "Hotel" ? " · restaurante" : ""}: ${inteiro(f.total)} avaliações`}>
                          <Selo site={s} /><NotaSite f={f} />
                        </span>
                      )))}
                    </span>
                  </>) : (
                    <span className="av-casa-vazia">Ainda sem perfil no Google e no Tripadvisor. Criando o perfil, ele entra aqui sozinho.</span>
                  )}
                </button>
              );
            })}
          </section>

          <div className="av-duas">
            <section className="fx-bloco av-cartao">
              <div className="fx-bloco-cabeca"><h2>Avaliações por mês</h2><span className="muted">{casa === "todas" ? "todas as casas" : nomeCasa(casa)} · 12 meses</span></div>
              <div className="av-grafico">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={porMes} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                    <XAxis dataKey="nome" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis yAxisId="n" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis yAxisId="m" orientation="right" domain={[1, 5]} hide />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                      formatter={(v, k) => [k === "media" ? `${fmt(Number(v), 2)} de 5` : String(v), k === "media" ? "Nota média" : SITES[String(k)]?.nome ?? String(k)]} />
                    {ORDEM_SITES.map((s, i) => <Bar key={s} yAxisId="n" dataKey={s} stackId="a" fill={`var(--av-${s})`} radius={i === ORDEM_SITES.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={26} />)}
                    <Line yAxisId="m" dataKey="media" type="monotone" stroke="var(--gold)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="av-legenda">
                {ORDEM_SITES.map((s) => <span key={s}><i style={{ background: `var(--av-${s})` }} />{SITES[s].nome}</span>)}
                <span><i className="linha" />Nota média (0–5)</span>
              </div>
            </section>

            <section className="fx-bloco av-cartao">
              <div className="fx-bloco-cabeca"><h2>Pede atenção</h2><span className="muted">notas até 3 nos últimos 30 dias</span></div>
              {atencao.length === 0 ? <p className="av-tranquilo">Nenhuma nota baixa nos últimos 30 dias. 🙌</p> : (
                <ul className="av-atencao">
                  {atencao.map((a) => {
                    const f = fontePorId[a.fonte_id];
                    return (
                      <li key={a.id}>
                        <button onClick={() => setAberta(a)}>
                          <span className="av-at-topo"><Selo site={f?.site ?? ""} /><b>{nomeCasa(f?.casa ?? "")}</b><Estrelas n={a.nota5} tam={12} /><span className="muted">{dataCurta(a)}</span></span>
                          <span className="av-at-texto">{a.titulo ? `${a.titulo} — ` : ""}{a.texto ?? a.negativo ?? "(sem texto)"}</span>
                          {!a.resposta && <span className="av-pilula">sem resposta</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {temas.length > 0 && (
            <section className="fx-bloco">
              <div className="fx-bloco-cabeca"><h2>O que mais aparece</h2><span className="muted">assuntos citados no período · verde = notas 4 e 5, vermelho = até 3 · clique para filtrar</span></div>
              <div className="av-temas">
                {temas.map((t) => (
                  <button key={t.id} className={`av-tema${tema === t.id ? " on" : ""}`} onClick={() => setTema(tema === t.id ? null : t.id)}>
                    <span className="av-tema-nome">{t.nome}<small>{t.n}</small></span>
                    <span className="av-tema-barra"><i className="b" style={{ width: `${(t.boas / t.n) * 100}%` }} /><i className="r" style={{ width: `${(t.ruins / t.n) * 100}%` }} /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="fx-bloco">
            <div className="fx-bloco-cabeca">
              <h2>Todas as avaliações</h2>
              <span className="muted">{inteiro(lista.length)} no filtro</span>
            </div>
            <div className="av-filtros">
              <div className="av-seg pequeno">
                <button className={site === "todos" ? "on" : ""} onClick={() => setSite("todos")}>Todos os sites</button>
                {ORDEM_SITES.map((s) => <button key={s} className={site === s ? "on" : ""} onClick={() => setSite(s)}><Selo site={s} />{SITES[s].nome}</button>)}
              </div>
              <div className="av-seg pequeno">
                {[["todas", "Todas as notas"], ["5", "5★"], ["4", "4★"], ["3", "3★"], ["ruins", "1–2★"]].map(([k, n]) => (
                  <button key={k} className={faixa === k ? "on" : ""} onClick={() => setFaixa(k)}>{n}</button>
                ))}
              </div>
              <label className="av-check"><input type="checkbox" checked={semResposta} onChange={(e) => setSemResposta(e.target.checked)} /> Só sem resposta</label>
              <input className="av-busca" type="search" placeholder="Buscar no texto ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {(casa !== "todas" || tema) && (
                <span className="av-ativos">
                  {casa !== "todas" && <button onClick={() => setCasa("todas")}>{nomeCasa(casa)} ×</button>}
                  {tema && <button onClick={() => setTema(null)}>{TEMAS.find((t) => t.id === tema)?.nome} ×</button>}
                </span>
              )}
            </div>

            {lista.length === 0 ? <p className="vazio muted">Nenhuma avaliação com esses filtros.</p> : (
              <div className="av-lista">
                {lista.slice(0, mostrar).map((a) => <CartaoAvaliacao key={a.id} a={a} f={fontePorId[a.fonte_id]} nova={ehNova(a)} recem={recemChegadas.has(a.id)} abrir={() => setAberta(a)} />)}
              </div>
            )}
            {lista.length > mostrar && <button className="botao-painel fx-mais" onClick={() => setMostrar((m) => m + 30)}>Mostrar mais ({inteiro(lista.length - mostrar)})</button>}
          </section>

          <section className="fx-bloco">
            <div className="fx-bloco-cabeca">
              <h2>Sites ligados</h2>
              <button className="botao-painel" onClick={() => setVerSites((v) => !v)}>{verSites ? "Recolher" : `Ver os ${fontes.length} sites`}</button>
            </div>
            {verSites && (
              <div className="av-sites">
                {fontes.map((f) => (
                  <div key={f.id} className={`av-site${f.ativa ? "" : " off"}`}>
                    <Selo site={f.site} />
                    <div className="av-site-nome"><b>{nomeCasa(f.casa)}</b><span className="muted">{SITES[f.site]?.nome}{f.tipo === "restaurante" && f.casa === "sempre_vivo" ? " · restaurante" : ""} · {f.nome_no_site}</span></div>
                    <div className="av-site-nota">{f.nota != null ? <><b><NotaSite f={f} /></b><span className="muted">{inteiro(f.total)} aval.</span></> : <span className="muted">—</span>}</div>
                    <div className="av-site-sit">
                      {!f.ativa ? <span className="muted">{f.observacao ?? "desligado"}</span>
                        : !f.robo ? <span className="muted" title="O site responde ao robô com verificação de robô; a leitura automática vai pela API oficial">carga manual {haQuanto(f.lida_em)} · automático pela API oficial (a pedir)</span>
                        : f.erro && (!f.lida_em || (f.erro_em ?? "") > f.lida_em) ? <span className="fx-perigo" title={f.erro}>falhou {haQuanto(f.erro_em)}</span>
                        : f.lida_em ? <span className="fx-ok">lido {haQuanto(f.lida_em)}</span> : <span className="muted">{f.url ? "ainda não lido" : f.observacao ?? "falta o endereço"}</span>}
                      {f.posicao && <small className="muted">{f.posicao}</small>}
                    </div>
                    {f.url && <a className="av-site-link" href={f.url} target="_blank" rel="noreferrer">abrir ↗</a>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>)}
      </main>

      {avisos.length > 0 && (
        <div className="av-avisos" aria-live="polite">
          {avisos.map(({ id, a }) => {
            const f = fontePorId[a.fonte_id];
            return (
              <button key={id} className="av-aviso" onClick={() => { setAberta(a); setAvisos((l) => l.filter((x) => x.id !== id)); }}>
                <Selo site={f?.site ?? ""} />
                <span><b>Nova avaliação · {nomeCasa(f?.casa ?? "")}</b><small><Estrelas n={a.nota5} tam={11} /> {a.autor ?? ""} — {(a.texto ?? a.titulo ?? "").slice(0, 90)}</small></span>
              </button>
            );
          })}
        </div>
      )}

      {aberta && (() => {
        const f = fontePorId[aberta.fonte_id];
        return (
          <Gaveta titulo={aberta.autor ?? "Avaliação"} sub={`${nomeCasa(f?.casa ?? "")} · ${SITES[f?.site ?? ""]?.nome ?? ""} · ${dataCurta(aberta)}`} fechar={() => setAberta(null)}>
            <div className="av-detalhe">
              <p className="av-det-nota"><Estrelas n={aberta.nota5} tam={20} /> <b>{fmt(aberta.nota, aberta.escala === 10 ? 1 : 0)}</b><span className="muted"> de {aberta.escala}</span></p>
              {aberta.autor_info && <p className="muted">{aberta.autor_info}{aberta.pais ? ` · ${aberta.pais}` : ""}</p>}
              {aberta.titulo && <h3>{aberta.titulo}</h3>}
              {aberta.positivo || aberta.negativo ? (<>
                {aberta.positivo && <p className="av-pos"><b>Gostou:</b> {aberta.positivo}</p>}
                {aberta.negativo && <p className="av-neg"><b>Não gostou:</b> {aberta.negativo}</p>}
              </>) : <p className="av-det-texto">{aberta.texto ?? "(sem texto, só a nota)"}</p>}
              <dl className="av-det-info">
                {aberta.estadia && <><dt>Estadia</dt><dd>{aberta.estadia}</dd></>}
                {aberta.perfil && <><dt>Perfil</dt><dd>{aberta.perfil}</dd></>}
                {aberta.quarto && <><dt>Quarto</dt><dd>{aberta.quarto}</dd></>}
                <dt>Chegou aqui</dt><dd>{new Date(aberta.primeira_leitura).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</dd>
              </dl>
              {aberta.resposta ? <div className="av-resposta"><b>Resposta da casa</b><p>{aberta.resposta}</p></div>
                : <p className="av-pilula grande">Ainda sem resposta da casa</p>}
              {(aberta.link || f?.url) && <a className="botao-painel" href={aberta.link || f?.url || "#"} target="_blank" rel="noreferrer">Abrir no {SITES[f?.site ?? ""]?.nome ?? "site"} ↗</a>}
            </div>
          </Gaveta>
        );
      })()}
    </div>
  );
}

function CartaoAvaliacao({ a, f, nova, recem, abrir }: { a: Avaliacao; f?: Fonte; nova?: boolean; recem?: boolean; abrir: () => void }) {
  const texto = a.positivo || a.negativo
    ? [a.positivo && `👍 ${a.positivo}`, a.negativo && `👎 ${a.negativo}`].filter(Boolean).join("   ")
    : a.texto;
  const ruim = (a.nota5 ?? 5) <= 3;
  return (
    <article className={`av-card${ruim ? " ruim" : ""}${recem ? " recem" : ""}`} onClick={abrir} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && abrir()}>
      <header>
        <Selo site={f?.site ?? ""} />
        <div className="av-card-quem"><b>{nova && <i className="av-nova">nova</i>}{a.autor ?? "Anônimo"}</b><span className="muted">{nomeCasa(f?.casa ?? "")}{f?.tipo === "restaurante" && f.casa === "sempre_vivo" ? " · restaurante" : ""} · {dataCurta(a)}</span></div>
        <div className="av-card-nota"><Estrelas n={a.nota5} tam={13} />{a.escala === 10 && <small>{fmt(a.nota, 1)}</small>}</div>
      </header>
      {a.titulo && <h4>{a.titulo}</h4>}
      {texto ? <p className="av-card-texto">{texto}</p> : <p className="av-card-texto muted">(só a nota, sem texto)</p>}
      <footer>
        {a.resposta ? <span className="av-respondida">✓ respondida</span> : <span className={ruim ? "av-pilula" : "muted"}>sem resposta</span>}
        {a.perfil && <span className="muted">{a.perfil}</span>}
      </footer>
    </article>
  );
}
