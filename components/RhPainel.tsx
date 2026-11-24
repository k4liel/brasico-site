"use client";

// Painel e Equipe do RH (refeitos em 23/11/2026, prévia A escolhida pelo dono, no padrão de Folha e salários e de
// Ponto). Privacidade: CPF e Valores juntos no topo do RH, valendo para todas as abas. PainelRH: equipe de hoje com a
// divisão por casa, o que precisa de atenção, a saúde dos dados, hoje no ponto por casa, próximos prazos e entradas
// e saídas. EquipeRH: cartões das casas (clicar filtra) e a lista por casa com situação, admissão e o que falta na ficha.
// As cores das casas seguem a mesma ordem de Folha e salários (casa com mais gente primeiro). CSS: bloco "Painel e
// Equipe do RH" em globals.css (classes rp-*).
import { useMemo, useState, type ReactNode } from "react";
import { cpfVisivel, dataBR, nomeCurto, nomeMes, ROTULO_SITUACAO, tempoDeCasa, type Alerta, type EmpresaRH, type ItemCalendario,
  type Movimentacao, type Pessoa, type Situacao } from "@/lib/esocial/rh";
import { localDaUnidadeRH } from "@/lib/esocial/locais";
import { estadoEsocial, estadoPonto, quando, type SaudeRH } from "./RhDados";
import type { Ponto } from "./PontoDados";
import { classificarDia } from "@/lib/esocial/ponto-mes";
import { hoje } from "@/lib/esocial/rh";

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
export const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const titulo = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b(i{1,3}|iv)$/, (m) => m.toUpperCase()) : "");
const iniciais = (s: string) => s.split(/\s+/).filter((p) => p && !MINUSCULAS.has(p.toLowerCase())).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
export const CORES_CASAS = ["#c9a463", "#7fa7c9", "#8cbf9a", "#b49ad6", "#d99a7c", "#7fc1bd", "#c98fa8"];
const NA_EQUIPE: Situacao[] = ["trabalhando", "experiencia", "afastado", "ferias", "aguardando", "sem_registro"];
const COR_SITUACAO: Record<Situacao, string> = {
  trabalhando: "var(--rp-ok)", experiencia: "var(--rp-amber)", ferias: "var(--rp-azul)", afastado: "var(--rp-roxo)",
  aguardando: "var(--line-strong)", saiu_ponto: "var(--rp-ruim)", saiu: "var(--line-strong)", sem_registro: "var(--muted)",
};
const FICHA = [["salário", "salário"], ["pagamento", "pagamento"], ["leitura do eSocial", "leitura"], ["cadastro no ponto", "ponto"]] as const;

// Local de cada pessoa (mesma regra de Folha e salários) e as casas na ordem de tamanho
export const localDe = (p: Pessoa, empresas: EmpresaRH[]) =>
  localDaUnidadeRH(p.unidade) || nomeCurto(empresas.find((e) => e.id === p.empresa_id)?.nome ?? "") || "Sem local";
function casasDe(pessoas: Pessoa[], empresas: EmpresaRH[]) {
  const m = new Map<string, Pessoa[]>();
  for (const p of pessoas.filter((x) => NA_EQUIPE.includes(x.situacao))) {
    const l = localDe(p, empresas);
    m.set(l, [...(m.get(l) ?? []), p]);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([nome, ps], i) => ({ nome, pessoas: ps, cor: CORES_CASAS[i % CORES_CASAS.length] }));
}

