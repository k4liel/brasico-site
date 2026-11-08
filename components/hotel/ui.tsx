"use client";

import { useState, type ReactNode } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Kit visual das páginas dos hotéis (Visão geral, Reservas, Mapa, Transações): cores, cartões, painéis, listas e gráficos (Recharts).
// Regra: pouca coisa por tela, números inteiros e legíveis (nunca cortados), no máximo dois painéis por linha.
// Cores em variáveis CSS (globals.css, bloco "Hotéis · kit visual"), que mudam com o tema claro/escuro.

export const COR = {
  azul: "var(--hx-azul)", verde: "var(--hx-verde)", ambar: "var(--hx-ambar)", violeta: "var(--hx-violeta)",
  rosa: "var(--hx-rosa)", ciano: "var(--hx-ciano)", cinza: "var(--hx-cinza)", ouro: "var(--hx-ouro)", grade: "var(--hx-grade)",
};
export const PALETA = [COR.azul, COR.verde, COR.ambar, COR.violeta, COR.ciano, COR.rosa, COR.ouro, COR.cinza];

// Dinheiro: com centavos até R$ 9.999,99; acima disso, sem centavos (cabe no cartão e se lê de uma vez).
export const moeda = (v: number | null | undefined, curto = false) => {
  if (v == null || !isFinite(v)) return "—";
  if (curto) return `R$ ${compacto(v)}`;
  if (Math.abs(v) >= 10000) return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
// Reais sem centavos (listas e tabelas: todos os valores no mesmo formato)
export const reais = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0, minimumFractionDigits: 0 }));
// 36 mil · 1,2 mi · 850
export const compacto = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: a >= 1e5 ? 0 : 1 })} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};
export const num = (v: number | null | undefined, casas = 0) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }));
export const pct = (v: number | null | undefined, casas = 1) => (v == null || !isFinite(v) ? "—" : `${num(v, casas)}%`);

