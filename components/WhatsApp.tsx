"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Conversa = {
  id: string;
  nome: string;
  tipo: "grupo" | "contato";
  foto: string;
  telefone: string;
  ativo: boolean;
  total: number;
  ultima: string | null;
  ultima_autor: string | null;
  ultima_texto: string | null;
  ultima_tipo: string | null;
  ultima_de_nos: boolean | null;
};
type Resumo = { id: string; grupo_id: string; dia: string; resumo: string; total_mensagens: number };
type Mensagem = {
  grupo_id: string;
  id: string;
  autor_jid: string;
  autor_nome: string;
  de_nos: boolean;
  tipo: string;
  texto: string;
  miniatura: string;
  citacao: string;
  enviada_em: string;
};
type Aba = "todas" | "grupos" | "contatos" | "resumos";

const POR_VEZ = 300;
const CAMPOS = "grupo_id,id,autor_jid,autor_nome,de_nos,tipo,texto,miniatura,citacao,enviada_em";

// ---------- Datas (sempre no horário de Brasília) ----------
const TZ = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtLonga = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long" });
const diaDe = (d: Date | string) => fmtDia.format(new Date(d));
const horaDe = (iso: string) => fmtHora.format(new Date(iso));
const hoje = () => diaDe(new Date());
const ontem = () => diaDe(new Date(Date.now() - 864e5));
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Horário na lista de conversas: hora (hoje), "Ontem", dia da semana ou data
function quandoCurto(iso: string | null) {
  if (!iso) return "";
  const d = diaDe(iso);
  if (d === hoje()) return horaDe(iso);
  if (d === ontem()) return "Ontem";
  if (Date.now() - new Date(iso).getTime() < 6 * 864e5) return maiuscula(fmtSemana.format(new Date(iso)));
  return fmtCurta.format(new Date(iso));
}
// Separador de data dentro da conversa
function rotuloDia(d: string) {
  if (d === hoje()) return "Hoje";
  if (d === ontem()) return "Ontem";
  return maiuscula(fmtLonga.format(new Date(`${d}T12:00:00-03:00`)));
}
const nomeDiaResumo = (d: string) => rotuloDia(d);

// ---------- Pessoas ----------
// "558487836518@s.whatsapp.net" -> "+55 84 8783-6518"
function formatarTelefone(n: string) {
  if (!/^\d+$/.test(n)) return "";
  if (n.startsWith("55") && (n.length === 12 || n.length === 13)) {
    const resto = n.slice(4);
    return `+55 ${n.slice(2, 4)} ${resto.slice(0, -4)}-${resto.slice(-4)}`;
  }
  return "+" + n;
}
const telefoneDoJid = (jid: string) => (jid.endsWith("@s.whatsapp.net") ? formatarTelefone(jid.split("@")[0].split(":")[0]) : "");
const autor = (m: Mensagem) => (m.de_nos ? "Você" : m.autor_nome || telefoneDoJid(m.autor_jid) || "Participante");
const nomeConversa = (c: Conversa | undefined) =>
  c ? c.nome || formatarTelefone(c.telefone) || (c.tipo === "grupo" ? "Grupo sem nome" : "Contato") : "";

