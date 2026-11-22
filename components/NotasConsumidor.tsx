"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import JanelaPdfNota from "./JanelaPdfNota";

// NFC-e da página Notas: as notas fiscais de consumidor das vendas dos restaurantes, que a TOTVS manda junto
// com cada venda (supabase/nfce.sql). Atualiza sozinho: a leitura ao vivo da TOTVS roda a cada minuto.
//  - NotasConsumidor: aba "NFC-e (vendas)": por mês e casa, 50 por página, nota aberta com itens, impostos e PDF.
//  - LeituraNfce: bloco da aba "Leituras" (andamento do histórico por casa).
// Vendas sem nota (ex.: assinada que vai para a conta do quarto) e notas pendentes também aparecem, para conferir.
type Unidade = { id: string; nome: string };
type Mes = {
  mes: string; unidade_id: string; emitente_cnpj: string | null; notas: number; canceladas: number; pendentes: number; sem_nota: number;
  valor: number; valor_sem_nota: number; valor_pendente: number; servico: number; icms: number; pis: number; cofins: number; cbs: number; ibs: number;
};
type Linha = {
  unidade_id: string; chave_venda: string; dia: string; emissao: string | null; chave: string | null; emitente_cnpj: string | null;
  numero: number | null; serie: string | null; situacao: string; cupom: number | null; caixa: number | null; valor: number | null; protocolo: string | null;
};
type Imp = { aliquota: number | null; base?: number | null; valor: number | null; cst?: string } | null;
type ItemV = {
  n: number; codigo: number | null; nome: string; grupo: string | null; ncm: string | null; unidade: string | null; cfop: string | null;
  cst: string | null; csosn: string | null; quantidade: number; valor_unitario: number; desconto: number; acrescimo: number;
  valor_total: number; cancelado: boolean; icms: Imp; pis: Imp; cofins: Imp;
  ibscbs: { cst: string | null; cclasstrib: string | null; base: number | null; cbs: Imp; ibs_uf: Imp; ibs_mun: Imp } | null;
};
type Completa = Linha & {
  pessoas: number | null; consumidor_identificado: boolean; subtotal: number | null; servico: number | null; desconto: number | null;
  acrescimo: number | null; taxa_entrega: number | null; troco: number | null; base_icms: number | null; icms: number | null; pis: number | null;
  cofins: number | null; cbs: number | null; ibs: number | null; itens: ItemV[]; pagamentos: { descricao: string; valor: number; recebido?: number }[];
  cancelamento: { quando?: string | null; motivo?: string | null; protocolo?: string | null; operador?: string | null } | null;
};
type Leitura = { unidade_id: string; nome: string; ultima_leitura: string | null; desde: string | null; dias_lidos: number; dias_faltam: number };

const CONSULTA_RN = "https://nfce.sefaz.rn.gov.br/portalDFE/NFCe/ConsultaNFCe.aspx";
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }) : "");
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const pct = (v: number | null | undefined) => (v == null ? "" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const doc = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "");
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const POR_PAGINA = 50;
const SITUACAO: Record<string, { txt: string; cls: string; marca: string }> = {
  autorizada: { txt: "autorizada", cls: "tv-ok", marca: "completa" },
  cancelada: { txt: "cancelada", cls: "tv-falha", marca: "cancelada" },
  pendente: { txt: "pendente na SEFAZ", cls: "tv-falha", marca: "cancelada" },
  sem_nota: { txt: "sem nota fiscal", cls: "tv-revisar", marca: "resumo" },
  venda_cancelada: { txt: "venda cancelada", cls: "tv-revisar", marca: "cancelada" },
};
const urlPdf = (n: { unidade_id: string; chave_venda: string }) => `/api/nfce/danfce/${n.unidade_id}/${encodeURIComponent(n.chave_venda)}`;

