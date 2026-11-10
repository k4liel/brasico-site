"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import GavetaReserva from "./hotel/GavetaReserva";
import {
  type Bloqueio, type Estadia, type Fase, type Uh, FASES, canalNome, dataBr, dataCurta, diaSemana, difDias, faseBloqueio, faseDe,
  fimDeSemana, hojeFortaleza, inteiro, nomeStatus, ordemNatural, reais, somaDias, todas, valida,
} from "@/lib/hotel-reservas";

// Mapa de reservas do hotel (aba Mapa da página /hoteis/<hotel>): UHs nas linhas, dias nas colunas, uma barra por estadia.
// Desenho e regras adaptados da referência reservation-map-design.md: abre 2 dias antes de hoje, janelas de 7/15/30 dias,
// barras do meio da coluna de chegada ao meio da coluna de saída, faixas quando se sobrepõem, prévia ao passar o mouse.
// A fase vem do status real do PMS (Confirmada, Pendente, Check-in, Check-out); bloqueios vêm da disponibilidade do PMS.
// Só consulta: a operação das reservas continua no PMS. Dados lidos pelo robô de 45 em 45 a 75 em 75 minutos.

type Fin = { reserva: string; diarias: number; taxas: number; consumo: number; spa: number; servicos: number; lancado: number; pago: number; saldo: number; lancamentos: number };
type Acomp = { item_id: number; nome: string | null; principal: boolean; crianca: boolean; idade_crianca: number | null };
const pedacos = <T,>(l: T[], n = 150) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, (i + 1) * n));

type Barra = {
  chave: string; fase: Fase; ini: number; fim: number; cortadoIni: boolean; cortadoFim: boolean; faixa: number;
  estadia?: Estadia; bloqueio?: Bloqueio; rotulo: string; sub: string;
};

function useLarguraTela() {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return w;
}

