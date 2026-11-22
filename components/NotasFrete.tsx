"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import JanelaPdfNota from "./JanelaPdfNota";

// CT-e da página Notas: os conhecimentos de transporte (fretes) em que as empresas do grupo aparecem, do
// Ambiente Nacional do CT-e (supabase/cte.sql). Atualiza sozinho: a rotina pergunta à SEFAZ de hora em hora.
//  - NotasFrete: aba "CT-e (fretes)": por mês e CNPJ, 50 por página, CT-e aberto com os atores, valores, NF-e
//    transportadas e o PDF (DACTE, /api/cte/dacte/<empresa>/<chave>).
//  - LeituraCte: bloco da aba "Leituras" (um cartão por CNPJ, buscar agora, andamento).
type Empresa = { cnpj: string; nome: string; ativa: boolean; ult_nsu: string; bloqueado_ate: string | null; ultima_consulta: string | null; ultimo_status: string | null };
type Mes = { mes: string; empresa_cnpj: string; ctes: number; cancelados: number; pagos: number; valor: number; valor_pago: number; icms: number; carga: number };
type Cte = {
  empresa_cnpj: string; chave: string; papeis: string[]; numero: string | null; serie: string | null; modelo: string | null; emissao: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; remetente_nome: string | null; destinatario_nome: string | null;
  tomador_nome: string | null; tomador_tipo: string | null; origem: string | null; destino: string | null; valor_prestacao: number | null;
  situacao: string; desacordo: boolean;
};
type CteCompleto = Cte & {
  cfop: string | null; natureza: string | null; modal: string | null; tipo_cte: string | null; emitente_uf: string | null;
  remetente_doc: string | null; destinatario_doc: string | null; expedidor_doc: string | null; expedidor_nome: string | null;
  recebedor_doc: string | null; recebedor_nome: string | null; tomador_doc: string | null; valor_receber: number | null; base_icms: number | null;
  icms: number | null; aliquota_icms: number | null; valor_carga: number | null; produto: string | null;
  componentes: { nome: string; valor: number | null }[]; quantidades: { unidade: string | null; tipo: string | null; quantidade: number | null }[];
  nfes: string[]; protocolo: string | null; observacao: string | null;
};
type NfeLigada = { chave: string; emitente_nome: string | null; valor: number | null; emissao: string | null; empresa_cnpj: string };
type Execucao = { id: string; empresa_cnpj: string; status: string; origem: string; resultado: Record<string, unknown>; erro: string | null; created_at: string };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const doc = (c: string | null) =>
  c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c && c.length === 11 ? `${c.slice(0, 3)}.***.***-${c.slice(9)}` : c ?? "";
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const numeroNfe = (chave: string) => Number(chave.slice(25, 34)).toLocaleString("pt-BR");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const mesDe = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).slice(0, 7) : "");
const STATUS: Record<string, string> = { na_fila: "na fila", rodando: "rodando", ok: "concluída", sem_dados: "sem CT-e novo", falha: "falha" };
const PAPEL: Record<string, string> = { tomador: "paga o frete", destinatario: "destinatário", remetente: "remetente", expedidor: "expedidor", recebedor: "recebedor", emitente: "emitente", autorizado: "autorizado", interessado: "interessado" };
const MODAL: Record<string, string> = { "01": "Rodoviário", "02": "Aéreo", "03": "Aquaviário", "04": "Ferroviário", "05": "Dutoviário", "06": "Multimodal" };
const TIPO_CTE: Record<string, string> = { "0": "Normal", "1": "Complemento de valores", "2": "Anulação", "3": "Substituto" };
const TOMADOR: Record<string, string> = { remetente: "o remetente", expedidor: "o expedidor", recebedor: "o recebedor", destinatario: "o destinatário", outros: "outro" };
const POR_PAGINA = 50;
const urlPdf = (c: { empresa_cnpj: string; chave: string }) => `/api/cte/dacte/${c.empresa_cnpj}/${c.chave}`;
const papelPrincipal = (p: string[]) => (p.includes("tomador") ? "tomador" : p[0] ?? "interessado");

