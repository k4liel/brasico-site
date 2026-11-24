"use client";

// Aba "Ponto e banco de horas" do RH (refeita em 23/11/2026, prévia B escolhida pelo dono).
// PontoMes: o ponto completo do mês de cada pessoa, organizado por casa → setor (como a escala), com os afastados à
// parte no fim. Cada linha tem a faixa do mês; clicar abre o calendário da pessoa em quadradinhos e, ao passar o mouse
// num dia, aparecem o previsto, as batidas, as horas e o atraso. O dia é classificado cruzando o relógio (RHiD) com a
// escala do Brasico e as justificativas (lib/esocial/ponto-mes.ts). BancoPonto: o saldo do banco de horas de cada
// pessoa com a variação de 30 dias, a partir dos mesmos dados (antes era uma leitura à parte e demorava).
// CSS num bloco só em globals.css ("Ponto do mês", classes pm-*).
import { useEffect, useMemo, useState } from "react";
import { cpfVisivel, hoje, somarDias } from "@/lib/esocial/rh";
import { classificarDia, diaDaSemana, diasDoMes, resumir, type DiaMes, type TipoDia } from "@/lib/esocial/ponto-mes";
import { horas, iniciais, nomeProprio, type LinhaPonto, type Ponto } from "./PontoDados";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const nomeDoMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const somarMes = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const dataLonga = (d: string) => `${SEMANA[diaDaSemana(d)].replace(/^./, (c) => c.toUpperCase())}, ${Number(d.slice(8, 10))} de ${MESES[Number(d.slice(5, 7)) - 1]}`;
const CORES = ["#c9a463", "#7fa7c9", "#8cbf9a", "#b49ad6", "#d99a7c", "#7fc1bd", "#c98fa8"];
const LEGENDA: [TipoDia, string][] = [["trab", "Trabalhou"], ["atr", "Com atraso"], ["fal", "Falta"], ["falc", "Falta a conferir (sem escala no Brasico)"],
  ["fol", "Folga"], ["fer", "Feriado"], ["afa", "Afastado · férias · atestado"], ["fora", "Em outro lugar"], ["prev", "Previsto"]];
const textoCurto = (d: DiaMes) => d.batidas.length ? `${d.batidas[0].hora}${d.batidas.length > 1 ? ` · ${d.batidas[d.batidas.length - 1].hora}` : ""}`
  : d.tipo === "prev" || d.tipo === "hoje" ? d.previsto : d.tipo === "fal" ? "falta" : d.tipo === "falc" ? "falta?" : d.rotulo.toLowerCase().replace(/^justificado: /, "");

type Linha = LinhaPonto & { mes: DiaMes[]; r: ReturnType<typeof resumir>; afastadoGrupo: boolean };
type Dica = { d: DiaMes; x: number; y: number; nome: string } | null;

// Caixinha que aparece ao passar o mouse num dia (posição fixa na tela, perto do quadradinho)
function DicaDia({ dica }: { dica: Dica }) {
  if (!dica) return null;
  const { d } = dica;
  const pares: [string, string | null][] = [];
  for (let i = 0; i < d.batidas.length; i += 2) pares.push([d.batidas[i].hora, d.batidas[i + 1]?.hora ?? null]);
  const largura = 250;
  const left = Math.min(Math.max(8, dica.x - largura / 2), (typeof window !== "undefined" ? window.innerWidth : 1200) - largura - 8);
  const acima = dica.y > 260;
  return (
    <div className={`pm-dica pm-dica-${d.tipo}`} role="tooltip" style={{ left, top: acima ? dica.y - 10 : dica.y + 26, transform: acima ? "translateY(-100%)" : undefined, width: largura }}>
      <b className="pm-dica-titulo">{dataLonga(d.dia)}</b>
      <span className="pm-dica-nome">{dica.nome}</span>
      {d.previsto && <span className="pm-dica-prev">Previsto {d.previsto}{d.descanso ? ` · desc. ${d.descanso}` : ""}<small>{d.origemEscala === "brasico" ? "escala do Brasico" : "horário do relógio"}</small></span>}
      {pares.length > 0 ? (
        <span className="pm-dica-batidas">{pares.map(([e, s], i) => <span key={i}><i>{e}</i><em>→</em><i className={s ? "" : "falta"}>{s ?? "sem saída"}</i></span>)}</span>
      ) : <span className="pm-dica-sem">{d.dia > hoje() ? "Dia ainda não chegou" : "Nenhuma batida"}</span>}
      <span className="pm-dica-rodape"><b>{d.rotulo}</b>{d.minutos > 0 && <> · {horas(d.minutos)} trabalhadas</>}{d.ajustada && <> · com ajuste no RHiD</>}</span>
      {d.alerta && <small className="pm-dica-alerta">Relógio: {d.alerta}</small>}
    </div>
  );
}

