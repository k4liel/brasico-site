"use client";

// Painel de integrações (/integracoes, só sócios): todas as conexões do Brasico numa tela, ao vivo.
// Dados: integracoes_painel() (supabase/integracoes.sql), relido a cada 30 s e ao voltar para a aba.
// Regras de verde/amarelo/vermelho em lib/integracoes.ts. CSS no bloco "Integrações" de app/globals.css (classes ig-*).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import {
  GRUPOS, NOME_FONTE, STATUS_TEXTO, estadoAgenda, estadoEvento, fonteDaAgenda, horarioLegivel, montarIntegracoes, quando,
  type Estado, type Integracao, type Painel,
} from "@/lib/integracoes";

const INTERVALO = 30; // segundos entre leituras
const TEXTO_ESTADO: Record<Estado, string> = { ok: "Funcionando", atencao: "Pede atenção", erro: "Parada", pausa: "Pausada" };

export default function Integracoes({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [recebidoEm, setRecebidoEm] = useState(0);
  const [semAcesso, setSemAcesso] = useState(false);
  const [falhou, setFalhou] = useState("");
  const [lendo, setLendo] = useState(false);
  const [, setTique] = useState(0);
  const [fonte, setFonte] = useState<string>("todas");

  const carregar = useCallback(async () => {
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
  }, [supabase]);

  // Lê ao abrir, a cada 30 s e quando a pessoa volta para a aba
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, INTERVALO * 1000);
    const vis = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [carregar]);
  // Relógio da tela: "há x min" e as cores andam sozinhos entre uma leitura e outra
  useEffect(() => { const t = setInterval(() => setTique((x) => x + 1), 5000); return () => clearInterval(t); }, []);

  // "Agora" = hora do banco na leitura + o tempo que passou desde então
  const agora = painel ? new Date(new Date(painel.agora).getTime() + (Date.now() - recebidoEm)).toISOString() : "";
  const lista = painel ? montarIntegracoes({ ...painel, agora }) : [];
  const segundos = recebidoEm ? Math.max(0, Math.round((Date.now() - recebidoEm) / 1000)) : 0;

  if (semAcesso) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="integracoes" />
        <main className="miolo"><p className="vazio muted">Só os sócios veem o painel de integrações.</p></main>
      </div>
    );
  }

  const conta = (e: Estado) => lista.filter((i) => i.estado === e).length;
  const pedem = lista.filter((i) => i.estado === "atencao" || i.estado === "erro").sort((a, b) => (a.estado === "erro" ? -1 : 0) - (b.estado === "erro" ? -1 : 0));
  const geral: Estado = conta("erro") ? "erro" : conta("atencao") ? "atencao" : "ok";

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="integracoes" />
      <main className="miolo es-sistema ig">
        <div className="es-topo">
          <div>
            <h1>Integrações</h1>
            <p>Tudo a que o Brasico está conectado, com a última leitura de cada sistema. Atualiza sozinho a cada {INTERVALO} segundos.</p>
          </div>
          <div className="ig-vivo">
            <span className={`ig-pulso ${lendo ? "lendo" : ""}`} aria-hidden="true" />
            <span>{!painel ? "Lendo…" : lendo ? "Atualizando…" : segundos < 5 ? "Ao vivo · atualizado agora" : `Ao vivo · atualizado há ${segundos} s`}</span>
            <button className="ghost small" onClick={carregar} disabled={lendo}>Atualizar</button>
          </div>
        </div>
        {falhou && <p className="es-aviso">{falhou}</p>}

        {!painel ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : (<>
          {/* Resumo: quantas funcionam, o que pede atenção e o mapa das conexões */}
          <section className="ig-resumo">
            <div className="ig-resumo-texto">
              <p className={`ig-geral ${geral}`}>
                {geral === "ok" ? "Tudo funcionando" : geral === "atencao" ? "Funcionando, com pontos de atenção" : "Tem conexão parada"}
              </p>
              <div className="ig-contas">
                <Conta estado="ok" n={conta("ok")} rotulo="funcionando" />
                <Conta estado="atencao" n={conta("atencao")} rotulo="pedem atenção" />
                <Conta estado="erro" n={conta("erro")} rotulo="paradas" />
                {conta("pausa") > 0 && <Conta estado="pausa" n={conta("pausa")} rotulo="pausadas" />}
              </div>
              {pedem.length > 0 ? (
                <ul className="ig-pedem">
                  {pedem.map((i) => (
                    <li key={i.id}>
                      <a href={`#ig-${i.id}`} className={i.estado}>
                        <i aria-hidden="true" /><b>{i.nome}</b><span>{i.erro && /^últim/.test(i.frase) ? `falhou: ${i.erro.texto}` : i.frase}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted ig-nada">Nenhuma conexão pedindo atenção agora.</p>
              )}
            </div>
            <Mapa lista={lista} />
          </section>

          {GRUPOS.map((g) => (
            <section key={g.id} className="ig-grupo">
              <div className="ig-grupo-cabeca"><h2>{g.titulo}</h2><p className="muted">{g.explica}</p></div>
              <div className="ig-cartoes">
                {lista.filter((i) => i.grupo === g.id).map((i) => <Cartao key={i.id} i={i} />)}
              </div>
            </section>
          ))}

          <Agendas painel={painel} agora={agora} />
          <Linha painel={painel} agora={agora} fonte={fonte} setFonte={setFonte} />
        </>)}
      </main>
    </div>
  );
}

function Conta({ estado, n, rotulo }: { estado: Estado; n: number; rotulo: string }) {
  return <span className={`ig-conta ${estado}`}><b>{n}</b>{rotulo}</span>;
}

function Cartao({ i }: { i: Integracao }) {
  return (
    <article id={`ig-${i.id}`} className={`ig-cartao ${i.estado}`}>
      <header>
        <span className="ig-bolinha" aria-hidden="true" />
        <div>
          <h3>{i.nome}</h3>
          <small>{i.quem}</small>
        </div>
        <span className={`ig-selo ${i.estado}`}>{TEXTO_ESTADO[i.estado]}</span>
      </header>
      <p className="ig-frase">{i.frase}</p>
      <p className="ig-faz">{i.oQueFaz}</p>
      {i.numeros.length > 0 && (
        <dl className="ig-numeros">
          {i.numeros.map((n) => <div key={n.rotulo}><dt>{n.rotulo}</dt><dd>{n.valor}</dd></div>)}
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
          <p>{i.erro.texto}</p>
        </details>
      )}
      {i.pagina && <a className="ig-abrir" href={i.pagina}>Abrir {i.nome} →</a>}
    </article>
  );
}

// Mapa: o Brasico no meio e cada conexão em volta; a linha "corre" quando está funcionando
function Mapa({ lista }: { lista: Integracao[] }) {
  const L = 420, c = L / 2, raio = 150;
  const nos = lista.map((i, k) => {
    const ang = (-90 + (360 / lista.length) * k) * (Math.PI / 180);
    return { i, x: c + raio * Math.cos(ang), y: c + raio * Math.sin(ang), cos: Math.cos(ang) };
  });
  return (
    <svg className="ig-mapa" viewBox={`0 0 ${L} ${L}`} role="img" aria-label="Mapa das conexões do Brasico">
      {nos.map(({ i, x, y }) => (
        <line key={`l-${i.id}`} x1={c} y1={c} x2={x} y2={y} className={`ig-fio ${i.estado}`} />
      ))}
      <circle cx={c} cy={c} r={38} className="ig-centro" />
      <text x={c} y={c + 5} textAnchor="middle" className="ig-centro-texto">Brasico</text>
      {nos.map(({ i, x, y, cos }) => {
        const lx = x + (cos > 0.3 ? 14 : cos < -0.3 ? -14 : 0);
        const ly = y + (Math.abs(cos) <= 0.3 ? (y < c ? -16 : 22) : 4);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        return (
          <a key={i.id} href={`#ig-${i.id}`}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            <circle cx={x} cy={y} r={9} className={`ig-no ${i.estado}`} />
            <text x={lx} y={ly} textAnchor={anchor} className="ig-no-texto">{i.nome.replace(" · resumo do dia", "")}</text>
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
      <div className="ig-grupo-cabeca">
        <h2>Agendas automáticas</h2>
        <p className="muted">
          {ag.length} rotinas do banco · {ag.filter((a) => a.ativa).length} ligadas · {falhando.length ? `${falhando.length} com falha nas últimas 24 h` : "nenhuma falhou nas últimas 24 h"}
        </p>
      </div>
      <details className="ig-agendas" open={falhando.length > 0}>
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
                    <td><span className={`ig-ponto ${e}`} aria-hidden="true" /><code>{a.nome}</code>{!a.ativa && <small> · desligada</small>}</td>
                    <td>{horarioLegivel(a.horario)}</td>
                    <td title={a.ultima_msg ?? ""}>{a.ultima ? `${quando(a.ultima, agora)}${a.ultima_status === "failed" ? " · falhou" : ""}` : "—"}</td>
                    <td>{a.rodadas_24h ? `${a.rodadas_24h}×${a.falhas_24h ? ` · ${a.falhas_24h} falha${a.falhas_24h === 1 ? "" : "s"}` : ""}` : "—"}</td>
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

function Linha({ painel, agora, fonte, setFonte }: { painel: Painel; agora: string; fonte: string; setFonte: (f: string) => void }) {
  const fontes = [...new Set(painel.eventos.map((e) => e.fonte))];
  const evs = painel.eventos.filter((e) => fonte === "todas" || e.fonte === fonte).slice(0, 30);
  return (
    <section className="ig-grupo">
      <div className="ig-grupo-cabeca">
        <h2>Últimas leituras</h2>
        <p className="muted">O que cada sistema fez por último, do mais novo para o mais antigo (as leituras do ponto a cada minuto ficam de fora).</p>
      </div>
      <div className="ig-filtros" role="group" aria-label="Filtrar por sistema">
        {["todas", ...fontes].map((f) => (
          <button key={f} className={fonte === f ? "on" : ""} onClick={() => setFonte(f)} aria-pressed={fonte === f}>
            {f === "todas" ? "Todas" : NOME_FONTE[f] ?? f}
          </button>
        ))}
      </div>
      <ol className="ig-linha">
        {evs.map((e, k) => {
          const est = estadoEvento(e.status);
          return (
            <li key={`${e.fonte}-${e.quando}-${k}`} className={est}>
              <i aria-hidden="true" />
              <span className="ig-linha-quando">{quando(e.quando, agora)}</span>
              <b>{NOME_FONTE[e.fonte] ?? e.fonte}</b>
              <span className="ig-linha-detalhe">{(e.detalhe ?? "").replace(/_/g, " ")}</span>
              <span className={`ig-linha-status ${est}`}>{STATUS_TEXTO[e.status] ?? e.status}</span>
              {e.erro && est !== "ok" && <small className="ig-linha-erro">{e.erro}</small>}
            </li>
          );
        })}
        {!evs.length && <li className="muted">Nada por aqui ainda.</li>}
      </ol>
    </section>
  );
}
