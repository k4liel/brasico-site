"use client";

// Painel de integrações (/integracoes, só sócios): todas as conexões do Brasico numa tela, ao vivo, no visual de
// uma sala de controle (pedido do dono, 13/11/2026: "mais tecnológico, futurista, com efeitos legais").
// Dados: integracoes_painel() (supabase/integracoes.sql), relido a cada 30 s e ao voltar para a aba.
// Regras de verde/amarelo/vermelho em lib/integracoes.ts. CSS no bloco "Integrações" de app/globals.css (classes ig-*):
// a página tem fundo próprio (escuro, com aurora e grade) nos dois temas do site.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import {
  GRUPOS, NOME_FONTE, STATUS_TEXTO, estadoAgenda, estadoEvento, fonteDaAgenda, horarioLegivel, montarIntegracoes, quando,
  type Estado, type Integracao, type Painel,
} from "@/lib/integracoes";

const titulo = Space_Grotesk({ subsets: ["latin"], variable: "--ig-fonte-titulo", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ig-fonte-mono", display: "swap" });

const INTERVALO = 30; // segundos entre leituras
const TEXTO_ESTADO: Record<Estado, string> = { ok: "Online", atencao: "Atenção", erro: "Parada", pausa: "Pausada" };

const semMovimento = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Integracoes({ userEmail, previa }: { userEmail: string; previa?: Painel }) {
  const supabase = useMemo(() => createClient(), []);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [recebidoEm, setRecebidoEm] = useState(0);
  const [semAcesso, setSemAcesso] = useState(false);
  const [falhou, setFalhou] = useState("");
  const [lendo, setLendo] = useState(false);
  const [, setTique] = useState(0);
  const [fonte, setFonte] = useState<string>("todas");

  const carregar = useCallback(async () => {
    // Prévia local com dados de exemplo (só para conferir o visual sem login)
    if (previa) { setPainel(previa); setRecebidoEm(Date.now()); return; }
    setLendo(true);
    const { data, error } = await supabase.rpc("integracoes_painel");
    setLendo(false);
    if (error) {
      if (error.code === "42501") setSemAcesso(true);
      else setFalhou("Não consegui ler o painel agora. Tento de novo em instantes.");
      return;
    }
    setFalhou("");
    setPainel(data as Painel);
    setRecebidoEm(Date.now());
  }, [supabase, previa]);

  // Lê ao abrir, a cada 30 s e quando a pessoa volta para a aba
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, INTERVALO * 1000);
    const vis = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [carregar]);
  // As cores e o "há x min" andam sozinhos entre uma leitura e outra
  useEffect(() => { const t = setInterval(() => setTique((x) => x + 1), 5000); return () => clearInterval(t); }, []);

  // "Agora" = hora do banco na leitura + o tempo que passou desde então
  const agora = painel ? new Date(new Date(painel.agora).getTime() + (Date.now() - recebidoEm)).toISOString() : "";
  const lista = painel ? montarIntegracoes({ ...painel, agora }) : [];

  const classe = `pagina ig-pagina ${titulo.variable} ${mono.variable}`;
  if (semAcesso) {
    return (
      <div className={classe}>
        <Fundo />
        <Topo email={userEmail} ativo="integracoes" />
        <main className="miolo ig"><p className="ig-vazio">Só os sócios veem o painel de integrações.</p></main>
      </div>
    );
  }

  const conta = (e: Estado) => lista.filter((i) => i.estado === e).length;
  const pedem = lista.filter((i) => i.estado === "atencao" || i.estado === "erro")
    .sort((a, b) => Number(b.estado === "erro") - Number(a.estado === "erro"));
  const geral: Estado = conta("erro") ? "erro" : conta("atencao") ? "atencao" : "ok";
  const saude = lista.length ? Math.round(((conta("ok") + conta("pausa") + conta("atencao") * 0.5) / lista.length) * 100) : 0;
  const leituras24h = painel ? somaLeituras(painel) : 0;

  return (
    <div className={classe}>
      <Fundo />
      <Topo email={userEmail} ativo="integracoes" />
      <main className="miolo ig">
        <header className="ig-hero">
          <div className="ig-hero-texto">
            <p className="ig-eyebrow"><span className={`ig-sinal ${lendo ? "lendo" : geral}`} aria-hidden="true" />Centro de comando · ao vivo</p>
            <h1>Integrações</h1>
            <p className="ig-sub">Tudo a que o Brasico está conectado, com o pulso de cada sistema em tempo real.</p>
            <Relogio recebidoEm={recebidoEm} lendo={lendo} onAtualizar={carregar} />
          </div>
          {painel && <Anel valor={saude} estado={geral} />}
        </header>
        {falhou && <p className="ig-aviso">{falhou}</p>}

        {!painel ? (
          <div className="ig-carregando" aria-label="Lendo as integrações"><i /><i /><i /><span>Conectando aos sistemas…</span></div>
        ) : (<>
          <section className="ig-placar" aria-label="Resumo">
            <Placa estado="ok" n={conta("ok")} rotulo="Online" />
            <Placa estado="atencao" n={conta("atencao")} rotulo="Pedem atenção" />
            <Placa estado="erro" n={conta("erro")} rotulo="Paradas" />
            <Placa estado="info" n={leituras24h} rotulo="Leituras em 24 h" />
          </section>

          <section className="ig-central">
            <div className="ig-vidro ig-mapa-caixa">
              <div className="ig-caixa-cabeca"><h2>Rede de conexões</h2><span className="ig-mono">{lista.length} nós · {conta("ok") + conta("pausa")} estáveis</span></div>
              <Mapa lista={lista} />
              <div className="ig-legenda">
                {(["ok", "atencao", "erro", "pausa"] as Estado[]).map((e) => <span key={e} className={e}><i />{TEXTO_ESTADO[e]}</span>)}
              </div>
            </div>
            <div className="ig-vidro ig-alertas">
              <div className="ig-caixa-cabeca"><h2>O que pede atenção</h2><span className="ig-mono">{pedem.length ? `${pedem.length} alerta${pedem.length === 1 ? "" : "s"}` : "nenhum"}</span></div>
              {pedem.length ? (
                <ul>
                  {pedem.map((i, k) => (
                    <li key={i.id} style={{ animationDelay: `${k * 70}ms` }}>
                      <a href={`#ig-${i.id}`} className={i.estado}>
                        <i aria-hidden="true" />
                        <span><b>{i.nome}</b><small>{i.erro && /^últim/.test(i.frase) ? `falhou: ${i.erro.texto}` : i.frase}</small></span>
                        <em>{TEXTO_ESTADO[i.estado]}</em>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ig-tudo-ok"><span aria-hidden="true">✓</span><p>Todos os sistemas respondendo.</p></div>
              )}
            </div>
          </section>

          {GRUPOS.map((g) => (
            <section key={g.id} className="ig-grupo">
              <div className="ig-grupo-cabeca"><span className="ig-mono">{String(GRUPOS.indexOf(g) + 1).padStart(2, "0")}</span><div><h2>{g.titulo}</h2><p>{g.explica}</p></div></div>
              <Cartoes lista={lista.filter((i) => i.grupo === g.id)} />
            </section>
          ))}

          <Agendas painel={painel} agora={agora} />
          <Linha painel={painel} agora={agora} fonte={fonte} setFonte={setFonte} />
        </>)}
      </main>
    </div>
  );
}

// Quantas leituras boas todas as fontes fizeram nas últimas 24 h
function somaLeituras(p: Painel) {
  const f = p.fontes;
  return [f.rhid, f.esocial, f.receita, f.notas, f.nfse, f.totvs, f.pms, f.gemini].reduce((s, x) => s + (x.ok_24h || 0), 0) + (f.cicchetti.ok_24h || 0);
}

// Fundo da sala de controle: aurora que se move devagar, grade em perspectiva e granulado
function Fundo() {
  return (
    <div className="ig-fundo" aria-hidden="true">
      <i className="ig-aurora a1" /><i className="ig-aurora a2" /><i className="ig-aurora a3" />
      <i className="ig-grade" />
      <i className="ig-granulado" />
    </div>
  );
}

// Relógio de Fortaleza com segundos e a barra até a próxima leitura (componente próprio: só ele muda a cada segundo)
function Relogio({ recebidoEm, lendo, onAtualizar }: { recebidoEm: number; lendo: boolean; onAtualizar: () => void }) {
  // Começa vazio e só mostra a hora no navegador (a do servidor seria outra e quebraria a montagem da tela)
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => { setAgora(Date.now()); const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (agora === null) return <div className="ig-relogio"><div className="ig-hora ig-mono">--<b>:</b>--<b>:</b><span>--</span></div></div>;
  const d = new Date(agora - 3 * 3600_000);
  const hms = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => String(x).padStart(2, "0"));
  const data = d.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" });
  const passou = recebidoEm ? Math.max(0, (agora - recebidoEm) / 1000) : 0;
  const falta = Math.max(0, Math.ceil(INTERVALO - passou));
  return (
    <div className="ig-relogio">
      <div className="ig-hora ig-mono" aria-label={`Hora de Fortaleza ${hms.join(":")}`}>
        {hms[0]}<b>:</b>{hms[1]}<b>:</b><span>{hms[2]}</span>
      </div>
      <div className="ig-relogio-info">
        <small>{data} · Fortaleza</small>
        <div className="ig-proxima">
          <div className="ig-proxima-trilho"><i style={{ width: `${lendo ? 100 : Math.min(100, (passou / INTERVALO) * 100)}%` }} /></div>
          <span className="ig-mono">{lendo ? "lendo agora…" : recebidoEm ? `próxima leitura em ${falta} s` : "conectando…"}</span>
          <button className="ig-botao" onClick={onAtualizar} disabled={lendo}>Atualizar</button>
        </div>
      </div>
    </div>
  );
}

// Anel de saúde: quanto do sistema está respondendo (atenção vale meio)
function Anel({ valor, estado }: { valor: number; estado: Estado }) {
  const n = useContador(valor);
  const r = 74, c = 2 * Math.PI * r;
  return (
    <div className={`ig-anel ${estado}`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <defs>
          <linearGradient id="ig-anel-cor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--ig-ciano)" }} /><stop offset="1" style={{ stopColor: "var(--ig-cor)" }} />
          </linearGradient>
        </defs>
        <circle cx="90" cy="90" r="86" className="ig-anel-marcas" />
        <circle cx="90" cy="90" r={r} className="ig-anel-trilho" />
        <circle cx="90" cy="90" r={r} className="ig-anel-valor" strokeDasharray={c} strokeDashoffset={c * (1 - valor / 100)} />
        <circle cx="90" cy="90" r="58" className="ig-anel-giro" />
      </svg>
      <div className="ig-anel-texto"><b className="ig-mono">{n}<small>%</small></b><span>saúde do sistema</span></div>
    </div>
  );
}

function useContador(alvo: number) {
  const [v, setV] = useState(alvo);
  const de = useRef(0);
  useEffect(() => {
    if (semMovimento()) { setV(alvo); de.current = alvo; return; }
    const ini = de.current, t0 = performance.now(), dur = 900;
    let raf = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(ini + (alvo - ini) * e));
      if (p < 1) raf = requestAnimationFrame(passo); else de.current = alvo;
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo]);
  return v;
}

function Placa({ estado, n, rotulo }: { estado: Estado | "info"; n: number; rotulo: string }) {
  const v = useContador(n);
  return (
    <div className={`ig-placa ${estado}`}>
      <span className="ig-placa-luz" aria-hidden="true" />
      <b className="ig-mono">{v.toLocaleString("pt-BR")}</b>
      <span>{rotulo}</span>
    </div>
  );
}

// Cartões: brilho que segue o mouse (variáveis --mx/--my no cartão sob o ponteiro)
function Cartoes({ lista }: { lista: Integracao[] }) {
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".ig-cartao");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div className="ig-cartoes" onPointerMove={mover}>
      {lista.map((i, k) => <Cartao key={i.id} i={i} ordem={k} />)}
    </div>
  );
}