function Faixa({ l, onDica }: { l: Linha; onDica: (d: Dica) => void }) {
  return (
    <span className="pm-faixa" onMouseLeave={() => onDica(null)}>
      {l.mes.map((d) => (
        <i key={d.dia} className={`pm-q pm-t-${d.tipo} ${d.dia === hoje() ? "pm-hoje" : ""}`}
          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); onDica({ d, x: r.left + r.width / 2, y: r.top, nome: nomeProprio(l.p.nome) }); }} />
      ))}
    </span>
  );
}

function Calendario({ l, onDica, onAbrirFicha }: { l: Linha; onDica: (d: Dica) => void; onAbrirFicha?: () => void }) {
  const vazios = diaDaSemana(l.mes[0].dia);
  const r = l.r;
  return (
    <div className="pm-abre">
      <div className="pm-cal" onMouseLeave={() => onDica(null)}>
        {["D", "S", "T", "Q", "Q", "S", "S"].map((w, i) => <span key={i} className="pm-cal-wd">{w}</span>)}
        {Array.from({ length: vazios }, (_, i) => <span key={`v${i}`} />)}
        {l.mes.map((d) => (
          <span key={d.dia} className={`pm-cal-d pm-t-${d.tipo} ${d.dia === hoje() ? "pm-hoje" : ""}`} tabIndex={0}
            onMouseEnter={(e) => { const b = e.currentTarget.getBoundingClientRect(); onDica({ d, x: b.left + b.width / 2, y: b.top, nome: nomeProprio(l.p.nome) }); }}
            onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); onDica({ d, x: b.left + b.width / 2, y: b.top, nome: nomeProprio(l.p.nome) }); }}
            onBlur={() => onDica(null)}>
            <b>{Number(d.dia.slice(8, 10))}</b>
            <small>{textoCurto(d)}</small>
          </span>
        ))}
      </div>
      <div className="pm-lado">
        <h4>{MESES[Number(l.mes[0].dia.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} de {nomeProprio(l.p.nome).split(" ")[0]}</h4>
        <div><span>Dias trabalhados</span><b>{r.dias}</b></div>
        <div><span>Horas</span><b>{horas(r.minutos)}</b></div>
        <div><span>Faltas</span><b className={r.faltas ? "pm-ruim" : ""}>{r.faltas}{r.aConferir ? <small> +{r.aConferir} a conferir</small> : null}</b></div>
        <div><span>Atrasos</span><b>{r.atrasos ? `${r.atrasos} · ${horas(r.minutosAtraso)}` : "—"}</b></div>
        <div><span>Folgas</span><b>{r.folgas}</b></div>
        {r.afastado > 0 && <div><span>Afastado</span><b>{r.afastado} dia{r.afastado === 1 ? "" : "s"}</b></div>}
        {r.fora > 0 && <div><span>Em outro lugar</span><b>{r.fora}</b></div>}
        <div><span>Banco de horas</span><b className={l.saldo == null ? "" : l.saldo < 0 ? "pm-ruim" : "pm-ok"}>{l.saldo == null ? "—" : horas(l.saldo, true)}</b></div>
        <p className="muted">{[l.escala && `Escala no relógio: ${l.escala}`, r.aConferir ? "Sem escala no Brasico neste mês: a folga não aparece e o relógio marca falta." : ""].filter(Boolean).join(" · ")}</p>
        {onAbrirFicha && <button type="button" className="ghost small" onClick={onAbrirFicha}>Abrir a ficha no RH</button>}
      </div>
    </div>
  );
}

function useLinhasDoMes(ponto: Ponto, mes: string) {
  const { vistas, planejada, afastamentosDe } = ponto;
  const dias = useMemo(() => diasDoMes(mes), [mes]);
  return useMemo(() => {
    const agora = hoje();
    return vistas.map((l) => {
      const escalaDe = (dia: string) => planejada.get(`${l.p.cliente_id}:${l.p.id}:${dia}`);
      const temEscalaNoMes = dias.some((d) => escalaDe(d));
      const af = afastamentosDe.get(l.k) ?? [];
      const mesDias = dias.map((d) => classificarDia(d, agora, l.dias.get(d), escalaDe(d), af, temEscalaNoMes));
      return { ...l, mes: mesDias, r: resumir(mesDias.filter((d) => d.dia <= agora)), afastadoGrupo: !!l.afastado || l.setor === "Afastados" } as Linha;
    });
  }, [vistas, planejada, afastamentosDe, dias]);
}