function useBase(supabase: ReturnType<typeof createClient>) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [pronto, setPronto] = useState(false);
  const carregar = useCallback(async () => {
    const [e, m] = await Promise.all([
      supabase.from("cte_empresas").select("cnpj,nome,ativa,ult_nsu,bloqueado_ate,ultima_consulta,ultimo_status").order("cnpj"),
      supabase.from("cte_meses").select("*").order("mes", { ascending: false }),
    ]);
    setEmpresas((e.data ?? []) as Empresa[]);
    setMeses((m.data ?? []) as Mes[]);
    setPronto(true);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);
  return { empresas, meses, pronto, carregar };
}

export default function NotasFrete() {
  const supabase = useMemo(() => createClient(), []);
  const { empresas, meses, pronto } = useBase(supabase);
  const [mes, setMes] = useState("");
  const [papel, setPapel] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Cte[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  useEffect(() => { setMes((v) => v || meses[0]?.mes || ""); }, [meses]);
  useEffect(() => { setPagina(0); }, [mes, papel, empresa, busca]);

  useEffect(() => {
    (async () => {
      if (!mes) { setLista(pronto ? [] : null); return; }
      setLista(null);
      const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1);
      const { data } = await supabase.from("cte_notas")
        .select("empresa_cnpj,chave,papeis,numero,serie,modelo,emissao,emitente_cnpj,emitente_nome,remetente_nome,destinatario_nome,tomador_nome,tomador_tipo,origem,destino,valor_prestacao,situacao,desacordo")
        .gte("emissao", `${mes}-01T00:00:00-03:00`).lt("emissao", `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}-01T00:00:00-03:00`)
        .order("emissao", { ascending: false }).limit(2000);
      setLista((data ?? []) as Cte[]);
    })();
  }, [supabase, mes, pronto]);

  const nomeEmpresa = Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome]));
  const doMes = meses.filter((m) => m.mes === mes && (!empresa || m.empresa_cnpj === empresa));
  const soma = (k: keyof Mes) => doMes.reduce((s, m) => s + Number(m[k] ?? 0), 0);
  const t = busca.trim().toLowerCase();
  const filtrados = (lista ?? []).filter((c) =>
    (!empresa || c.empresa_cnpj === empresa) &&
    (!papel || (papel === "tomador" ? c.papeis.includes("tomador") : !c.papeis.includes("tomador"))) &&
    (!t || [c.emitente_nome, c.remetente_nome, c.destinatario_nome, c.tomador_nome, c.numero, c.chave, c.emitente_cnpj, c.origem, c.destino].some((v) => v?.toLowerCase().includes(t))));
  const listaMeses = [...new Set(meses.map((m) => m.mes))];
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const daPagina = filtrados.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);
  const grupos: { mes: string; empresas: { cnpj: string; ctes: Cte[] }[] }[] = [];
  for (const c of daPagina) {
    const m = mesDe(c.emissao);
    let g = grupos.find((x) => x.mes === m);
    if (!g) grupos.push((g = { mes: m, empresas: [] }));
    let e = g.empresas.find((x) => x.cnpj === c.empresa_cnpj);
    if (!e) g.empresas.push((e = { cnpj: c.empresa_cnpj, ctes: [] }));
    e.ctes.push(c);
  }
  const totalMes = (m: string, cnpj?: string) => meses.filter((x) => x.mes === m && (!cnpj || x.empresa_cnpj === cnpj));

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Fretes pagos pelo grupo</span><span className="es-numero-valor">{brl(soma("valor_pago"))}</span><span className="tv-cartao-detalhe">{soma("pagos")} CT-e em que a empresa é a tomadora</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Todos os CT-e</span><span className="es-numero-valor">{brl(soma("valor"))}</span><span className="tv-cartao-detalhe">{soma("ctes")} fretes com o CNPJ do grupo · carga {brl(soma("carga"))}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">ICMS nos fretes</span><span className="es-numero-valor">{brl(soma("icms"))}</span><span className="tv-cartao-detalhe">{soma("cancelados")} cancelados no mês</span></div>
      </div>

      <div className="ft-barra nf-barra">
        <div className="nf-escolha">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            {!listaMeses.length && <option value="">Sem CT-e ainda</option>}
            {listaMeses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
          <select value={papel} onChange={(e) => setPapel(e.target.value)} aria-label="Quem paga">
            <option value="">Todos os fretes</option>
            <option value="tomador">Só os que o grupo paga</option>
            <option value="outros">Só os pagos por outros</option>
          </select>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Transportadora, remetente, cidade, número ou chave" aria-label="Buscar CT-e" />
        </div>
      </div>
      <div className="ft-chips nf-empresas" role="tablist" aria-label="Empresa">
        <button role="tab" aria-selected={!empresa} className={!empresa ? "on" : ""} onClick={() => setEmpresa("")}>Todas as empresas</button>
        {empresas.map((e) => (
          <button key={e.cnpj} role="tab" aria-selected={empresa === e.cnpj} className={empresa === e.cnpj ? "on" : ""} onClick={() => setEmpresa(e.cnpj)}>
            {e.nome}<span>{meses.filter((m) => m.empresa_cnpj === e.cnpj && (!mes || m.mes === mes)).reduce((s, m) => s + m.ctes, 0)}</span>
          </button>
        ))}
      </div>

      {lista === null ? <p className="muted">Carregando os CT-e…</p> : !filtrados.length ? (
        <p className="muted vazio">{meses.length ? "Nenhum CT-e com esses filtros." : "Nenhum CT-e lido ainda. A leitura na SEFAZ roda de hora em hora (aba Leituras)."}</p>
      ) : (
        <>
          {grupos.map((g) => {
            const tm = totalMes(g.mes);
            return (
              <section key={g.mes} className="nf-mes">
                <header className="nf-mes-cabeca">
                  <h2>{nomeMes(g.mes)}</h2>
                  <span className="muted">{tm.reduce((s, m) => s + m.ctes, 0)} CT-e · pagos pelo grupo {brl(tm.reduce((s, m) => s + Number(m.valor_pago), 0))}</span>
                </header>
                {g.empresas.map((e) => {
                  const te = totalMes(g.mes, e.cnpj);
                  const k = `${g.mes}|${e.cnpj}`;
                  const grupoAberto = abertos[k] ?? !!(t || empresa || grupos.reduce((s, x) => s + x.empresas.length, 0) === 1);
                  return (
                    <div key={e.cnpj} className={grupoAberto ? "nf-grupo aberto" : "nf-grupo"}>
                      <button className="nf-grupo-cabeca" onClick={() => setAbertos((x) => ({ ...x, [k]: !grupoAberto }))} aria-expanded={grupoAberto}>
                        <span className="nf-grupo-icone" aria-hidden="true">{(nomeEmpresa[e.cnpj] ?? "E").slice(0, 1)}</span>
                        <span className="nf-grupo-nome"><strong>{nomeEmpresa[e.cnpj] ?? "Empresa"}</strong><small>CNPJ {doc(e.cnpj)}</small></span>
                        <span className="nf-grupo-conta">
                          <span><i className="nf-card-marca completa" />{te.reduce((s, x) => s + x.pagos, 0)} pagos pela empresa</span>
                          <span><i className="nf-card-marca resumo" />{te.reduce((s, x) => s + x.ctes - x.pagos, 0)} outros</span>
                          {te.reduce((s, x) => s + x.cancelados, 0) > 0 && <span><i className="nf-card-marca cancelada" />{te.reduce((s, x) => s + x.cancelados, 0)} cancelados</span>}
                          <span className="muted">{e.ctes.length} nesta página</span>
                        </span>
                        <span className="nf-grupo-total"><b>{brl(te.reduce((s, x) => s + Number(x.valor_pago), 0))}</b><small>fretes pagos</small></span>
                        <span className="ip-seta" aria-hidden="true" />
                      </button>
                      {grupoAberto && <ul className="nf-cards">
                        {e.ctes.map((c) => {
                          const kc = `${c.empresa_cnpj}|${c.chave}`;
                          const esta = aberta === kc;
                          const pp = papelPrincipal(c.papeis);
                          return (
                            <li key={kc} className={esta ? "nf-card aberto" : "nf-card"}>
                              <button className="nf-card-linha" onClick={() => setAberta(esta ? null : kc)} aria-expanded={esta}>
                                <span className={`nf-card-marca ${c.situacao !== "autorizada" ? "cancelada" : pp === "tomador" ? "completa" : "resumo"}`} aria-hidden="true" />
                                <span className="nf-card-forn"><strong>{c.emitente_nome ?? "Transportadora"}</strong><small>{c.origem ?? "?"} → {c.destino ?? "?"} · de {c.remetente_nome ?? "—"}</small></span>
                                <span className="nf-card-num"><b>Nº {c.numero ?? "—"}</b><small>{c.modelo === "67" ? "CT-e OS" : "CT-e"}</small></span>
                                <span className="nf-card-data"><b>{dia(c.emissao)}</b><small>emissão</small></span>
                                <span className="nf-card-valor">{brl(c.valor_prestacao)}</span>
                                <span className="nf-card-selo">
                                  {c.situacao !== "autorizada" ? <span className="estado tv-falha">cancelado</span>
                                    : pp === "tomador" ? <span className="estado tv-revisar">grupo paga</span> : <span className="estado tv-ok">{PAPEL[pp] ?? pp}</span>}
                                </span>
                                <span className="ip-seta" aria-hidden="true" />
                              </button>
                              {esta && <CteAberto c={c} empresa={nomeEmpresa[c.empresa_cnpj]} onFechar={() => setAberta(null)} />}
                            </li>
                          );
                        })}
                      </ul>}
                    </div>
                  );
                })}
              </section>
            );
          })}
          <nav className="nf-paginas" aria-label="Páginas">
            <button className="ghost small" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
            <span className="muted">Página {pagina + 1} de {paginas} · {filtrados.length.toLocaleString("pt-BR")} CT-e</span>
            <button className="ghost small" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
          </nav>
        </>
      )}
    </>
  );
}

