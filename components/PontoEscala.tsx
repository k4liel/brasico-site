"use client";

// Grade de escala do Ponto (RH): um quadradinho por pessoa e dia, no mesmo visual das escalas
// dos projetos (:::escala, lib/markdown.ts). O horário vem da apuração do RHiD (escala contratual
// do dia). Ao passar o mouse (ou tocar), o balão mostra o PREVISTO e o que foi BATIDO de fato,
// com as batidas ajustadas por justificativa marcadas. As pessoas ficam agrupadas por local
// (restaurante/pousada) e, dentro dele, por setor.
import { useEffect, useRef, useState } from "react";
import { tipoPorEntrada, type TipoTurno } from "@/lib/markdown";
import { TEXTOS } from "@/lib/idioma";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";

export type BatidaEscala = { hora: string; tipo?: string; origem?: string; justificada?: boolean };
export type DiaEscala = {
  dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; minutos_abono?: number; alerta?: string; batidas: BatidaEscala[];
};
export type PessoaEscala = { chave: string; nome: string; local: string; setor: string; dias: Map<string, DiaEscala> };

type Turno = { tipo: TipoTurno; linhas: string[]; horario: string; intervalo: string; trabalha: boolean };
type Dica = {
  x: number; y: number; acima: boolean; quem: string; dia: string; previsto: string; intervalo: string; turno: string;
  batidas: BatidaEscala[]; situacao: string; classe: string; alerta: string; futuro: boolean;
};
const dois = (n: number) => String(n).padStart(2, "0");
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ORDEM: TipoTurno[] = ["abertura", "manha", "inter", "tarde", "noite", "dia", "partido", "plantao", "folga", "descanso"];

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
const ajustada = (b: BatidaEscala) => !!b.justificada || (!!b.origem && b.origem !== "O");

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