function agrupar(linhas: Linha[]) {
  const locais = [...new Set(linhas.filter((l) => !l.afastadoGrupo).map((l) => l.local || "Sem local"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const cor = (local: string) => CORES[Math.max(0, locais.indexOf(local)) % CORES.length];
  const grupos: { titulo: string; cor: string; linhas: Linha[]; afastados?: boolean }[] = [];
  for (const local of locais) {
    const doLocal = linhas.filter((l) => !l.afastadoGrupo && (l.local || "Sem local") === local);
    const setores = [...new Set(doLocal.map((l) => l.setor || ""))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    for (const s of setores) {
      grupos.push({ titulo: s ? `${local} · ${s}` : local, cor: cor(local),
        linhas: doLocal.filter((l) => (l.setor || "") === s).sort((a, b) => (a.posicao ?? 9999) - (b.posicao ?? 9999) || a.p.nome.localeCompare(b.p.nome)) });
    }
  }
  const af = linhas.filter((l) => l.afastadoGrupo).sort((a, b) => a.p.nome.localeCompare(b.p.nome));
  if (af.length) grupos.push({ titulo: "Afastados", cor: "#8a78c8", linhas: af, afastados: true });
  return { grupos, locais };
}

function Aguardando({ ponto }: { ponto: Ponto }) {
  if (ponto.acesso === false) return <p className="muted tv-nada">Sem acesso ao ponto (RHiD).</p>;
  return <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>;
}

export function PontoMes({ ponto, verCpf, chavesRH, onAbrirPessoa }: { ponto: Ponto; verCpf: boolean; chavesRH: Set<string>; onAbrirPessoa: (chave: string) => void }) {
  const agora = hoje();
  const [mes, setMes] = useState(agora.slice(0, 7));
  const [casa, setCasa] = useState("");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [dica, setDica] = useState<Dica>(null);
  const { garantir } = ponto;
  useEffect(() => { const ds = diasDoMes(mes); garantir(ds[0], ds[ds.length - 1]); }, [mes, garantir]);
  useEffect(() => { const f = () => setDica(null); window.addEventListener("scroll", f, true); return () => window.removeEventListener("scroll", f, true); }, []);
  const todas = useLinhasDoMes(ponto, mes);
  if (!ponto.carregado || ponto.acesso === false) return <Aguardando ponto={ponto} />;

  const termo = busca.trim().toLowerCase();
  const { grupos, locais } = agrupar(todas);
  const filtrar = (l: Linha) => (!casa || (l.local || "Sem local") === casa || (casa === "Afastados" && l.afastadoGrupo))
    && (!termo || l.p.nome.toLowerCase().includes(termo) || l.cargo.toLowerCase().includes(termo));
  const naEquipe = todas.filter((l) => !l.afastadoGrupo && (!casa || (l.local || "Sem local") === casa));
  const soma = (f: (l: Linha) => number) => naEquipe.reduce((t, l) => t + f(l), 0);
  const ehMesAtual = mes === agora.slice(0, 7);
  // Hoje pela mesma regra do mês (relógio × escala do Brasico): quem bateu, quem tinha de trabalhar e quem passou da entrada
  const deHoje = naEquipe.map((l) => l.mes.find((d) => d.dia === agora)).filter((d): d is DiaMes => !!d);
  const trabalhando = deHoje.filter((d) => d.tipo === "trab" || d.tipo === "atr").length;
  const comEscalaHoje = deHoje.filter((d) => d.tipo === "trab" || d.tipo === "atr" || d.tipo === "hoje").length;
  const passouDaEntrada = (d: DiaMes) => { const m = d.previsto.match(/^(\d{2}):(\d{2})/); if (!m) return false;
    const [h, mi] = ponto.relogio.split(":").map(Number); return h * 60 + mi >= Number(m[1]) * 60 + Number(m[2]) + 10; };
  const atrasadosAgora = deHoje.filter((d) => d.tipo === "hoje" && passouDaEntrada(d)).length;
  const afastadosHoje = todas.filter((l) => l.afastadoGrupo).length;
  const diasAtraso = soma((l) => l.r.atrasos);
  const aConferir = soma((l) => l.r.aConferir);

  return (
    <div className="pm">
      <div className="pm-barra">
        <div className="pm-mes" role="group" aria-label="Mês">
          <button type="button" onClick={() => { setMes(somarMes(mes, -1)); setAberta(null); }} aria-label="Mês anterior" disabled={mes <= somarMes(agora.slice(0, 7), -12)}>‹</button>
          <b>{nomeDoMes(mes).replace(/^./, (c) => c.toUpperCase())}</b>
          <button type="button" onClick={() => { setMes(somarMes(mes, 1)); setAberta(null); }} aria-label="Próximo mês" disabled={mes >= somarMes(agora.slice(0, 7), 1)}>›</button>
        </div>
        <div className="pm-seg" role="group" aria-label="Casa">
          <button type="button" className={casa === "" ? "on" : ""} onClick={() => setCasa("")}>Todas as casas</button>
          {locais.map((u) => <button key={u} type="button" className={casa === u ? "on" : ""} onClick={() => setCasa(u)}>{u}</button>)}
          {afastadosHoje > 0 && <button type="button" className={casa === "Afastados" ? "on" : ""} onClick={() => setCasa("Afastados")}>Afastados</button>}
        </div>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou cargo" aria-label="Buscar no ponto" />
      </div>

      <div className="pm-kpis">
        {ehMesAtual ? (
          <div className="pm-kpi"><span>No relógio hoje</span><b>{trabalhando} <small>de {comEscalaHoje}</small></b><small>bateram ponto hoje{atrasadosAgora ? ` · ${atrasadosAgora} atrasado${atrasadosAgora === 1 ? "" : "s"} agora` : ""}</small></div>
        ) : (
          <div className="pm-kpi"><span>Dias trabalhados</span><b>{soma((l) => l.r.dias)}</b><small>somando a equipe em {MESES[Number(mes.slice(5, 7)) - 1]}</small></div>
        )}
        <div className="pm-kpi"><span>Faltas no mês</span><b className={soma((l) => l.r.faltas) ? "pm-ruim" : ""}>{soma((l) => l.r.faltas)}</b>
          <small>{aConferir ? `+${aConferir} a conferir (sem escala no Brasico)` : "fora da folga da escala"}</small></div>
        <div className="pm-kpi"><span>Atrasos no mês</span><b>{horas(soma((l) => l.r.minutosAtraso))}</b><small>em {diasAtraso} dia{diasAtraso === 1 ? "" : "s"} · mais de 10 min</small></div>
        <div className="pm-kpi"><span>Afastados hoje</span><b>{afastadosHoje}</b><small>férias, atestado e licença · fora das contas</small></div>
      </div>

      <div className="pm-legenda">{LEGENDA.map(([t, r]) => <span key={t}><i className={`pm-q pm-t-${t}`} />{r}</span>)}</div>

      <div className="pm-lista">
        {grupos.map((g) => {
          const ls = g.linhas.filter(filtrar);
          if (!ls.length) return null;
          const f = ls.reduce((t, l) => t + l.r.faltas, 0), a = ls.reduce((t, l) => t + l.r.minutosAtraso, 0);
          return (
            <section key={g.titulo} className={`pm-grupo ${g.afastados ? "pm-grupo-af" : ""}`}>
              <div className="pm-grupo-cab"><b><i style={{ background: g.cor }} />{g.titulo}</b>
                <span>{ls.length} pessoa{ls.length === 1 ? "" : "s"}{g.afastados ? " · fora das contas" : `${f ? ` · ${f} falta${f === 1 ? "" : "s"}` : ""}${a ? ` · ${horas(a)} de atraso` : ""}`}</span></div>
              {ls.map((l) => {
                const on = aberta === l.k;
                return (
                  <div key={l.k} className={`pm-pessoa ${on ? "on" : ""}`}>
                    <button type="button" className="pm-linha" onClick={() => setAberta(on ? null : l.k)} aria-expanded={on}>
                      <span className="pm-av" style={{ color: g.cor }}>{iniciais(nomeProprio(l.p.nome))}</span>
                      <span className="pm-nm"><b>{nomeProprio(l.p.nome)}</b><small>{[l.cargo, verCpf && l.p.cpf ? cpfVisivel(l.p.cpf, true) : "", g.afastados && l.afastado ? `${l.afastado.tipo} até ${l.afastado.fim.slice(8, 10)}/${l.afastado.fim.slice(5, 7)}` : ""].filter(Boolean).join(" · ") || "—"}</small></span>
                      <Faixa l={l} onDica={setDica} />
                      <span className="pm-n"><b>{l.r.dias}</b><small>dias</small></span>
                      <span className="pm-n"><b className={l.r.faltas ? "pm-ruim" : ""}>{l.r.faltas || "—"}{l.r.aConferir ? <em title="faltas a conferir (sem escala no Brasico)">+{l.r.aConferir}?</em> : null}</b><small>faltas</small></span>
                      <span className="pm-n"><b>{l.r.minutosAtraso ? horas(l.r.minutosAtraso) : "—"}</b><small>atraso</small></span>
                      <span className="pm-n"><b className={l.saldo == null ? "" : l.saldo < 0 ? "pm-ruim" : "pm-ok"}>{l.saldo == null ? "—" : horas(l.saldo, true)}</b><small>banco</small></span>
                    </button>
                    {on && <Calendario l={l} onDica={setDica} onAbrirFicha={chavesRH.has(l.chaveRH) ? () => onAbrirPessoa(l.chaveRH) : undefined} />}
                  </div>
                );
              })}
            </section>
          );
        })}
        {!grupos.some((g) => g.linhas.some(filtrar)) && <p className="muted pm-nada">Ninguém neste filtro.</p>}
      </div>
      <p className="muted pm-nota">Cada dia cruza o relógio (RHiD) com a escala do Brasico: folga da escala não conta como falta, e o atraso é a 1ª batida depois da entrada prevista (mais de 10 min). Quem não tem escala montada no Brasico aparece com "falta a conferir" nos dias em que o relógio marcou falta, porque pode ser a folga. Banco de horas: saldo do último dia lido no RHiD.</p>
      <DicaDia dica={dica} />
    </div>
  );
}

// =====================================================================
// Banco de horas: saldo de hoje de cada pessoa, com a variação de 30 dias
// =====================================================================
function Linha30({ valores }: { valores: number[] }) {
  if (valores.length < 2) return <span className="pm-spark" />;
  const mn = Math.min(...valores, 0), mx = Math.max(...valores, 0), amp = mx - mn || 1;
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * 100},${24 - ((v - mn) / amp) * 22 - 1}`).join(" ");
  const zero = 24 - ((0 - mn) / amp) * 22 - 1;
  return (
    <svg className="pm-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1={zero} y2={zero} className="pm-spark-zero" />
      <polyline points={pts} className={valores[valores.length - 1] < 0 ? "neg" : "pos"} />
    </svg>
  );
}

const ORDENS = ["Mais negativo", "Mais positivo", "Nome"] as const;
export function BancoPonto({ ponto, chavesRH, onAbrirPessoa }: { ponto: Ponto; chavesRH: Set<string>; onAbrirPessoa: (chave: string) => void }) {
  const [casa, setCasa] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<(typeof ORDENS)[number]>("Mais negativo");
  if (!ponto.carregado || ponto.acesso === false) return <Aguardando ponto={ponto} />;
  const agora = hoje(), antes = somarDias(agora, -30);
  const linhas = ponto.vistas.map((l) => {
    const serie = [...l.dias.values()].filter((d) => d.dia >= antes && d.dia <= agora && d.saldo_banco != null).sort((a, b) => a.dia.localeCompare(b.dia));
    const v30 = serie.length > 1 ? serie[serie.length - 1].saldo_banco! - serie[0].saldo_banco! : null;
    return { l, serie: serie.map((d) => d.saldo_banco!), v30 };
  }).filter((x) => x.l.saldo != null);
  const locais = [...new Set(linhas.map((x) => x.l.local || "Sem local"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const termo = busca.trim().toLowerCase();
  const vistas = linhas.filter((x) => (!casa || (x.l.local || "Sem local") === casa) && (!termo || x.l.p.nome.toLowerCase().includes(termo)));
  const pos = vistas.filter((x) => x.l.saldo! > 0), neg = vistas.filter((x) => x.l.saldo! < 0);
  const maxAbs = Math.max(60, ...vistas.map((x) => Math.abs(x.l.saldo!)));
  const ordenar = (a: typeof vistas[number], b: typeof vistas[number]) =>
    ordem === "Nome" ? a.l.p.nome.localeCompare(b.l.p.nome) : ordem === "Mais positivo" ? b.l.saldo! - a.l.saldo! : a.l.saldo! - b.l.saldo!;
  const somaH = (xs: typeof vistas) => xs.reduce((t, x) => t + x.l.saldo!, 0);
  return (
    <div className="pm">
      <div className="pm-barra">
        <div className="pm-seg" role="group" aria-label="Casa">
          <button type="button" className={casa === "" ? "on" : ""} onClick={() => setCasa("")}>Todas as casas</button>
          {locais.map((u) => <button key={u} type="button" className={casa === u ? "on" : ""} onClick={() => setCasa(u)}>{u}</button>)}
        </div>
        <div className="pm-seg" role="group" aria-label="Ordem">{ORDENS.map((o) => <button key={o} type="button" className={ordem === o ? "on" : ""} onClick={() => setOrdem(o)}>{o}</button>)}</div>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa" aria-label="Buscar no banco de horas" />
      </div>
      <div className="pm-kpis">
        <div className="pm-kpi"><span>Horas a favor</span><b className="pm-ok">{horas(somaH(pos), true)}</b><small>{pos.length} pessoa{pos.length === 1 ? "" : "s"} com saldo positivo</small></div>
        <div className="pm-kpi"><span>Horas devidas</span><b className="pm-ruim">{horas(somaH(neg))}</b><small>{neg.length} pessoa{neg.length === 1 ? "" : "s"} com saldo negativo</small></div>
        <div className="pm-kpi"><span>Saldo da equipe</span><b className={somaH(vistas) < 0 ? "pm-ruim" : "pm-ok"}>{horas(somaH(vistas), true)}</b><small>somando todo mundo</small></div>
        <div className="pm-kpi"><span>Maior variação em 30 dias</span>{(() => { const m = [...vistas].filter((x) => x.v30 != null).sort((a, b) => Math.abs(b.v30!) - Math.abs(a.v30!))[0];
          return m ? <><b className={m.v30! < 0 ? "pm-ruim" : "pm-ok"}>{horas(m.v30!, true)}</b><small>{nomeProprio(m.l.p.nome)}</small></> : <><b>—</b><small>sem leitura de 30 dias</small></>; })()}</div>
      </div>
      <div className="pm-lista">
        {(casa ? [casa] : locais).map((u, i) => {
          const xs = vistas.filter((x) => (x.l.local || "Sem local") === u).sort(ordenar);
          if (!xs.length) return null;
          return (
            <section key={u} className="pm-grupo">
              <div className="pm-grupo-cab"><b><i style={{ background: CORES[(casa ? locais.indexOf(u) : i) % CORES.length] }} />{u}</b><span>{xs.length} pessoa{xs.length === 1 ? "" : "s"} · saldo {horas(somaH(xs), true)}</span></div>
              <div className="pm-bh-cab" aria-hidden="true"><span>Pessoa</span><span className="pm-bh-eixo"><em>devendo</em><em>a favor</em></span><span>Saldo</span><span>30 dias</span></div>
              {xs.map(({ l, serie, v30 }) => {
                const w = (Math.abs(l.saldo!) / maxAbs) * 50;
                const pode = chavesRH.has(l.chaveRH);
                return (
                  <button key={l.k} type="button" className="pm-bh" onClick={() => pode && onAbrirPessoa(l.chaveRH)} disabled={!pode} title={pode ? "Abrir a ficha no RH" : undefined}>
                    <span className="pm-nm"><b>{nomeProprio(l.p.nome)}</b><small>{[l.setor, l.cargo].filter(Boolean).join(" · ")}</small></span>
                    <span className="pm-bh-barra"><i className={l.saldo! < 0 ? "neg" : "pos"} style={l.saldo! < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} /></span>
                    <b className={l.saldo! < 0 ? "pm-ruim" : "pm-ok"}>{horas(l.saldo!, true)}</b>
                    <span className="pm-bh-var"><Linha30 valores={serie} /><small className={v30 == null ? "muted" : v30 < 0 ? "pm-ruim" : "pm-ok"}>{v30 == null ? "—" : horas(v30, true)}</small></span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className="muted pm-nota">Saldo do banco de horas no último dia lido do RHiD (apuração do ponto). A linha mostra os últimos 30 dias; o número ao lado é quanto o saldo mudou nesse tempo.</p>
    </div>
  );
}