export default function HotelMapa({ hotel }: { hotel: string }) {
  const supabase = useMemo(() => createClient(), []);
  const largura = useLarguraTela();
  const celular = largura <= 600;
  const hoje = hojeFortaleza();
  const [inicio, setInicio] = useState(() => somaDias(hojeFortaleza(), -2));
  const [dias, setDias] = useState<7 | 15 | 30 | null>(null); // null = padrão (15 no computador, 7 no celular)
  const janela = dias ?? (celular ? 7 : 15);
  const fimExcl = somaDias(inicio, janela);
  const COL = celular ? 66 : 104, NOME = celular ? 142 : 246, CAB = celular ? 57 : 68, ALT = celular ? 32 : 34, CHANFRO = celular ? 8 : 12;

  const [uhs, setUhs] = useState<Uh[] | null>(null);
  const [estadias, setEstadias] = useState<Estadia[]>([]);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [deHoje, setDeHoje] = useState<Estadia[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "atualizando" | "falhou">("carregando");
  const [erro, setErro] = useState<string | null>(null);
  // Prévia ao passar o mouse: abre embaixo ou em cima da barra (o lado com mais espaço), sem nunca cobrir a barra;
  // enquanto não está fixa (clique), ela não pega o mouse, para não fechar e abrir sem parar.
  const [previa, setPrevia] = useState<{ b: Barra; x: number; y: number; acima: boolean; max: number; fixa: boolean } | null>(null);
  const [aberta, setAberta] = useState<Estadia | null>(null);
  // Prévia completa: financeiro (transações), hóspedes da reserva e total da reserva (detalhes do PMS)
  const [fin, setFin] = useState<Map<string, Fin>>(new Map());
  const [acomp, setAcomp] = useState<Map<number, Acomp[]>>(new Map());
  const [totalRes, setTotalRes] = useState<Map<number, number>>(new Map());
  const grade = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async (silencioso = false) => {
    setEstado((e) => (silencioso && e !== "carregando" ? "atualizando" : e));
    try {
      const [u, e, b, h] = await Promise.all([
        todas<Uh>((de, ate) => supabase.from("pms_uhs").select("uh_id,numero,tipo,andar,ativa,fora_inventario,visto_em").eq("hotel_id", hotel).range(de, ate)),
        todas<Estadia>((de, ate) => supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel)
          .lt("checkin", fimExcl).gte("checkout", somaDias(inicio, -1)).neq("status_id", 6).range(de, ate)),
        todas<Bloqueio>((de, ate) => supabase.from("pms_bloqueios_atuais").select("bloqueio_id,uh_id,inicio,fim,motivo,comentario").eq("hotel_id", hotel)
          .lt("inicio", fimExcl).gte("fim", inicio).range(de, ate)),
        todas<Estadia>((de, ate) => supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel)
          .lte("checkin", hoje).gte("checkout", hoje).not("status_id", "in", "(5,6)").range(de, ate)),
      ]);
      setUhs(u.sort((a, z) => ordemNatural(a.numero, z.numero) || a.uh_id - z.uh_id));
      setEstadias(e); setBloqueios(b); setDeHoje(h);
      const codigos = [...new Set(e.map((x) => x.codigo).filter(Boolean) as string[])];
      const itens = [...new Set(e.map((x) => x.item_id).filter((x) => x > 0))];
      Promise.all([
        Promise.all(pedacos(codigos).map((c) => supabase.from("pms_reserva_financeiro").select("reserva,diarias,taxas,consumo,spa,servicos,lancado,pago,saldo,lancamentos").eq("hotel_id", hotel).in("reserva", c))),
        Promise.all(pedacos(itens).map((c) => supabase.from("pms_reserva_hospedes").select("item_id,nome,principal,crianca,idade_crianca").eq("hotel_id", hotel).in("item_id", c))),
        Promise.all(pedacos(itens).map((c) => supabase.from("pms_reserva_detalhes").select("item_id,total").eq("hotel_id", hotel).in("item_id", c))),
      ]).then(([f, a, d]) => {
        setFin(new Map(f.flatMap((r) => (r.data as Fin[]) ?? []).map((x) => [x.reserva, x])));
        const m = new Map<number, Acomp[]>();
        for (const x of a.flatMap((r) => (r.data as Acomp[]) ?? [])) m.set(x.item_id, [...(m.get(x.item_id) ?? []), x]);
        for (const l of m.values()) l.sort((x, y) => Number(y.principal) - Number(x.principal) || Number(x.crianca) - Number(y.crianca));
        setAcomp(m);
        setTotalRes(new Map(d.flatMap((r) => (r.data as { item_id: number; total: number | null }[]) ?? []).filter((x) => x.total != null).map((x) => [x.item_id, Number(x.total)])));
      }).catch(() => {});
      setEstado("ok"); setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "erro");
      setEstado((s) => (s === "carregando" ? "falhou" : "falhou"));
    }
  }, [supabase, hotel, inicio, fimExcl, hoje]);

  useEffect(() => { carregar(); }, [carregar]);
  // Atualiza a cada 60 s com a aba visível e ao voltar para a aba
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(true); }, 60000);
    const v = () => { if (document.visibilityState === "visible") carregar(true); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [carregar]);

  const diasJanela = useMemo(() => Array.from({ length: janela }, (_, i) => somaDias(inicio, i)), [inicio, janela]);

  // Barras por UH, com as faixas de sobreposição
  const { porUh, semUh } = useMemo(() => {
    const m = new Map<number, Barra[]>();
    const semUh: Estadia[] = [];
    const ids = new Set((uhs ?? []).map((u) => u.uh_id));
    // Barra do meio do dia de chegada ao meio do dia de saída; "frac" desloca as pontas (estadia de zero noites)
    const montar = (chave: string, a: string, b: string, fase: Fase, extra: Partial<Barra>, frac: [number, number] = [0.5, 0.5]): Barra | null => {
      const ini0 = difDias(inicio, a) + frac[0], fim0 = difDias(inicio, b) + frac[1];
      const ini = Math.max(0, ini0), fim = Math.min(janela, fim0);
      if (fim <= ini) return null;
      return { chave, fase, ini, fim, cortadoIni: ini0 < 0, cortadoFim: fim0 > janela, faixa: 0, rotulo: "", sub: "", ...extra };
    };
    for (const e of estadias) {
      if (e.status_id === 6 || !e.checkin || !e.checkout || e.checkout < e.checkin) continue;
      if (!e.uh_id || !ids.has(e.uh_id)) { if (valida(e) && (e.status_id === 1 || e.status_id === 4 || e.status_id === 2)) semUh.push(e); continue; }
      const nome = e.hospede || (e.item_id < 0 ? `Reserva ${e.codigo ?? ""}` : "Hóspede não informado");
      const sub = e.item_id < 0 ? "check-out · pelas transações" : e.codigo ?? "";
      const por = (b: Barra | null) => { if (b) m.set(e.uh_id!, [...(m.get(e.uh_id!) ?? []), b]); };
      const original = e.checkin_original && e.checkin_original < e.checkin ? e.checkin_original : null;
      if (e.status_id === 5) {
        // No-show: o PMS põe a saída igual à chegada; mostra a noite reservada
        const a = original ?? e.checkin, b = e.checkout > a ? e.checkout : somaDias(a, 1);
        por(montar(`n${e.item_id}`, a, b, "noshow", { estadia: e, rotulo: `No-show · ${nome}`, sub }));
        continue;
      }
      // Passou por no-show e o hóspede chegou depois: a noite perdida aparece como no-show, e a estadia em seguida
      if (e.teve_noshow && original) por(montar(`n${e.item_id}`, original, e.checkin, "noshow", { estadia: e, rotulo: `No-show · ${nome}`, sub: "depois fez check-in" }));
      if (e.checkout > e.checkin) por(montar(`e${e.item_id}`, e.checkin, e.checkout, faseDe(e), { estadia: e, rotulo: nome, sub }));
      else por(montar(`e${e.item_id}`, e.checkin, e.checkin, faseDe(e), { estadia: e, rotulo: nome, sub: `entrou e saiu no mesmo dia · ${sub}` }, [0.5, 0.98]));
    }
    for (const bl of bloqueios) {
      if (!bl.uh_id || !bl.inicio || !bl.fim || !ids.has(bl.uh_id)) continue;
      const f = faseBloqueio(bl);
      // Bloqueio ocupa dias inteiros: do começo do primeiro dia ao fim do último (o PMS conta o último dia como bloqueado).
      const b = montar(`b${bl.bloqueio_id}`, bl.inicio, bl.fim, f, { bloqueio: bl, rotulo: f === "manutencao" ? "Manutenção" : "Bloqueio", sub: bl.comentario || bl.motivo || "" }, [0.03, 0.97]);
      if (!b) continue;
      // Mas no PMS o bloqueio libera a UH no último dia antes do check-in (e só começa depois do check-out):
      // uma reserva que entra no último dia do bloqueio, ou sai no primeiro, nunca fica por baixo dele no mapa.
      for (const r of m.get(bl.uh_id) ?? []) {
        if (!r.estadia) continue;
        // Estadia que cobre o bloqueio inteiro (hóspede trocado de UH depois): o bloqueio não aparece
        if (r.ini <= b.ini && r.fim >= b.fim) { b.fim = b.ini; break; }
        if (r.ini >= b.ini && r.ini < b.fim) b.fim = r.ini;
        if (r.fim > b.ini && r.fim <= b.fim) b.ini = r.fim;
      }
      if (b.fim - b.ini < 0.05) continue;
      m.set(bl.uh_id, [...(m.get(bl.uh_id) ?? []), b]);
    }
    for (const [k, l] of m) {
      l.sort((a, b) => a.ini - b.ini || a.chave.localeCompare(b.chave));
      const fins: number[] = [];
      for (const b of l) {
        let f = fins.findIndex((x) => x <= b.ini + 1e-9);
        if (f < 0) { f = fins.length; fins.push(0); }
        b.faixa = f; fins[f] = b.fim;
      }
      m.set(k, l);
    }
    return { porUh: m, semUh: semUh.sort((a, b) => (a.checkin ?? "").localeCompare(b.checkin ?? "")) };
  }, [estadias, bloqueios, uhs, inicio, janela]);

  // Indicadores de hoje (independem da janela)
  const kpis = useMemo(() => {
    const ativas = (uhs ?? []).filter((u) => u.ativa && !u.fora_inventario);
    const idsAtivas = new Set(ativas.map((u) => u.uh_id));
    const validas = deHoje.filter(valida);
    // Ocupadas agora = hóspede com check-in feito (como no painel do PMS), inclusive quem ainda sai hoje
    const emCasa = validas.filter((e) => e.status_id === 2 && e.checkin! <= hoje && e.checkout! >= hoje);
    const ocupadas = new Set(emCasa.filter((e) => e.uh_id && idsAtivas.has(e.uh_id)).map((e) => e.uh_id));
    const bloqueadas = new Set(bloqueios.filter((b) => b.uh_id && idsAtivas.has(b.uh_id) && b.inicio! <= hoje && b.fim! >= hoje).map((b) => b.uh_id));
    const hospedes = emCasa.filter((e) => e.uh_id && idsAtivas.has(e.uh_id)).reduce((a, e) => a + (e.adultos ?? 0) + (e.criancas ?? 0), 0);
    const livres = [...idsAtivas].filter((id) => !ocupadas.has(id) && !bloqueadas.has(id)).length;
    return {
      ocupacao: ativas.length ? Math.round((100 * ocupadas.size) / ativas.length) : null, ocupadas: ocupadas.size, ativas: ativas.length,
      entradas: validas.filter((e) => e.checkin === hoje).length, saidas: validas.filter((e) => e.checkout === hoje).length,
      hospedes, livres, bloqueadas: bloqueadas.size,
    };
  }, [deHoje, uhs, bloqueios, hoje]);

  const atualizado = useMemo(() => {
    const t = (uhs ?? []).reduce((m, u) => (u.visto_em > m ? u.visto_em : m), "");
    return t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) : null;
  }, [uhs]);

  useEffect(() => {
    const el = grade.current;
    if (!el) return;
    const f = () => setPrevia((p) => (p?.fixa ? p : null));
    el.addEventListener("scroll", f, { passive: true });
    return () => el.removeEventListener("scroll", f);
  }, [uhs]);

  function abrirPrevia(b: Barra, alvo: HTMLElement, fixa: boolean) {
    const r = alvo.getBoundingClientRect();
    const embaixo = window.innerHeight - r.bottom - 14, emCima = r.top - 14;
    const acima = embaixo < 440 && emCima > embaixo;
    setPrevia({ b, x: Math.min(Math.max(8, r.left), window.innerWidth - 336), y: acima ? r.top - 6 : r.bottom + 6, acima, max: Math.max(160, acima ? emCima : embaixo), fixa });
  }

  const intervalo = `${dataBr(inicio)} a ${dataBr(somaDias(inicio, janela - 1))}`;
  const nomeEstado = estado === "carregando" ? "Consultando reservas" : estado === "atualizando" ? "Dados salvos · conferindo atualizações"
    : estado === "falhou" ? (uhs ? "Atualização falhou · dados salvos" : "Mapa indisponível") : "Mapa atualizado";

  return (
    <div className="mr">
      {/* Período */}
      <div className="mr-controles">
        <div className="mr-nav">
          <button type="button" className="mr-btn" aria-label={`Voltar ${janela} dias`} onClick={() => setInicio(somaDias(inicio, -janela))}>←</button>
          <button type="button" className="mr-btn" onClick={() => setInicio(somaDias(hoje, -2))}>Hoje</button>
          <button type="button" className="mr-btn" aria-label={`Avançar ${janela} dias`} onClick={() => setInicio(somaDias(inicio, janela))}>→</button>
        </div>
        <span className="mr-intervalo">{intervalo}</span>
        <div className="mr-janelas" role="group" aria-label="Dias visíveis">
          {([7, 15, 30] as const).map((d) => (
            <button key={d} type="button" className={janela === d ? "mr-btn on" : "mr-btn"} aria-pressed={janela === d} onClick={() => setDias(d)}>{d} dias</button>
          ))}
        </div>
      </div>

      {/* Indicadores de hoje */}
      <div className="mr-kpis">
        <div><span className="mr-rotulo">Ocupação agora</span><b className="mr-num">{kpis.ocupacao == null ? "—" : `${kpis.ocupacao}%`}</b><span className="mr-ctx">{kpis.ocupadas} de {kpis.ativas} UHs ativas</span></div>
        <div><span className="mr-rotulo">Entradas hoje</span><b className="mr-num">{inteiro(kpis.entradas)}</b><span className="mr-ctx">chegadas previstas</span></div>
        <div><span className="mr-rotulo">Saídas hoje</span><b className="mr-num">{inteiro(kpis.saidas)}</b><span className="mr-ctx">partidas previstas</span></div>
        <div><span className="mr-rotulo">Hóspedes no hotel</span><b className="mr-num">{inteiro(kpis.hospedes)}</b><span className="mr-ctx">{kpis.livres} UHs livres · {kpis.bloqueadas} bloqueadas</span></div>
      </div>

      <div className="mr-sinc" role="status">
        <span className={`mr-selo mr-selo-${estado}`}>{nomeEstado}</span>
        {atualizado && <span className="mr-ctx">PMS lido em {atualizado} · a tela confere a cada 60 s</span>}
      </div>
      <p className="mr-ctx mr-dica">Clique numa reserva para abrir tudo dela (detalhes, observações, histórico e transações). Deslize a grade para o lado para ver mais dias.</p>

      {estado === "falhou" && !uhs ? (
        <div className="mr-vazio">
          <p><b>Mapa indisponível.</b> {erro}</p>
          <button type="button" className="mr-btn" onClick={() => { setEstado("carregando"); carregar(); }}>Tentar novamente</button>
        </div>
      ) : uhs === null ? (
        <div className="mr-esqueleto" aria-hidden="true"><i /><i /><i /><i /></div>
      ) : uhs.length === 0 ? (
        <div className="mr-vazio"><p>O PMS ainda não informou as UHs deste hotel. O robô traz o inventário na próxima leitura.</p></div>
      ) : (
        <div className="mr-grade" ref={grade} tabIndex={0} aria-label="Grade do mapa de reservas"
          style={{ ["--mr-col" as string]: `${COL}px`, ["--mr-nome" as string]: `${NOME}px`, ["--mr-cab" as string]: `${CAB}px` }}>
          <table className="mr-tabela" style={{ width: NOME + COL * janela }}>
            <thead>
              <tr>
                <th scope="col" className="mr-canto">UH</th>
                {diasJanela.map((d) => (
                  <th key={d} scope="col" className={`mr-dia${fimDeSemana(d) ? " fds" : ""}${d === hoje ? " hoje" : ""}`}>
                    <span>{diaSemana(d)}</span><b>{dataCurta(d)}</b>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uhs.filter((u) => (u.ativa && !u.fora_inventario) || (porUh.get(u.uh_id)?.length ?? 0) > 0).map((u) => {
                const bs = porUh.get(u.uh_id) ?? [];
                const faixas = Math.max(1, ...bs.map((b) => b.faixa + 1));
                const altura = 16 + 40 * faixas;
                return (
                  <tr key={u.uh_id} style={{ height: altura }}>
                    <th scope="row" className={`mr-uh${u.ativa ? "" : " inativa"}`}>
                      <b>{u.numero}</b>
                      {!celular && <span>{!u.ativa || u.fora_inventario ? "Inativa / fora do inventário" : `${u.tipo ?? ""}${bs.length ? ` · ${bs.length} no período` : " · livre no período"}`}</span>}
                    </th>
                    <td colSpan={janela} className="mr-trilho">
                      <div className="mr-fundo" aria-hidden="true">
                        {diasJanela.map((d) => <i key={d} className={`${fimDeSemana(d) ? "fds" : ""}${d === hoje ? " hoje" : ""}`} />)}
                      </div>
                      {bs.map((b) => {
                        const l = b.ini * COL, w = (b.fim - b.ini) * COL;
                        const c = Math.min(CHANFRO, w / 3);
                        const poly = `polygon(${b.cortadoIni ? "0 0" : `${c}px 0`}, ${b.cortadoFim ? "100% 0" : `calc(100% - ${c}px) 0`}, 100% 50%, ${b.cortadoFim ? "100% 100%" : `calc(100% - ${c}px) 100%`}, ${b.cortadoIni ? "0 100%" : `${c}px 100%`}, 0 50%)`;
                        const e = b.estadia;
                        const rotuloA11y = e
                          ? `${e.codigo ?? ""} ${b.rotulo}, ${nomeStatus(e)}, ${dataBr(e.checkin)} a ${dataBr(e.checkout)}, ${(e.adultos ?? 0) + (e.criancas ?? 0)} hóspedes`
                          : `${b.rotulo}${b.sub ? ` (${b.sub})` : ""}, ${dataBr(b.bloqueio?.inicio ?? null)} a ${dataBr(b.bloqueio?.fim ?? null)}`;
                        return (
                          <button key={b.chave} type="button" className={`mr-barra fase-${b.fase}`} aria-label={rotuloA11y}
                            style={{ left: l, width: w, top: 10 + 40 * b.faixa, height: ALT, clipPath: poly }}
                            onMouseEnter={(ev) => abrirPrevia(b, ev.currentTarget, false)} onFocus={(ev) => abrirPrevia(b, ev.currentTarget, false)}
                            onMouseLeave={() => setPrevia((p) => (p?.fixa ? p : null))} onBlur={() => setPrevia((p) => (p?.fixa ? p : null))}
                            onClick={(ev) => { if (b.estadia) { setPrevia(null); setAberta(b.estadia); } else abrirPrevia(b, ev.currentTarget, true); }}>
                            <span className="mr-barra-nome">{e?.vip ? "★ " : ""}{b.rotulo}</span>
                            {!celular && b.sub && <span className="mr-barra-sub">{b.sub}</span>}
                          </button>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <ul className="mr-legenda">
        {FASES.map((f) => <li key={f.id}><i className={`fase-${f.id}`} />{f.nome}</li>)}
      </ul>

      {semUh.length > 0 && (
        <div className="mr-pendencias">
          <b>{semUh.length === 1 ? "1 reserva sem UH atribuída" : `${semUh.length} reservas sem UH atribuída`} neste período</b>
          <ul>
            {semUh.map((e) => (
              <li key={e.item_id}>{e.codigo} · {e.hospede || "Hóspede não informado"} · {e.tipo ?? "tipo não informado"} · {dataCurta(e.checkin)} a {dataCurta(e.checkout)} · {nomeStatus(e)}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mr-ctx mr-nota">
        Cada barra vai do meio do dia de chegada ao meio do dia de saída. A cor segue o status no PMS. Reservas canceladas não aparecem; no-show aparece em roxo na noite reservada (e, se o hóspede chegou depois, a estadia vem em seguida). Quem entrou e saiu no mesmo dia aparece como uma barra curta nesse dia. Check-outs antigos que a busca do PMS não traz vêm das transações (sem o nome do hóspede).
        O mapa é só para consulta: as reservas são feitas e alteradas no PMS.
      </p>

      {/* Prévia */}
      {previa && (
        <div className={previa.fixa ? "mr-previa fixa" : "mr-previa"} style={{ left: previa.x, top: previa.y, maxHeight: previa.max, transform: previa.acima ? "translateY(-100%)" : undefined }} role="dialog" aria-label="Detalhe da reserva">
          {previa.fixa && <button type="button" className="mr-previa-fechar" aria-label="Fechar" onClick={() => setPrevia(null)}>×</button>}
          {previa.b.estadia ? (() => {
            const e = previa.b.estadia!;
            return (
              <>
                <div className="mr-previa-topo"><span className="mr-mono">{e.codigo ?? "—"}</span><b>{e.vip ? "★ " : ""}{e.hospede || (e.item_id < 0 ? "Check-out (dados das transações, sem nome)" : "Hóspede não informado")}</b></div>
                <div className="mr-previa-3">
                  <div><span className="mr-rotulo">Hóspedes</span><b>{e.adultos ?? 0} adulto{(e.adultos ?? 0) === 1 ? "" : "s"}{e.criancas ? ` · ${e.criancas} criança${e.criancas === 1 ? "" : "s"}` : ""}</b></div>
                  <div><span className="mr-rotulo">Status</span><b>{nomeStatus(e)}</b></div>
                  <div><span className="mr-rotulo">Canal</span><b>{canalNome(e)}</b></div>
                </div>
                <div className="mr-previa-linhas">
                  <span>Estadia</span><b>{dataBr(e.checkin)} → {dataBr(e.checkout)} · {e.noites} noite{e.noites === 1 ? "" : "s"}</b>
                  <span>UH</span><b>{e.uh_numero ?? "—"} · {e.tipo ?? "—"}</b>
                  {e.tarifa && <><span>Tarifa</span><b>{e.tarifa}</b></>}
                  {e.grupo_nome && <><span>Grupo</span><b>{e.grupo_nome}</b></>}
                  {e.empresa && <><span>Empresa</span><b>{e.empresa}</b></>}
                </div>
                {(() => {
                  const hs = acomp.get(e.item_id) ?? [];
                  const f = e.codigo ? fin.get(e.codigo) : undefined;
                  const total = totalRes.get(e.item_id) ?? (e.valor_diarias != null ? Number(e.valor_diarias) : null);
                  const linhas: [string, number][] = f ? ([["Diárias", f.diarias], ["Taxas (serviço, ISS)", f.taxas], ["Consumo (restaurante, bar, frigobar)", f.consumo], ["Spa", f.spa], ["Serviços e outros", f.servicos]] as [string, number][]).filter(([, v]) => Math.abs(Number(v)) >= 0.01) : [];
                  return (<>
                    {hs.length > 0 && (
                      <div className="mr-previa-hosp">
                        <span className="mr-rotulo">Hóspedes da reserva</span>
                        {hs.map((h, i) => <b key={i}>{h.nome ?? "—"}<small>{h.principal ? "principal" : h.crianca ? `criança${h.idade_crianca != null ? ` · ${h.idade_crianca} anos` : ""}` : "acompanhante"}</small></b>)}
                      </div>
                    )}
                    {f ? (
                      <div className="mr-previa-fin">
                        {linhas.map(([n, v]) => <div key={n}><span>{n}</span><b>{reais(Number(v))}</b></div>)}
                        <div className="forte"><span>Total lançado</span><b>{reais(Number(f.lancado))}</b></div>
                        <div><span>Pago</span><b>{reais(Number(f.pago))}</b></div>
                        <div className={Number(f.saldo) > 0.009 ? "forte alerta" : "forte"}><span>{Number(f.saldo) > 0.009 ? "Falta pagar" : Number(f.saldo) < -0.009 ? "Pago a mais" : "Saldo"}</span><b>{reais(Math.abs(Number(f.saldo)))}</b></div>
                      </div>
                    ) : null}
                    {total != null && <div className="mr-previa-total"><span>Valor da reserva</span><b>{reais(total)}</b></div>}
                    {!f && total == null && <div className="mr-previa-total"><span>Financeiro</span><b>sem lançamentos ainda</b></div>}
                    <span className="mr-ctx">Clique na reserva para abrir tudo (detalhes, observações, histórico e cada lançamento).</span>
                  </>);
                })()}
              </>
            );
          })() : (
            <>
              <div className="mr-previa-topo"><b>{previa.b.rotulo}</b></div>
              <div className="mr-previa-linhas">
                <span>Período</span><b>{dataBr(previa.b.bloqueio?.inicio ?? null)} a {dataBr(previa.b.bloqueio?.fim ?? null)}</b>
                {previa.b.bloqueio?.motivo && <><span>Motivo</span><b>{previa.b.bloqueio.motivo}</b></>}
                {previa.b.bloqueio?.comentario && <><span>Observação</span><b>{previa.b.bloqueio.comentario}</b></>}
              </div>
            </>
          )}
        </div>
      )}
      {aberta && <GavetaReserva hotel={hotel} estadia={aberta} fechar={() => setAberta(null)} />}
    </div>
  );
}