// ---------- Estrutura ----------
export function Painel({ titulo, sub, acoes, children, className = "" }: { titulo?: ReactNode; sub?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`hx-painel ${className}`}>
      {(titulo || acoes) && (
        <header className="hx-painel-topo">
          <div>{titulo && <h3>{titulo}</h3>}{sub && <span className="hx-painel-sub">{sub}</span>}</div>
          {acoes && <div className="hx-painel-acoes">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Segmentos<T extends string>({ valor, opcoes, mudar, rotulo }: { valor: T; opcoes: [T, string][]; mudar: (v: T) => void; rotulo: string }) {
  return (
    <div className="hx-seg" role="group" aria-label={rotulo}>
      {opcoes.map(([v, t]) => <button key={v} type="button" className={v === valor ? "on" : ""} aria-pressed={v === valor} onClick={() => mudar(v)}>{t}</button>)}
    </div>
  );
}

export function Delta({ v, pontos, inverso, vs }: { v: number | null | undefined; pontos?: boolean; inverso?: boolean; vs?: string }) {
  if (v == null || !isFinite(v)) return null;
  const bom = inverso ? v < 0 : v >= 0;
  const txt = pontos ? `${num(Math.abs(v), 1)} p.p.` : `${num(Math.abs(v) * 100, 1)}%`;
  return <span className={`hx-delta ${bom ? "bom" : "ruim"}`}>{v >= 0 ? "▲" : "▼"} {txt}{vs && <em> vs {vs}</em>}</span>;
}

// Cartão de indicador: rótulo, número grande e uma linha de contexto.
export function Kpi({ rotulo, valor, delta, pontos, inverso, vs, nota, ajuda }: {
  rotulo: string; valor: string; delta?: number | null; pontos?: boolean; inverso?: boolean; vs?: string; nota?: ReactNode; ajuda?: string;
}) {
  return (
    <div className="hx-kpi" title={ajuda}>
      <span className="hx-kpi-rotulo">{rotulo}</span>
      <b className="hx-kpi-valor">{valor}</b>
      <div className="hx-kpi-rodape">
        <Delta v={delta} pontos={pontos} inverso={inverso} vs={vs} />
        {nota && <span className="hx-kpi-nota">{nota}</span>}
      </div>
    </div>
  );
}

// Faixa de números secundários (rótulo em cima, valor embaixo), numa linha só
export function Resumo({ itens }: { itens: { rotulo: string; valor: ReactNode; nota?: ReactNode }[] }) {
  return (
    <div className="hx-resumo">
      {itens.map((i) => <div key={i.rotulo}><span>{i.rotulo}</span><b>{i.valor}</b>{i.nota && <small>{i.nota}</small>}</div>)}
    </div>
  );
}

// Lista com barra: nome, valor e participação — substitui roscas e rankings (mais fácil de ler, nada se corta)
export function Lista({ dados, fmt, cor = COR.azul, limite = 8, total: totalDado }: {
  dados: { nome: string; valor: number; cor?: string; extra?: ReactNode }[]; fmt: (v: number) => string; cor?: string; limite?: number; total?: number;
}) {
  const [tudo, setTudo] = useState(false);
  const pos = dados.filter((d) => d.valor > 0);
  const total = totalDado ?? pos.reduce((a, d) => a + d.valor, 0);
  const max = Math.max(...pos.map((d) => d.valor), 1);
  const vis = tudo ? dados : dados.slice(0, limite);
  if (!dados.length) return <Vazio>Sem dados neste período.</Vazio>;
  return (
    <div className="hx-lista">
      {vis.map((d) => (
        <div key={d.nome} className="hx-lista-item" title={d.nome}>
          <div className="hx-lista-linha">
            <span className="hx-lista-nome"><i style={{ background: d.cor ?? cor }} />{d.nome}</span>
            <b>{fmt(d.valor)}</b>
            <small>{total > 0 && d.valor > 0 ? pct((100 * d.valor) / total, 0) : ""}</small>
          </div>
          <div className="hx-lista-barra"><em style={{ width: `${Math.max(0, (100 * d.valor) / max)}%`, background: d.cor ?? cor }} /></div>
          {d.extra && <div className="hx-lista-extra">{d.extra}</div>}
        </div>
      ))}
      {dados.length > limite && <button type="button" className="hx-mais" onClick={() => setTudo(!tudo)}>{tudo ? "Mostrar menos" : `Ver todos (${dados.length})`}</button>}
    </div>
  );
}

// ---------- Gráficos ----------
type Fmt = (v: number) => string;
function Dica({ active, payload, label, fmt, rotulo }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; fmt: Record<string, Fmt> | Fmt; rotulo?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="hx-dica">
      <b>{rotulo ? rotulo(String(label)) : label}</b>
      {payload.filter((p) => p.value != null).map((p) => {
        const f = typeof fmt === "function" ? fmt : fmt[p.dataKey] ?? ((v: number) => num(v));
        return <div key={p.dataKey}><i style={{ background: p.color }} />{p.name}<span>{f(Number(p.value))}</span></div>;
      })}
    </div>
  );
}

// Rótulos dos eixos sem quebra de linha (o padrão do Recharts quebra "R$ 36 mil" em duas linhas e corta)
type TickProps = { x?: number; y?: number; payload?: { value: unknown }; fmt?: (v: never) => string; ancora?: "start" | "middle" | "end"; dy?: number };
function Tick({ x = 0, y = 0, payload, fmt, ancora = "end", dy = 4 }: TickProps) {
  const v = payload?.value;
  return <text x={x} y={y} dy={dy} textAnchor={ancora} fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt ? fmt(v as never) : String(v)}</text>;
}

export type SerieDef = { chave: string; nome: string; cor: string; tipo?: "barra" | "linha" | "area"; eixo?: "esq" | "dir"; tracejada?: boolean; pilha?: string };

export function Legenda({ series }: { series: { nome: string; cor: string; tipo?: string; tracejada?: boolean }[] }) {
  return (
    <ul className="hx-legenda">
      {series.map((s) => <li key={s.nome}><i className={s.tipo === "linha" ? (s.tracejada ? "linha tracejada" : "linha") : ""} style={{ ["--c" as string]: s.cor }} />{s.nome}</li>)}
    </ul>
  );
}

// Barras + linhas + áreas, com dois eixos
export function GraficoCombinado({ dados, x, series, altura = 280, fmtEsq, fmtDir, fmt, rotuloX, rotuloDica, legenda = true }: {
  dados: Record<string, unknown>[]; x: string; series: SerieDef[]; altura?: number; fmtEsq?: Fmt; fmtDir?: Fmt; fmt: Record<string, Fmt>;
  rotuloX?: (v: string) => string; rotuloDica?: (v: string) => string; legenda?: boolean;
}) {
  const temDir = series.some((s) => s.eixo === "dir");
  return (
    <div className="hx-grafico-caixa">
      {legenda && series.length > 1 && <Legenda series={series} />}
      <div className="hx-grafico" style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 12, right: temDir ? 0 : 8, bottom: 0, left: 0 }}>
            <defs>
              {series.filter((s) => s.tipo === "area").map((s) => (
                <linearGradient key={s.chave} id={`a-${s.chave}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.cor} stopOpacity={0.22} /><stop offset="100%" stopColor={s.cor} stopOpacity={0.02} /></linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={COR.grade} vertical={false} />
            <XAxis dataKey={x} axisLine={false} tickLine={false} minTickGap={16} height={24} interval="preserveStartEnd"
              tick={<Tick fmt={rotuloX as (v: never) => string} ancora="middle" dy={14} />} />
            <YAxis yAxisId="esq" axisLine={false} tickLine={false} width={58} tickCount={5} tick={<Tick fmt={(fmtEsq ?? ((v: number) => num(v))) as (v: never) => string} />} />
            {temDir && <YAxis yAxisId="dir" orientation="right" axisLine={false} tickLine={false} width={42} tickCount={5} domain={[0, 100]}
              tick={<Tick fmt={(fmtDir ?? ((v: number) => num(v))) as (v: never) => string} ancora="start" />} />}
            <Tooltip content={<Dica fmt={fmt} rotulo={rotuloDica} />} cursor={{ fill: "var(--hover-bg)", opacity: 0.6 }} />
            {series.map((s) => s.tipo === "linha" ? (
              <Line key={s.chave} yAxisId={s.eixo ?? "esq"} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} strokeWidth={2}
                strokeDasharray={s.tracejada ? "5 4" : undefined} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ) : s.tipo === "area" ? (
              <Area key={s.chave} yAxisId={s.eixo ?? "esq"} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} strokeWidth={2}
                fill={`url(#a-${s.chave})`} strokeDasharray={s.tracejada ? "5 4" : undefined} connectNulls isAnimationActive={false} />
            ) : (
              <Bar key={s.chave} yAxisId={s.eixo ?? "esq"} dataKey={s.chave} name={s.nome} fill={s.cor} radius={s.pilha ? 0 : [3, 3, 0, 0]} maxBarSize={26} stackId={s.pilha} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="hx-vazio">{children}</div>;
}