export default function PontoEscala({ pessoas, onAbrir }: { pessoas: PessoaEscala[]; onAbrir?: (chave: string) => void }) {
  const agora = hoje();
  const [inicio, setInicio] = useState(() => segunda(agora));
  const [dica, setDica] = useState<Dica | null>(null);
  const ativo = useRef<HTMLElement | null>(null);
  const raiz = useRef<HTMLDivElement | null>(null);
  const dias = Array.from({ length: 14 }, (_, i) => somarDias(inicio, i));
  const podeVoltar = inicio > somarDias(agora, -29);
  const podeAvancar = somarDias(inicio, 7) <= agora;
  const T = TEXTOS.pt;

  // Balão: fecha ao rolar, redimensionar ou sair da grade
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
  const trabalhando = dias.map((_, i) => pessoas.filter((p) => turnosDe.get(p.chave)![i].trabalha).length);
  const min = Math.min(...trabalhando, Infinity);
  const max = Math.max(...trabalhando, -Infinity);
  const corte = min + (max - min) * 0.25;

  // Locais e, dentro de cada um, os setores (em ordem alfabética; "Sem setor" por último)
  const locais = [...new Set(pessoas.map((p) => p.local || "Sem local"))].sort();
  const setoresDe = (local: string) => [...new Set(pessoas.filter((p) => (p.local || "Sem local") === local).map((p) => p.setor))]
    .sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  function mostrar(td: HTMLElement, p: PessoaEscala, dia: string, t: Turno) {
    const d = p.dias.get(dia);
    ativo.current?.classList.remove("esc-ativo");
    ativo.current = td;
    td.classList.add("esc-ativo");
    const r = td.getBoundingClientRect();
    const acima = r.top > 200;
    const sit = situacaoDo(d, t, dia, agora);
    setDica({
      x: Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160), y: acima ? r.top - 10 : r.bottom + 10, acima,
      quem: p.nome, dia: `${DIAS_SEMANA[diaSemana(dia)]} ${dataBR(dia)}`,
      previsto: t.horario, intervalo: t.intervalo, turno: t.trabalha ? T.turnos[t.tipo] : "",
      batidas: d?.batidas ?? [], situacao: sit.texto, classe: sit.classe, alerta: d?.alerta ?? "", futuro: dia > agora,
    });
  }
  function esconder() {
    ativo.current?.classList.remove("esc-ativo");
    ativo.current = null;
    setDica(null);
  }

  return (
    <div className="pt-escala" ref={raiz} onMouseLeave={esconder}>
      <div className="pt-escala-topo">
        <div className="tv-unidades">
          <button className="botao-painel" onClick={() => setInicio(somarDias(inicio, -7))} disabled={!podeVoltar} aria-label="Semana anterior">‹</button>
          <button className="botao-painel" onClick={() => setInicio(segunda(agora))}>Esta semana</button>
          <button className="botao-painel" onClick={() => setInicio(somarDias(inicio, 7))} disabled={!podeAvancar} aria-label="Próxima semana">›</button>
        </div>
        <span className="muted">{dataBR(dias[0])} a {dataBR(dias[dias.length - 1])} · passe o mouse num dia para ver o previsto e o batido</span>
      </div>
      <div className="pe-wrap">
        <table className="pe-grade">
          <colgroup>
            <col className="pe-col-nome" />
            {dias.map((d) => <col key={d} />)}
            <col className="pe-col-tot" /><col className="pe-col-tot" />
          </colgroup>
          <thead>
            <tr>
              <th className="pe-nome">Equipe</th>
              {dias.map((d) => {
                const dow = diaSemana(d);
                return (
                  <th key={d} className={`pe-dia${dow === 0 ? " dom" : ""}${d === agora ? " hoje" : ""}`}>
                    <span>{DIAS_SEMANA[dow]}</span><b>{d.slice(8, 10)}</b>
                  </th>
                );
              })}
              <th className="pe-tot">Dias</th><th className="pe-tot">Folgas</th>
            </tr>
          </thead>
          <tbody>
            {locais.map((local) => (
              <LocalLinhas key={local} local={local} setores={setoresDe(local)} pessoas={pessoas.filter((p) => (p.local || "Sem local") === local)}
                dias={dias} agora={agora} turnosDe={turnosDe} onAbrir={onAbrir} colunas={dias.length + 3} mostrar={mostrar} />
            ))}
          </tbody>
          {pessoas.length > 1 && (
            <tfoot>
              <tr>
                <td className="pe-nome">Trabalhando</td>
                {trabalhando.map((v, i) => (
                  <td key={dias[i]} className={`esc-c${max > min && v <= corte ? " baixo" : ""}${diaSemana(dias[i]) === 0 ? " dom" : ""}`}>{v}</td>
                ))}
                <td className="pe-tot" /><td className="pe-tot" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="pe-legenda">
        {ORDEM.filter((t) => usados.has(t)).map((t) => {
          const hs = [...(usados.get(t) ?? [])].sort((x, y) => x - y);
          return (
            <span key={t}><i className={`pe-chip t-${t}`} /><b>{T.turnos[t]}</b>
              {hs.length > 0 && t !== "partido" && t !== "dia" && <em>entra {hs.map((h) => `${dois(h)}h`).join(hs.length > 2 ? ", " : " ou ")}</em>}
            </span>
          );
        })}
        <span><i className="pe-chip dom-chip" /><b>Domingo</b></span>
        <span><i className="pe-marca m-ok" /><b>Trabalhou</b></span>
        <span><i className="pe-marca m-atraso" /><b>Atraso</b></span>
        <span><i className="pe-marca m-falta" /><b>Falta</b></span>
        <span><i className="pe-marca m-just" /><b>Falta justificada</b></span>
        <span><b className="pe-ajuste-ex">07:06*</b><b>batida ajustada por justificativa</b></span>
      </div>

      {dica && (
        <div className="esc-dica pt-dica on" role="tooltip" style={{ left: dica.x, top: dica.y, transform: `translate(-50%, ${dica.acima ? "-100%" : "0"})` }}>
          <div className="esc-dica-top">{dica.quem} · {dica.dia}</div>
          <div className="pt-dica-linha">
            <span>Previsto</span>
            <b>{dica.previsto}{dica.intervalo ? <small> · intervalo {dica.intervalo}</small> : null}</b>
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

function LocalLinhas({ local, setores, pessoas, dias, agora, turnosDe, onAbrir, colunas, mostrar }: {
  local: string; setores: string[]; pessoas: PessoaEscala[]; dias: string[]; agora: string; turnosDe: Map<string, Turno[]>;
  onAbrir?: (chave: string) => void; colunas: number; mostrar: (td: HTMLElement, p: PessoaEscala, dia: string, t: Turno) => void;
}) {
  return (
    <>
      <tr className="pe-local"><td colSpan={colunas}>{local} <span>{pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}</span></td></tr>
      {setores.map((setor) => {
        const do_ = pessoas.filter((p) => p.setor === setor);
        return (
          <GrupoLinhas key={setor || "_"} grupo={setor || "Sem setor"} mostrarGrupo={setores.length > 1 || !!setor} pessoas={do_} dias={dias} agora={agora}
            turnosDe={turnosDe} onAbrir={onAbrir} colunas={colunas} mostrar={mostrar} />
        );
      })}
    </>
  );
}

function GrupoLinhas({ grupo, mostrarGrupo, pessoas, dias, agora, turnosDe, onAbrir, colunas, mostrar }: {
  grupo: string; mostrarGrupo: boolean; pessoas: PessoaEscala[]; dias: string[]; agora: string; turnosDe: Map<string, Turno[]>;
  onAbrir?: (chave: string) => void; colunas: number; mostrar: (td: HTMLElement, p: PessoaEscala, dia: string, t: Turno) => void;
}) {
  return (
    <>
      {mostrarGrupo && <tr className="pe-grupo"><td colSpan={colunas}>{grupo} <span>{pessoas.length}</span></td></tr>}
      {pessoas.map((p) => {
        const ts = turnosDe.get(p.chave)!;
        const trab = ts.filter((t) => t.trabalha).length;
        const folgas = ts.filter((t) => t.tipo === "folga").length;
        return (
          <tr key={p.chave}>
            <td className="pe-nome">
              {onAbrir ? <button className="esc-pessoa pe-pessoa-botao" onClick={() => onAbrir(p.chave)}>{p.nome}</button> : <span className="esc-pessoa">{p.nome}</span>}
            </td>
            {dias.map((d, i) => {
              const t = ts[i];
              const dd = p.dias.get(d);
              const m = situacaoDo(dd, t, d, agora);
              const dow = diaSemana(d);
              const temAjuste = !!dd?.batidas.some(ajustada);
              return (
                <td key={d} className={`esc-c t-${t.tipo}${dow === 0 ? " dom" : ""}${d === agora ? " hoje" : ""}${m.classe ? ` ${m.classe}` : ""}${temAjuste ? " ajuste" : ""}`}
                  onMouseEnter={(e) => mostrar(e.currentTarget, p, d, t)} onClick={(e) => mostrar(e.currentTarget, p, d, t)}
                  aria-label={`${t.horario}${t.intervalo ? `, intervalo ${t.intervalo}` : ""}${m.texto ? `, ${m.texto}` : ""}`}>
                  {t.linhas.map((x, k) => <span key={k}>{x}</span>)}
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