// Cor fixa por pessoa (como o WhatsApp faz nos grupos)
const CORES = ["#e17076", "#7bc862", "#e5a64e", "#65aadd", "#a695e7", "#ee7aae", "#6ec9cb", "#faa774", "#d4a017", "#5fb98a"];
function corDe(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return CORES[Math.abs(h) % CORES.length];
}
function iniciais(nome: string) {
  const p = nome.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "#";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

const MIDIA: Record<string, { icone: string; rotulo: string }> = {
  imagem: { icone: "📷", rotulo: "Foto" },
  video: { icone: "🎥", rotulo: "Vídeo" },
  audio: { icone: "🎤", rotulo: "Áudio" },
  documento: { icone: "📄", rotulo: "Documento" },
  figurinha: { icone: "🏷️", rotulo: "Figurinha" },
  local: { icone: "📍", rotulo: "Localização" },
  contato: { icone: "👤", rotulo: "Contato" },
  enquete: { icone: "📊", rotulo: "Enquete" },
};
function previa(tipo: string | null, texto: string | null) {
  const m = tipo ? MIDIA[tipo] : undefined;
  if (m) return `${m.icone} ${texto || m.rotulo}`;
  return texto || "";
}

// ---------- Peças ----------
function Avatar({ nome, foto, grupo, tamanho = 48 }: { nome: string; foto: string; grupo: boolean; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [foto]);
  const estilo = { width: tamanho, height: tamanho, fontSize: tamanho * 0.38 };
  if (foto && !falhou)
    // Fotos vêm do WhatsApp e expiram; se falhar, mostra as iniciais
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="wa-avatar" src={foto} alt="" style={estilo} referrerPolicy="no-referrer" loading="lazy" onError={() => setFalhou(true)} />;
  return (
    <span className="wa-avatar wa-avatar-letras" style={{ ...estilo, background: corDe(nome || "?") }} aria-hidden>
      {grupo && !nome ? "👥" : iniciais(nome)}
    </span>
  );
}

// O resumo vem do Claude a partir de mensagens de terceiros: mostrado como texto,
// com só títulos, listas e negrito (nada de HTML).
function negrito(t: string) {
  return t.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}
function TextoResumo({ md }: { md: string }) {
  const blocos: React.ReactNode[] = [];
  let itens: string[] = [];
  const fecharLista = () => {
    if (itens.length) blocos.push(<ul key={blocos.length}>{itens.map((t, i) => <li key={i}>{negrito(t)}</li>)}</ul>);
    itens = [];
  };
  for (const linha of md.replace(/\r/g, "").split("\n")) {
    const l = linha.trim();
    const item = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      itens.push(item[1]);
      continue;
    }
    fecharLista();
    if (!l) continue;
    const titulo = l.match(/^#{1,6}\s+(.*)$/);
    blocos.push(titulo ? <h3 key={blocos.length}>{titulo[1]}</h3> : <p key={blocos.length}>{negrito(l)}</p>);
  }
  fecharLista();
  return <div className="wa-resumo">{blocos}</div>;
}

// Links clicáveis dentro do texto (só http/https)
function comLinks(t: string) {
  return t.split(/(https?:\/\/[^\s<]+)/g).map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">
        {p}
      </a>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function Balao({ m, grupo, primeiraDoAutor }: { m: Mensagem; grupo: boolean; primeiraDoAutor: boolean }) {
  const midia = MIDIA[m.tipo];
  const nome = autor(m);
  return (
    <div className={`wa-linha ${m.de_nos ? "wa-saida" : "wa-entrada"} ${primeiraDoAutor ? "wa-primeira" : ""}`}>
      <div className="wa-balao">
        {grupo && !m.de_nos && primeiraDoAutor && (
          <div className="wa-balao-autor" style={{ color: corDe(m.autor_jid || nome) }}>
            {nome}
            {m.autor_nome && telefoneDoJid(m.autor_jid) && <span className="wa-balao-tel">{telefoneDoJid(m.autor_jid)}</span>}
          </div>
        )}
        {m.citacao && <div className="wa-citacao">{m.citacao}</div>}
        {m.miniatura && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="wa-miniatura" src={`data:image/jpeg;base64,${m.miniatura}`} alt={midia?.rotulo ?? "Mídia"} />
        )}
        {midia && !m.miniatura && (
          <div className="wa-midia">
            <span aria-hidden>{midia.icone}</span> {m.tipo === "documento" && m.texto ? "" : midia.rotulo}
          </div>
        )}
        {m.texto && <span className="wa-texto">{comLinks(m.texto)}</span>}
        <span className="wa-hora">{horaDe(m.enviada_em)}</span>
      </div>
    </div>
  );
}

// ---------- Página ----------
export default function WhatsApp({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [resumos, setResumos] = useState<Resumo[]>([]);
  const [aba, setAba] = useState<Aba>("todas");
  const [filtro, setFiltro] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [diaResumo, setDiaResumo] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [vendoBusca, setVendoBusca] = useState(false);
  const corpo = useRef<HTMLDivElement>(null);
  const descer = useRef(true);

  const carregar = useCallback(async () => {
    const [{ data: a }, { data: g }, { data: r }] = await Promise.all([
      supabase.from("wa_acesso").select("user_id").eq("user_id", userId),
      supabase.rpc("wa_painel_grupos"),
      supabase.from("wa_resumos").select("id,grupo_id,dia,resumo,total_mensagens").order("dia", { ascending: false }).limit(600),
    ]);
    setAcesso(!!a?.length);
    setConversas(((g as Conversa[]) ?? []).map((x) => ({ ...x, total: Number(x.total) })));
    setResumos((r as Resumo[]) ?? []);
  }, [supabase, userId]);

  // Mensagens da conversa aberta: as últimas 300, e mais 300 a cada "carregar anteriores"
  const carregarMensagens = useCallback(
    async (antesDe?: string) => {
      if (!aberta) return;
      let q = supabase.from("wa_mensagens").select(CAMPOS).eq("grupo_id", aberta).order("enviada_em", { ascending: false }).limit(POR_VEZ);
      if (antesDe) q = q.lt("enviada_em", antesDe);
      const b = buscaAtiva.replace(/[%,()*]/g, " ").trim();
      if (b) q = q.or(`texto.ilike.%${b}%,autor_nome.ilike.%${b}%`);
      const { data } = await q;
      const lote = ((data as Mensagem[]) ?? []).reverse();
      setTemMais(lote.length === POR_VEZ);
      setMensagens((atual) => (antesDe ? [...lote, ...(atual ?? [])] : lote));
    },
    [supabase, aberta, buscaAtiva],
  );

  useEffect(() => {
    if (!aberta || !acesso) return;
    setMensagens(null);
    descer.current = true;
    carregarMensagens();
  }, [aberta, acesso, carregarMensagens]);

  // Tempo real: mensagem nova entra na conversa aberta; a lista se atualiza logo depois
  const abertaRef = useRef(aberta);
  abertaRef.current = aberta;
  const buscaRef = useRef(buscaAtiva);
  buscaRef.current = buscaAtiva;
  useEffect(() => {
    carregar();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const atualizarLista = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(carregar, 800);
    };
    const ch = supabase
      .channel("whatsapp")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_mensagens" }, (p) => {
        const m = p.new as Mensagem;
        if (m.grupo_id === abertaRef.current && !buscaRef.current) {
          const el = corpo.current;
          descer.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          setMensagens((atual) => (atual && !atual.some((x) => x.id === m.id) ? [...atual, m] : atual));
        }
        atualizarLista();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_grupos" }, atualizarLista)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_resumos" }, atualizarLista)
      .subscribe();
    return () => {
      if (espera) clearTimeout(espera);
      supabase.removeChannel(ch);
    };
  }, [supabase, carregar]);

  // Desce até a última mensagem ao abrir a conversa (e quando chega uma nova, se já estava no fim)
  useEffect(() => {
    if (descer.current && corpo.current && mensagens) {
      corpo.current.scrollTop = corpo.current.scrollHeight;
      descer.current = false;
    }
  }, [mensagens]);

  async function carregarAnteriores() {
    if (!mensagens?.length || carregandoMais) return;
    const el = corpo.current;
    const altura = el?.scrollHeight ?? 0;
    setCarregandoMais(true);
    await carregarMensagens(mensagens[0].enviada_em);
    setCarregandoMais(false);
    // Mantém o ponto de leitura no lugar depois de inserir as antigas em cima
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - altura;
    });
  }

  function abrir(id: string) {
    setAberta(id);
    setDiaResumo(null);
    setBusca("");
    setBuscaAtiva("");
    setVendoBusca(false);
  }

  async function alternarAcompanhamento(c: Conversa) {
    if (c.ativo && !confirm(`Parar de acompanhar "${nomeConversa(c)}"? Nada novo dessa conversa será gravado.`)) return;
    setConversas((cs) => cs.map((x) => (x.id === c.id ? { ...x, ativo: !c.ativo } : x)));
    const { error } = await supabase.from("wa_grupos").update({ ativo: !c.ativo }).eq("id", c.id);
    if (error) {
      alert("Não foi possível salvar: " + error.message);
      carregar();
    }
  }

  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return conversas.filter(
      (c) =>
        (aba === "todas" || (aba === "grupos" ? c.tipo === "grupo" : c.tipo === "contato")) &&
        (!f || nomeConversa(c).toLowerCase().includes(f) || c.telefone.includes(f.replace(/\D/g, "") || "§")),
    );
  }, [conversas, aba, filtro]);

  const dias = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resumos) m.set(r.dia, (m.get(r.dia) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [resumos]);

  const conversa = conversas.find((c) => c.id === aberta);
  const ehGrupo = conversa?.tipo === "grupo";
  const contagem = {
    todas: conversas.length,
    grupos: conversas.filter((c) => c.tipo === "grupo").length,
    contatos: conversas.filter((c) => c.tipo === "contato").length,
  };
  const painelAberto = !!aberta || !!diaResumo;

  return (
    <div className="pagina wa-pagina">
      <Topo email={userEmail} ativo="whatsapp" />
      {acesso === null ? (
        <p className="muted wa-aviso">Carregando…</p>
      ) : !acesso ? (
        <p className="vazio muted wa-aviso">Você ainda não tem acesso às conversas de WhatsApp.</p>
      ) : (
        <main className={`wa ${painelAberto ? "wa-com-painel" : ""}`}>
          {/* ---------- Lista ---------- */}
          <aside className="wa-lado">
            <header className="wa-lado-topo">
              <h1>WhatsApp</h1>
              <span className="wa-conta">
                <span className="wa-ponto" aria-hidden /> Brasico conectado
              </span>
            </header>
            <div className="wa-filtro">
              <input type="search" placeholder="Pesquisar conversa ou número" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
            <nav className="wa-abas" aria-label="Filtro">
              {(["todas", "grupos", "contatos", "resumos"] as Aba[]).map((a) => (
                <button key={a} className={aba === a ? "on" : ""} onClick={() => setAba(a)}>
                  {{ todas: "Todas", grupos: "Grupos", contatos: "Contatos", resumos: "Resumos" }[a]}
                  {a !== "resumos" && contagem[a] > 0 && <span>{contagem[a]}</span>}
                </button>
              ))}
            </nav>

            <div className="wa-itens">
              {aba === "resumos" ? (
                dias.length ? (
                  dias.map(([d, n]) => (
                    <button key={d} className={diaResumo === d ? "wa-item on" : "wa-item"} onClick={() => { setDiaResumo(d); setAberta(null); }}>
                      <span className="wa-avatar wa-avatar-letras wa-avatar-resumo" style={{ width: 48, height: 48 }} aria-hidden>✦</span>
                      <span className="wa-item-meio">
                        <span className="wa-item-linha">
                          <strong>{nomeDiaResumo(d)}</strong>
                        </span>
                        <span className="wa-item-previa">Resumo de {n} grupo{n > 1 ? "s" : ""} pelo Claude</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="wa-vazio">Os resumos saem todo dia às 7h, com o que aconteceu nos grupos no dia anterior.</p>
                )
              ) : lista.length ? (
                lista.map((c) => {
                  const nome = nomeConversa(c);
                  const quem = c.ultima_de_nos ? "Você" : c.tipo === "grupo" ? (c.ultima_autor || "").split(" ")[0] : "";
                  return (
                    <button key={c.id} className={`wa-item ${aberta === c.id ? "on" : ""} ${c.ativo ? "" : "wa-pausada"}`} onClick={() => abrir(c.id)}>
                      <Avatar nome={nome} foto={c.foto} grupo={c.tipo === "grupo"} />
                      <span className="wa-item-meio">
                        <span className="wa-item-linha">
                          <strong>{nome}</strong>
                          <span className="wa-item-hora">{quandoCurto(c.ultima)}</span>
                        </span>
                        <span className="wa-item-previa">
                          {!c.ativo ? (
                            <em>Pausada</em>
                          ) : c.ultima ? (
                            <>
                              {quem && <span className="wa-item-quem">{quem}: </span>}
                              {previa(c.ultima_tipo, c.ultima_texto)}
                            </>
                          ) : (
                            <em>Sem mensagens ainda</em>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="wa-vazio">{filtro ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>
              )}
            </div>
          </aside>

          {/* ---------- Painel da direita ---------- */}
          <section className="wa-painel">
            {diaResumo ? (
              <>
                <header className="wa-painel-topo">
                  <button className="wa-voltar" onClick={() => setDiaResumo(null)} aria-label="Voltar">‹</button>
                  <span className="wa-avatar wa-avatar-letras wa-avatar-resumo" style={{ width: 40, height: 40 }} aria-hidden>✦</span>
                  <div className="wa-painel-titulo">
                    <strong>Resumo · {nomeDiaResumo(diaResumo)}</strong>
                    <span>Escrito pelo Claude a partir das mensagens dos grupos</span>
                  </div>
                </header>
                <div className="wa-corpo wa-corpo-resumo">
                  {resumos
                    .filter((r) => r.dia === diaResumo)
                    .sort((a, b) => b.total_mensagens - a.total_mensagens)
                    .map((r) => {
                      const c = conversas.find((x) => x.id === r.grupo_id);
                      return (
                        <article key={r.id} className="wa-cartao">
                          <header>
                            <Avatar nome={nomeConversa(c)} foto={c?.foto ?? ""} grupo tamanho={36} />
                            <button className="wa-cartao-nome" onClick={() => abrir(r.grupo_id)}>
                              {nomeConversa(c) || "Grupo"}
                            </button>
                            <span className="muted small">{r.total_mensagens} mensagens</span>
                          </header>
                          <TextoResumo md={r.resumo} />
                        </article>
                      );
                    })}
                </div>
              </>
            ) : conversa ? (
              <>
                <header className="wa-painel-topo">
                  <button className="wa-voltar" onClick={() => setAberta(null)} aria-label="Voltar">‹</button>
                  <Avatar nome={nomeConversa(conversa)} foto={conversa.foto} grupo={ehGrupo} tamanho={40} />
                  <div className="wa-painel-titulo">
                    <strong>{nomeConversa(conversa)}</strong>
                    <span>
                      {ehGrupo ? "Grupo" : formatarTelefone(conversa.telefone) || "Conversa individual"} · {conversa.total.toLocaleString("pt-BR")} mensage
                      {conversa.total === 1 ? "m" : "ns"}
                    </span>
                  </div>
                  <button className={`wa-icone ${vendoBusca ? "on" : ""}`} onClick={() => setVendoBusca((v) => !v)} aria-label="Pesquisar na conversa" title="Pesquisar na conversa">
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                      <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z" />
                    </svg>
                  </button>
                  <button className={`wa-acompanhar ${conversa.ativo ? "" : "off"}`} onClick={() => alternarAcompanhamento(conversa)} title="Gravar ou não as mensagens novas desta conversa">
                    {conversa.ativo ? "Acompanhando" : "Pausada"}
                  </button>
                </header>
                {vendoBusca && (
                  <form
                    className="wa-busca"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setBuscaAtiva(busca);
                    }}
                  >
                    <input autoFocus type="search" placeholder="Buscar mensagens por texto ou autor" value={busca} onChange={(e) => setBusca(e.target.value)} />
                    {buscaAtiva && (
                      <button type="button" onClick={() => { setBusca(""); setBuscaAtiva(""); }}>
                        Limpar
                      </button>
                    )}
                  </form>
                )}
                <div className="wa-corpo" ref={corpo}>
                  {mensagens === null ? (
                    <p className="wa-chip">Carregando…</p>
                  ) : !mensagens.length ? (
                    <p className="wa-chip">{buscaAtiva ? "Nada encontrado." : "Nenhuma mensagem gravada ainda."}</p>
                  ) : (
                    <>
                      {temMais && (
                        <button className="wa-chip wa-mais" onClick={carregarAnteriores} disabled={carregandoMais}>
                          {carregandoMais ? "Carregando…" : "Carregar mensagens anteriores"}
                        </button>
                      )}
                      {buscaAtiva && <p className="wa-chip">Resultados para “{buscaAtiva}”</p>}
                      {mensagens.map((m, i) => {
                        const ant = mensagens[i - 1];
                        const novoDia = !ant || diaDe(ant.enviada_em) !== diaDe(m.enviada_em);
                        const primeira = novoDia || ant.de_nos !== m.de_nos || ant.autor_jid !== m.autor_jid;
                        return (
                          <Fragment key={m.grupo_id + m.id}>
                            {novoDia && <p className="wa-chip wa-chip-dia">{rotuloDia(diaDe(m.enviada_em))}</p>}
                            <Balao m={m} grupo={ehGrupo} primeiraDoAutor={primeira} />
                          </Fragment>
                        );
                      })}
                    </>
                  )}
                </div>
                <footer className="wa-rodape">🔒 Somente leitura · o número da Brasico não responde por aqui</footer>
              </>
            ) : (
              <div className="wa-boas-vindas">
                <div className="wa-boas-icone" aria-hidden>
                  <svg viewBox="0 0 24 24" width="44" height="44">
                    <path fill="currentColor" d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.74 4.86-1.27A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-2.89.76.77-2.81-.2-.31A8.2 8.2 0 1 1 12 20.2Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43l-.76-1.82c-.2-.48-.4-.41-.56-.42h-.47a.9.9 0 0 0-.66.31 2.76 2.76 0 0 0-.86 2.05 4.8 4.8 0 0 0 1 2.55 11 11 0 0 0 4.2 3.7c1.56.68 2.18.74 2.96.62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.08.14-1.18-.06-.1-.22-.16-.47-.28Z" />
                  </svg>
                </div>
                <h2>Conversas da Brasico</h2>
                <p>
                  {contagem.grupos} grupo{contagem.grupos === 1 ? "" : "s"} e {contagem.contatos} conversa{contagem.contatos === 1 ? "" : "s"} individua
                  {contagem.contatos === 1 ? "l" : "is"}. Escolha uma conversa ao lado para ler as mensagens.
                </p>
                <span className="wa-boas-nota">🔒 Só os sócios veem estas conversas.</span>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