function Cartao({ i, ordem }: { i: Integracao; ordem: number }) {
  return (
    <article id={`ig-${i.id}`} className={`ig-cartao ${i.estado}`} style={{ animationDelay: `${ordem * 60}ms` }}>
      <div className="ig-cartao-miolo">
        <header>
          <span className="ig-bolinha" aria-hidden="true" />
          <div>
            <h3>{i.nome}</h3>
            <small>{i.quem}</small>
          </div>
          <span className="ig-selo">{TEXTO_ESTADO[i.estado]}</span>
        </header>
        <Pulso estado={i.estado} />
        <p className="ig-frase">{i.frase}</p>
        <p className="ig-faz">{i.oQueFaz}</p>
        {i.numeros.length > 0 && (
          <dl className="ig-numeros">
            {i.numeros.map((n) => <div key={n.rotulo}><dt>{n.rotulo}</dt><dd className="ig-mono">{n.valor}</dd></div>)}
          </dl>
        )}
        {i.linhas && i.linhas.length > 0 && (
          <ul className="ig-linhas">
            {i.linhas.map((l) => <li key={l.nome} className={l.estado}><i aria-hidden="true" /><b>{l.nome}</b><span>{l.texto}</span></li>)}
          </ul>
        )}
        {i.erro && (
          <details className="ig-erro">
            <summary>Última falha · {i.erro.quando}</summary>
            <p className="ig-mono">{i.erro.texto}</p>
          </details>
        )}
        {i.pagina && <a className="ig-abrir" href={i.pagina}>Abrir {i.nome} <span aria-hidden="true">→</span></a>}
      </div>
    </article>
  );
}