// =====================================================================
// Privacidade: CPF e Valores juntos, no mesmo canto (pedido do dono)
// =====================================================================
function Interruptor({ ligado, onClick, rotulo, icone }: { ligado: boolean; onClick: () => void; rotulo: string; icone: "olho" | "real" }) {
  return (
    <button type="button" className={`fs-tg ${ligado ? "on" : ""}`} onClick={onClick} aria-pressed={ligado} title={ligado ? `Esconder ${rotulo}` : `Mostrar ${rotulo}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {icone === "olho" ? <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
          : <path d="M12 2v20M17 6.5a4 4 0 0 0-4-2.5H11a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5" />}
      </svg>
      {rotulo}<i className="fs-sw" aria-hidden="true" />
    </button>
  );
}
export function Privacidade({ verCpf, onCpf, verValores, onValores }: { verCpf: boolean; onCpf: () => void; verValores: boolean; onValores: () => void }) {
  return (
    <div className="fs-priv rp-priv" role="group" aria-label="Privacidade">
      <span className="fs-priv-rot">Privacidade</span>
      <Interruptor ligado={verCpf} onClick={onCpf} rotulo="CPF" icone="olho" />
      <Interruptor ligado={verValores} onClick={onValores} rotulo="Valores" icone="real" />
    </div>
  );
}

// =====================================================================
// Painel
// =====================================================================
const COR_ESTADO = { ok: "var(--rp-ok)", atencao: "var(--rp-amber)", erro: "var(--rp-ruim)" } as const;

export function PainelRH({ pessoas, empresas, numeros, alertas, emExperiencia, calendario, movimentacoes, saude, comSalario, comLiquido, ponto,
  rotatividadeNota, primeiros, onAlerta, onPessoa, onIr, onCasa }: {
  pessoas: Pessoa[]; empresas: EmpresaRH[];
  numeros: { ativos: number; entraram: number; sairam: number; ferias: number; afastados: number; rotatividade: number | null };
  alertas: Alerta[]; emExperiencia: Pessoa[]; calendario: ItemCalendario[]; movimentacoes: Movimentacao[]; saude: SaudeRH | null;
  comSalario: number; comLiquido: number; ponto: Ponto; rotatividadeNota: string; primeiros?: ReactNode;
  onAlerta: (a: Alerta) => void; onPessoa: (chave: string) => void; onIr: (secao: "pessoas" | "horas" | "folha" | "dados", visao?: string) => void; onCasa: (casa: string) => void;
}) {
  const [todosAlertas, setTodosAlertas] = useState(false);
  const casas = useMemo(() => casasDe(pessoas, empresas), [pessoas, empresas]);
  const total = casas.reduce((t, c) => t + c.pessoas.length, 0);

  // Saúde dos dados: ponto, eSocial (a pior empresa) e fichas
  const sPonto = saude ? estadoPonto(saude) : null;
  const sEs = saude ? saude.esocial.map((e) => estadoEsocial(e, saude.agora)) : [];
  const piorEs = sEs.find((x) => x.estado === "erro") ?? sEs.find((x) => x.estado === "atencao") ?? sEs[0] ?? null;
  const ultimaEs = saude?.esocial.map((e) => e.ultima_resposta).filter(Boolean).sort().at(-1) ?? null;
  const fichas = comSalario >= numeros.ativos * 0.95 ? "ok" : comSalario >= numeros.ativos * 0.8 ? "atencao" : "erro";

  // Hoje no ponto, por casa, pela mesma regra do Ponto do mês (relógio × escala do Brasico; lib/esocial/ponto-mes.ts):
  // bateu ponto, tinha de trabalhar e ainda não bateu, e quem passou 10 min da entrada sem bater (atrasado)
  const { vistas, planejada, afastamentosDe, relogio } = ponto;
  const pontoCasas = useMemo(() => {
    const agora = hoje();
    const [h, mi] = relogio.split(":").map(Number);
    const m = new Map<string, { trab: number; atr: number; escala: number }>();
    for (const l of vistas) {
      if (l.afastado || l.setor === "Afastados") continue;
      const d = classificarDia(agora, agora, l.dias.get(agora), planejada.get(`${l.p.cliente_id}:${l.p.id}:${agora}`), afastamentosDe.get(l.k) ?? [], true);
      const c = m.get(l.local || "Sem local") ?? { trab: 0, atr: 0, escala: 0 };
      if (d.tipo === "trab" || d.tipo === "atr") { c.trab++; c.escala++; }
      else if (d.tipo === "hoje") {
        c.escala++;
        const e = d.previsto.match(/^(\d{2}):(\d{2})/);
        if (e && h * 60 + mi >= Number(e[1]) * 60 + Number(e[2]) + 10) c.atr++;
      }
      m.set(l.local || "Sem local", c);
    }
    return [...m.entries()].filter(([, c]) => c.escala > 0).sort((a, b) => b[1].escala - a[1].escala);
  }, [vistas, planejada, afastamentosDe, relogio]);
  const bateram = pontoCasas.reduce((t, [, c]) => t + c.trab, 0), comEscala = pontoCasas.reduce((t, [, c]) => t + c.escala, 0);
  const prazos = calendario.filter((c) => c.estado !== "feito").slice(0, 4);
  const mostrados = todosAlertas ? alertas : alertas.slice(0, 5);

  return (
    <div className="rp">
      {primeiros}
      <div className="rp-hero">
        <section className="fs-card rp-equipe">
          <span className="fs-eyebrow">Na equipe hoje</span>
          <button type="button" className="rp-grande" onClick={() => onIr("pessoas", "lista")}>{numeros.ativos} <small>pessoa{numeros.ativos === 1 ? "" : "s"}</small></button>
          <span className="muted">Em {nomeMes(hoje().slice(0, 7)).split("/")[0]}: {numeros.entraram ? `${numeros.entraram} entrada${numeros.entraram === 1 ? "" : "s"}` : "nenhuma entrada"} · {numeros.sairam ? `${numeros.sairam} saída${numeros.sairam === 1 ? "" : "s"}` : "nenhuma saída"}</span>
          <div className="fs-sub">
            <button type="button" onClick={() => onIr("pessoas", "ausencias")}><b>{numeros.ferias + numeros.afastados}</b><small>fora hoje ({numeros.ferias} férias · {numeros.afastados} afastados)</small></button>
            <button type="button" onClick={() => onIr("pessoas", "experiencia")}><b>{emExperiencia.length}</b><small>{emExperiencia[0] ? `em experiência · próximo acaba ${dataBR(emExperiencia[0].fimContrato)}` : "em experiência"}</small></button>
            <div><b>{numeros.rotatividade == null ? "—" : `${numeros.rotatividade}%`}</b><small>rotatividade em 12 meses{rotatividadeNota ? ` · ${rotatividadeNota}` : ""}</small></div>
          </div>
          <div className="fs-pilha" aria-hidden="true">{casas.map((c) => <i key={c.nome} style={{ flex: c.pessoas.length, background: c.cor }} />)}</div>
          <div className="fs-legenda">
            {casas.map((c) => (
              <button key={c.nome} type="button" onClick={() => onCasa(c.nome)} title={`Ver a equipe de ${c.nome}`}>
                <i style={{ background: c.cor }} />{c.nome}<b>{c.pessoas.length}</b>
              </button>
            ))}
          </div>
          {total < numeros.ativos && <small className="muted">{numeros.ativos - total} sem casa definida</small>}
        </section>

        <section className="fs-card rp-atencao">
          <div className="rp-cab"><h3>Precisa de atenção</h3><span className="muted">{alertas.length || ""}</span></div>
          {alertas.length === 0 ? (
            <p className="rp-tudo-certo">✓ Nada pendente. Olhamos contratos de experiência, afastamentos, prazos de admissão e desligamento, fechamento da folha e certificados.</p>
          ) : (
            <ul className="rp-alertas">
              {mostrados.map((a, i) => (
                <li key={i} className={`rp-alerta ${a.nivel}`}>
                  <span className="rp-alerta-ic" aria-hidden="true">{a.nivel === "info" ? "i" : "!"}</span>
                  <div><b>{a.texto}</b><small>{a.detalhe}</small></div>
                  {(a.pessoa || a.acao) && <button type="button" className="ghost small" onClick={() => onAlerta(a)}>{a.pessoa ? "Ver ficha" : a.acao === "leitura" ? "Ligar" : a.acao === "certificado" ? "Certificados" : "Ver"}</button>}
                </li>
              ))}
            </ul>
          )}
          {alertas.length > 5 && <button type="button" className="ghost small rp-mais" onClick={() => setTodosAlertas((v) => !v)}>{todosAlertas ? "Mostrar menos" : `Ver todos os ${alertas.length}`}</button>}
        </section>
      </div>

      <div className="rp-saude">
        <button type="button" className="rp-fonte" onClick={() => onIr("horas")}>
          <i style={{ background: sPonto ? COR_ESTADO[sPonto.estado] : "var(--line-strong)" }} />
          <span><b>Ponto (RHiD)</b><small>{sPonto ? `${sPonto.texto} · ${ponto.vistas.length} no relógio` : "lendo…"}</small></span>
        </button>
        <button type="button" className="rp-fonte" onClick={() => onIr("dados")}>
          <i style={{ background: piorEs ? COR_ESTADO[piorEs.estado] : "var(--line-strong)" }} />
          <span><b>eSocial</b><small>{piorEs && piorEs.estado !== "ok" ? piorEs.texto : `última leitura ${saude ? quando(ultimaEs, saude.agora) : "—"} · ${saude?.esocial.length ?? 0} empresas`}</small></span>
        </button>
        <button type="button" className="rp-fonte" onClick={() => onIr("folha")}>
          <i style={{ background: COR_ESTADO[fichas] }} />
          <span><b>Fichas</b><small>{comSalario} de {numeros.ativos} com salário · {comLiquido} com pagamento</small></span>
        </button>
      </div>

      <div className="rp-tres">
        <section className="fs-card">
          <div className="rp-cab"><h3>Hoje no ponto</h3><button type="button" className="rp-link" onClick={() => onIr("horas")}>{bateram} de {comEscala} bateram →</button></div>
          {pontoCasas.length === 0 ? <p className="muted">{ponto.carregado ? "Ninguém com escala agora." : "Lendo o relógio…"}</p> : (
            <div className="rp-barras">
              {pontoCasas.map(([nome, c]) => (
                <div key={nome} className="rp-barra">
                  <span>{nome}</span>
                  <span className="rp-trilho"><i style={{ width: `${(c.trab / c.escala) * 100}%`, background: "var(--rp-ok)" }} /><i style={{ width: `${(c.atr / c.escala) * 100}%`, background: "var(--rp-amber)" }} /></span>
                  <small>{c.trab}/{c.escala}</small>
                </div>
              ))}
              <small className="muted rp-leg"><i style={{ background: "var(--rp-ok)" }} />bateram ponto <i style={{ background: "var(--rp-amber)" }} />atrasados (sem batida 10 min depois da entrada) · cruzado com a escala do Brasico</small>
            </div>
          )}
        </section>
        <section className="fs-card">
          <div className="rp-cab"><h3>Próximos prazos</h3><button type="button" className="rp-link" onClick={() => onIr("folha")}>ver o mês →</button></div>
          {prazos.length === 0 ? <p className="muted">Nada pendente neste mês.</p> : (
            <ul className="rp-prazos">
              {prazos.map((c, i) => (
                <li key={i} className={c.estado}>
                  <span className="rp-dia"><b>{String(c.dia).padStart(2, "0")}</b><small>{nomeMes(c.data.slice(0, 7)).slice(0, 3)}</small></span>
                  <span><b>{c.titulo}</b><small>{c.detalhe}</small></span>
                  {c.estado === "atrasado" && <em className="rp-ruim">atrasado</em>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="fs-card">
          <div className="rp-cab"><h3>Entradas e saídas</h3><button type="button" className="rp-link" onClick={() => onIr("pessoas", "movimentos")}>3 meses →</button></div>
          {movimentacoes.length === 0 ? <p className="muted">Nenhuma admissão ou saída lida nos últimos 3 meses.</p> : (
            <ul className="rp-movs">
              {movimentacoes.slice(0, 6).map((m, i) => (
                <li key={i}><button type="button" onClick={() => onPessoa(m.pessoa.chave)}>
                  <i style={{ background: m.tipo === "entrada" ? "var(--rp-ok)" : "var(--rp-ruim)" }} />
                  <span><b>{nomeProprio(m.pessoa.nome)}</b><small>{m.texto}</small></span>
                  <em>{m.tipo === "entrada" ? "entrou" : "saiu"} {dataBR(m.quando).slice(0, 5)}</em>
                </button></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// =====================================================================
// Equipe (aba Pessoas, visão Lista)
// =====================================================================
export const FILTROS = ["Na equipe", "Em experiência", "Afastados", "Saíram do ponto", "Saíram", "Todos"] as const;
export type Filtro = (typeof FILTROS)[number];
export const NO_FILTRO: Record<Filtro, (s: Situacao) => boolean> = {
  "Na equipe": (s) => NA_EQUIPE.includes(s), "Em experiência": (s) => s === "experiencia", Afastados: (s) => s === "afastado" || s === "ferias",
  "Saíram do ponto": (s) => s === "saiu_ponto", Saíram: (s) => s === "saiu", Todos: () => true,
};
const FICHAS = ["Todas", "Ficha completa", "Falta algo"] as const;

export function EquipeRH({ pessoas, empresas, verCpf, casa, onCasa, filtro, onFiltro, onPessoa, vazio }: {
  pessoas: Pessoa[]; empresas: EmpresaRH[]; verCpf: boolean; casa: string; onCasa: (c: string) => void;
  filtro: Filtro; onFiltro: (f: Filtro) => void; onPessoa: (chave: string) => void; vazio?: ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const [ficha, setFicha] = useState<(typeof FICHAS)[number]>("Todas");
  const casas = useMemo(() => casasDe(pessoas, empresas), [pessoas, empresas]);
  const corDe = (nome: string) => casas.find((c) => c.nome === nome)?.cor ?? "var(--line-strong)";
  const termo = busca.trim().toLowerCase();
  const daCasa = pessoas.filter((p) => !casa || localDe(p, empresas) === casa);
  const vistas = daCasa.filter((p) => NO_FILTRO[filtro](p.situacao))
    .filter((p) => ficha === "Todas" || (ficha === "Ficha completa") === (p.faltando.length === 0))
    .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || p.cargo.toLowerCase().includes(termo) || (termo.replace(/\D/g, "") && p.cpf.includes(termo.replace(/\D/g, ""))));
  const grupos = [...new Set(vistas.map((p) => localDe(p, empresas)))]
    .sort((a, b) => { const ia = casas.findIndex((c) => c.nome === a), ib = casas.findIndex((c) => c.nome === b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
  const ordem: Record<Situacao, number> = { experiencia: 0, trabalhando: 1, aguardando: 2, ferias: 3, afastado: 4, sem_registro: 5, saiu_ponto: 6, saiu: 7 };
  const varias = empresas.length > 1;

  if (!pessoas.length) return <>{vazio}</>;
  return (
    <div className="rp">
      <div className="fs-casas">
        {casas.map((c, i) => {
          const n = (s: Situacao) => c.pessoas.filter((p) => p.situacao === s).length;
          const completas = c.pessoas.filter((p) => p.faltando.length === 0).length;
          return (
            <button key={c.nome} type="button" className={`fs-casa ${casa === c.nome ? "on" : ""}`} style={{ ["--c" as string]: c.cor, animationDelay: `${i * 50}ms` }}
              onClick={() => onCasa(casa === c.nome ? "" : c.nome)} aria-pressed={casa === c.nome}>
              <span className="fs-casa-cab"><b>{c.nome}</b><span>{c.pessoas.length} pessoa{c.pessoas.length === 1 ? "" : "s"}</span></span>
              <strong>{n("trabalhando") + n("experiencia")} <small className="rp-casa-sub">trabalhando</small></strong>
              <span className="rp-mix" aria-hidden="true">
                {(["trabalhando", "experiencia", "ferias", "afastado", "aguardando", "sem_registro"] as Situacao[]).map((s) => n(s) ? <i key={s} style={{ flex: n(s), background: COR_SITUACAO[s] }} /> : null)}
              </span>
              <small>{[n("experiencia") && `${n("experiencia")} em experiência`, (n("ferias") + n("afastado")) && `${n("ferias") + n("afastado")} fora`, `ficha ${Math.round((completas / c.pessoas.length) * 100)}%`].filter(Boolean).join(" · ")}</small>
            </button>
          );
        })}
      </div>

      <section className="fs-card fs-lista">
        <div className="fs-lista-cab">
          <h3>Equipe</h3>
          <div className="fs-chips" role="group" aria-label="Situação">
            {FILTROS.map((f) => {
              const n = daCasa.filter((p) => NO_FILTRO[f](p.situacao)).length;
              return <button key={f} type="button" className={filtro === f ? "on" : ""} onClick={() => onFiltro(f)}>{f} <span className="rp-n">{n}</span></button>;
            })}
          </div>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, cargo ou CPF" aria-label="Buscar na equipe" />
        </div>
        <div className="rp-subfiltros">
          <div className="fs-chips" role="group" aria-label="Casa">
            <button type="button" className={casa === "" ? "on" : ""} onClick={() => onCasa("")}>Todas as casas</button>
            {casas.map((c) => <button key={c.nome} type="button" className={casa === c.nome ? "on" : ""} onClick={() => onCasa(c.nome)}>{c.nome}</button>)}
          </div>
          <div className="fs-chips" role="group" aria-label="Ficha">
            {FICHAS.map((f) => <button key={f} type="button" className={ficha === f ? "on" : ""} onClick={() => setFicha(f)}>{f}</button>)}
          </div>
        </div>
        {vistas.length === 0 ? <p className="muted fs-nada">Ninguém neste filtro.</p> : (
          <>
            <div className="rp-row rp-row-cab" aria-hidden="true"><span /><span>Pessoa</span><span>Cargo</span><span>Admissão</span><span>Ficha</span><span>Situação</span></div>
            {grupos.map((g) => {
              const ps = vistas.filter((p) => localDe(p, empresas) === g)
                .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.nome.localeCompare(b.nome, "pt-BR"));
              const trab = ps.filter((p) => p.situacao === "trabalhando").length, exp = ps.filter((p) => p.situacao === "experiencia").length;
              return (
                <div key={g}>
                  <div className="fs-grupo-cab"><span><i style={{ background: corDe(g) }} />{g} · {ps.length}</span>
                    <span>{[trab && `${trab} trabalhando`, exp && `${exp} em experiência`].filter(Boolean).join(" · ")}</span></div>
                  {ps.map((p) => (
                    <button key={p.chave} type="button" className="rp-row" onClick={() => onPessoa(p.chave)} title="Abrir a ficha">
                      <span className="fs-av" style={{ color: corDe(g) }}>{iniciais(p.nome || "?")}</span>
                      <span className="fs-nm"><b>{p.nome ? nomeProprio(p.nome) : "Nome ainda não lido"}{p.alertas.length > 0 && <em className="rp-alerta-mini" title={p.alertas[0].texto}>!</em>}</b>
                        <small>{p.situacao === "sem_registro" ? ["na escala do Brasico", p.setorEscala].filter(Boolean).join(" · ") : [cpfVisivel(p.cpf, verCpf), varias ? nomeCurto(empresas.find((e) => e.id === p.empresa_id)?.nome ?? "") : ""].filter(Boolean).join(" · ")}</small></span>
                      <span className="fs-cargo">{titulo(p.cargo) || "—"}</span>
                      <span className="rp-adm">{p.dtAdm ? <>{dataBR(p.dtAdm)}<small>{tempoDeCasa(p.dtAdm, p.dtDeslig ?? undefined)}{p.dtDeslig ? ` · saiu ${dataBR(p.dtDeslig)}` : ""}</small></> : <span className="muted">—</span>}</span>
                      <span className="rp-ficha" title={p.faltando.length ? `Falta: ${p.faltando.join(", ")}` : "Ficha completa"}>
                        {p.situacao === "saiu" ? <small className="muted">—</small> : <>
                          <span className="rp-ficha-barras">{FICHA.map(([k, r]) => <i key={k} className={p.faltando.includes(k) ? "" : "on"} title={`${r}: ${p.faltando.includes(k) ? "falta" : "ok"}`} />)}</span>
                          <small className={p.faltando.length ? "rp-amber" : "rp-ok"}>{p.situacao === "sem_registro" ? "sem registro no eSocial" : p.faltando.length ? `falta ${p.faltando.map((f) => FICHA.find(([k]) => k === f)?.[1] ?? f).join(", ")}` : "completa"}</small>
                        </>}
                      </span>
                      <span><span className={`rp-selo ${p.situacao}`}>{ROTULO_SITUACAO[p.situacao]}</span></span>
                    </button>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
