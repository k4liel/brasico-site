"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COR, GraficoCombinado, Kpi, Painel, Rosca, BarrasH, Segmentos, Vazio, moeda, num } from "./ui";

// Transações do hotel (aba Transações da página /hoteis/<hotel>): todos os lançamentos do PMS — diárias, serviços,
// consumo, taxas, pagamentos e estornos — de pms_transacoes (relatório "Lançamentos por Período (Analítico)").
// Sem dados pessoais de hóspede (o robô descarta nome, CPF, e-mail e telefone).

type Tx = { chave: string; dia: string; reserva: string | null; uh: string | null; tipo_uh: string | null; status_reserva: string | null;
  origem: string | null; segmento: string | null; conta_tipo: string | null; item_tipo: string | null; grupo: string | null;
  codigo: string | null; descricao: string | null; valor: number; estornado: boolean; observacao: string | null };
type Atalho = "7d" | "30d" | "mes" | "mesant" | "ano" | "livre";

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
const soma = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fimMes = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
function intervalo(a: Atalho, h: string): [string, string] {
  if (a === "7d") return [soma(h, -6), h];
  if (a === "30d") return [soma(h, -29), h];
  if (a === "mes") return [`${h.slice(0, 7)}-01`, fimMes(h.slice(0, 7))];
  if (a === "mesant") { const d = new Date(Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 2, 1)).toISOString().slice(0, 7); return [`${d}-01`, fimMes(d)]; }
  return [`${h.slice(0, 4)}-01-01`, h];
}
const GRUPOS = ["Diária", "Consumo", "Serviço", "Taxa", "Pagamento", "Outros"] as const;
const COR_GRUPO: Record<string, string> = { "Diária": COR.azul, Consumo: COR.ambar, "Serviço": COR.violeta, Taxa: COR.ciano, Pagamento: COR.verde, Outros: COR.cinza };

