"use client";

// Grade de escala do RH, na largura toda da página: uma linha por pessoa e uma coluna por dia, no mesmo
// visual das escalas dos projetos (:::escala, lib/markdown.ts). O horário vem da apuração do RHiD
// (escala contratual do dia). Três visões: semana (células grandes, com o batido), 2 semanas e mês.
// O cabeçalho dos dias e a coluna dos nomes ficam presos ao rolar. Pessoas agrupadas por local
// (restaurante/pousada), que abre e fecha e mostra quantos trabalham em cada dia, e por setor.
// Ao passar o mouse (ou tocar), o balão mostra o PREVISTO e o que foi BATIDO de fato.
import { useEffect, useRef, useState } from "react";
import { tipoPorEntrada, type TipoTurno } from "@/lib/markdown";
import { TEXTOS } from "@/lib/idioma";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";

export type BatidaEscala = { hora: string; tipo?: string; origem?: string; classificacao?: string; justificada?: boolean };
export type DiaEscala = {
  dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; minutos_abono?: number; alerta?: string; batidas: BatidaEscala[];
};
export type PessoaEscala = {
  chave: string; nome: string; cargo?: string; local: string; setor: string; dias: Map<string, DiaEscala>;
  // Chave da ficha no RH (quando diferente da chave da linha)
  ficha?: string;
  // Situação de hoje (bolinha ao lado do nome)
  hoje?: { texto: string; classe: string };
};

type Turno = { tipo: TipoTurno; linhas: string[]; horario: string; intervalo: string; trabalha: boolean };
type Dica = {
  x: number; y: number; acima: boolean; quem: string; dia: string; previsto: string; intervalo: string; turno: string;
  batidas: BatidaEscala[]; situacao: string; classe: string; alerta: string; futuro: boolean;
};
export type Visao = "semana" | "quinzena" | "mes";
const VISOES: [Visao, string][] = [["semana", "Semana"], ["quinzena", "2 semanas"], ["mes", "Mês"]];
const dois = (n: number) => String(n).padStart(2, "0");
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ORDEM: TipoTurno[] = ["abertura", "manha", "inter", "tarde", "noite", "dia", "partido", "plantao", "folga", "descanso"];
// Até onde dá para andar: o RHiD guarda 1 ano para trás e a apuração traz a escala de 5 semanas à frente
const VOLTA_DIAS = 370;
const FRENTE_DIAS = 34;

// "07:00-12:00\r\n13:00-15:20" → entrada 07:00, saída 15:20, intervalo 12:00–13:00
function lerHorario(d: DiaEscala | undefined): Turno {
  const vazio = { horario: "", intervalo: "", trabalha: false };
  if (!d) return { tipo: "descanso", linhas: ["·"], ...vazio, horario: "Sem leitura" };
  if (d.folga) return { tipo: "folga", linhas: ["F"], ...vazio, horario: "Folga" };
  const faixas = d.horario.split(/\r?\n|\s*\/\s*/).map((f) => f.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)).filter(Boolean) as RegExpMatchArray[];
  // Dia lido sem horário contratual: é a folga da escala (o RHiD só marca `folga` em casos especiais)
  if (!faixas.length) {
    if (d.feriado) return { tipo: "descanso", linhas: ["Fer"], ...vazio, horario: "Feriado" };
    return { tipo: "folga", linhas: ["F"], ...vazio, horario: "Folga" };
  }
  const h = faixas.map((m) => ({ a: Number(m[1]) + Number(m[2]) / 60, b: Number(m[3]) + Number(m[4]) / 60, ta: `${dois(Number(m[1]))}:${m[2]}`, tb: `${dois(Number(m[3]))}:${m[4]}` }));
  const entrada = h[0];
  const saida = h[h.length - 1];
  const intervalo = h.length > 1 ? `${h[0].tb}–${h[1].ta}` : "";
  return {
    tipo: tipoPorEntrada(Math.floor(entrada.a), Math.floor(saida.b)), trabalha: true, intervalo,
    linhas: [entrada.ta, saida.tb], horario: `${entrada.ta}–${saida.tb}`,
  };
}