function CteAberto({ c, empresa, onFechar }: { c: Cte; empresa?: string; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [x, setX] = useState<CteCompleto | null>(null);
  const [nfes, setNfes] = useState<NfeLigada[]>([]);
  const [verPdf, setVerPdf] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cte_notas").select("*").eq("empresa_cnpj", c.empresa_cnpj).eq("chave", c.chave).single();
      const completo = data as CteCompleto;
      setX(completo);
      if (completo?.nfes?.length) {
        const r = await supabase.from("notas").select("chave,emitente_nome,valor,emissao,empresa_cnpj").in("chave", completo.nfes.slice(0, 100));
        setNfes((r.data ?? []) as NfeLigada[]);
      }
    })();
  }, [supabase, c]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && !verPdf && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar, verPdf]);

  async function baixarXml() {
    const { data } = await supabase.from("cte_notas").select("xml").eq("empresa_cnpj", c.empresa_cnpj).eq("chave", c.chave).single();
    if (!data?.xml) return;
    const url = URL.createObjectURL(new Blob([data.xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `CTe-${c.chave}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ator = (rotulo: string, nome: string | null, d: string | null) => (
    <div><dt>{rotulo}</dt><dd>{nome ?? "—"}{d && <><br /><small className="muted">{doc(d)}</small></>}</dd></div>
  );
  return (
    <div className="nf-aberta" onClick={(e) => e.stopPropagation()}>
      <header className="nf-aberta-cabeca">
        <div className="ft-painel-titulo">
          <span className="es-sobre">{c.modelo === "67" ? "CT-e OS" : "CT-e"} nº {c.numero ?? "—"} · série {c.serie ?? "—"} · {c.papeis.map((p) => PAPEL[p] ?? p).join(", ")}</span>
          <h2 className="nf-painel-nome">{c.emitente_nome ?? "Transportadora"}</h2>
          <p className="muted nf-painel-sub">CNPJ {doc(c.emitente_cnpj)}{x?.emitente_uf ? ` · ${x.emitente_uf}` : ""} · {c.origem ?? "?"} → {c.destino ?? "?"}</p>
          <div className="ft-indicadores">
            <span><small>Emissão</small><b>{dia(c.emissao)}</b></span>
            <span><small>Valor do frete</small><b>{brl(c.valor_prestacao)}</b></span>
            <span><small>Quem paga</small><b>{c.tomador_nome ?? (c.tomador_tipo ? TOMADOR[c.tomador_tipo] : "—")}</b></span>
            <span><small>Empresa do grupo</small><b>{empresa ?? "—"}</b></span>
          </div>
        </div>
        <div className="ft-painel-acoes">
          <button className="small" onClick={() => setVerPdf(true)}>Ver PDF</button>
          <button className="ghost small" onClick={baixarXml}>Baixar XML</button>
          <button className="ghost small" onClick={onFechar}>Fechar</button>
        </div>
      </header>
      <div className="nf-painel-corpo">
        {!x ? <p className="muted">Carregando o CT-e…</p> : (
          <>
            {c.situacao === "cancelada" && <p className="es-aviso">Este CT-e foi cancelado pela transportadora.</p>}
            {c.desacordo && <p className="es-aviso">Há um evento de prestação de serviço em desacordo registrado neste CT-e.</p>}
            <dl className="nf-dados">
              {ator("Remetente", x.remetente_nome, x.remetente_doc)}
              {ator("Destinatário", x.destinatario_nome, x.destinatario_doc)}
              {(x.expedidor_nome || x.expedidor_doc) && ator("Expedidor", x.expedidor_nome, x.expedidor_doc)}
              {(x.recebedor_nome || x.recebedor_doc) && ator("Recebedor", x.recebedor_nome, x.recebedor_doc)}
              {ator("Tomador (paga o frete)", x.tomador_nome, x.tomador_doc)}
              <div><dt>Tipo · modal</dt><dd>{TIPO_CTE[x.tipo_cte ?? ""] ?? x.tipo_cte ?? "—"} · {MODAL[x.modal ?? ""] ?? x.modal ?? "—"}</dd></div>
              <div><dt>CFOP · natureza</dt><dd>{x.cfop ?? "—"} · {x.natureza ?? "—"}</dd></div>
              <div><dt>Protocolo de autorização</dt><dd>{x.protocolo ?? "—"}</dd></div>
              <div className="nf-dados-largo"><dt>Chave de acesso</dt><dd className="nf-chave">{chaveFmt(c.chave)}</dd></div>
            </dl>

            <div className="nf-colunas">
              <section className="nf-bloco">
                <h3>Valores do frete</h3>
                <dl className="nf-totais">
                  {x.componentes.map((cp, k) => <div key={k}><dt>{cp.nome}</dt><dd>{brl(cp.valor)}</dd></div>)}
                  <div className="total"><dt>Valor total da prestação</dt><dd>{brl(x.valor_prestacao)}</dd></div>
                  <div><dt>Valor a receber</dt><dd>{brl(x.valor_receber)}</dd></div>
                  <div><dt>ICMS{x.aliquota_icms ? ` (${Number(x.aliquota_icms).toLocaleString("pt-BR")}%)` : ""}</dt><dd>{brl(x.icms)}</dd></div>
                </dl>
              </section>
              <section className="nf-bloco">
                <h3>Carga</h3>
                <dl className="nf-totais">
                  <div><dt>Produto predominante</dt><dd>{x.produto ?? "—"}</dd></div>
                  <div><dt>Valor da carga</dt><dd>{brl(x.valor_carga)}</dd></div>
                  {x.quantidades.map((q, k) => <div key={k}><dt>{q.tipo ?? "Quantidade"}</dt><dd>{q.quantidade == null ? "—" : Number(q.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</dd></div>)}
                </dl>
              </section>
            </div>

            <section className="nf-bloco">
              <h3>NF-e transportadas <span className="muted">· {x.nfes.length}</span></h3>
              {!x.nfes.length ? <p className="muted">O CT-e não informa NF-e.</p> : (
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela">
                    <thead><tr><th>NF-e</th><th>Fornecedor</th><th>Emissão</th><th className="n">Valor</th><th>No Brasico</th></tr></thead>
                    <tbody>
                      {x.nfes.map((k) => {
                        const n = nfes.find((z) => z.chave === k);
                        return (
                          <tr key={k}>
                            <td><strong>Nº {numeroNfe(k)}</strong><small>{chaveFmt(k)}</small></td>
                            <td>{n?.emitente_nome ?? "—"}</td>
                            <td>{n ? dia(n.emissao) : "—"}</td>
                            <td className="n">{n ? brl(n.valor) : "—"}</td>
                            <td>{n ? <span className="estado tv-ok">na aba NF-e</span> : <span className="estado tv-revisar">não recebida</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {x.observacao && <section className="nf-bloco"><h3>Observações</h3><p className="nf-info">{x.observacao}</p></section>}
          </>
        )}
      </div>
      {verPdf && <JanelaPdfNota url={urlPdf(c)} titulo={`DACTE · CT-e nº ${c.numero ?? ""}`} subtitulo={`${c.emitente_nome ?? ""} · ${brl(c.valor_prestacao)}`}
        arquivo={`DACTE-${c.numero ?? c.chave}.pdf`} onFechar={() => setVerPdf(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Bloco da aba Leituras: uma leitura por CNPJ no Ambiente Nacional do CT-e
// ---------------------------------------------------------------------
export function LeituraCte() {
  const supabase = useMemo(() => createClient(), []);
  const { empresas, meses, carregar } = useBase(supabase);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [aviso, setAviso] = useState("");
  const carregarExec = useCallback(async () => {
    const { data } = await supabase.from("cte_execucoes").select("id,empresa_cnpj,status,origem,resultado,erro,created_at")
      .order("created_at", { ascending: false }).limit(12);
    setExecucoes((data ?? []) as Execucao[]);
  }, [supabase]);
  useEffect(() => { carregarExec(); }, [carregarExec]);
  useEffect(() => {
    const canal = supabase.channel("cte-execucoes").on("postgres_changes", { event: "*", schema: "public", table: "cte_execucoes" }, () => { carregar(); carregarExec(); }).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, carregar, carregarExec]);

  async function buscar(cnpj: string) {
    setAviso("");
    const { error } = await supabase.rpc("cte_buscar", { p_cnpj: cnpj });
    setAviso(error ? error.message : "Leitura pedida à SEFAZ. O andamento aparece abaixo.");
    carregar(); carregarExec();
  }
  async function ajustar(cnpj: string, ativa: boolean) {
    const { error } = await supabase.rpc("cte_ajustar", { p_cnpj: cnpj, p_ativa: ativa });
    if (error) setAviso(error.message);
    carregar();
  }

  const nomeEmpresa = Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome]));
  const agora = new Date();
  const doCnpj = (cnpj: string) => meses.filter((m) => m.empresa_cnpj === cnpj).reduce((s, m) => s + m.ctes, 0);
  return (
    <section className="nfs-leitura">
      <h2 className="nfs-titulo">CT-e (fretes) · SEFAZ</h2>
      <p className="muted">De hora em hora o Brasico pergunta ao Ambiente Nacional do CT-e, com o certificado de cada empresa e sem custo, por todo frete em que o CNPJ aparece (como tomador, destinatário, remetente…). Sem CT-e novo, a SEFAZ pede 1 hora de espera.</p>
      {aviso && <p className="es-aviso">{aviso}</p>}
      <div className="sf-empresas">
        {empresas.map((e) => {
          const bloqueada = !!e.bloqueado_ate && new Date(e.bloqueado_ate) > agora;
          const falha = !!e.ultimo_status && /falha|erro|rejei|sefaz|conex|656/i.test(e.ultimo_status);
          const estado = falha ? { cls: "falha", txt: "Precisa de atenção" } : !e.ativa ? { cls: "parada", txt: "Fora da leitura" }
            : e.ultima_consulta ? { cls: "ok", txt: "Em dia" } : { cls: "espera", txt: "Ainda não lida" };
          return (
            <article key={e.cnpj} className="sf-empresa">
              <header className="sf-empresa-cabeca">
                <span className="nf-grupo-icone" aria-hidden="true">{e.nome.slice(0, 1)}</span>
                <span className="sf-empresa-nome"><strong>{e.nome}</strong><small>CNPJ {doc(e.cnpj)}</small></span>
                <span className={`sf-estado ${estado.cls}`}>{estado.txt}</span>
              </header>
              <dl className="sf-numeros">
                <div><dt>CT-e lidos</dt><dd>{doCnpj(e.cnpj)}</dd></div>
                <div><dt>Último NSU</dt><dd>{Number(e.ult_nsu).toLocaleString("pt-BR")}</dd></div>
                <div><dt>Última leitura</dt><dd>{e.ultima_consulta ? `${dia(e.ultima_consulta)} · ${hora(e.ultima_consulta)}` : "nunca"}</dd></div>
              </dl>
              {e.ultimo_status && !STATUS[e.ultimo_status] && <p className="sf-ultimo">{e.ultimo_status}</p>}
              <footer className="sf-empresa-rodape">
                <label className="sf-chave">
                  <input type="checkbox" checked={e.ativa} onChange={(v) => ajustar(e.cnpj, v.target.checked)} />
                  <span className="sf-chave-trilho" aria-hidden="true" /><span>Leitura de hora em hora</span>
                </label>
                <button className="ghost small" disabled={bloqueada} title={bloqueada ? `A SEFAZ libera às ${hora(e.bloqueado_ate!)}` : undefined} onClick={() => buscar(e.cnpj)}>
                  {bloqueada ? `Libera às ${hora(e.bloqueado_ate!)}` : "Buscar agora"}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {execucoes.length > 0 && (
        <ol className="sf-linha-tempo nfs-tempo">
          {execucoes.map((x) => (
            <li key={x.id} className={x.status === "falha" ? "falha" : x.status === "rodando" || x.status === "na_fila" ? "andando" : "ok"}>
              <span className="sf-ponto" aria-hidden="true" />
              <div>
                <strong>Leitura · {nomeEmpresa[x.empresa_cnpj] ?? x.empresa_cnpj}</strong>
                <small>{dia(x.created_at)} às {hora(x.created_at)} · {x.origem === "agenda" ? "automática" : x.origem === "encadeada" ? "continuação" : "pedida no site"}</small>
                <span className="sf-resultado">
                  <span className={`estado tv-${x.status === "sem_dados" ? "ok" : x.status}`}>{STATUS[x.status] ?? x.status}</span>
                  {x.resultado?.ctes != null && <span>{String(x.resultado.ctes)} CT-e</span>}
                  {Number(x.resultado?.eventos) > 0 && <span>{String(x.resultado.eventos)} evento(s)</span>}
                </span>
                {x.erro && <p className="sf-erro">{x.erro}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="muted es-nota">
        A SEFAZ guarda os CT-e dos últimos 3 meses para a primeira leitura; daí em diante o Brasico pega cada frete novo. Cada CNPJ (matriz e filial)
        tem a sua própria fila. Se outro sistema (o do contador, por exemplo) consultar o mesmo CNPJ, o Brasico busca o trecho que faltou aos poucos.
      </p>
    </section>
  );
}