function planilha(l: Tx[], nome: string) {
  const cab = ["Data", "Grupo", "Tipo", "Código", "Descrição", "Valor", "Estornado", "Reserva", "UH", "Tipo de UH", "Status da reserva", "Origem", "Segmento", "Conta", "Observação"];
  const e = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = l.map((t) => [t.dia, t.grupo, t.item_tipo, t.codigo, t.descricao, String(t.valor).replace(".", ","), t.estornado ? "sim" : "", t.reserva, t.uh, t.tipo_uh, t.status_reserva, t.origem, t.segmento, t.conta_tipo, t.observacao].map(e).join(";"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [cab.map(e).join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function Transacoes({ hotel, nome }: { hotel: string; nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const h = hoje();
  const [atalho, setAtalho] = useState<Atalho>("mes");
  const [[ini, fim], setIntervalo] = useState<[string, string]>(() => intervalo("mes", hoje()));
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<string>("");
  const [mostrarEstornos, setMostrarEstornos] = useState(true);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [ordem, setOrdem] = useState<"data" | "valor">("data");

  useEffect(() => {
    setTxs(null); setPagina(0);
    (async () => {
      const out: Tx[] = [];
      for (let de = 0; de < 50000; de += 1000) {
        const r = await supabase.from("pms_transacoes").select("chave,dia,reserva,uh,tipo_uh,status_reserva,origem,segmento,conta_tipo,item_tipo,grupo,codigo,descricao,valor,estornado,observacao")
          .eq("hotel_id", hotel).gte("dia", ini).lte("dia", fim).order("dia", { ascending: false }).range(de, de + 999);
        if (r.error) { setErro(r.error.message); break; }
        out.push(...((r.data as Tx[]) ?? []));
        if ((r.data ?? []).length < 1000) break;
      }
      setTxs(out);
    })();
  }, [supabase, hotel, ini, fim]);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = (txs ?? []).filter((t) => (!grupo || t.grupo === grupo) && (mostrarEstornos || !t.estornado) &&
      (!b || [t.descricao, t.reserva, t.uh, t.codigo, t.origem, t.observacao].some((v) => (v ?? "").toLowerCase().includes(b))));
    return ordem === "valor" ? [...l].sort((a, z) => Math.abs(Number(z.valor)) - Math.abs(Number(a.valor))) : l;
  }, [txs, grupo, mostrarEstornos, busca, ordem]);

  const ind = useMemo(() => {
    const l = txs ?? [];
    const val = (f: (t: Tx) => boolean) => l.filter(f).reduce((a, t) => a + Number(t.valor), 0);
    const receitas = val((t) => t.grupo !== "Pagamento");
    const pagamentos = val((t) => t.grupo === "Pagamento");
    const estornos = l.filter((t) => t.estornado);
    return { receitas, pagamentos: Math.abs(pagamentos), estornos: estornos.reduce((a, t) => a + Math.abs(Number(t.valor)), 0), qtdEstornos: estornos.length,
      lancamentos: l.length, reservas: new Set(l.map((t) => t.reserva).filter(Boolean)).size };
  }, [txs]);

  const porGrupo = useMemo(() => GRUPOS.map((g) => ({ nome: g, valor: Math.abs((txs ?? []).filter((t) => t.grupo === g).reduce((a, t) => a + Number(t.valor), 0)), cor: COR_GRUPO[g] })).filter((x) => x.valor > 0), [txs]);
  const porDia = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const t of txs ?? []) {
      const x = m.get(t.dia) ?? {};
      const g = t.grupo === "Pagamento" ? "Pagamento" : t.grupo === "Diária" ? "Diária" : "Extras";
      x[g] = (x[g] ?? 0) + (g === "Pagamento" ? Math.abs(Number(t.valor)) : Number(t.valor));
      m.set(t.dia, x);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, x]) => ({ dia, ...x }));
  }, [txs]);
  const topDescricoes = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs ?? []) { if (t.grupo === "Pagamento" || t.grupo === "Diária") continue; const k = t.descricao ?? "—"; m.set(k, (m.get(k) ?? 0) + Number(t.valor)); }
    return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [txs]);
  const formasPag = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs ?? []) { if (t.grupo !== "Pagamento") continue; const k = t.descricao ?? "—"; m.set(k, (m.get(k) ?? 0) + Math.abs(Number(t.valor))); }
    return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [txs]);

  const POR = 60, paginas = Math.max(1, Math.ceil(filtradas.length / POR));
  const vis = filtradas.slice(pagina * POR, (pagina + 1) * POR);

  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo">
        <div><span className="hx-sobre">Lançamentos do PMS</span><h2>Transações</h2></div>
        <div className="hx-controles">
          <Segmentos valor={atalho} rotulo="Período" mudar={(a) => { setAtalho(a); if (a !== "livre") setIntervalo(intervalo(a, h)); }}
            opcoes={[["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["mesant", "Mês passado"], ["ano", "Este ano"]]} />
          <label className="hx-campo"><span>De</span><input type="date" value={ini} onChange={(e) => { setAtalho("livre"); setIntervalo([e.target.value, fim]); }} /></label>
          <label className="hx-campo"><span>Até</span><input type="date" value={fim} onChange={(e) => { setAtalho("livre"); setIntervalo([ini, e.target.value]); }} /></label>
        </div>
      </div>

      {erro && <Vazio>Não foi possível abrir as transações: {erro}</Vazio>}
      {txs === null ? <div className="hx-carregando"><i /><i /><i /></div> : txs.length === 0 ? (
        <Vazio>Nenhum lançamento neste período ainda. O robô traz as transações mês a mês; se o período é recente ou antigo, ele pode ainda não ter chegado.</Vazio>
      ) : (
        <>
          <div className="hx-kpis">
            <Kpi rotulo="Lançado na conta" valor={moeda(ind.receitas)} cor={COR.azul} serie={porDia.map((d) => (d as unknown as Record<string, number>)["Diária"] ?? 0)} nota="diárias, consumo, serviços e taxas" />
            <Kpi rotulo="Pagamentos recebidos" valor={moeda(ind.pagamentos)} cor={COR.verde} serie={porDia.map((d) => (d as unknown as Record<string, number>)["Pagamento"] ?? 0)} nota="todas as formas" />
            <Kpi rotulo="Estornos" valor={moeda(ind.estornos)} cor={COR.rosa} nota={`${num(ind.qtdEstornos)} lançamentos estornados`} />
            <Kpi rotulo="Lançamentos" valor={num(ind.lancamentos)} cor={COR.violeta} nota={`${num(ind.reservas)} reservas`} />
          </div>

          <Painel sub="Dia a dia" titulo="Lançamentos e pagamentos">
            <GraficoCombinado dados={porDia} x="dia" altura={300} rotuloX={(v) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} rotuloDica={dataBr}
              fmtEsq={(v) => moeda(v, true)} fmt={{ "Diária": (v) => moeda(v), Extras: (v) => moeda(v), Pagamento: (v) => moeda(v) }}
              series={[
                { chave: "Diária", nome: "Diárias", cor: COR.azul, tipo: "barra", pilha: "c" },
                { chave: "Extras", nome: "Consumo, serviços e taxas", cor: COR.ambar, tipo: "barra", pilha: "c" },
                { chave: "Pagamento", nome: "Pagamentos", cor: COR.verde, tipo: "linha" },
              ]} />
          </Painel>

          <div className="hx-tres">
            <Painel sub="Composição" titulo="Por tipo de lançamento">
              <Rosca dados={porGrupo} fmt={(v) => moeda(v, true)} altura={200} />
            </Painel>
            <Painel sub="Fora as diárias" titulo="O que mais se vende">
              {topDescricoes.length ? <BarrasH dados={topDescricoes} fmt={(v) => moeda(v, true)} cor={COR.ambar} /> : <Vazio>Sem consumo ou serviços.</Vazio>}
            </Painel>
            <Painel sub="Recebido" titulo="Formas de pagamento">
              {formasPag.length ? <BarrasH dados={formasPag} fmt={(v) => moeda(v, true)} cor={COR.verde} /> : <Vazio>Sem pagamentos.</Vazio>}
            </Painel>
          </div>

          <Painel sub={`${num(filtradas.length)} lançamentos`} titulo="Todas as transações"
            acoes={<button type="button" className="hx-botao" onClick={() => planilha(filtradas, `transacoes-${nome.toLowerCase().replace(/\s+/g, "-")}-${ini}-a-${fim}`)}>Baixar planilha</button>}>
            <div className="hx-filtros">
              <div className="hx-chips" role="group" aria-label="Tipo de lançamento">
                <button type="button" className={!grupo ? "on" : ""} onClick={() => { setGrupo(""); setPagina(0); }}>Todos</button>
                {GRUPOS.map((g) => <button key={g} type="button" className={grupo === g ? "on" : ""} onClick={() => { setGrupo(g); setPagina(0); }}><i style={{ background: COR_GRUPO[g] }} />{g}</button>)}
              </div>
              <label className="hx-check"><input type="checkbox" checked={mostrarEstornos} onChange={(e) => setMostrarEstornos(e.target.checked)} /> Mostrar estornos</label>
              <Segmentos valor={ordem} mudar={setOrdem} rotulo="Ordem" opcoes={[["data", "Mais recentes"], ["valor", "Maiores valores"]]} />
              <input type="search" className="hx-busca" placeholder="Buscar descrição, reserva, UH…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
            </div>
            <div className="hx-rolagem">
              <table className="hx-tabela">
                <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Reserva</th><th>UH</th><th>Origem</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {vis.map((t) => (
                    <tr key={t.chave} className={t.estornado ? "estornado" : ""}>
                      <td className="mono">{dataBr(t.dia)}</td>
                      <td><span className="hx-etiqueta" style={{ ["--c" as string]: COR_GRUPO[t.grupo ?? "Outros"] ?? COR.cinza }}>{t.grupo}</span></td>
                      <td>{t.descricao}{t.estornado && <small className="hx-tag-estorno">estornado</small>}{t.observacao && <small className="muted"> · {t.observacao}</small>}</td>
                      <td className="mono">{t.reserva ?? "—"}</td><td>{t.uh ?? "—"}</td><td>{t.origem ?? "—"}</td>
                      <td className={`num mono ${Number(t.valor) < 0 ? "neg" : ""}`}>{moeda(Number(t.valor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paginas > 1 && (
              <div className="hx-paginas">
                <button type="button" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
                <span>Página {pagina + 1} de {paginas}</span>
                <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Próxima ›</button>
              </div>
            )}
          </Painel>
          <p className="hx-fonte">Fonte: relatório “Lançamentos por Período (Analítico)” do PMS. “Lançado na conta” soma diárias, consumo, serviços e taxas já descontados os estornos; “Pagamentos” soma o que foi recebido, em qualquer forma.</p>
        </>
      )}
    </div>
  );
}
