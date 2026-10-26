"use client";

// Grade de escala do Ponto (RH): um quadradinho por pessoa e dia, no mesmo visual das escalas
// dos projetos (:::escala, lib/markdown.ts). O horário vem da apuração do RHiD (escala contratual
// do dia); nos dias passados, o quadradinho ganha a marca do que aconteceu (ok, atraso, falta).
import { useState } from "react";
import { tipoPorEntrada, type TipoTurno } from "@/lib/markdown";
import { TEXTOS } from "@/lib/idioma";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";
import EscalaDica from "./EscalaDica";

export type DiaEscala = {
  dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; batidas: { hora: string }[];
};
export type PessoaEscala = { chave: string; nome: string; unidade: string; dias: Map<string, DiaEscala> };

type Turno = { tipo: TipoTurno; linhas: string[]; horario: string; intervalo: string; trabalha: boolean };
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
  const tipo = tipoPorEntrada(Math.floor(entrada.a), Math.floor(saida.b));
  return {
    tipo, trabalha: true, intervalo,
    linhas: [entrada.ta, saida.tb],
    horario: `${entrada.ta}–${saida.tb}`,
  };
}

// Segunda-feira da semana de um dia (YYYY-MM-DD)
function segunda(d: string) {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return somarDias(d, -((dow + 6) % 7));
}

export default function PontoEscala({ pessoas, onAbrir }: { pessoas: PessoaEscala[]; onAbrir?: (chave: string) => void }) {
  const agora = hoje();
  const [inicio, setInicio] = useState(() => segunda(agora));
  const SEMANAS = 2;
  const dias = Array.from({ length: 7 * SEMANAS }, (_, i) => somarDias(inicio, i));
  const podeVoltar = inicio > somarDias(agora, -29);
  const podeAvancar = somarDias(inicio, 7) <= agora;

  const grupos = [...new Set(pessoas.map((p) => p.unidade || "Sem unidade"))].sort();
  const usados = new Map<TipoTurno, Set<number>>();
  const turnosDe = new Map<string, Turno[]>();
  for (const p of pessoas) {
    const ts = dias.map((d) => {
      const t = lerHorario(p.dias.get(d));
      if (!usados.has(t.tipo)) usados.set(t.tipo, new Set());
      if (t.trabalha) usados.get(t.tipo)!.add(parseInt(t.linhas[0], 10));
      return t;
    });
    turnosDe.set(p.chave, ts);
  }
  const trabalhando = dias.map((_, i) => pessoas.filter((p) => turnosDe.get(p.chave)![i].trabalha).length);
  const min = Math.min(...trabalhando, Infinity);
  const max = Math.max(...trabalhando, -Infinity);
  const corte = min + (max - min) * 0.25;
  const T = TEXTOS.pt;

  // Marca do que aconteceu num dia já passado
  const marca = (d: DiaEscala | undefined, t: Turno, dia: string) => {
    if (dia >= agora || !d || !t.trabalha) return { classe: "", texto: "" };
    if (d.falta && !d.justificado) return { classe: "m-falta", texto: "Falta" };
    if (d.falta && d.justificado) return { classe: "m-just", texto: "Falta justificada" };
    if (d.minutos_atraso >= 10) return { classe: "m-atraso", texto: `Atraso de ${d.minutos_atraso} min` };
    if (d.batidas.length || d.minutos_trabalhados > 0) return { classe: "m-ok", texto: "Trabalhou" };
    return { classe: "m-sem", texto: "Sem batida" };
  };

  return (
    <div className="pt-escala">
      <div className="pt-escala-topo">
        <div className="tv-unidades">
          <button className="botao-painel" onClick={() => setInicio(somarDias(inicio, -7))} disabled={!podeVoltar} aria-label="Semana anterior">‹</button>
          <button className="botao-painel" onClick={() => setInicio(segunda(agora))}>Esta semana</button>
          <button className="botao-painel" onClick={() => setInicio(somarDias(inicio, 7))} disabled={!podeAvancar} aria-label="Próxima semana">›</button>
        </div>
        <span className="muted">{dataBR(dias[0])} a {dataBR(dias[dias.length - 1])}</span>
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
                const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
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
            {grupos.map((g) => (
              <GrupoLinhas key={g} grupo={g} pessoas={pessoas.filter((p) => (p.unidade || "Sem unidade") === g)} dias={dias} agora={agora}
                turnosDe={turnosDe} marca={marca} rotulo={(t) => T.turnos[t]} onAbrir={onAbrir} colunas={dias.length + 3} />
            ))}
          </tbody>
          {pessoas.length > 1 && (
            <tfoot>
              <tr>
                <td className="pe-nome">Trabalhando</td>
                {trabalhando.map((v, i) => {
                  const dow = new Date(`${dias[i]}T12:00:00Z`).getUTCDay();
                  return <td key={dias[i]} className={`esc-c${max > min && v <= corte ? " baixo" : ""}${dow === 0 ? " dom" : ""}`}>{v}</td>;
                })}
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
      </div>
      <EscalaDica />
    </div>
  );
}

function GrupoLinhas({ grupo, pessoas, dias, agora, turnosDe, marca, rotulo, onAbrir, colunas }: {
  grupo: string; pessoas: PessoaEscala[]; dias: string[]; agora: string; turnosDe: Map<string, Turno[]>;
  marca: (d: DiaEscala | undefined, t: Turno, dia: string) => { classe: string; texto: string };
  rotulo: (t: TipoTurno) => string; onAbrir?: (chave: string) => void; colunas: number;
}) {
  return (
    <>
      <tr className="pe-grupo"><td colSpan={colunas}>{grupo} <span>{pessoas.length}</span></td></tr>
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
              const m = marca(dd, t, d);
              const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
              const batidas = dd?.batidas.map((b) => b.hora).join(" · ") ?? "";
              const tipo = [rotulo(t.tipo), m.texto, batidas ? `bateu ${batidas}` : ""].filter(Boolean).join(" · ");
              return (
                <td key={d} className={`esc-c t-${t.tipo}${dow === 0 ? " dom" : ""}${d === agora ? " hoje" : ""}${m.classe ? ` ${m.classe}` : ""}`}
                  {...(t.trabalha ? { "data-h": t.horario, "data-t": tipo, ...(t.intervalo ? { "data-i": t.intervalo } : {}) } : {})}
                  aria-label={t.trabalha ? `${t.horario}${t.intervalo ? `, intervalo ${t.intervalo}` : ""}${m.texto ? `, ${m.texto}` : ""}` : t.horario}>
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