// Linha de batimento (como um monitor cardíaco): batendo quando está online, irregular na atenção, reta quando parada
function Pulso({ estado }: { estado: Estado }) {
  const batida = "h18 l4 -10 l4 20 l4 -16 l3 6 h17";
  const fraca = "h20 l3 -4 l3 7 l3 -3 h21";
  const d = estado === "erro" || estado === "pausa" ? "M0 16 h200" : `M0 16 ${Array(4).fill(estado === "atencao" ? fraca : batida).join(" ")}`;
  return (
    <svg className={`ig-pulso ${estado}`} viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} className="ig-pulso-fundo" />
      <path d={d} className="ig-pulso-linha" pathLength={100} />
    </svg>
  );
}

// Nomes curtos no mapa (o nome completo fica no cartão e ao passar o mouse)
const NO_MAPA: Record<string, string> = {
  receita: "Receita", notas: "NF-e", certificados: "Certificados", totvs: "TOTVS", cicchetti: "Cicchetti",
  pms: "PMS hotéis", conector: "Conector", claude: "Claude",
};

// Mapa: o Brasico no meio, cada conexão em volta; pacotes de dados correm pelas linhas que estão funcionando
function Mapa({ lista }: { lista: Integracao[] }) {
  const L = 520, c = L / 2, raio = 180;
  // Os pacotes correm por SMIL, que o "menos movimento" do CSS não para: só aparecem se o aparelho deixar
  const [mov, setMov] = useState(false);
  useEffect(() => setMov(!semMovimento()), []);
  const nos = lista.map((i, k) => {
    const ang = (-90 + (360 / lista.length) * k) * (Math.PI / 180);
    return { i, x: c + raio * Math.cos(ang), y: c + raio * Math.sin(ang), cos: Math.cos(ang) };
  });
  return (
    <svg className="ig-mapa" viewBox={`0 0 ${L} ${L}`} role="img" aria-label="Mapa das conexões do Brasico">
      <defs>
        <radialGradient id="ig-nucleo" cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: "var(--ig-ciano)", stopOpacity: 0.55 }} /><stop offset="1" style={{ stopColor: "var(--ig-ciano)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="ig-varredura" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--ig-ciano)", stopOpacity: 0 }} /><stop offset="1" style={{ stopColor: "var(--ig-ciano)", stopOpacity: 0.35 }} />
        </linearGradient>
        <filter id="ig-brilho" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* órbitas e radar */}
      <circle cx={c} cy={c} r={raio} className="ig-orbita" />
      <circle cx={c} cy={c} r={raio * 0.62} className="ig-orbita fina" />
      <circle cx={c} cy={c} r={raio * 1.12} className="ig-orbita tracejada" />
      <g className="ig-radar"><path d={`M${c} ${c} L${c + raio} ${c} A${raio} ${raio} 0 0 0 ${c + raio * Math.cos(-0.6)} ${c + raio * Math.sin(-0.6)} Z`} fill="url(#ig-varredura)" /></g>
      {nos.map(({ i, x, y }, k) => (
        <g key={`l-${i.id}`} className={`ig-elo ${i.estado}`}>
          <path id={`ig-fio-${i.id}`} d={`M${c} ${c} L${x} ${y}`} className="ig-fio" />
          {mov && i.estado === "ok" && (
            <circle r="2.6" className="ig-pacote" filter="url(#ig-brilho)">
              <animateMotion dur={`${2.2 + (k % 4) * 0.45}s`} repeatCount="indefinite" begin={`${(k * 0.37) % 2}s`} keyPoints={k % 2 ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear">
                <mpath href={`#ig-fio-${i.id}`} />
              </animateMotion>
            </circle>
          )}
        </g>
      ))}
      <circle cx={c} cy={c} r={80} fill="url(#ig-nucleo)" className="ig-nucleo-halo" />
      <circle cx={c} cy={c} r={44} className="ig-centro" />
      <circle cx={c} cy={c} r={52} className="ig-centro-anel" />
      <text x={c} y={c + 6} textAnchor="middle" className="ig-centro-texto">Brasico</text>
      {nos.map(({ i, x, y, cos }) => {
        const meio = Math.abs(cos) <= 0.12;
        const lx = x + (meio ? 0 : cos > 0 ? 16 : -16);
        const ly = y + (meio ? (y < c ? -18 : 28) : 4);
        const anchor = meio ? "middle" : cos > 0 ? "start" : "end";
        return (
          <a key={i.id} href={`#ig-${i.id}`} className={`ig-no-grupo ${i.estado}`}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            {(i.estado === "erro" || i.estado === "atencao") && <circle cx={x} cy={y} r={11} className="ig-no-onda" />}
            <circle cx={x} cy={y} r={11} className="ig-no" filter="url(#ig-brilho)" />
            <circle cx={x} cy={y} r={4} className="ig-no-miolo" />
            <text x={lx} y={ly} textAnchor={anchor} className="ig-no-texto">{NO_MAPA[i.id] ?? i.nome}</text>
          </a>
        );
      })}
    </svg>
  );
}

