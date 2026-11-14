"use client";

// Painel de integrações (/integracoes, só sócios): todas as conexões do Brasico numa tela, ao vivo.
// Visual sóbrio, no padrão do sistema (13/11/2026: o dono pediu "sério, profissional, tecnologia sem exagero").
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
const TEXTO_ESTADO: Record<Estado, string> = { ok: "Funcionando", atencao: "Atenção", erro: "Parada", pausa: "Pausada" };

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
  const leituras24h = painel ? somaLeituras(painel) : 0;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="integracoes" />
      <main className="miolo es-sistema ig">
        <div className="es-topo ig-topo">
          <div>
            <p className="ig-eyebrow">Sistema · conexões</p>
            <h1>Integrações</h1>
            <p>Todos os sistemas a que o Brasico está conectado, com a última leitura de cada um.</p>
          </div>
          <Vivo recebidoEm={recebidoEm} lendo={lendo} onAtualizar={carregar} />
        </div>
        {falhou && <p className="es-aviso">{falhou}</p>}

        {!painel ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : (<>
          <section className="ig-resumo" aria-label="Resumo">
            <div className="ig-resumo-geral">
              <span className={`ig-estado ${geral}`}><i aria-hidden="true" />
                {geral === "ok" ? "Todos os sistemas funcionando" : geral === "atencao" ? "Funcionando, com pontos de atenção" : "Há conexão parada"}
              </span>
              <Barra lista={lista} />
            </div>
            <dl className="ig-numeros-topo">
              <div><dt>Funcionando</dt><dd>{conta("ok")}<small> de {lista.length}</small></dd></div>
              <div className={conta("atencao") ? "atencao" : ""}><dt>Atenção</dt><dd>{conta("atencao")}</dd></div>
              <div className={conta("erro") ? "erro" : ""}><dt>Paradas</dt><dd>{conta("erro")}</dd></div>
              <div><dt>Leituras em 24 h</dt><dd>{leituras24h.toLocaleString("pt-BR")}</dd></div>
            </dl>
          </section>

          <section className="ig-central">
            <div className="ig-caixa">
              <div className="ig-caixa-cabeca"><h2>Mapa das conexões</h2><span>{lista.length} sistemas</span></div>
              <Mapa lista={lista} />
              <div className="ig-legenda">
                {(["ok", "atencao", "erro", "pausa"] as Estado[]).map((e) => <span key={e} className={e}><i />{TEXTO_ESTADO[e]}</span>)}
              </div>
            </div>
            <div className="ig-caixa ig-alertas">
              <div className="ig-caixa-cabeca"><h2>O que pede atenção</h2><span>{pedem.length || "nenhum"}</span></div>
              {pedem.length ? (
                <ul>
                  {pedem.map((i) => (
                    <li key={i.id}>
                      <a href={`#ig-${i.id}`} className={i.estado}>
                        <i aria-hidden="true" />
                        <span><b>{i.nome}</b><small>{i.erro && /^últim/.test(i.frase) ? `Falhou: ${i.erro.texto}` : i.frase}</small></span>
                        <em>{TEXTO_ESTADO[i.estado]}</em>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ig-tudo-ok">Nenhuma conexão pedindo atenção agora.</p>
              )}
            </div>
          </section>

          {GRUPOS.map((g) => (
            <section key={g.id} className="ig-grupo">
              <div className="ig-grupo-cabeca"><h2>{g.titulo}</h2><p>{g.explica}</p></div>
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

// Quantas leituras boas todas as fontes fizeram nas últimas 24 h
function somaLeituras(p: Painel) {
  const f = p.fontes;
  return [f.rhid, f.esocial, f.receita, f.notas, f.nfse, f.totvs, f.pms, f.gemini].reduce((s, x) => s + (x.ok_24h || 0), 0) + (f.cicchetti.ok_24h || 0);
}

// Indicador de "ao vivo": quando foi a última leitura e quanto falta para a próxima (só ele muda a cada segundo)
function Vivo({ recebidoEm, lendo, onAtualizar }: { recebidoEm: number; lendo: boolean; onAtualizar: () => void }) {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => { setAgora(Date.now()); const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const passou = agora && recebidoEm ? Math.max(0, (agora - recebidoEm) / 1000) : 0;
  const falta = Math.max(0, Math.ceil(INTERVALO - passou));
  return (
    <div className="ig-vivo">
      <span className={`ig-vivo-ponto ${lendo ? "lendo" : ""}`} aria-hidden="true" />
      <div>
        <b>{lendo ? "Atualizando…" : "Ao vivo"}</b>
        <small>{!agora || !recebidoEm ? "conectando…" : `atualizado há ${Math.round(passou)} s · próxima em ${falta} s`}</small>
      </div>
      <button className="ghost small" onClick={onAtualizar} disabled={lendo}>Atualizar</button>
    </div>
  );
}

// Barra de situação: cada sistema é um trecho colorido
function Barra({ lista }: { lista: Integracao[] }) {
  const ordem: Estado[] = ["ok", "pausa", "atencao", "erro"];
  return (
    <div className="ig-barra" role="img" aria-label={ordem.map((e) => `${lista.filter((i) => i.estado === e).length} ${TEXTO_ESTADO[e]}`).join(", ")}>
      {ordem.flatMap((e) => lista.filter((i) => i.estado === e)).map((i) => <i key={i.id} className={i.estado} title={`${i.nome}: ${TEXTO_ESTADO[i.estado]}`} />)}
    </div>
  );
}

function Cartao({ i }: { i: Integracao }) {
  return (
    <article id={`ig-${i.id}`} className={`ig-cartao ${i.estado}`}>
      <header>
        <div>
          <h3>{i.nome}</h3>
          <small>{i.quem}</small>
        </div>
        <span className="ig-selo"><i aria-hidden="true" />{TEXTO_ESTADO[i.estado]}</span>
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

// Nomes curtos no mapa (o nome completo fica no cartão e ao passar o mouse)
const NO_MAPA: Record<string, string> = {
  receita: "Receita", notas: "NF-e", certificados: "Certificados", totvs: "TOTVS", cicchetti: "Cicchetti",
  pms: "PMS hotéis", conector: "Conector", claude: "Claude",
};

// Mapa estático: o Brasico no meio e cada sistema em volta, com a cor da situação
function Mapa({ lista }: { lista: Integracao[] }) {
  const L = 520, c = L / 2, raio = 180;
  const nos = lista.map((i, k) => {
    const ang = (-90 + (360 / lista.length) * k) * (Math.PI / 180);
    return { i, x: c + raio * Math.cos(ang), y: c + raio * Math.sin(ang), cos: Math.cos(ang) };
  });
  return (
    <svg className="ig-mapa" viewBox={`0 0 ${L} ${L}`} role="img" aria-label="Mapa das conexões do Brasico">
      <circle cx={c} cy={c} r={raio} className="ig-orbita" />
      {nos.map(({ i, x, y }) => <line key={`l-${i.id}`} x1={c} y1={c} x2={x} y2={y} className={`ig-fio ${i.estado}`} />)}
      <circle cx={c} cy={c} r={42} className="ig-centro" />
      <text x={c} y={c + 6} textAnchor="middle" className="ig-centro-texto">Brasico</text>
      {nos.map(({ i, x, y, cos }) => {
        const meio = Math.abs(cos) <= 0.12;
        const lx = x + (meio ? 0 : cos > 0 ? 15 : -15);
        const ly = y + (meio ? (y < c ? -16 : 26) : 4);
        const anchor = meio ? "middle" : cos > 0 ? "start" : "end";
        return (
          <a key={i.id} href={`#ig-${i.id}`} className={`ig-no-grupo ${i.estado}`}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            <circle cx={x} cy={y} r={8} className="ig-no" />
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
