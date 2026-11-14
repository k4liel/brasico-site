"use client";

// Painel de integrações (/integracoes, só sócios): todas as conexões do Brasico numa tela, ao vivo.
// Visual (13/11/2026, depois de duas tentativas recusadas pelo dono): no padrão do sistema, sem neon e sem nada
// forçado, mas com tecnologia de verdade — atividade por hora (gráfico e barra de 24 h em cada cartão), busca e
// filtro, painel lateral com o detalhe de cada sistema, mapa interativo e movimentos discretos.
// Dados: integracoes_painel() (supabase/integracoes.sql), relido a cada 30 s e ao voltar para a aba.
// Regras em lib/integracoes.ts. CSS no bloco "Integrações" de app/globals.css (classes ig-*).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import Gaveta from "./Gaveta";
import {
  GRUPOS, NOME_FONTE, STATUS_TEXTO, atividadeGeral, estadoAgenda, estadoEvento, estadoHora, fonteDaAgenda, horaDaPosicao,
  horarioLegivel, montarIntegracoes, quando, type Estado, type Hora, type Integracao, type Painel,
} from "@/lib/integracoes";

const INTERVALO = 30; // segundos entre leituras
const TEXTO_ESTADO: Record<Estado, string> = { ok: "Funcionando", atencao: "Atenção", erro: "Parada", pausa: "Pausada" };
type Filtro = "todas" | "problema" | "ok";

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
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [aberto, setAberto] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  // Sistemas que leram algo novo desde a última atualização: o cartão pisca de leve
  const [novos, setNovos] = useState<Set<string>>(new Set());
  const ultimas = useRef<Record<string, string | null>>({});

  const receber = useCallback((p: Painel) => {
    const atual: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(p.fontes)) {
      const x = v as { ultima?: string | null; ultima_mensagem?: string | null; ultimo_resumo?: string | null; ultimo_uso?: string | null };
      atual[k] = x.ultima ?? x.ultima_mensagem ?? x.ultimo_resumo ?? x.ultimo_uso ?? null;
    }
    const antes = ultimas.current;
    if (Object.keys(antes).length) {
      const mudou = new Set(Object.keys(atual).filter((k) => atual[k] && atual[k] !== antes[k]));
      if (mudou.size) { setNovos(mudou); setTimeout(() => setNovos(new Set()), 2400); }
    }
    ultimas.current = atual;
    setPainel(p);
    setRecebidoEm(Date.now());
  }, []);

  const carregar = useCallback(async () => {
    // Prévia local com dados de exemplo (só para conferir o visual sem login)
    if (previa) { receber(previa); return; }
    setLendo(true);
    const { data, error } = await supabase.rpc("integracoes_painel");
    setLendo(false);
    if (error) {
      if (error.code === "42501") setSemAcesso(true);
      else setFalhou("Não consegui ler o painel agora. Tento de novo em instantes.");
      return;
    }
    setFalhou("");
    receber(data as Painel);
  }, [supabase, previa, receber]);

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

  if (semAcesso) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="integracoes" />
        <main className="miolo"><p className="vazio muted">Só os sócios veem o painel de integrações.</p></main>
      </div>
    );
  }

  const conta = (e: Estado) => lista.filter((i) => i.estado === e).length;
  const pedem = lista.filter((i) => i.estado === "atencao" || i.estado === "erro")
    .sort((a, b) => Number(b.estado === "erro") - Number(a.estado === "erro"));
  const geral: Estado = conta("erro") ? "erro" : conta("atencao") ? "atencao" : "ok";
  const atividade = atividadeGeral(lista);
  const leituras24h = atividade.reduce((s, h) => s + h[0], 0);
  const falhas24h = atividade.reduce((s, h) => s + h[1], 0);
  const termo = busca.trim().toLowerCase();
  const visivel = (i: Integracao) =>
    (filtro === "todas" || (filtro === "problema" ? i.estado === "erro" || i.estado === "atencao" : i.estado === "ok" || i.estado === "pausa"))
    && (!termo || `${i.nome} ${i.quem} ${i.oQueFaz}`.toLowerCase().includes(termo));
  const filtrada = lista.filter(visivel);
  const selecionado = lista.find((i) => i.id === aberto) ?? null;
  const abrir = (id: string) => setAberto(id);

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="integracoes" />
      <main className="miolo es-sistema ig">
        <div className="es-topo ig-topo">
          <div>
            <p className="ig-eyebrow">Sistema · conexões</p>
            <h1>Integrações</h1>
            <p>Todos os sistemas a que o Brasico está conectado, com a atividade de cada um nas últimas 24 horas.</p>
          </div>
          <Vivo recebidoEm={recebidoEm} lendo={lendo} onAtualizar={carregar} />
        </div>
        {falhou && <p className="es-aviso">{falhou}</p>}

        {!painel ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : (<>
          <section className="ig-resumo ig-entra" aria-label="Resumo">
            <div className="ig-resumo-geral">
              <span className={`ig-estado ${geral}`}><i aria-hidden="true" />
                {geral === "ok" ? "Todos os sistemas funcionando" : geral === "atencao" ? "Funcionando, com pontos de atenção" : "Há conexão parada"}
              </span>
              <Barra lista={lista} onAbrir={abrir} />
            </div>
            <dl className="ig-numeros-topo">
              <div><dt>Funcionando</dt><dd><Contador valor={conta("ok")} /><small> de {lista.length}</small></dd></div>
              <div className={conta("atencao") ? "atencao" : ""}><dt>Atenção</dt><dd><Contador valor={conta("atencao")} /></dd></div>
              <div className={conta("erro") ? "erro" : ""}><dt>Paradas</dt><dd><Contador valor={conta("erro")} /></dd></div>
              <div><dt>Leituras em 24 h</dt><dd><Contador valor={leituras24h} /></dd></div>
            </dl>
          </section>

          <section className="ig-central">
            <div className="ig-caixa ig-entra" style={{ "--i": 1 } as React.CSSProperties}>
              <div className="ig-caixa-cabeca"><h2>Mapa das conexões</h2><span>passe o mouse ou clique num sistema</span></div>
              <Mapa lista={lista} foco={foco} setFoco={setFoco} onAbrir={abrir} />
              <div className="ig-legenda">
                {(["ok", "atencao", "erro", "pausa"] as Estado[]).map((e) => <span key={e} className={e}><i />{TEXTO_ESTADO[e]}</span>)}
              </div>
            </div>
            <div className="ig-lado">
              <div className="ig-caixa ig-entra" style={{ "--i": 2 } as React.CSSProperties}>
                <div className="ig-caixa-cabeca"><h2>Atividade nas últimas 24 h</h2>
                  <span>{leituras24h.toLocaleString("pt-BR")} leituras · {falhas24h ? `${falhas24h} falha${falhas24h === 1 ? "" : "s"}` : "nenhuma falha"}</span></div>
                <Atividade dados={atividade} agora={agora} />
              </div>
              <div className="ig-caixa ig-alertas ig-entra" style={{ "--i": 3 } as React.CSSProperties}>
                <div className="ig-caixa-cabeca"><h2>O que pede atenção</h2><span>{pedem.length || "nenhum"}</span></div>
                {pedem.length ? (
                  <ul>
                    {pedem.map((i) => (
                      <li key={i.id}>
                        <button className={i.estado} onClick={() => abrir(i.id)}>
                          <i aria-hidden="true" />
                          <span><b>{i.nome}</b><small>{i.erro && /^últim/.test(i.frase) ? `Falhou: ${i.erro.texto}` : i.frase}</small></span>
                          <em>{TEXTO_ESTADO[i.estado]}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ig-tudo-ok">Nenhuma conexão pedindo atenção agora.</p>
                )}
              </div>
            </div>
          </section>

          <div className="ig-ferramentas">
            <label className="ig-busca">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              <input type="search" placeholder="Procurar um sistema…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Procurar um sistema" />
            </label>
            <div className="ig-segmento" role="group" aria-label="Filtrar por situação">
              {([["todas", `Todos · ${lista.length}`], ["problema", `Com problema · ${pedem.length}`], ["ok", `Funcionando · ${conta("ok") + conta("pausa")}`]] as [Filtro, string][]).map(([v, t]) => (
                <button key={v} className={filtro === v ? "on" : ""} onClick={() => setFiltro(v)} aria-pressed={filtro === v}>{t}</button>
              ))}
            </div>
          </div>

          {GRUPOS.map((g) => {
            const doGrupo = filtrada.filter((i) => i.grupo === g.id);
            if (!doGrupo.length) return null;
            return (
              <section key={g.id} className="ig-grupo">
                <div className="ig-grupo-cabeca"><h2>{g.titulo}</h2><p>{g.explica}</p></div>
                <Cartoes>
                  {doGrupo.map((i, k) => <Cartao key={i.id} i={i} ordem={k} agora={agora} novo={novos.has(i.id)} onAbrir={() => abrir(i.id)} />)}
                </Cartoes>
              </section>
            );
          })}
          {!filtrada.length && <p className="ig-nada">Nenhum sistema com esse filtro.</p>}

          <Agendas painel={painel} agora={agora} />
          <Linha painel={painel} agora={agora} fonte={fonte} setFonte={setFonte} />
        </>)}
      </main>

      {selecionado && painel && (
        <Gaveta titulo={selecionado.nome} sub={selecionado.quem} fechar={() => setAberto(null)}>
          <Detalhe i={selecionado} painel={painel} agora={agora} />
        </Gaveta>
      )}
    </div>
  );
}

// Número que conta até o valor (só quando o aparelho deixa movimento)
function Contador({ valor }: { valor: number }) {
  const [v, setV] = useState(valor);
  const de = useRef(0);
  useEffect(() => {
    if (semMovimento()) { setV(valor); de.current = valor; return; }
    const ini = de.current, t0 = performance.now(), dur = 800;
    let raf = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(ini + (valor - ini) * e));
      if (p < 1) raf = requestAnimationFrame(passo); else de.current = valor;
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <>{v.toLocaleString("pt-BR")}</>;
}

// "Ao vivo": quando foi a última leitura, e o botão Atualizar com um anel que fecha até a próxima
function Vivo({ recebidoEm, lendo, onAtualizar }: { recebidoEm: number; lendo: boolean; onAtualizar: () => void }) {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => { setAgora(Date.now()); const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const passou = agora && recebidoEm ? Math.max(0, (agora - recebidoEm) / 1000) : 0;
  const falta = Math.max(0, Math.ceil(INTERVALO - passou));
  const c = 2 * Math.PI * 15;
  return (
    <div className="ig-vivo">
      <span className={`ig-vivo-ponto ${lendo ? "lendo" : ""}`} aria-hidden="true" />
      <div>
        <b>{lendo ? "Atualizando…" : "Ao vivo"}</b>
        <small>{!agora || !recebidoEm ? "conectando…" : `atualizado há ${Math.round(passou)} s · próxima em ${falta} s`}</small>
      </div>
      <button className={`ig-atualizar ${lendo ? "lendo" : ""}`} onClick={onAtualizar} disabled={lendo} aria-label="Atualizar agora" title="Atualizar agora">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="ig-atualizar-trilho" />
          <circle cx="18" cy="18" r="15" className="ig-atualizar-anel" strokeDasharray={c} strokeDashoffset={c * Math.min(1, passou / INTERVALO)} />
          <path d="M23.5 15.5A6 6 0 1 0 24 19.5M24 12v3.7h-3.7" className="ig-atualizar-seta" />
        </svg>
      </button>
    </div>
  );
}

// Barra de situação: cada sistema é um trecho; clicar abre o detalhe
function Barra({ lista, onAbrir }: { lista: Integracao[]; onAbrir: (id: string) => void }) {
  const ordem: Estado[] = ["ok", "pausa", "atencao", "erro"];
  return (
    <div className="ig-barra" aria-label={ordem.map((e) => `${lista.filter((i) => i.estado === e).length} ${TEXTO_ESTADO[e]}`).join(", ")}>
      {ordem.flatMap((e) => lista.filter((i) => i.estado === e)).map((i, k) => (
        <button key={i.id} className={i.estado} style={{ "--i": k } as React.CSSProperties} onClick={() => onAbrir(i.id)} title={`${i.nome}: ${TEXTO_ESTADO[i.estado]}`} aria-label={`${i.nome}: ${TEXTO_ESTADO[i.estado]}`} />
      ))}
    </div>
  );
}

// Gráfico de atividade: leituras boas (área) e falhas (barras) de cada hora
function Atividade({ dados, agora }: { dados: Hora[]; agora: string }) {
  const linhas = dados.map(([ok, f], k) => ({ h: `${horaDaPosicao(k, agora)}h`, ok, f }));
  return (
    <div className="ig-grafico">
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={linhas} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="ig-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--gold)", stopOpacity: 0.32 }} />
              <stop offset="1" style={{ stopColor: "var(--gold)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <XAxis dataKey="h" tickLine={false} axisLine={false} interval={5} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--muted)" }} allowDecimals={false} />
          <Tooltip cursor={{ stroke: "var(--line-strong)" }} content={<Dica />} />
          <Area type="monotone" dataKey="ok" stroke="var(--gold)" strokeWidth={1.8} fill="url(#ig-area)" animationDuration={900} />
          <Bar dataKey="f" fill="var(--ig-erro)" barSize={5} radius={[2, 2, 0, 0]} animationDuration={900} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Dica({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const ok = payload.find((p) => p.dataKey === "ok")?.value ?? 0;
  const f = payload.find((p) => p.dataKey === "f")?.value ?? 0;
  return (
    <div className="ig-dica">
      <b>{label}</b>
      <span>{ok.toLocaleString("pt-BR")} leituras</span>
      {f > 0 && <span className="erro">{f} falha{f === 1 ? "" : "s"}</span>}
    </div>
  );
}

// Barra de 24 h de um sistema (cada traço é uma hora)
function Horas({ horas, agora, rotulo, grande }: { horas: Hora[]; agora: string; rotulo: string; grande?: boolean }) {
  return (
    <div className={`ig-horas ${grande ? "grande" : ""}`} role="img" aria-label={`Atividade das últimas 24 horas (${rotulo})`}>
      {horas.map((h, k) => {
        const e = estadoHora(h);
        const hr = horaDaPosicao(k, agora);
        return (
          <span key={k} className={e === "vazio" ? "sem" : e} style={{ "--i": k } as React.CSSProperties}
            title={`${hr}h às ${(hr + 1) % 24}h · ${h[0]} ${rotulo}${h[1] ? ` · ${h[1]} falha${h[1] === 1 ? "" : "s"}` : ""}`} />
        );
      })}
    </div>
  );
}

// Cartões com um brilho suave que segue o mouse (variáveis --mx/--my no cartão sob o ponteiro)
function Cartoes({ children }: { children: React.ReactNode }) {
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".ig-cartao");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return <div className="ig-cartoes" onPointerMove={mover}>{children}</div>;
}

function Cartao({ i, ordem, agora, novo, onAbrir }: { i: Integracao; ordem: number; agora: string; novo: boolean; onAbrir: () => void }) {
  const principal = i.numeros[0];
  return (
    <article id={`ig-${i.id}`} className={`ig-cartao ${i.estado} ${novo ? "novo" : ""}`} style={{ "--i": ordem } as React.CSSProperties}
      role="button" tabIndex={0} onClick={onAbrir} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
      aria-label={`${i.nome}: ${TEXTO_ESTADO[i.estado]}. ${i.frase}. Abrir detalhes`}>
      <header>
        <div>
          <h3>{i.nome}</h3>
          <small>{i.quem}</small>
        </div>
        <span className="ig-selo"><i aria-hidden="true" />{TEXTO_ESTADO[i.estado]}</span>
      </header>
      <p className="ig-frase">{i.frase}</p>
      {i.horas ? (
        <div className="ig-cartao-horas">
          <Horas horas={i.horas} agora={agora} rotulo={i.horasRotulo ?? "leituras"} />
          <div className="ig-horas-eixo"><span>24 h atrás</span><span>agora</span></div>
        </div>
      ) : i.linhas?.length ? (
        <ul className="ig-linhas">
          {i.linhas.slice(0, 3).map((l) => <li key={l.nome} className={l.estado}><i aria-hidden="true" /><b>{l.nome}</b><span>{l.texto}</span></li>)}
        </ul>
      ) : null}
      <footer>
        {principal ? <span>{principal.rotulo}: <b>{principal.valor}</b></span> : <span>{i.oQueFaz}</span>}
        <em aria-hidden="true">Detalhes →</em>
      </footer>
    </article>
  );
}

// Painel lateral de um sistema: tudo o que o banco sabe dele
function Detalhe({ i, painel, agora }: { i: Integracao; painel: Painel; agora: string }) {
  const evs = painel.eventos.filter((e) => e.fonte === i.id).slice(0, 12);
  return (
    <div className="ig ig-detalhe">
      <div className={`ig-detalhe-estado ${i.estado}`}>
        <span className="ig-selo"><i aria-hidden="true" />{TEXTO_ESTADO[i.estado]}</span>
        <p>{i.frase}</p>
      </div>
      <p className="ig-faz">{i.oQueFaz}</p>
      {i.horas && (
        <section>
          <h4>Atividade nas últimas 24 h</h4>
          <Horas horas={i.horas} agora={agora} rotulo={i.horasRotulo ?? "leituras"} grande />
          <div className="ig-horas-eixo"><span>{horaDaPosicao(0, agora)}h</span><span>{horaDaPosicao(12, agora)}h</span><span>agora</span></div>
        </section>
      )}
      {i.numeros.length > 0 && (
        <dl className="ig-numeros">
          {i.numeros.map((n) => <div key={n.rotulo}><dt>{n.rotulo}</dt><dd>{n.valor}</dd></div>)}
        </dl>
      )}
      {i.linhas && i.linhas.length > 0 && (
        <section>
          <h4>Por empresa ou unidade</h4>
          <ul className="ig-linhas">
            {i.linhas.map((l) => <li key={l.nome} className={l.estado}><i aria-hidden="true" /><b>{l.nome}</b><span>{l.texto}</span></li>)}
          </ul>
        </section>
      )}
      {i.erro && (
        <section className="ig-erro">
          <h4>Última falha · {i.erro.quando}</h4>
          <p>{i.erro.texto}</p>
        </section>
      )}
      {evs.length > 0 && (
        <section>
          <h4>Últimas leituras</h4>
          <ol className="ig-linha ig-linha-curta">
            {evs.map((e, k) => {
              const est = estadoEvento(e.status);
              return (
                <li key={`${e.quando}-${k}`} className={est}>
                  <span className="ig-linha-quando ig-num">{quando(e.quando, agora)}</span>
                  <span className="ig-linha-detalhe">{(e.detalhe ?? "").replace(/_/g, " ")}</span>
                  <span className="ig-linha-status"><i aria-hidden="true" />{STATUS_TEXTO[e.status] ?? e.status}</span>
                  {e.erro && est !== "ok" && <small className="ig-linha-erro">{e.erro}</small>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {i.pagina && <a className="ig-abrir-pagina" href={i.pagina}>Abrir {i.nome} →</a>}
    </div>
  );
}

// Nomes curtos no mapa (o nome completo fica no cartão e ao passar o mouse)
const NO_MAPA: Record<string, string> = {
  receita: "Receita", notas: "NF-e", certificados: "Certificados", totvs: "TOTVS", cicchetti: "Cicchetti",
  pms: "PMS hotéis", conector: "Conector", claude: "Claude",
};

// Mapa: o Brasico no meio e cada sistema em volta. Pontos discretos correm pelas ligações que estão funcionando;
// passar o mouse destaca a ligação, clicar abre o detalhe.
function Mapa({ lista, foco, setFoco, onAbrir }: { lista: Integracao[]; foco: string | null; setFoco: (id: string | null) => void; onAbrir: (id: string) => void }) {
  const L = 520, c = L / 2, raio = 180;
  const [mov, setMov] = useState(false);
  useEffect(() => setMov(!semMovimento()), []);
  const nos = lista.map((i, k) => {
    const ang = (-90 + (360 / lista.length) * k) * (Math.PI / 180);
    return { i, k, x: c + raio * Math.cos(ang), y: c + raio * Math.sin(ang), cos: Math.cos(ang) };
  });
  return (
    <svg className={`ig-mapa ${foco ? "com-foco" : ""}`} viewBox={`0 0 ${L} ${L}`} role="img" aria-label="Mapa das conexões do Brasico">
      <circle cx={c} cy={c} r={raio} className="ig-orbita" />
      <circle cx={c} cy={c} r={raio * 0.55} className="ig-orbita interna" />
      {nos.map(({ i, k, x, y }) => (
        <g key={`l-${i.id}`} className={`ig-elo ${i.estado} ${foco === i.id ? "ativo" : ""}`}>
          <path id={`ig-fio-${i.id}`} d={`M${c} ${c} L${x} ${y}`} className="ig-fio" />
          {mov && (i.estado === "ok" || i.estado === "atencao") && (
            <circle r="2.4" className="ig-pacote">
              <animateMotion dur={`${3.2 + (k % 4) * 0.5}s`} repeatCount="indefinite" begin={`${(k * 0.53) % 3}s`}
                keyPoints={k % 2 ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear">
                <mpath href={`#ig-fio-${i.id}`} />
              </animateMotion>
            </circle>
          )}
        </g>
      ))}
      <circle cx={c} cy={c} r={50} className="ig-centro-anel" />
      <circle cx={c} cy={c} r={42} className="ig-centro" />
      <text x={c} y={c + 6} textAnchor="middle" className="ig-centro-texto">Brasico</text>
      {nos.map(({ i, x, y, cos }) => {
        const meio = Math.abs(cos) <= 0.12;
        const lx = x + (meio ? 0 : cos > 0 ? 15 : -15);
        const ly = y + (meio ? (y < c ? -16 : 26) : 4);
        const anchor = meio ? "middle" : cos > 0 ? "start" : "end";
        return (
          <g key={i.id} className={`ig-no-grupo ${i.estado} ${foco === i.id ? "ativo" : ""}`} tabIndex={0} role="button"
            aria-label={`${i.nome}: ${TEXTO_ESTADO[i.estado]}`}
            onMouseEnter={() => setFoco(i.id)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(i.id)} onBlur={() => setFoco(null)}
            onClick={() => onAbrir(i.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAbrir(i.id)}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            {(i.estado === "erro" || i.estado === "atencao") && <circle cx={x} cy={y} r={8} className="ig-no-onda" />}
            <circle cx={x} cy={y} r={18} className="ig-no-alvo" />
            <circle cx={x} cy={y} r={8} className="ig-no" />
            <text x={lx} y={ly} textAnchor={anchor} className="ig-no-texto">{NO_MAPA[i.id] ?? i.nome}</text>
          </g>
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
      <div className="ig-grupo-cabeca">
        <h2>Agendas automáticas</h2>
        <p>{ag.length} rotinas do banco · {ag.filter((a) => a.ativa).length} ligadas · {falhando.length ? `${falhando.length} com falha nas últimas 24 h` : "nenhuma falhou nas últimas 24 h"}</p>
      </div>
      <details className="ig-caixa ig-agendas" open={falhando.length > 0}>
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
                    <td><span className="ig-ponto" aria-hidden="true" /><code>{a.nome}</code>{!a.ativa && <small> · desligada</small>}</td>
                    <td>{horarioLegivel(a.horario)}</td>
                    <td title={a.ultima_msg ?? ""}>{a.ultima ? `${quando(a.ultima, agora)}${a.ultima_status === "failed" ? " · falhou" : ""}` : "—"}</td>
                    <td className="ig-num">{a.rodadas_24h ? `${a.rodadas_24h}×${a.falhas_24h ? ` · ${a.falhas_24h} falha${a.falhas_24h === 1 ? "" : "s"}` : ""}` : "—"}</td>
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

// Últimas leituras de todas as fontes, em tabela
function Linha({ painel, agora, fonte, setFonte }: { painel: Painel; agora: string; fonte: string; setFonte: (f: string) => void }) {
  const fontes = [...new Set(painel.eventos.map((e) => e.fonte))];
  const evs = painel.eventos.filter((e) => fonte === "todas" || e.fonte === fonte).slice(0, 30);
  return (
    <section className="ig-grupo">
      <div className="ig-grupo-cabeca">
        <h2>Últimas leituras</h2>
        <p>O que cada sistema fez por último, do mais novo para o mais antigo (as leituras do ponto a cada minuto ficam de fora).</p>
      </div>
      <div className="ig-filtros" role="group" aria-label="Filtrar por sistema">
        {["todas", ...fontes].map((f) => (
          <button key={f} className={fonte === f ? "on" : ""} onClick={() => setFonte(f)} aria-pressed={fonte === f}>
            {f === "todas" ? "Todas" : NOME_FONTE[f] ?? f}
          </button>
        ))}
      </div>
      <div className="ig-caixa">
        <ol className="ig-linha">
          {evs.map((e, k) => {
            const est = estadoEvento(e.status);
            return (
              <li key={`${e.fonte}-${e.quando}-${k}`} className={est}>
                <span className="ig-linha-quando ig-num">{quando(e.quando, agora)}</span>
                <b>{NOME_FONTE[e.fonte] ?? e.fonte}</b>
                <span className="ig-linha-detalhe">{(e.detalhe ?? "").replace(/_/g, " ")}</span>
                <span className="ig-linha-status"><i aria-hidden="true" />{STATUS_TEXTO[e.status] ?? e.status}</span>
                {e.erro && est !== "ok" && <small className="ig-linha-erro">{e.erro}</small>}
              </li>
            );
          })}
          {!evs.length && <li className="muted">Nada por aqui ainda.</li>}
        </ol>
      </div>
    </section>
  );
}
