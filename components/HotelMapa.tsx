"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Bloqueio, type Estadia, type Fase, type Uh, FASES, canalNome, dataBr, dataCurta, diaSemana, difDias, faseBloqueio, faseDe,
  fimDeSemana, hojeFortaleza, inteiro, nomeStatus, ordemNatural, reais, somaDias, todas, valida,
} from "@/lib/hotel-reservas";

// Mapa de reservas do hotel (aba Mapa da página /hoteis/<hotel>): UHs nas linhas, dias nas colunas, uma barra por estadia.
// Desenho e regras adaptados da referência reservation-map-design.md: abre 2 dias antes de hoje, janelas de 7/15/30 dias,
// barras do meio da coluna de chegada ao meio da coluna de saída, faixas quando se sobrepõem, prévia ao passar o mouse.
// A fase vem do status real do PMS (Confirmada, Pendente, Check-in, Check-out); bloqueios vêm da disponibilidade do PMS.
// Só consulta: a operação das reservas continua no PMS. Dados lidos pelo robô de 45 em 45 a 75 em 75 minutos.

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
  const [previa, setPrevia] = useState<{ b: Barra; x: number; y: number; fixa: boolean } | null>(null);
  const grade = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async (silencioso = false) => {
    setEstado((e) => (silencioso && e !== "carregando" ? "atualizando" : e));
    try {
      const [u, e, b, h] = await Promise.all([
        todas<Uh>((de, ate) => supabase.from("pms_uhs").select("uh_id,numero,tipo,andar,ativa,fora_inventario,visto_em").eq("hotel_id", hotel).range(de, ate)),
        todas<Estadia>((de, ate) => supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel)
          .lt("checkin", fimExcl).gt("checkout", inicio).not("status_id", "in", "(5,6)").range(de, ate)),
        todas<Bloqueio>((de, ate) => supabase.from("pms_bloqueios").select("bloqueio_id,uh_id,inicio,fim,motivo,comentario").eq("hotel_id", hotel)
          .lt("inicio", fimExcl).gte("fim", inicio).range(de, ate)),
        todas<Estadia>((de, ate) => supabase.from("pms_estadias_canal").select("*").eq("hotel_id", hotel)
          .lte("checkin", hoje).gte("checkout", hoje).not("status_id", "in", "(5,6)").range(de, ate)),
      ]);
      setUhs(u.sort((a, z) => ordemNatural(a.numero, z.numero) || a.uh_id - z.uh_id));
      setEstadias(e); setBloqueios(b); setDeHoje(h);
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
    const montar = (chave: string, a: string, b: string, fase: Fase, extra: Partial<Barra>): Barra | null => {
      const ini0 = difDias(inicio, a) + 0.5, fim0 = difDias(inicio, b) + 0.5;
      const ini = Math.max(0, ini0), fim = Math.min(janela, fim0);
      if (fim <= ini) return null;
      return { chave, fase, ini, fim, cortadoIni: ini0 < 0, cortadoFim: fim0 > janela, faixa: 0, rotulo: "", sub: "", ...extra };
    };
    for (const e of estadias) {
      if (!valida(e)) continue;
      if (!e.uh_id || !ids.has(e.uh_id)) { if (e.status_id === 1 || e.status_id === 4 || e.status_id === 2) semUh.push(e); continue; }
      const b = montar(`e${e.item_id}`, e.checkin!, e.checkout!, faseDe(e), { estadia: e, rotulo: e.hospede || "Hóspede não informado", sub: e.codigo ?? "" });
      if (b) m.set(e.uh_id, [...(m.get(e.uh_id) ?? []), b]);
    }
    for (const bl of bloqueios) {
      if (!bl.uh_id || !bl.inicio || !bl.fim || !ids.has(bl.uh_id)) continue;
      const f = faseBloqueio(bl);
      const b = montar(`b${bl.bloqueio_id}`, bl.inicio, somaDias(bl.fim, 1), f, { bloqueio: bl, rotulo: f === "manutencao" ? "Manutenção" : "Bloqueio", sub: bl.motivo ?? "" });
      if (b) m.set(bl.uh_id, [...(m.get(bl.uh_id) ?? []), b]);
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
    const emCasa = validas.filter((e) => e.checkin! <= hoje && e.checkout! > hoje);
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
    const abaixo = r.bottom + 260 < window.innerHeight;
    setPrevia({ b, x: Math.min(Math.max(8, r.left), window.innerWidth - 336), y: abaixo ? r.bottom + 6 : Math.max(8, r.top - 6 - 250), fixa });
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
        <div><span className="mr-rotulo">Ocupação hoje</span><b className="mr-num">{kpis.ocupacao == null ? "—" : `${kpis.ocupacao}%`}</b><span className="mr-ctx">{kpis.ocupadas} de {kpis.ativas} UHs ativas</span></div>
        <div><span className="mr-rotulo">Entradas hoje</span><b className="mr-num">{inteiro(kpis.entradas)}</b><span className="mr-ctx">chegadas previstas</span></div>
        <div><span className="mr-rotulo">Saídas hoje</span><b className="mr-num">{inteiro(kpis.saidas)}</b><span className="mr-ctx">partidas previstas</span></div>
        <div><span className="mr-rotulo">Hóspedes em estadia</span><b className="mr-num">{inteiro(kpis.hospedes)}</b><span className="mr-ctx">{kpis.livres} UHs livres · {kpis.bloqueadas} bloqueadas</span></div>
      </div>

      <div className="mr-sinc" role="status">
        <span className={`mr-selo mr-selo-${estado}`}>{nomeEstado}</span>
        {atualizado && <span className="mr-ctx">PMS lido em {atualizado} · a tela confere a cada 60 s</span>}
      </div>
      <p className="mr-ctx mr-dica">Deslize a grade para o lado para ver mais dias; a coluna das UHs fica parada.</p>

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
              {uhs.map((u) => {
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
                            onClick={(ev) => abrirPrevia(b, ev.currentTarget, true)}>
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
        Cada barra vai do meio do dia de chegada ao meio do dia de saída. A cor segue o status no PMS. Reservas canceladas e no-show não aparecem.
        O mapa é só para consulta: as reservas são feitas e alteradas no PMS.
      </p>

      {/* Prévia */}
      {previa && (
        <div className="mr-previa" style={{ left: previa.x, top: previa.y }} role="dialog" aria-label="Detalhe da reserva">
          {previa.fixa && <button type="button" className="mr-previa-fechar" aria-label="Fechar" onClick={() => setPrevia(null)}>×</button>}
          {previa.b.estadia ? (() => {
            const e = previa.b.estadia!;
            return (
              <>
                <div className="mr-previa-topo"><span className="mr-mono">{e.codigo ?? "—"}</span><b>{e.vip ? "★ " : ""}{e.hospede || "Hóspede não informado"}</b></div>
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
                <div className="mr-previa-total"><span>Diárias informadas pelo canal</span><b>{e.valor_diarias == null ? "A conferir" : reais(e.valor_diarias)}</b></div>
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
    </div>
  );
}
