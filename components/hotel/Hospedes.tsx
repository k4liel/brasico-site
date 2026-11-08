"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Estadia, canalNome, dataBr, faseDe, nomeStatus, todas } from "@/lib/hotel-reservas";
import DetalheReserva, { quando } from "./DetalheReserva";
import { Kpi, Painel, Segmentos, Vazio, moeda, num, reais } from "./ui";

// Hóspedes do hotel (aba Hóspedes da página /hoteis/<hotel>): cadastro completo vindo do PMS (pms_hospedes), com as
// estadias de cada um (pms_reserva_hospedes + pms_estadias_canal) e, em cada estadia, detalhes, observações e histórico.
// Dados pessoais (LGPD): só os sócios veem; os campos sensíveis ficam escondidos até clicar em "Mostrar dados".

type Resumo = { guest_id: number; nome: string | null; email: string | null; contato: string | null; documento: string | null; documento_tipo_id: number | null;
  nascimento: string | null; cidade: string | null; uf: string | null; pais: string | null; estadias: number | null; noites: number | null;
  ultima_chegada: string | null; primeira_chegada: string | null; total_gasto: number | null; vip: boolean | null; hospedado_agora: boolean | null; tem_futura: boolean | null };
type Ficha = Resumo & { person_id: string | null; telefone: string | null; celular: string | null; sexo: string | null; rua: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cep: string | null; estado: string | null; motivo_viagem: string | null; atualizado_em: string };
type Filtro = "todos" | "agora" | "futura" | "voltaram";
type Ordem = "recentes" | "nome" | "estadias" | "gasto";

const COR_FASE: Record<string, string> = { reservada: "var(--fase-reservada)", pendente: "var(--fase-pendente)", hospedada: "var(--fase-hospedada)",
  finalizada: "var(--fase-finalizada)", noshow: "var(--fase-noshow)", cancelada: "var(--fase-cancelada)" };
