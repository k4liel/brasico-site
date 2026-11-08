"use client";

import type { ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

// Kit visual das páginas dos hotéis (Visão geral, Reservas, Mapa, Transações): cores, cartões, painéis e gráficos (Recharts).
// Cores em variáveis CSS (globals.css, bloco "Hotéis · kit visual"), que mudam com o tema claro/escuro.

export const COR = {
  azul: "var(--hx-azul)", verde: "var(--hx-verde)", ambar: "var(--hx-ambar)", violeta: "var(--hx-violeta)",
  rosa: "var(--hx-rosa)", ciano: "var(--hx-ciano)", cinza: "var(--hx-cinza)", ouro: "var(--hx-ouro)", grade: "var(--hx-grade)",
};
export const PALETA = [COR.azul, COR.verde, COR.ambar, COR.violeta, COR.ciano, COR.rosa, COR.ouro, COR.cinza];

export const moeda = (v: number | null | undefined, curto = false) => {
  if (v == null || !isFinite(v)) return "—";
  if (curto && Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) >= 100000 ? 0 : 1 })} mil`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
export const num = (v: number | null | undefined, casas = 0) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }));
export const pct = (v: number | null | undefined, casas = 1) => (v == null || !isFinite(v) ? "—" : `${num(v, casas)}%`);

// ---------- Estrutura ----------
export function Painel({ titulo, sub, acoes, children, className = "" }: { titulo?: ReactNode; sub?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`hx-painel ${className}`}>
      {(titulo || acoes) && (
        <header className="hx-painel-topo">
          <div>{sub && <span className="hx-sobre">{sub}</span>}{titulo && <h3>{titulo}</h3>}</div>
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

export function Delta({ v, pontos, inverso }: { v: number | null; pontos?: boolean; inverso?: boolean }) {
  if (v == null || !isFinite(v)) return <span className="hx-delta neutro">sem comparação</span>;
  const bom = inverso ? v < 0 : v >= 0;
  const txt = pontos ? `${num(Math.abs(v), 1)} p.p.` : `${num(Math.abs(v) * 100, 1)}%`;
  return <span className={`hx-delta ${bom ? "bom" : "ruim"}`}>{v >= 0 ? "↑" : "↓"} {txt}</span>;
}

// Cartão de indicador com minigráfico
export function Kpi({ rotulo, valor, delta, pontos, inverso, nota, serie, cor = COR.azul, ajuda }: {
  rotulo: string; valor: string; delta?: number | null; pontos?: boolean; inverso?: boolean; nota?: ReactNode;
  serie?: (number | null)[]; cor?: string; ajuda?: string;
}) {
  const dados = (serie ?? []).map((v, i) => ({ i, v }));
  const id = `g${rotulo.replace(/\W/g, "")}`;
  return (
    <div className="hx-kpi" title={ajuda}>
      <span className="hx-kpi-rotulo">{rotulo}</span>
      <b className="hx-kpi-valor">{valor}</b>
      <div className="hx-kpi-rodape">
        {delta !== undefined && <Delta v={delta} pontos={pontos} inverso={inverso} />}
        {nota && <span className="hx-kpi-nota">{nota}</span>}
      </div>
      {dados.length > 1 && (
        <div className="hx-kpi-faisca" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dados} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} stopOpacity={0.35} /><stop offset="100%" stopColor={cor} stopOpacity={0} /></linearGradient></defs>
              <Area type="monotone" dataKey="v" stroke={cor} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
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

export type SerieDef = { chave: string; nome: string; cor: string; tipo?: "barra" | "linha" | "area"; eixo?: "esq" | "dir"; tracejada?: boolean; pilha?: string };

// Barras + linhas + áreas, com dois eixos
export function GraficoCombinado({ dados, x, series, altura = 300, fmtEsq, fmtDir, fmt, rotuloX, rotuloDica, legenda = true }: {
  dados: Record<string, unknown>[]; x: string; series: SerieDef[]; altura?: number; fmtEsq?: Fmt; fmtDir?: Fmt; fmt: Record<string, Fmt>;
  rotuloX?: (v: string) => string; rotuloDica?: (v: string) => string; legenda?: boolean;
}) {
  const temDir = series.some((s) => s.eixo === "dir");
  return (
    <div className="hx-grafico" style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={{ top: 8, right: temDir ? 4 : 12, bottom: 0, left: 0 }}>
          <defs>
            {series.filter((s) => s.tipo === "area").map((s) => (
              <linearGradient key={s.chave} id={`a-${s.chave}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.cor} stopOpacity={0.35} /><stop offset="100%" stopColor={s.cor} stopOpacity={0.02} /></linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={COR.grade} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={x} tickFormatter={rotuloX} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis yAxisId="esq" tickFormatter={fmtEsq} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={56} />
          {temDir && <YAxis yAxisId="dir" orientation="right" tickFormatter={fmtDir} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={44} />}
          <Tooltip content={<Dica fmt={fmt} rotulo={rotuloDica} />} cursor={{ fill: "var(--hover-bg)", opacity: 0.5 }} />
          {legenda && series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />}
          {series.map((s) => s.tipo === "linha" ? (
            <Line key={s.chave} yAxisId={s.eixo ?? "esq"} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} strokeWidth={2.2}
              strokeDasharray={s.tracejada ? "5 4" : undefined} dot={false} activeDot={{ r: 4 }} connectNulls />
          ) : s.tipo === "area" ? (
            <Area key={s.chave} yAxisId={s.eixo ?? "esq"} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} strokeWidth={2.2}
              fill={`url(#a-${s.chave})`} strokeDasharray={s.tracejada ? "5 4" : undefined} connectNulls />
          ) : (
            <Bar key={s.chave} yAxisId={s.eixo ?? "esq"} dataKey={s.chave} name={s.nome} fill={s.cor} radius={[4, 4, 0, 0]} maxBarSize={28} stackId={s.pilha} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Rosca com o total no meio
export function Rosca({ dados, fmt, altura = 220, centro, sub }: { dados: { nome: string; valor: number; cor?: string }[]; fmt: Fmt; altura?: number; centro?: string; sub?: string }) {
  const total = dados.reduce((a, d) => a + Math.max(0, d.valor), 0);
  return (
    <div className="hx-rosca">
      <div className="hx-rosca-grafico" style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={dados.filter((d) => d.valor > 0)} dataKey="valor" nameKey="nome" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {dados.filter((d) => d.valor > 0).map((d, i) => <Cell key={d.nome} fill={d.cor ?? PALETA[i % PALETA.length]} />)}
            </Pie>
            <Tooltip content={<Dica fmt={fmt} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="hx-rosca-centro"><b>{centro ?? fmt(total)}</b>{sub && <span>{sub}</span>}</div>
      </div>
      <ul className="hx-rosca-legenda">
        {dados.filter((d) => d.valor !== 0).map((d, i) => (
          <li key={d.nome}><i style={{ background: d.cor ?? PALETA[i % PALETA.length] }} /><span>{d.nome}</span>
            <b>{fmt(d.valor)}</b><small>{total ? pct((100 * Math.max(0, d.valor)) / total, 0) : ""}</small></li>
        ))}
      </ul>
    </div>
  );
}

// Barras horizontais (ranking)
export function BarrasH({ dados, fmt, cor = COR.azul, altura }: { dados: { nome: string; valor: number; cor?: string }[]; fmt: Fmt; cor?: string; altura?: number }) {
  const h = altura ?? Math.max(120, dados.length * 34 + 16);
  return (
    <div className="hx-grafico" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 12, fill: "var(--text)" }} axisLine={false} tickLine={false} />
          <Tooltip content={<Dica fmt={fmt} />} cursor={{ fill: "var(--hover-bg)", opacity: 0.5 }} />
          <Bar dataKey="valor" name="Valor" radius={[0, 6, 6, 0]} maxBarSize={20} label={{ position: "right", formatter: (v: unknown) => fmt(Number(v)), fontSize: 11.5, fill: "var(--text)" }}>
            {dados.map((d) => <Cell key={d.nome} fill={d.cor ?? cor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="hx-vazio">{children}</div>;
}