// Segunda-feira da semana de um dia (YYYY-MM-DD)
function segunda(d: string) {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return somarDias(d, -((dow + 6) % 7));
}
const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const somarMeses = (d: string, n: number) => {
  const [a, m] = d.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
};
// Os dias que a visão mostra a partir de um dia de referência
function diasDoPeriodo(visao: Visao, ref: string) {
  if (visao === "mes") {
    const ini = `${ref.slice(0, 7)}-01`;
    const n = new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => somarDias(ini, i));
  }
  const ini = segunda(ref);
  return Array.from({ length: visao === "semana" ? 7 : 14 }, (_, i) => somarDias(ini, i));
}
const passo = (visao: Visao, ref: string, n: number) => (visao === "mes" ? somarMeses(ref, n) : somarDias(ref, 7 * n));
function tituloPeriodo(visao: Visao, dias: string[]) {
  const [a, b] = [dias[0], dias[dias.length - 1]];
  if (visao === "mes") return `${MESES[Number(a.slice(5, 7)) - 1]} de ${a.slice(0, 4)}`;
  const d = (x: string) => `${Number(x.slice(8, 10))} de ${MESES_CURTOS[Number(x.slice(5, 7)) - 1]}`;
  return `${d(a)} a ${d(b)}${a.slice(0, 4) !== hoje().slice(0, 4) || b.slice(0, 4) !== a.slice(0, 4) ? ` de ${b.slice(0, 4)}` : ""}`;
}
// Nome que cabe na coluna: "Maria Eduarda Trajano do Nascimento" → "Maria E. T. Nascimento"; se ainda
// for longo, "Maria Nascimento". O nome completo aparece ao passar o mouse.
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e"]);
export function nomeCurto(nome: string, max = 22) {
  const partes = nome.trim().split(/\s+/).filter((p) => !LIGACOES.has(p.toLowerCase()));
  if (nome.length <= max || partes.length <= 2) return nome;
  const [primeiro, ...resto] = partes;
  const ultimo = resto.pop()!;
  const meio = `${primeiro} ${resto.map((p) => `${p[0].toUpperCase()}.`).join(" ")} ${ultimo}`;
  return meio.length <= max ? meio : `${primeiro} ${ultimo}`;
}
// Ordem da grade: locais em ordem alfabética ("Sem local" por último), setores em ordem alfabética
// ("Sem setor" por último) e, dentro do setor, as pessoas na ordem em que chegam (a ordem escolhida à mão).
// O modo Organizar usa a mesma ordem para saber quem está acima e abaixo de cada pessoa.
const SEM_LOCAL = "Sem local";
const localDe = (p: PessoaEscala) => p.local || SEM_LOCAL;
const locaisDe = (ps: PessoaEscala[]) => [...new Set(ps.map(localDe))].sort((a, b) => (a === SEM_LOCAL ? 1 : b === SEM_LOCAL ? -1 : a.localeCompare(b)));
const setoresDe = (ps: PessoaEscala[]) => [...new Set(ps.map((p) => p.setor))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
export function ordemDaGrade(ps: PessoaEscala[]) {
  return locaisDe(ps).flatMap((l) => {
    const doLocal = ps.filter((p) => localDe(p) === l);
    return setoresDe(doLocal).flatMap((s) => doLocal.filter((p) => p.setor === s));
  });
}
// Origem "O" = batida original do relógio; "I" = incluída/alterada no RHiD (justificativa, ajuste do gestor)
const ajustada = (b: BatidaEscala) => !!b.justificada || b.classificacao === "J" || b.origem === "I";

// O que aconteceu num dia já passado (ou em andamento)
function situacaoDo(d: DiaEscala | undefined, t: Turno, dia: string, agora: string) {
  if (!d || !t.trabalha) return { classe: "", texto: "" };
  if (dia > agora) return { classe: "", texto: "" };
  const bateu = d.batidas.length > 0 || d.minutos_trabalhados > 0;
  if (dia === agora) return bateu ? { classe: "m-ok", texto: d.batidas.length % 2 ? "Trabalhando agora" : "Já saiu" } : { classe: "", texto: "Ainda sem batida" };
  if (d.falta && !d.justificado) return { classe: "m-falta", texto: "Falta" };
  if (d.falta && d.justificado) return { classe: "m-just", texto: "Falta justificada" };
  if (d.minutos_atraso >= 10) return { classe: "m-atraso", texto: `Atraso de ${d.minutos_atraso} min` };
  if (bateu) return { classe: "m-ok", texto: d.batidas.some(ajustada) ? "Trabalhou · com ajuste" : "Trabalhou" };
  return { classe: "m-sem", texto: "Sem batida" };
}

function lerLocal(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function gravarLocal(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

export default function PontoEscala({ pessoas, onAbrir, garantir, extra, organizar = false, onMover }: {
  pessoas: PessoaEscala[]; onAbrir?: (chave: string) => void; garantir?: (de: string, ate: string) => void;
  // Modo Organizar: ▲ ▼ ao lado de cada nome
  organizar?: boolean; onMover?: (chave: string, direcao: -1 | 1) => void;
  // Botões a mais na barra da escala (ex.: Atualizar)
  extra?: React.ReactNode;
}) {
  const agora = hoje();
  const [visao, setVisao] = useState<Visao>("quinzena");
  const [ref, setRef] = useState(agora);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [dica, setDica] = useState<Dica | null>(null);
  const ativo = useRef<HTMLElement | null>(null);
  const dias = diasDoPeriodo(visao, ref);
  const podeVoltar = dias[0] > somarDias(agora, -VOLTA_DIAS);
  const podeAvancar = diasDoPeriodo(visao, passo(visao, ref, 1))[0] <= somarDias(agora, FRENTE_DIAS);
  const T = TEXTOS.pt;

  useEffect(() => {
    const v = lerLocal("brasico-escala-visao");
    if (v === "semana" || v === "quinzena" || v === "mes") setVisao(v);
  }, []);
  function escolherVisao(v: Visao) {
    setVisao(v);
    gravarLocal("brasico-escala-visao", v);
  }
  // Dias fora do que já foi lido do banco: pede o trecho
  const de = dias[0], ate = dias[dias.length - 1];
  useEffect(() => {
    garantir?.(de, ate);
  }, [garantir, de, ate]);

  // Balão: fecha ao rolar ou redimensionar
  useEffect(() => {
    const limpar = () => {
      ativo.current?.classList.remove("esc-ativo");
      ativo.current = null;
      setDica(null);
    };
    window.addEventListener("scroll", limpar, true);
    window.addEventListener("resize", limpar);
    return () => {
      window.removeEventListener("scroll", limpar, true);
      window.removeEventListener("resize", limpar);
    };
  }, []);

  const usados = new Map<TipoTurno, Set<number>>();
  const turnosDe = new Map<string, Turno[]>();
  for (const p of pessoas) {
    turnosDe.set(p.chave, dias.map((d) => {
      const t = lerHorario(p.dias.get(d));
      if (!usados.has(t.tipo)) usados.set(t.tipo, new Set());
      if (t.trabalha) usados.get(t.tipo)!.add(parseInt(t.linhas[0], 10));
      return t;
    }));
  }
  const contar = (ps: PessoaEscala[]) => dias.map((_, i) => ps.filter((p) => turnosDe.get(p.chave)![i].trabalha).length);
  const trabalhando = contar(pessoas);
  const min = Math.min(...trabalhando, Infinity);
  const max = Math.max(...trabalhando, -Infinity);
  const corte = min + (max - min) * 0.25;

  const locais = locaisDe(pessoas);
  const primeira = ordemDaGrade(pessoas)[0]?.chave;
  const ultima = ordemDaGrade(pessoas).at(-1)?.chave;
  const alternar = (local: string) => setFechados((s) => {
    const n = new Set(s);
    if (n.has(local)) n.delete(local);
    else n.add(local);
    return n;
  });

  function mostrar(td: HTMLElement, p: PessoaEscala, dia: string, t: Turno) {
    const d = p.dias.get(dia);
    ativo.current?.classList.remove("esc-ativo");
    ativo.current = td;
    td.classList.add("esc-ativo");
    const r = td.getBoundingClientRect();
    const acima = r.top > 220;
    const sit = situacaoDo(d, t, dia, agora);
    setDica({
      x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: acima ? r.top - 10 : r.bottom + 10, acima,
      quem: p.nome, dia: `${DIAS_SEMANA[diaSemana(dia)]} ${dataBR(dia)}`,
      previsto: t.horario, intervalo: t.intervalo, turno: t.trabalha ? T.turnos[t.tipo] : "",
      // Hoje o RHiD ainda marca "Falta" enquanto o dia não fecha: com batida, o alerta do dia não vale
      batidas: d?.batidas ?? [], situacao: sit.texto, classe: sit.classe, alerta: dia === agora && d?.batidas.length ? "" : d?.alerta ?? "", futuro: dia > agora,
    });
  }
  function esconder() {
    ativo.current?.classList.remove("esc-ativo");
    ativo.current = null;
    setDica(null);
  }

  const colunas = dias.length + 3;
  const contem = dias.includes(agora);
  return (
    <div className="pt-escala" data-visao={visao} onMouseLeave={esconder}>
      <div className="pe-barra">
        <div className="pe-periodo">
          <button className="pe-seta" onClick={() => setRef(passo(visao, ref, -1))} disabled={!podeVoltar} aria-label="Período anterior">‹</button>
          <h3>{tituloPeriodo(visao, dias)}</h3>
          <button className="pe-seta" onClick={() => setRef(passo(visao, ref, 1))} disabled={!podeAvancar} aria-label="Próximo período">›</button>
          {!contem && <button className="ghost small" onClick={() => setRef(agora)}>Hoje</button>}
        </div>
        <div className="pe-barra-dir">
          <div className="pe-visoes" role="tablist" aria-label="Visão da escala">
            {VISOES.map(([v, r]) => (
              <button key={v} role="tab" aria-selected={visao === v} className={visao === v ? "on" : ""} onClick={() => escolherVisao(v)}>{r}</button>
            ))}
          </div>
          {extra}
        </div>
      </div>

      <div className="pe-quadro" style={{ "--dias": dias.length } as React.CSSProperties}>
        <table className="pe-grade">
          <colgroup>
            <col className="pe-col-nome" />
            {dias.map((d) => <col key={d} />)}
            <col className="pe-col-tot" /><col className="pe-col-tot" />
          </colgroup>
          <thead>
            <tr>
              <th className="pe-nome">{pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}</th>
              {dias.map((d) => {
                const dow = diaSemana(d);
                return (
                  <th key={d} className={`pe-dia${dow === 0 ? " dom" : ""}${dow === 1 ? " seg" : ""}${d === agora ? " hoje" : ""}${d < agora ? " passado" : ""}`}>
                    <span>{visao === "mes" ? DIAS_SEMANA[dow].slice(0, 1) : DIAS_SEMANA[dow]}</span><b>{Number(d.slice(8, 10))}</b>
                  </th>
                );
              })}
              <th className="pe-tot" title="Dias de trabalho no período">Dias</th><th className="pe-tot" title="Folgas no período">Folgas</th>
            </tr>
          </thead>
          {locais.map((local) => {
            const doLocal = pessoas.filter((p) => (p.local || "Sem local") === local);
            const fechado = !organizar && fechados.has(local);
            const porDia = contar(doLocal);
            return (
              <tbody key={local} className={fechado ? "fechado" : ""}>
                <tr className="pe-local">
                  <th className="pe-nome" scope="rowgroup">
                    <button onClick={() => alternar(local)} aria-expanded={!fechado}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={fechado ? "M9 6l6 6-6 6" : "M6 9l6 6 6-6"} /></svg>
                      {local} <span>{doLocal.length}</span>
                    </button>
                  </th>
                  {porDia.map((v, i) => (
                    <td key={dias[i]} className={`pe-conta${diaSemana(dias[i]) === 0 ? " dom" : ""}${dias[i] === agora ? " hoje" : ""}`} title={`${v} trabalhando em ${dataBR(dias[i])}`}>{v || ""}</td>
                  ))}
                  <td className="pe-tot" /><td className="pe-tot" />
                </tr>
                {!fechado && setoresDe(doLocal).map((setor) => {
                  const ps = doLocal.filter((p) => p.setor === setor);
                  return (
                    <SetorLinhas key={setor || "_"} setor={setor || "Sem setor"} mostrarSetor={setoresDe(doLocal).length > 1 || !!setor}
                      pessoas={ps} dias={dias} agora={agora} visao={visao} turnosDe={turnosDe} onAbrir={onAbrir} colunas={colunas} mostrar={mostrar}
                      organizar={organizar} onMover={onMover} primeira={primeira} ultima={ultima} />
                  );
                })}
              </tbody>
            );
          })}
          {pessoas.length > 1 && (
            <tfoot>
              <tr>
                <th className="pe-nome">Trabalhando</th>
                {trabalhando.map((v, i) => (
                  <td key={dias[i]} className={`esc-c${max > min && v <= corte ? " baixo" : ""}${diaSemana(dias[i]) === 0 ? " dom" : ""}${dias[i] === agora ? " hoje" : ""}`}>{v}</td>
                ))}
                <td className="pe-tot" /><td className="pe-tot" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="pe-legenda">
        {ORDEM.filter((t) => usados.has(t) && t !== "descanso").map((t) => {
          const hs = [...(usados.get(t) ?? [])].sort((x, y) => x - y);
          return (
            <span key={t}><i className={`pe-chip t-${t}`} /><b>{T.turnos[t]}</b>
              {hs.length > 0 && t !== "partido" && t !== "dia" && <em>entra {hs.map((h) => `${dois(h)}h`).join(hs.length > 2 ? ", " : " ou ")}</em>}
            </span>
          );
        })}
        <span className="pe-legenda-sep" aria-hidden="true" />
        <span><i className="pe-marca m-ok" /><b>Trabalhou</b></span>
        <span><i className="pe-marca m-atraso" /><b>Atraso</b></span>
        <span><i className="pe-marca m-falta" /><b>Falta</b></span>
        <span><i className="pe-marca m-just" /><b>Falta justificada</b></span>
        <span><b className="pe-ajuste-ex">•</b><b>com batida ajustada</b></span>
        <span className="muted">Passe o mouse (ou toque) num dia para ver o previsto e o batido.</span>
      </div>

      {dica && (
        <div className="esc-dica pt-dica on" role="tooltip" style={{ left: dica.x, top: dica.y, transform: `translate(-50%, ${dica.acima ? "-100%" : "0"})` }}>
          <div className="esc-dica-top">{dica.quem} · {dica.dia}</div>
          <div className="pt-dica-linha">
            <span>Previsto</span>
            <b>{dica.previsto}{dica.turno ? <small> · {dica.turno}</small> : null}{dica.intervalo ? <small> · intervalo {dica.intervalo}</small> : null}</b>
          </div>
          {!dica.futuro && (
            <div className="pt-dica-linha">
              <span>Batido</span>
              <b>{dica.batidas.length ? dica.batidas.map((b, i) => (
                <em key={i} className={ajustada(b) ? "ajustada" : ""}>{b.hora}{ajustada(b) ? "*" : ""}</em>
              )) : <small>nenhuma batida</small>}</b>
            </div>
          )}
          {(dica.situacao || dica.alerta) && (
            <div className={`pt-dica-sit ${dica.classe}`}>
              {dica.situacao}{dica.alerta && dica.alerta !== dica.situacao ? ` · ${dica.alerta}` : ""}
            </div>
          )}
          {dica.batidas.some(ajustada) && <div className="pt-dica-nota">* batida incluída ou alterada por justificativa no RHiD</div>}
        </div>
      )}
    </div>
  );
}

function SetorLinhas({ setor, mostrarSetor, pessoas, dias, agora, visao, turnosDe, onAbrir, colunas, mostrar, organizar, onMover, primeira, ultima }: {
  setor: string; mostrarSetor: boolean; pessoas: PessoaEscala[]; dias: string[]; agora: string; visao: Visao; turnosDe: Map<string, Turno[]>;
  onAbrir?: (chave: string) => void; colunas: number; mostrar: (td: HTMLElement, p: PessoaEscala, dia: string, t: Turno) => void;
  organizar: boolean; onMover?: (chave: string, direcao: -1 | 1) => void; primeira?: string; ultima?: string;
}) {
  return (
    <>
      {mostrarSetor && <tr className="pe-grupo"><th className="pe-nome" colSpan={1}>{setor} <span>{pessoas.length}</span></th><td colSpan={colunas - 1} /></tr>}
      {pessoas.map((p) => {
        const ts = turnosDe.get(p.chave)!;
        const trab = ts.filter((t) => t.trabalha).length;
        const folgas = ts.filter((t) => t.tipo === "folga").length;
        return (
          <tr key={p.chave} className={organizar ? "pe-pessoa organizando" : "pe-pessoa"}>
            <th className="pe-nome" scope="row" title={[p.nome, p.cargo, p.hoje && dias.includes(agora) ? `Hoje: ${p.hoje.texto}` : ""].filter(Boolean).join("\n")}>
              {organizar && onMover ? (
                <span className="pe-mover">
                  <button onClick={() => onMover(p.chave, -1)} disabled={p.chave === primeira} aria-label={`Subir ${p.nome}`} title="Subir">▲</button>
                  <button onClick={() => onMover(p.chave, 1)} disabled={p.chave === ultima} aria-label={`Descer ${p.nome}`} title="Descer">▼</button>
                </span>
              ) : p.hoje && dias.includes(agora) && <i className={`pe-agora ${p.hoje.classe}`} aria-label={`Hoje: ${p.hoje.texto}`} />}
              {onAbrir && !organizar
                ? <button className="esc-pessoa pe-pessoa-botao" onClick={() => onAbrir(p.ficha ?? p.chave)} aria-label={p.nome}>{nomeCurto(p.nome, visao === "mes" ? 19 : 22)}</button>
                : <span className="esc-pessoa">{nomeCurto(p.nome, visao === "mes" ? 19 : 22)}</span>}
              {p.cargo && <small className="pe-cargo">{p.cargo}</small>}
            </th>
            {dias.map((d, i) => {
              const t = ts[i];
              const dd = p.dias.get(d);
              const m = situacaoDo(dd, t, d, agora);
              const dow = diaSemana(d);
              const temAjuste = !!dd?.batidas.some(ajustada);
              // Semana: horário numa linha e, embaixo, o que foi batido (ou o nome do turno, se ainda não chegou)
              const linhas = !t.trabalha ? t.linhas
                : visao === "mes" ? [t.linhas[0]]
                : visao === "semana" ? [t.horario, d <= agora && dd?.batidas.length ? dd.batidas.map((b) => b.hora).join(" · ") : TEXTOS.pt.turnos[t.tipo]]
                : t.linhas;
              return (
                <td key={d} className={`esc-c t-${t.tipo}${dow === 0 ? " dom" : ""}${dow === 1 ? " seg" : ""}${d === agora ? " hoje" : ""}${d < agora ? " passado" : ""}${m.classe ? ` ${m.classe}` : ""}${temAjuste ? " ajuste" : ""}`}
                  onMouseEnter={(e) => mostrar(e.currentTarget, p, d, t)} onClick={(e) => mostrar(e.currentTarget, p, d, t)}
                  aria-label={`${dataBR(d)}: ${t.horario}${t.intervalo ? `, intervalo ${t.intervalo}` : ""}${m.texto ? `, ${m.texto}` : ""}`}>
                  {linhas.map((x, k) => <span key={k} className={k ? "pe-sub" : ""}>{x}</span>)}
                  {m.classe && <i className={`pe-marca ${m.classe}`} aria-hidden="true" />}
                </td>
              );
            })}
            <td className="pe-tot">{trab}</td><td className="pe-tot">{folgas}</td>
          </tr>
        );
      })}
    </>
  );
}