function Agendas({ painel, agora }: { painel: Painel; agora: string }) {
  const ag = painel.agendas;
  const falhando = ag.filter((a) => estadoAgenda(a) === "erro" || estadoAgenda(a) === "atencao");
  const grupos = new Map<string, Painel["agendas"]>();
  for (const a of ag) { const f = fonteDaAgenda(a.nome); grupos.set(f, [...(grupos.get(f) ?? []), a]); }
  return (
    <section className="ig-grupo">
      <div className="ig-grupo-cabeca"><span className="ig-mono">04</span><div>
        <h2>Agendas automáticas</h2>
        <p>{ag.length} rotinas do banco · {ag.filter((a) => a.ativa).length} ligadas · {falhando.length ? `${falhando.length} com falha nas últimas 24 h` : "nenhuma falhou nas últimas 24 h"}</p>
      </div></div>
      <details className="ig-vidro ig-agendas" open={falhando.length > 0}>
        <summary>Ver as {ag.length} agendas</summary>
        <div className="ig-tabela">
          <table>
            <thead><tr><th>Sistema</th><th>Agenda</th><th>Quando roda (Fortaleza)</th><th>Última vez</th><th>Em 24 h</th></tr></thead>
            <tbody>
              {[...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).flatMap(([f, as]) => as.map((a, k) => {
                const e = estadoAgenda(a);
                return (
                  <tr key={a.nome} className={e}>
                    <td>{k === 0 ? f : ""}</td>
                    <td><span className="ig-ponto" aria-hidden="true" /><code className="ig-mono">{a.nome}</code>{!a.ativa && <small> · desligada</small>}</td>
                    <td>{horarioLegivel(a.horario)}</td>
                    <td title={a.ultima_msg ?? ""}>{a.ultima ? `${quando(a.ultima, agora)}${a.ultima_status === "failed" ? " · falhou" : ""}` : "—"}</td>
                    <td className="ig-mono">{a.rodadas_24h ? `${a.rodadas_24h}×${a.falhas_24h ? ` · ${a.falhas_24h} falha${a.falhas_24h === 1 ? "" : "s"}` : ""}` : "—"}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// Registro em estilo terminal: o que cada sistema fez por último
function Linha({ painel, agora, fonte, setFonte }: { painel: Painel; agora: string; fonte: string; setFonte: (f: string) => void }) {
  const fontes = [...new Set(painel.eventos.map((e) => e.fonte))];
  const evs = painel.eventos.filter((e) => fonte === "todas" || e.fonte === fonte).slice(0, 30);
  return (
    <section className="ig-grupo">
      <div className="ig-grupo-cabeca"><span className="ig-mono">05</span><div>
        <h2>Registro ao vivo</h2>
        <p>O que cada sistema fez por último, do mais novo para o mais antigo (as leituras do ponto a cada minuto ficam de fora).</p>
      </div></div>
      <div className="ig-filtros" role="group" aria-label="Filtrar por sistema">
        {["todas", ...fontes].map((f) => (
          <button key={f} className={fonte === f ? "on" : ""} onClick={() => setFonte(f)} aria-pressed={fonte === f}>
            {f === "todas" ? "Todas" : NOME_FONTE[f] ?? f}
          </button>
        ))}
      </div>
      <div className="ig-terminal">
        <div className="ig-terminal-barra" aria-hidden="true"><i /><i /><i /><span className="ig-mono">brasico://integracoes/registro</span></div>
        <ol className="ig-linha ig-mono">
          {evs.map((e, k) => {
            const est = estadoEvento(e.status);
            return (
              <li key={`${e.fonte}-${e.quando}-${k}`} className={est} style={{ animationDelay: `${Math.min(k, 15) * 35}ms` }}>
                <span className="ig-linha-quando">{quando(e.quando, agora)}</span>
                <b>{(NOME_FONTE[e.fonte] ?? e.fonte).toUpperCase()}</b>
                <span className="ig-linha-detalhe">{(e.detalhe ?? "").replace(/_/g, " ")}</span>
                <span className="ig-linha-status">[{STATUS_TEXTO[e.status] ?? e.status}]</span>
                {e.erro && est !== "ok" && <small className="ig-linha-erro">↳ {e.erro}</small>}
              </li>
            );
          })}
          {!evs.length && <li>Nada por aqui ainda.</li>}
          <li className="ig-cursor" aria-hidden="true"><span>&gt;</span><i /></li>
        </ol>
      </div>
    </section>
  );
}
