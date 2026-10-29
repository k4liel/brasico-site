"use client";

import { useMemo, useRef, useState } from "react";

// Gráficos em SVG, sem biblioteca, nas cores do sistema (tokens do globals.css):
// linhas 2px, pontos de 8px, grade discreta, legenda quando há 2 ou mais séries e o valor ao passar o mouse.
// Cores das séries: --serie-1..4 (paleta validada para daltonismo); a referência "Geral" usa --strong.

export type Serie = { nome: string; cor: string; pontos: (number | null)[]; destaque?: boolean };

const W = 720;
function escala(min: number, max: number, a: number, b: number) {
  const d = max - min || 1;
  return (v: number) => a + ((v - min) / d) * (b - a);
}
function marcas(min: number, max: number, n = 4) {
  const passo = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + i * passo);
}

/** Linhas por mês (ex.: índice de preços). */
export function GraficoLinhas({ rotulos, series, altura = 260, formato = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), base }: {
  rotulos: string[]; series: Serie[]; altura?: number; formato?: (v: number) => string; base?: number;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const H = altura, E = 44, D = 64, T = 16, B = 28;
  const valores = series.flatMap((s) => s.pontos.filter((v): v is number => v != null));
  if (base != null) valores.push(base);
  const min0 = Math.min(...valores), max0 = Math.max(...valores);
  const folga = (max0 - min0) * 0.15 || 1;
  const min = min0 - folga, max = max0 + folga;
  const x = (i: number) => E + (rotulos.length <= 1 ? 0 : (i / (rotulos.length - 1)) * (W - E - D));
  const y = escala(min, max, H - B, T);
  const ticks = marcas(min, max);

  function mover(ev: React.MouseEvent<SVGSVGElement>) {
    const r = svg.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - E) / (W - E - D)) * (rotulos.length - 1));
    setFoco(Math.max(0, Math.min(rotulos.length - 1, i)));
  }
  const caminho = (s: Serie) => s.pontos.map((v, i) => (v == null ? "" : `${x(i)},${y(v)}`)).filter(Boolean).reduce((acc, p, k) => `${acc}${k ? "L" : "M"}${p}`, "");

  return (
    <div className="gr">
      {series.length > 1 && (
        <ul className="gr-legenda">
          {series.map((s) => <li key={s.nome}><i style={{ background: s.cor }} />{s.nome}</li>)}
        </ul>
      )}
      <div className="gr-area">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico: ${series.map((s) => s.nome).join(", ")}`}
          onMouseMove={mover} onMouseLeave={() => setFoco(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={E} x2={W - D} y1={y(t)} y2={y(t)} className="gr-grade" />
              <text x={E - 8} y={y(t) + 4} className="gr-eixo" textAnchor="end">{formato(t)}</text>
            </g>
          ))}
          {base != null && <line x1={E} x2={W - D} y1={y(base)} y2={y(base)} className="gr-base" />}
          {rotulos.map((r, i) => (
            (rotulos.length <= 12 || i % 2 === 0) && <text key={r + i} x={x(i)} y={H - 8} className="gr-eixo" textAnchor="middle">{r}</text>
          ))}
          {foco != null && <line x1={x(foco)} x2={x(foco)} y1={T} y2={H - B} className="gr-mira" />}
          {series.map((s) => (
            <g key={s.nome}>
              <path d={caminho(s)} fill="none" stroke={s.cor} strokeWidth={s.destaque ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
              {s.pontos.map((v, i) => v != null && (i === s.pontos.length - 1 || foco === i) && (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.cor} className="gr-ponto" />
              ))}
              {(() => {
                const ult = [...s.pontos].reverse().findIndex((v) => v != null);
                if (ult < 0) return null;
                const i = s.pontos.length - 1 - ult;
                return <text x={x(i) + 8} y={y(s.pontos[i]!) + 4} className="gr-rotulo">{formato(s.pontos[i]!)}</text>;
              })()}
            </g>
          ))}
        </svg>
        {foco != null && (
          <div className="gr-dica" style={{ left: `${(x(foco) / W) * 100}%` }}>
            <b>{rotulos[foco]}</b>
            {series.map((s) => s.pontos[foco] != null && (
              <span key={s.nome}><i style={{ background: s.cor }} />{s.nome}<em>{formato(s.pontos[foco]!)}</em></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras por mês (ex.: gasto). */
export function GraficoBarras({ rotulos, valores, altura = 200, formato }: { rotulos: string[]; valores: number[]; altura?: number; formato: (v: number) => string }) {
  const [foco, setFoco] = useState<number | null>(null);
  const H = altura, E = 8, T = 22, B = 28;
  const max = Math.max(...valores, 1);
  const larg = (W - 2 * E) / Math.max(1, valores.length);
  const y = escala(0, max, H - B, T);
  return (
    <div className="gr">
      <div className="gr-area">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras por mês" onMouseLeave={() => setFoco(null)}>
          <line x1={E} x2={W - E} y1={H - B} y2={H - B} className="gr-grade" />
          {valores.map((v, i) => {
            const bx = E + i * larg + larg * 0.2, bw = larg * 0.6, by = y(v), bh = H - B - by;
            return (
              <g key={i} onMouseEnter={() => setFoco(i)}>
                <rect x={E + i * larg} y={T} width={larg} height={H - B - T} fill="transparent" />
                <path d={`M${bx},${H - B} V${by + 4} Q${bx},${by} ${bx + 4},${by} H${bx + bw - 4} Q${bx + bw},${by} ${bx + bw},${by + 4} V${H - B} Z`}
                  className={foco === i ? "gr-barra on" : i === valores.length - 1 ? "gr-barra ultima" : "gr-barra"} style={{ opacity: bh > 0 ? 1 : 0 }} />
                <text x={bx + bw / 2} y={H - 8} className="gr-eixo" textAnchor="middle">{rotulos[i]}</text>
                {(foco === i || i === valores.length - 1) && <text x={bx + bw / 2} y={by - 6} className="gr-rotulo" textAnchor="middle">{formato(v)}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Histórico de preço de um produto: um ponto por compra, cor por fornecedor, linha tracejada da média. */
export type Compra = { data: string; preco: number; fornecedor: string; quantidade: number };
export function GraficoPrecos({ compras, altura = 240, unidade }: { compras: Compra[]; altura?: number; unidade: string }) {
  const [foco, setFoco] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const H = altura, E = 56, D = 16, T = 16, B = 28;
  const fornecedores = useMemo(() => {
    const vistos: string[] = [];
    for (const c of compras) if (!vistos.includes(c.fornecedor)) vistos.push(c.fornecedor);
    return vistos;
  }, [compras]);
  const cor = (f: string) => { const i = fornecedores.indexOf(f); return i < 4 ? `var(--serie-${i + 1})` : "var(--muted)"; };
  if (!compras.length) return <p className="muted">Sem compras nos últimos 12 meses.</p>;
  const tempos = compras.map((c) => new Date(`${c.data}T12:00:00`).getTime());
  const t0 = Math.min(...tempos), t1 = Math.max(...tempos);
  const precos = compras.map((c) => c.preco);
  const pmin = Math.min(...precos), pmax = Math.max(...precos), folga = (pmax - pmin) * 0.15 || pmax * 0.1 || 1;
  const x = escala(t0, t1 === t0 ? t0 + 1 : t1, E, W - D);
  const y = escala(pmin - folga, pmax + folga, H - B, T);
  const media = precos.reduce((s, p) => s + p, 0) / precos.length;
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mesesEixo: number[] = [];
  const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= t1) { mesesEixo.push(d.getTime()); d.setMonth(d.getMonth() + (t1 - t0 > 200 * 864e5 ? 2 : 1)); }

  function mover(ev: React.MouseEvent<SVGSVGElement>) {
    const r = svg.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let melhor = 0, dist = Infinity;
    tempos.forEach((t, i) => { const dd = Math.abs(x(t) - px); if (dd < dist) { dist = dd; melhor = i; } });
    setFoco(melhor);
  }
  const c = foco != null ? compras[foco] : null;
  return (
    <div className="gr">
      <ul className="gr-legenda">
        {fornecedores.slice(0, 4).map((f) => <li key={f}><i style={{ background: cor(f) }} />{f}</li>)}
        {fornecedores.length > 4 && <li><i style={{ background: "var(--muted)" }} />outros {fornecedores.length - 4}</li>}
        <li><i className="gr-tracejado" />média {brl(media)}</li>
      </ul>
      <div className="gr-area">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histórico de preço por compra" onMouseMove={mover} onMouseLeave={() => setFoco(null)}>
          {marcas(pmin - folga, pmax + folga).map((t) => (
            <g key={t}>
              <line x1={E} x2={W - D} y1={y(t)} y2={y(t)} className="gr-grade" />
              <text x={E - 8} y={y(t) + 4} className="gr-eixo" textAnchor="end">{t.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</text>
            </g>
          ))}
          {mesesEixo.map((t) => (
            <text key={t} x={x(t)} y={H - 8} className="gr-eixo" textAnchor="middle">
              {new Date(t).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", " ").replace(".", "")}
            </text>
          ))}
          <line x1={E} x2={W - D} y1={y(media)} y2={y(media)} className="gr-media" />
          <path d={compras.map((cc, i) => `${i ? "L" : "M"}${x(tempos[i])},${y(cc.preco)}`).join("")} fill="none" className="gr-trilha" />
          {foco != null && <line x1={x(tempos[foco])} x2={x(tempos[foco])} y1={T} y2={H - B} className="gr-mira" />}
          {compras.map((cc, i) => (
            <circle key={i} cx={x(tempos[i])} cy={y(cc.preco)} r={foco === i ? 6 : 4} fill={cor(cc.fornecedor)} className="gr-ponto" />
          ))}
        </svg>
        {c && (
          <div className="gr-dica" style={{ left: `${(x(tempos[foco!]) / W) * 100}%` }}>
            <b>{new Date(`${c.data}T12:00:00`).toLocaleDateString("pt-BR")}</b>
            <span><i style={{ background: cor(c.fornecedor) }} />{c.fornecedor}</span>
            <span>Preço<em>{brl(c.preco)} / {unidade || "un"}</em></span>
            <span>Quantidade<em>{c.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</em></span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Linha pequena de tendência (alertas). */
export function Faisca({ valores, alta }: { valores: number[]; alta: boolean }) {
  if (valores.length < 2) return null;
  const w = 96, h = 28;
  const min = Math.min(...valores), max = Math.max(...valores);
  const x = (i: number) => 2 + (i / (valores.length - 1)) * (w - 6);
  const y = escala(min, max === min ? min + 1 : max, h - 4, 4);
  const d = valores.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  return (
    <svg className="gr-faisca" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={alta ? "var(--danger)" : "var(--ok)"} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(valores.length - 1)} cy={y(valores[valores.length - 1])} r={2.6} fill={alta ? "var(--danger)" : "var(--ok)"} />
    </svg>
  );
}