function useBase(supabase: ReturnType<typeof createClient>) {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [pronto, setPronto] = useState(false);
  const carregar = useCallback(async () => {
    const [u, m] = await Promise.all([
      supabase.from("totvs_unidades").select("id,nome").order("ordem"),
      supabase.from("nfce_meses").select("*").order("mes", { ascending: false }),
    ]);
    setUnidades((u.data ?? []) as Unidade[]);
    setMeses((m.data ?? []) as Mes[]);
    setPronto(true);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);
  return { unidades, meses, pronto, carregar };
}

export default function NotasConsumidor() {
  const supabase = useMemo(() => createClient(), []);
  const { unidades, meses, pronto, carregar } = useBase(supabase);
  const [mes, setMes] = useState("");
  const [unidade, setUnidade] = useState("");
  const [situacao, setSituacao] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [total, setTotal] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => { setMes((v) => v || meses[0]?.mes || ""); }, [meses]);
  useEffect(() => { setPagina(0); }, [mes, unidade, situacao, termo]);
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  // Notas novas chegam a cada minuto (leitura ao vivo da TOTVS): a lista e os totais se atualizam sozinhos
  useEffect(() => {
    const t = setInterval(() => { carregar(); setVersao((v) => v + 1); }, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    (async () => {
      if (!mes) { setLinhas(pronto ? [] : null); return; }
      if (versao === 0) setLinhas(null);
      const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1);
      const fim = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}-01`;
      let q = supabase.from("nfce_notas")
        .select("unidade_id,chave_venda,dia,emissao,chave,emitente_cnpj,numero,serie,situacao,cupom,caixa,valor,protocolo", { count: "exact" })
        .gte("dia", `${mes}-01`).lt("dia", fim);
      if (unidade) q = q.eq("unidade_id", unidade);
      if (situacao) q = q.eq("situacao", situacao);
      const t = termo.replace(/\D/g, "");
      if (termo) {
        if (t.length === 44) q = q.eq("chave", t);
        else if (t) q = q.or(`numero.eq.${t},cupom.eq.${t}`);
      }
      const { data, count } = await q.order("emissao", { ascending: false, nullsFirst: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      setLinhas((data ?? []) as Linha[]);
      setTotal(count ?? 0);
    })();
  }, [supabase, mes, unidade, situacao, termo, pagina, pronto, versao]);

  const nomeUnidade = Object.fromEntries(unidades.map((u) => [u.id, u.nome]));
  const doMes = meses.filter((m) => m.mes === mes && (!unidade || m.unidade_id === unidade));
  const soma = (k: keyof Mes) => doMes.reduce((s, m) => s + Number(m[k] ?? 0), 0);
  const listaMeses = [...new Set(meses.map((m) => m.mes))];
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const unidadesComNota = unidades.filter((u) => meses.some((m) => m.unidade_id === u.id));

  // Na página: agrupa por casa
  const grupos: { unidade: string; notas: Linha[] }[] = [];
  for (const n of linhas ?? []) {
    let g = grupos.find((x) => x.unidade === n.unidade_id);
    if (!g) grupos.push((g = { unidade: n.unidade_id, notas: [] }));
    g.notas.push(n);
  }
  const tm = (u?: string) => meses.filter((x) => x.mes === mes && (!u || x.unidade_id === u));

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">NFC-e autorizadas</span><span className="es-numero-valor">{brl(soma("valor"))}</span><span className="tv-cartao-detalhe">{soma("notas").toLocaleString("pt-BR")} notas · taxa de serviço {brl(soma("servico"))}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Impostos nas notas</span><span className="es-numero-valor">{brl(soma("icms") + soma("pis") + soma("cofins"))}</span><span className="tv-cartao-detalhe">ICMS {brl(soma("icms"))} · PIS {brl(soma("pis"))} · Cofins {brl(soma("cofins"))}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Reforma (teste 2026)</span><span className="es-numero-valor">{brl(soma("cbs") + soma("ibs"))}</span><span className="tv-cartao-detalhe">CBS {brl(soma("cbs"))} · IBS {brl(soma("ibs"))}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Para conferir</span><span className="es-numero-valor">{(soma("pendentes") + soma("canceladas")).toLocaleString("pt-BR")}</span><span className="tv-cartao-detalhe">{soma("pendentes")} pendentes ({brl(soma("valor_pendente"))}) · {soma("canceladas")} canceladas · {soma("sem_nota")} vendas sem nota ({brl(soma("valor_sem_nota"))})</span></div>
      </div>
      {soma("pendentes") > 0 && (
        <p className="es-aviso">
          {soma("pendentes")} venda(s) deste mês aparecem como NFC-e sem autorização da SEFAZ (sem chave ou sem protocolo). Normalmente é nota em contingência que o caixa
          ainda não transmitiu. Filtre por &quot;Pendentes na SEFAZ&quot; para ver quais são e confira no caixa da TOTVS.
        </p>
      )}

      <div className="ft-barra nf-barra">
        <div className="nf-escolha">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            {!listaMeses.length && <option value="">Sem notas ainda</option>}
            {listaMeses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação">
            <option value="">Todas as vendas</option>
            <option value="autorizada">Só NFC-e autorizadas</option>
            <option value="cancelada">Só NFC-e canceladas</option>
            <option value="pendente">Pendentes na SEFAZ</option>
            <option value="sem_nota">Vendas sem nota fiscal</option>
            <option value="venda_cancelada">Vendas canceladas sem nota</option>
          </select>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número da nota, cupom ou chave de acesso" aria-label="Buscar NFC-e" />
        </div>
      </div>
      <div className="ft-chips nf-empresas" role="tablist" aria-label="Casa">
        <button role="tab" aria-selected={!unidade} className={!unidade ? "on" : ""} onClick={() => setUnidade("")}>Todas as casas</button>
        {unidadesComNota.map((u) => (
          <button key={u.id} role="tab" aria-selected={unidade === u.id} className={unidade === u.id ? "on" : ""} onClick={() => setUnidade(u.id)}>
            {u.nome}<span>{tm(u.id).reduce((s, m) => s + m.notas, 0).toLocaleString("pt-BR")}</span>
          </button>
        ))}
      </div>

      {linhas === null ? <p className="muted">Carregando as NFC-e…</p> : !linhas.length ? (
        <p className="muted vazio">{meses.length ? "Nenhuma venda com esses filtros." : "Nenhuma NFC-e lida ainda. As notas chegam junto com as vendas da TOTVS; o histórico vai entrando aos poucos (aba Leituras)."}</p>
      ) : (
        <>
          <section className="nf-mes">
            <header className="nf-mes-cabeca">
              <h2>{nomeMes(mes)}</h2>
              <span className="muted">{tm(unidade || undefined).reduce((s, m) => s + m.notas, 0).toLocaleString("pt-BR")} NFC-e · {brl(tm(unidade || undefined).reduce((s, m) => s + Number(m.valor), 0))}</span>
            </header>
            {grupos.map((g) => {
              const t = tm(g.unidade);
              const cnpjs = [...new Set(t.map((x) => x.emitente_cnpj).filter(Boolean))] as string[];
              return (
                <div key={g.unidade} className="nf-grupo aberto">
                  <div className="nf-grupo-cabeca">
                    <span className="nf-grupo-icone" aria-hidden="true">{(nomeUnidade[g.unidade] ?? "C").slice(0, 1)}</span>
                    <span className="nf-grupo-nome"><strong>{nomeUnidade[g.unidade] ?? g.unidade}</strong><small>{cnpjs.map((c) => `CNPJ ${doc(c)}`).join(" · ") || "caixa TOTVS"}</small></span>
                    <span className="nf-grupo-conta">
                      <span><i className="nf-card-marca completa" />{t.reduce((s, x) => s + x.notas, 0).toLocaleString("pt-BR")} autorizadas</span>
                      {t.reduce((s, x) => s + x.canceladas, 0) > 0 && <span><i className="nf-card-marca cancelada" />{t.reduce((s, x) => s + x.canceladas, 0)} canceladas</span>}
                      {t.reduce((s, x) => s + x.sem_nota, 0) > 0 && <span><i className="nf-card-marca resumo" />{t.reduce((s, x) => s + x.sem_nota, 0)} sem nota</span>}
                      <span className="muted">{g.notas.length} nesta página</span>
                    </span>
                    <span className="nf-grupo-total"><b>{brl(t.reduce((s, x) => s + Number(x.valor), 0))}</b><small>no mês</small></span>
                  </div>
                  <ul className="nf-cards">
                    {g.notas.map((n) => {
                      const k = `${n.unidade_id}|${n.chave_venda}`;
                      const esta = aberta === k;
                      const s = SITUACAO[n.situacao] ?? SITUACAO.autorizada;
                      return (
                        <li key={k} className={esta ? "nf-card aberto" : "nf-card"}>
                          <button className="nf-card-linha" onClick={() => setAberta(esta ? null : k)} aria-expanded={esta}>
                            <span className={`nf-card-marca ${s.marca}`} aria-hidden="true" />
                            <span className="nf-card-forn"><strong>{n.chave ? `NFC-e nº ${n.numero ?? "—"}` : `Venda · cupom ${n.cupom ?? "—"}`}</strong><small>{n.chave ? `série ${n.serie ?? "—"} · cupom ${n.cupom ?? "—"}` : "sem chave de acesso"} · caixa {n.caixa ?? "—"}</small></span>
                            <span className="nf-card-num"><b>{hora(n.emissao)}</b><small>hora</small></span>
                            <span className="nf-card-data"><b>{dia(n.emissao ?? `${n.dia}T12:00:00-03:00`)}</b><small>emissão</small></span>
                            <span className="nf-card-valor">{brl(n.valor)}</span>
                            <span className="nf-card-selo"><span className={`estado ${s.cls}`}>{s.txt}</span></span>
                            <span className="ip-seta" aria-hidden="true" />
                          </button>
                          {esta && <NfceAberta linha={n} casa={nomeUnidade[n.unidade_id]} onFechar={() => setAberta(null)} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
          <nav className="nf-paginas" aria-label="Páginas">
            <button className="ghost small" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
            <span className="muted">Página {pagina + 1} de {paginas} · {total.toLocaleString("pt-BR")} vendas</span>
            <button className="ghost small" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
          </nav>
        </>
      )}
    </>
  );
}

function NfceAberta({ linha, casa, onFechar }: { linha: Linha; casa?: string; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [n, setN] = useState<Completa | null>(null);
  const [verPdf, setVerPdf] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    supabase.from("nfce_notas").select("*").eq("unidade_id", linha.unidade_id).eq("chave_venda", linha.chave_venda).single()
      .then(({ data }) => setN(data as Completa));
  }, [supabase, linha]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && !verPdf && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar, verPdf]);

  async function consultar() {
    if (!linha.chave) return;
    try { await navigator.clipboard.writeText(linha.chave); setCopiado(true); } catch { /* sem área de transferência */ }
    window.open(CONSULTA_RN, "_blank", "noopener");
  }

  const s = SITUACAO[linha.situacao] ?? SITUACAO.autorizada;
  const itens = n?.itens ?? [];
  const classes = [...new Set(itens.filter((i) => !i.cancelado).map((i) => i.ibscbs?.cclasstrib).filter(Boolean))] as string[];
  return (
    <div className="nf-aberta" onClick={(e) => e.stopPropagation()}>
      <header className="nf-aberta-cabeca">
        <div className="ft-painel-titulo">
          <span className="es-sobre">{linha.chave ? `NFC-e nº ${linha.numero ?? "—"} · série ${linha.serie ?? "—"}` : `Venda sem NFC-e · cupom ${linha.cupom ?? "—"}`}</span>
          <h2 className="nf-painel-nome">{casa ?? linha.unidade_id}</h2>
          <p className="muted nf-painel-sub">Emitente CNPJ {doc(linha.emitente_cnpj)} · caixa {linha.caixa ?? "—"} · cupom {linha.cupom ?? "—"}</p>
          <div className="ft-indicadores">
            <span><small>Emissão</small><b>{dia(linha.emissao)} {hora(linha.emissao)}</b></span>
            <span><small>Valor</small><b>{brl(linha.valor)}</b></span>
            <span><small>Pessoas</small><b>{n?.pessoas ?? "—"}</b></span>
            <span><small>Situação</small><b><span className={`estado ${s.cls}`}>{s.txt}</span></b></span>
          </div>
        </div>
        <div className="ft-painel-acoes">
          <button className="small" onClick={() => setVerPdf(true)}>Ver PDF</button>
          {linha.chave && <button className="ghost small" onClick={consultar} title="Copia a chave e abre a consulta da SEFAZ-RN">{copiado ? "Chave copiada" : "Consultar na SEFAZ"}</button>}
          <button className="ghost small" onClick={onFechar}>Fechar</button>
        </div>
      </header>
      <div className="nf-painel-corpo">
        {!n ? <p className="muted">Carregando a nota…</p> : (
          <>
            {linha.situacao === "pendente" && <p className="es-aviso">Esta venda deveria ter NFC-e, mas a TOTVS não mostra a autorização da SEFAZ (sem chave ou sem protocolo). Confira no caixa se a nota foi transmitida.</p>}
            {linha.situacao === "sem_nota" && <p className="es-aviso">Esta venda não emitiu nota fiscal no caixa (ex.: assinada que vai para a conta do quarto e é faturada pelo hotel).</p>}
            {n.cancelamento && (
              <p className="es-aviso">Cancelada{n.cancelamento.quando ? ` em ${dia(n.cancelamento.quando)} ${hora(n.cancelamento.quando)}` : ""}{n.cancelamento.operador ? ` por ${n.cancelamento.operador}` : ""}{n.cancelamento.motivo ? ` · motivo: ${n.cancelamento.motivo}` : ""}{n.cancelamento.protocolo ? ` · protocolo ${n.cancelamento.protocolo}` : ""}.</p>
            )}
            <dl className="nf-dados">
              <div><dt>Protocolo de autorização</dt><dd>{linha.protocolo ?? "—"}</dd></div>
              <div><dt>Consumidor</dt><dd>{n.consumidor_identificado ? "Identificado (CPF na nota)" : "Não identificado"}</dd></div>
              <div><dt>Data de movimento</dt><dd>{dia(`${linha.dia}T12:00:00-03:00`)}</dd></div>
              <div><dt>Classificação da reforma</dt><dd>{classes.length ? classes.map((c) => `cClassTrib ${c}`).join(" · ") : "—"}</dd></div>
              {linha.chave && <div className="nf-dados-largo"><dt>Chave de acesso</dt><dd className="nf-chave">{chaveFmt(linha.chave)}</dd></div>}
            </dl>

            <section className="nf-bloco">
              <h3>Itens <span className="muted">· {itens.length}</span></h3>
              <div className="nf-tabela-wrap">
                <table className="nf-tabela nf-itens-tabela">
                  <thead><tr><th>#</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>CST</th><th className="n">Qtd.</th><th>Un.</th><th className="n">V. unit.</th><th className="n">Total</th><th className="n">ICMS</th><th className="n">PIS/Cofins</th><th className="n">CBS/IBS</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.n} className={i.cancelado ? "muted" : ""}>
                        <td className="muted">{i.n}</td>
                        <td><strong>{i.nome}{i.cancelado ? " (cancelado)" : ""}</strong>{i.grupo && <small>{i.grupo}{i.codigo ? ` · cód. ${i.codigo}` : ""}</small>}</td>
                        <td>{i.ncm ?? ""}</td>
                        <td>{i.cfop ?? ""}</td>
                        <td>{i.cst ?? i.csosn ?? ""}</td>
                        <td className="n">{qtd(i.quantidade)}</td>
                        <td>{i.unidade ?? ""}</td>
                        <td className="n">{brl(i.valor_unitario)}</td>
                        <td className="n">{brl(i.valor_total)}</td>
                        <td className="n">{i.icms?.valor ? <>{brl(i.icms.valor)}<small>{pct(i.icms.aliquota)}</small></> : "—"}</td>
                        <td className="n">{(i.pis?.valor || i.cofins?.valor) ? brl(Number(i.pis?.valor ?? 0) + Number(i.cofins?.valor ?? 0)) : "—"}</td>
                        <td className="n">{i.ibscbs ? <>{brl(Number(i.ibscbs.cbs?.valor ?? 0) + Number(i.ibscbs.ibs_uf?.valor ?? 0) + Number(i.ibscbs.ibs_mun?.valor ?? 0))}<small>{i.ibscbs.cclasstrib ?? ""}</small></> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="nf-colunas">
              <section className="nf-bloco">
                <h3>Totais</h3>
                <dl className="nf-totais">
                  <div><dt>Subtotal</dt><dd>{brl(n.subtotal)}</dd></div>
                  {!!n.servico && <div><dt>Taxa de serviço</dt><dd>{brl(n.servico)}</dd></div>}
                  {!!n.desconto && <div><dt>Descontos</dt><dd>{brl(n.desconto)}</dd></div>}
                  {!!n.acrescimo && <div><dt>Acréscimos</dt><dd>{brl(n.acrescimo)}</dd></div>}
                  {!!n.taxa_entrega && <div><dt>Taxa de entrega</dt><dd>{brl(n.taxa_entrega)}</dd></div>}
                  <div className="total"><dt>Total da venda</dt><dd>{brl(n.valor)}</dd></div>
                  <div><dt>ICMS (base {brl(n.base_icms)})</dt><dd>{brl(n.icms)}</dd></div>
                  <div><dt>PIS</dt><dd>{brl(n.pis)}</dd></div>
                  <div><dt>Cofins</dt><dd>{brl(n.cofins)}</dd></div>
                  <div><dt>CBS · IBS (teste da reforma)</dt><dd>{brl(n.cbs)} · {brl(n.ibs)}</dd></div>
                </dl>
              </section>
              <section className="nf-bloco">
                <h3>Pagamentos</h3>
                {n.pagamentos.length ? (
                  <dl className="nf-totais">
                    {n.pagamentos.map((p, k) => <div key={k}><dt>{p.descricao}</dt><dd>{brl(p.recebido ?? p.valor)}</dd></div>)}
                    {!!n.troco && <div><dt>Troco</dt><dd>{brl(n.troco)}</dd></div>}
                  </dl>
                ) : <p className="muted">Sem pagamentos registrados.</p>}
              </section>
            </div>
          </>
        )}
      </div>
      {verPdf && <JanelaPdfNota url={urlPdf(linha)} titulo={linha.chave ? `DANFE NFC-e · nº ${linha.numero ?? ""}` : `Venda · cupom ${linha.cupom ?? ""}`}
        subtitulo={`${casa ?? ""} · ${brl(linha.valor)}`} arquivo={linha.chave ? `NFCe-${linha.numero ?? linha.chave}.pdf` : `Venda-${linha.cupom ?? ""}.pdf`} onFechar={() => setVerPdf(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Bloco da aba Leituras: as NFC-e vêm da TOTVS junto com as vendas
// ---------------------------------------------------------------------
export function LeituraNfce() {
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Leitura[]>([]);
  const carregar = useCallback(async () => {
    const { data } = await supabase.from("nfce_leitura").select("*");
    setLista((data ?? []) as Leitura[]);
  }, [supabase]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, [carregar]);
  return (
    <section className="nfs-leitura">
      <h2 className="nfs-titulo">NFC-e (vendas) · caixa TOTVS</h2>
      <p className="muted">A cada minuto a leitura ao vivo da TOTVS traz as vendas do dia e, junto, a NFC-e de cada uma (chave, protocolo e impostos). Os dias antigos entram aos poucos, um por vez, até completar o histórico do caixa.</p>
      <div className="sf-empresas">
        {lista.map((l) => {
          const ok = l.dias_faltam === 0 && !!l.ultima_leitura;
          const estado = !l.ultima_leitura ? { cls: "espera", txt: "Ainda não lida" } : ok ? { cls: "ok", txt: "Em dia" } : { cls: "espera", txt: "Buscando o histórico" };
          return (
            <article key={l.unidade_id} className="sf-empresa">
              <header className="sf-empresa-cabeca">
                <span className="nf-grupo-icone" aria-hidden="true">{l.nome.slice(0, 1)}</span>
                <span className="sf-empresa-nome"><strong>{l.nome}</strong><small>caixa TOTVS Chef Web</small></span>
                <span className={`sf-estado ${estado.cls}`}>{estado.txt}</span>
              </header>
              <dl className="sf-numeros">
                <div><dt>Dias lidos</dt><dd>{l.dias_lidos}</dd></div>
                <div><dt>Faltam</dt><dd>{l.dias_faltam}</dd></div>
                <div><dt>Última leitura</dt><dd>{l.ultima_leitura ? `${dia(l.ultima_leitura)} · ${hora(l.ultima_leitura)}` : "nunca"}</dd></div>
              </dl>
              {l.desde && <p className="sf-ultimo">Notas desde {dia(`${l.desde}T12:00:00-03:00`)}</p>}
            </article>
          );
        })}
      </div>
      <p className="muted es-nota">
        A SEFAZ não tem serviço para o emitente baixar as próprias NFC-e, e a API fiscal da TOTVS que devolveria o XML dá erro interno (chamado aberto).
        Por isso o PDF é montado com os dados da venda que o caixa mandou; a chave de acesso permite conferir cada nota no portal da SEFAZ-RN.
      </p>
    </section>
  );
}