const so = (v: string | null) => (v ?? "").replace(/\D/g, "");
export const documentoFmt = (d: string | null) => {
  const n = so(d);
  if (n.length === 11) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  if (n.length === 14) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
  return d ?? "—";
};
const esconder = (v: string | null, mostrar: boolean) => (!v ? "—" : mostrar ? v : v.length <= 4 ? "••••" : `${v.slice(0, 2)}${"•".repeat(Math.min(8, v.length - 4))}${v.slice(-2)}`);
const idade = (n: string | null) => {
  if (!n) return null;
  const h = new Date(), d = new Date(`${n}T12:00:00`);
  let a = h.getFullYear() - d.getFullYear();
  if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
};
const sexoNome = (s: string | null) => (s === "M" ? "Masculino" : s === "F" ? "Feminino" : s ?? "—");
const sem = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function planilha(l: Resumo[], nome: string) {
  const cab = ["Nome", "Documento", "E-mail", "Contato", "Nascimento", "Cidade", "UF", "País", "Estadias", "Noites", "Primeira chegada", "Última chegada", "Total gasto"];
  const e = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const c = l.map((x) => [x.nome, documentoFmt(x.documento), x.email, x.contato, x.nascimento, x.cidade, x.uf, x.pais, x.estadias, x.noites, x.primeira_chegada, x.ultima_chegada,
    x.total_gasto?.toString().replace(".", ",")].map(e).join(";"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [cab.map(e).join(";"), ...c].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function Hospedes({ hotel, nome }: { hotel: string; nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Resumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const [mostrar, setMostrar] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState<number | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [estadias, setEstadias] = useState<Estadia[] | null>(null);
  const [estadiaAberta, setEstadiaAberta] = useState<number | null>(null);

  useEffect(() => {
    setLista(null);
    todas<Resumo>((de, ate) => supabase.from("pms_hospedes_resumo").select("*").eq("hotel_id", hotel).range(de, ate))
      .then((l) => { setLista(l); setErro(null); })
      .catch((e) => { setErro(e instanceof Error ? e.message : "erro"); setLista([]); });
  }, [supabase, hotel]);

  // Ficha do hóspede aberto
  useEffect(() => {
    setFicha(null); setEstadias(null); setEstadiaAberta(null);
    if (aberto == null) return;
    (async () => {
      const [f, rh] = await Promise.all([
        supabase.from("pms_hospedes").select("*").eq("hotel_id", hotel).eq("guest_id", aberto).maybeSingle(),
        supabase.from("pms_reserva_hospedes").select("item_id").eq("hotel_id", hotel).eq("guest_id", aberto),
      ]);
      const r = (lista ?? []).find((x) => x.guest_id === aberto);
      setFicha({ ...(r ?? {}), ...((f.data as object) ?? {}) } as Ficha);
      const itens = [...new Set(((rh.data as { item_id: number }[]) ?? []).map((x) => x.item_id))];
      if (!itens.length) { setEstadias([]); return; }
      const e = await supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel).in("item_id", itens).order("checkin", { ascending: false });
      setEstadias((e.data as Estadia[]) ?? []);
    })();
  }, [supabase, hotel, aberto, lista]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(null); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, []);

  const filtradas = useMemo(() => {
    const b = sem(busca.trim()), bn = so(busca);
    const l = (lista ?? []).filter((h) => (filtro === "todos" || (filtro === "agora" && h.hospedado_agora) || (filtro === "futura" && h.tem_futura) || (filtro === "voltaram" && (h.estadias ?? 0) >= 2)) &&
      (!b || [h.nome, h.email, h.cidade, h.pais].some((v) => sem(v ?? "").includes(b)) || (bn.length >= 3 && [h.documento, h.contato].some((v) => so(v).includes(bn)))));
    const s = [...l];
    if (ordem === "nome") s.sort((a, z) => (a.nome ?? "").localeCompare(z.nome ?? "", "pt-BR"));
    else if (ordem === "estadias") s.sort((a, z) => (z.estadias ?? 0) - (a.estadias ?? 0) || (z.ultima_chegada ?? "").localeCompare(a.ultima_chegada ?? ""));
    else if (ordem === "gasto") s.sort((a, z) => Number(z.total_gasto ?? 0) - Number(a.total_gasto ?? 0));
    else s.sort((a, z) => (z.ultima_chegada ?? "").localeCompare(a.ultima_chegada ?? ""));
    return s;
  }, [lista, busca, filtro, ordem]);

  const ind = useMemo(() => {
    const l = lista ?? [];
    return { total: l.length, agora: l.filter((h) => h.hospedado_agora).length, futura: l.filter((h) => h.tem_futura).length,
      voltaram: l.filter((h) => (h.estadias ?? 0) >= 2).length, comEstadia: l.filter((h) => (h.estadias ?? 0) >= 1).length };
  }, [lista]);

  const POR = 50, paginas = Math.max(1, Math.ceil(filtradas.length / POR));
  const vis = filtradas.slice(pagina * POR, (pagina + 1) * POR);

  return (
    <div className="hx-pilha">
      <div className="hx-barra-periodo">
        <h2>Hóspedes</h2>
        <div className="hx-controles">
          <button type="button" className="hx-botao" onClick={() => setMostrar(!mostrar)}>{mostrar ? "Esconder dados" : "Mostrar dados"}</button>
          <button type="button" className="hx-botao" onClick={() => planilha(filtradas, `hospedes-${nome.toLowerCase().replace(/\s+/g, "-")}`)}>Baixar planilha</button>
        </div>
      </div>

      {erro && <Vazio>Não foi possível abrir os hóspedes: {erro}</Vazio>}
      {lista === null ? <div className="hx-carregando"><i /><i /></div> : lista.length === 0 ? (
        <Vazio>Os cadastros dos hóspedes ainda estão chegando do PMS. O robô traz as reservas ativas primeiro e depois o histórico, aos poucos.</Vazio>
      ) : (
        <>
          <div className="hx-kpis">
            <Kpi rotulo="Hóspedes cadastrados" valor={num(ind.total)} nota={`${num(ind.comEstadia)} com estadia ligada`} />
            <Kpi rotulo="Hospedados agora" valor={num(ind.agora)} />
            <Kpi rotulo="Com reserva futura" valor={num(ind.futura)} />
            <Kpi rotulo="Voltaram" valor={num(ind.voltaram)} nota={ind.comEstadia ? `${num((100 * ind.voltaram) / ind.comEstadia, 1)}% com 2 ou mais estadias` : undefined} />
          </div>

          <Painel titulo="Todos os hóspedes" sub={`${num(filtradas.length)} hóspedes`}>
            <div className="hx-filtros">
              <input type="search" className="hx-busca" placeholder="Buscar nome, documento, e-mail, telefone ou cidade…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
              <Segmentos valor={filtro} rotulo="Filtro" mudar={(v) => { setFiltro(v); setPagina(0); }}
                opcoes={[["todos", "Todos"], ["agora", "Hospedados agora"], ["futura", "Reserva futura"], ["voltaram", "Voltaram"]]} />
              <select className="hx-select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordem">
                <option value="recentes">Chegada mais recente</option><option value="nome">Nome</option><option value="estadias">Mais estadias</option><option value="gasto">Maior gasto</option>
              </select>
            </div>
            <div className="hx-rolagem">
              <table className="hx-tabela clicavel">
                <thead><tr><th>Hóspede</th><th>Documento</th><th>Contato</th><th>Cidade</th><th className="num">Estadias</th><th>Última chegada</th><th className="num">Gasto</th></tr></thead>
                <tbody>
                  {vis.map((h) => (
                    <tr key={h.guest_id} onClick={() => setAberto(h.guest_id)} className={aberto === h.guest_id ? "on" : ""}>
                      <td><b className="hx-forte">{h.vip ? "★ " : ""}{h.nome ?? "—"}</b>
                        {h.hospedado_agora ? <small className="hx-tag-agora">hospedado agora</small> : h.tem_futura ? <small className="muted">reserva futura</small> : null}</td>
                      <td className="mono">{esconder(documentoFmt(h.documento) === "—" ? null : documentoFmt(h.documento), mostrar)}</td>
                      <td>{esconder(h.contato, mostrar)}<small className="muted">{esconder(h.email, mostrar)}</small></td>
                      <td>{[h.cidade, h.uf].filter(Boolean).join(" / ") || "—"}<small className="muted">{h.pais && h.pais !== "Brasil" ? h.pais : ""}</small></td>
                      <td className="num">{num(h.estadias ?? 0)}</td>
                      <td className="mono">{dataBr(h.ultima_chegada)}</td>
                      <td className="num">{h.total_gasto == null ? "—" : reais(Number(h.total_gasto))}</td>
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
          <p className="hx-fonte">Cadastro, detalhes e histórico vêm do PMS (lidos pelo robô a cada ~30 min; as reservas antigas chegam aos poucos). Dados pessoais: uso interno dos sócios (LGPD). “Gasto” soma o total das estadias concluídas em que a pessoa foi o hóspede principal.</p>
        </>
      )}

      {aberto != null && (
        <>
          <div className="hx-veu" onClick={() => setAberto(null)} />
          <aside className="hx-gaveta hx-gaveta-larga" role="dialog" aria-label="Ficha do hóspede">
            <header>
              <div><span className="hx-sobre">Ficha do hóspede</span><h3>{ficha?.vip ? "★ " : ""}{ficha?.nome ?? "…"}</h3>
                {ficha?.hospedado_agora && <span className="hx-etiqueta" style={{ ["--c" as string]: "var(--fase-hospedada)" }}>Hospedado agora</span>}</div>
              <button type="button" className="hx-fechar" aria-label="Fechar" onClick={() => setAberto(null)}>×</button>
            </header>
            {!ficha ? <p className="muted">Carregando…</p> : (
              <>
                <div className="hx-gaveta-grade">
                  <div><span>Documento</span><b className="mono">{documentoFmt(ficha.documento)}</b></div>
                  <div><span>Nascimento</span><b>{ficha.nascimento ? `${dataBr(ficha.nascimento)}${idade(ficha.nascimento) != null ? ` · ${idade(ficha.nascimento)} anos` : ""}` : "—"}</b></div>
                  <div><span>E-mail</span><b>{ficha.email ?? "—"}</b></div>
                  <div><span>Sexo</span><b>{sexoNome(ficha.sexo)}</b></div>
                  <div><span>Celular</span><b>{ficha.celular ?? "—"}</b></div>
                  <div><span>Telefone</span><b>{ficha.telefone ?? "—"}</b></div>
                  <div className="largo"><span>Endereço</span><b>{[[ficha.rua, ficha.numero].filter(Boolean).join(", "), ficha.complemento, ficha.bairro].filter(Boolean).join(" · ") || "—"}
                    <small>{[ficha.cidade, ficha.uf ?? ficha.estado, ficha.pais, ficha.cep ? `CEP ${ficha.cep}` : null].filter(Boolean).join(" · ")}</small></b></div>
                  {ficha.motivo_viagem && <div><span>Motivo da viagem</span><b>{ficha.motivo_viagem}</b></div>}
                  <div><span>Atualizado do PMS</span><b>{quando(ficha.atualizado_em)}</b></div>
                </div>
                <div className="hx-gaveta-somas">
                  <div><span>Estadias</span><b>{num(ficha.estadias ?? 0)}</b></div>
                  <div><span>Noites</span><b>{num(ficha.noites ?? 0)}</b></div>
                </div>
                <div className="hx-gaveta-total"><span>Total das estadias (hóspede principal)</span><b>{ficha.total_gasto == null ? "—" : moeda(Number(ficha.total_gasto))}</b></div>

                <h4>Estadias</h4>
                {estadias === null ? <p className="muted">Carregando…</p> : estadias.length === 0 ? <p className="muted">Nenhuma estadia ligada ainda.</p> : (
                  <ul className="hx-estadias">
                    {estadias.map((e) => (
                      <li key={e.item_id} className={estadiaAberta === e.item_id ? "on" : ""}>
                        <button type="button" onClick={() => setEstadiaAberta(estadiaAberta === e.item_id ? null : e.item_id)}>
                          <span><b>{dataBr(e.checkin)} → {dataBr(e.checkout)}</b><small>{e.noites ?? 0} noite{e.noites === 1 ? "" : "s"} · UH {e.uh_numero ?? "—"} · {canalNome(e)}</small></span>
                          <span className="hx-etiqueta" style={{ ["--c" as string]: COR_FASE[faseDe(e)] }}>{nomeStatus(e)}</span>
                        </button>
                        {estadiaAberta === e.item_id && <DetalheReserva hotel={hotel} item={e.item_id} abrirHospede={(g) => setAberto(g)} />}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
