"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import IndicePrecos from "./IndicePrecos";

// Notas fiscais (Operação · fase 1): as NF-e recebidas pelas empresas (SEFAZ) e as notas avulsas.
// Abas: Notas (por mês e por CNPJ, com a nota aberta e o PDF), Índice de preços, Nota avulsa e Leitura da SEFAZ.
// O PDF (DANFE) é montado do XML oficial em /api/notas/danfe/<chave>. Tabelas e funções em supabase/notas*.sql.
type Empresa = {
  cnpj: string; nome: string; ativa: boolean; ciencia: boolean; ult_nsu: string; max_nsu: string | null;
  bloqueado_ate: string | null; ultima_consulta: string | null; ultimo_status: string | null;
};
type Execucao = {
  id: string; empresa_cnpj: string; tipo: string; status: string; origem: string; resultado: Record<string, number | boolean>;
  cstat: number | null; erro: string | null; created_at: string;
};
type Nota = {
  chave: string; empresa_cnpj: string; origem: string; emitente_cnpj: string | null; emitente_nome: string | null;
  emissao: string | null; valor: number | null; situacao: string; completa: boolean; foto: string | null; observacao: string | null;
};
type Item = {
  n_item: number; codigo: string | null; descricao: string; ncm: string | null; cfop: string | null; unidade: string | null;
  quantidade: number | null; valor_unitario: number | null; valor_total: number | null; desconto: number; frete: number; preco_efetivo: number | null;
};
type Mes = { mes: string; empresa_cnpj: string; notas: number; canceladas: number; so_resumo: number; valor: number };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const qtd = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const cnpjMask = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "");
const STATUS: Record<string, string> = { na_fila: "na fila", rodando: "rodando", ok: "concluída", sem_dados: "sem notas novas", falha: "falha" };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const mesDe = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).slice(0, 7) : "");
// Número e série vêm dentro da chave de acesso (posições 23–25 e 26–34)
const numeroNota = (chave: string) => (/^\d{44}$/.test(chave) ? Number(chave.slice(25, 34)).toLocaleString("pt-BR") : "");
const serieNota = (chave: string) => (/^\d{44}$/.test(chave) ? String(Number(chave.slice(22, 25))) : "");
const chaveFmt = (c: string) => (c.match(/.{1,4}/g) ?? []).join(" ");
const POR_PAGINA = 50;

export default function Notas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [aba, setAba] = useState<"notas" | "indice" | "avulsa" | "sefaz">("notas");

  const carregarEmpresas = useCallback(async () => {
    const { data } = await supabase.from("notas_empresas").select("*").order("nome");
    setEmpresas((data ?? []) as Empresa[]);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notas_acesso").select("user_id").eq("user_id", userId);
      if (!data?.length) return setAcesso(false);
      setAcesso(true);
      carregarEmpresas();
    })();
  }, [supabase, userId, carregarEmpresas]);

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="notas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso às notas fiscais.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="notas" />
      <main className="miolo tv es nf nf-larga">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Operação</span>
            <h1>Notas fiscais</h1>
            <p>As notas de compra das empresas, que chegam da SEFAZ, e as notas avulsas. Clique numa nota para ver os itens e o PDF.</p>
          </div>
        </div>

        <div className="cp-abas" role="tablist">
          <button role="tab" aria-selected={aba === "notas"} className={aba === "notas" ? "on" : ""} onClick={() => setAba("notas")}>Notas</button>
          <button role="tab" aria-selected={aba === "indice"} className={aba === "indice" ? "on" : ""} onClick={() => setAba("indice")}>Índice de preços</button>
          <button role="tab" aria-selected={aba === "avulsa"} className={aba === "avulsa" ? "on" : ""} onClick={() => setAba("avulsa")}>Nota avulsa</button>
          <button role="tab" aria-selected={aba === "sefaz"} className={aba === "sefaz" ? "on" : ""} onClick={() => setAba("sefaz")}>Leitura da SEFAZ</button>
        </div>

        {aba === "notas" && <ListaNotas empresas={empresas} />}
        {aba === "indice" && <IndicePrecos />}
        {aba === "avulsa" && <NotaAvulsa empresas={empresas} onPronto={() => setAba("notas")} />}
        {aba === "sefaz" && <LeituraSefaz empresas={empresas} onMudou={carregarEmpresas} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Aba Notas: escolha do mês, da empresa e busca; lista por mês e CNPJ, com páginas
// ---------------------------------------------------------------------
function ListaNotas({ empresas }: { empresas: Empresa[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [mes, setMes] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [situacao, setSituacao] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(0);
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [total, setTotal] = useState(0);
  const [aberta, setAberta] = useState<Nota | null>(null);
  // CNPJs abertos ou fechados (chave mês|cnpj); começam fechados, a não ser numa busca ou com uma empresa escolhida
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase.from("notas_meses").select("*").order("mes", { ascending: false }).then(({ data }) => {
      const ms = (data ?? []) as Mes[];
      setMeses(ms);
      setMes((m) => m || ms[0]?.mes || "");
    });
  }, [supabase]);

  // A busca espera a pessoa parar de digitar
  useEffect(() => {
    const t = setTimeout(() => { setTermo(busca.trim()); setPagina(0); }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    setNotas(null);
    let q = supabase.from("notas").select("chave,empresa_cnpj,origem,emitente_cnpj,emitente_nome,emissao,valor,situacao,completa,foto,observacao", { count: "exact" });
    if (mes) {
      const ini = `${mes}-01T00:00:00-03:00`;
      const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1);
      const fim = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}-01T00:00:00-03:00`;
      q = q.gte("emissao", ini).lt("emissao", fim);
    }
    if (empresa) q = q.eq("empresa_cnpj", empresa);
    if (situacao === "completa") q = q.eq("completa", true).eq("origem", "sefaz");
    if (situacao === "resumo") q = q.eq("completa", false).eq("origem", "sefaz");
    if (situacao === "cancelada") q = q.eq("situacao", "cancelada");
    if (situacao === "avulsa") q = q.eq("origem", "avulsa");
    if (termo) {
      const t = termo.replace(/[%,()]/g, " ").trim();
      const so = t.replace(/\D/g, "");
      // também acha a nota pelo nome de um item
      const { data: comItem } = await supabase.from("notas_itens").select("chave").ilike("descricao", `%${t}%`).limit(300);
      const chaves = [...new Set(((comItem ?? []) as { chave: string }[]).map((x) => x.chave))];
      const ors = [`emitente_nome.ilike.%${t}%`];
      if (so.length >= 3) ors.push(`emitente_cnpj.ilike.%${so}%`, `chave.ilike.%${so}%`);
      if (chaves.length) ors.push(`chave.in.(${chaves.join(",")})`);
      q = q.or(ors.join(","));
    }
    const { data, count } = await q.order("emissao", { ascending: false }).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    setNotas((data ?? []) as Nota[]);
    setTotal(count ?? 0);
  }, [supabase, mes, empresa, situacao, termo, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const nomeEmpresa = useMemo(() => Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome])), [empresas]);
  const curto = (cnpj: string) => (nomeEmpresa[cnpj] ?? cnpjMask(cnpj)).replace(/ EMPREENDIMENTOS TURISTICOS LTDA| HOTELARIAS LTDA/i, "").replace(/^ASSOCIACAO /i, "");
  const listaMeses = [...new Set(meses.map((m) => m.mes))];
  const doMes = meses.filter((m) => !mes || m.mes === mes);
  const resumo = {
    notas: doMes.filter((m) => !empresa || m.empresa_cnpj === empresa).reduce((s, m) => s + m.notas, 0),
    valor: doMes.filter((m) => !empresa || m.empresa_cnpj === empresa).reduce((s, m) => s + Number(m.valor), 0),
    resumo: doMes.filter((m) => !empresa || m.empresa_cnpj === empresa).reduce((s, m) => s + m.so_resumo, 0),
  };
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  // Mês → CNPJ → notas (na ordem da página)
  const grupos: { mes: string; empresas: { cnpj: string; notas: Nota[] }[] }[] = [];
  for (const n of notas ?? []) {
    const m = mesDe(n.emissao);
    let g = grupos.find((x) => x.mes === m);
    if (!g) grupos.push((g = { mes: m, empresas: [] }));
    let e = g.empresas.find((x) => x.cnpj === n.empresa_cnpj);
    if (!e) g.empresas.push((e = { cnpj: n.empresa_cnpj, notas: [] }));
    e.notas.push(n);
  }
  const totalMes = (m: string, cnpj?: string) => meses.filter((x) => x.mes === m && (!cnpj || x.empresa_cnpj === cnpj));

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Notas</span><span className="es-numero-valor">{resumo.notas.toLocaleString("pt-BR")}</span><span className="tv-cartao-detalhe">{mes ? nomeMes(mes) : "todos os meses"}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Valor</span><span className="es-numero-valor">{brl(resumo.valor)}</span><span className="tv-cartao-detalhe">sem as canceladas</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Só em resumo</span><span className="es-numero-valor">{resumo.resumo}</span><span className="tv-cartao-detalhe">os itens e o PDF chegam depois</span></div>
      </div>

      <div className="ft-barra nf-barra">
        <div className="nf-escolha">
          <select value={mes} onChange={(e) => { setMes(e.target.value); setPagina(0); }} aria-label="Mês">
            <option value="">Todos os meses</option>
            {listaMeses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
          <select value={situacao} onChange={(e) => { setSituacao(e.target.value); setPagina(0); }} aria-label="Situação">
            <option value="">Todas as notas</option>
            <option value="completa">Completas (com itens e PDF)</option>
            <option value="resumo">Só em resumo</option>
            <option value="cancelada">Canceladas</option>
            <option value="avulsa">Notas avulsas</option>
          </select>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, CNPJ, número ou item" aria-label="Buscar nota" />
        </div>
      </div>
      <div className="ft-chips nf-empresas" role="tablist" aria-label="Empresa">
        <button role="tab" aria-selected={!empresa} className={!empresa ? "on" : ""} onClick={() => { setEmpresa(""); setPagina(0); }}>Todas as empresas</button>
        {empresas.map((e) => {
          const n = doMes.filter((m) => m.empresa_cnpj === e.cnpj).reduce((s, m) => s + m.notas, 0);
          return (
            <button key={e.cnpj} role="tab" aria-selected={empresa === e.cnpj} className={empresa === e.cnpj ? "on" : ""} onClick={() => { setEmpresa(e.cnpj); setPagina(0); }}>
              {curto(e.cnpj)}<span>{n}</span>
            </button>
          );
        })}
      </div>

      {notas === null ? <p className="muted">Carregando as notas…</p> : !notas.length ? (
        <p className="muted vazio">Nenhuma nota com esses filtros.</p>
      ) : (
        <>
          {grupos.map((g) => (
            <section key={g.mes} className="nf-mes">
              <header className="nf-mes-cabeca">
                <h2>{nomeMes(g.mes)}</h2>
                <span className="muted">{totalMes(g.mes).reduce((s, m) => s + m.notas, 0)} notas · {brl(totalMes(g.mes).reduce((s, m) => s + Number(m.valor), 0))}</span>
              </header>
              {g.empresas.map((e) => {
                const t = totalMes(g.mes, e.cnpj)[0];
                const k = `${g.mes}|${e.cnpj}`;
                const grupoAberto = abertos[k] ?? !!(termo || empresa);
                const completas = e.notas.filter((n) => n.origem === "sefaz" && n.completa && n.situacao !== "cancelada").length;
                const resumos = e.notas.filter((n) => n.origem === "sefaz" && !n.completa).length;
                return (
                  <div key={e.cnpj} className={grupoAberto ? "nf-grupo aberto" : "nf-grupo"}>
                    <button className="nf-grupo-cabeca" onClick={() => setAbertos((x) => ({ ...x, [k]: !grupoAberto }))} aria-expanded={grupoAberto}>
                      <span className="nf-grupo-icone" aria-hidden="true">{(nomeEmpresa[e.cnpj] ?? "E").slice(0, 1)}</span>
                      <span className="nf-grupo-nome"><strong>{nomeEmpresa[e.cnpj] ?? "Empresa"}</strong><small>CNPJ {cnpjMask(e.cnpj)}</small></span>
                      <span className="nf-grupo-conta">
                        <span><i className="nf-card-marca completa" />{completas} completas</span>
                        {resumos > 0 && <span><i className="nf-card-marca resumo" />{resumos} só resumo</span>}
                        <span className="muted">{e.notas.length} nesta página</span>
                      </span>
                      <span className="nf-grupo-total">{t ? <><b>{brl(Number(t.valor))}</b><small>{t.notas} notas no mês</small></> : null}</span>
                      <span className="ip-seta" aria-hidden="true" />
                    </button>
                    {grupoAberto && <ul className="nf-cards">
                      {e.notas.map((n) => {
                        const esta = aberta?.chave === n.chave;
                        return (
                          <li key={n.chave} className={esta ? "nf-card aberto" : "nf-card"}>
                            <button className="nf-card-linha" onClick={() => setAberta(esta ? null : n)} aria-expanded={esta}>
                              <span className={`nf-card-marca ${n.situacao === "cancelada" ? "cancelada" : n.origem === "avulsa" ? "avulsa" : n.completa ? "completa" : "resumo"}`} aria-hidden="true" />
                              <span className="nf-card-forn"><strong>{n.emitente_nome ?? "—"}</strong><small>{n.origem === "avulsa" ? n.observacao ?? "nota avulsa" : cnpjMask(n.emitente_cnpj)}</small></span>
                              <span className="nf-card-num">{n.origem === "avulsa" ? <><b>Avulsa</b><small>sem NF-e</small></> : <><b>Nº {numeroNota(n.chave)}</b><small>série {serieNota(n.chave)}</small></>}</span>
                              <span className="nf-card-data"><b>{dia(n.emissao)}</b><small>emissão</small></span>
                              <span className="nf-card-valor">{brl(n.valor)}</span>
                              <span className="nf-card-selo"><Selo n={n} /></span>
                              <span className="ip-seta" aria-hidden="true" />
                            </button>
                            {esta && <NotaAberta nota={n} empresa={nomeEmpresa[n.empresa_cnpj]} onFechar={() => setAberta(null)} />}
                          </li>
                        );
                      })}
                    </ul>}
                  </div>
                );
              })}
            </section>
          ))}
          <nav className="nf-paginas" aria-label="Páginas">
            <button className="ghost small" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
            <span className="muted">Página {pagina + 1} de {paginas} · {total.toLocaleString("pt-BR")} notas</span>
            <button className="ghost small" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
          </nav>
        </>
      )}

    </>
  );
}

function Selo({ n }: { n: Nota }) {
  if (n.situacao === "cancelada") return <span className="estado tv-falha">cancelada</span>;
  if (n.origem === "avulsa") return <span className="estado">avulsa</span>;
  if (n.completa) return <span className="estado tv-ok">completa</span>;
  return <span className="estado tv-revisar">só resumo</span>;
}

// ---------------------------------------------------------------------
// Nota aberta: dados, itens, totais e o PDF
// ---------------------------------------------------------------------
type Extra = {
  natureza: string; protocolo: string; endereco: string; ie: string; totais: [string, string][]; duplicatas: [string, string, string][];
  pagamento: string; informacoes: string; transporte: string;
};
const PAGTO: Record<string, string> = { "01": "dinheiro", "02": "cheque", "03": "cartão de crédito", "04": "cartão de débito", "05": "crédito loja",
  "10": "vale alimentação", "11": "vale refeição", "15": "boleto", "16": "depósito", "17": "Pix", "18": "transferência", "90": "sem pagamento", "99": "outros" };
const FRETE: Record<string, string> = { "0": "por conta do emitente", "1": "por conta do destinatário", "2": "por conta de terceiros", "9": "sem frete" };

function lerXml(texto: string): Extra {
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  const g = (raiz: Element | Document | null | undefined, tag: string) => raiz?.getElementsByTagName(tag)[0] ?? null;
  const t = (raiz: Element | Document | null | undefined, tag: string) => g(raiz, tag)?.textContent?.trim() ?? "";
  const emit = g(doc, "emit"), ende = g(emit, "enderEmit"), tot = g(doc, "ICMSTot"), prot = g(doc, "infProt");
  const v = (k: string) => Number(t(tot, k) || 0);
  const totais: [string, string][] = [
    ["Produtos", brl(v("vProd"))], ["Frete", brl(v("vFrete"))], ["Seguro", brl(v("vSeg"))], ["Desconto", brl(v("vDesc"))],
    ["Outras despesas", brl(v("vOutro"))], ["IPI", brl(v("vIPI"))], ["ICMS ST", brl(v("vST"))], ["ICMS", brl(v("vICMS"))], ["Total da nota", brl(v("vNF"))],
  ];
  const dups = Array.from(doc.getElementsByTagName("dup")).map((d) => [t(d, "nDup"), t(d, "dVenc"), brl(Number(t(d, "vDup") || 0))] as [string, string, string]);
  const pags = Array.from(doc.getElementsByTagName("detPag")).map((p) => `${PAGTO[t(p, "tPag")] ?? "outros"} ${brl(Number(t(p, "vPag") || 0))}`);
  return {
    natureza: t(doc, "natOp"),
    protocolo: prot ? `${t(prot, "nProt")} em ${dia(t(prot, "dhRecbto"))}` : "",
    endereco: [`${t(ende, "xLgr")}, ${t(ende, "nro")}`, t(ende, "xBairro"), `${t(ende, "xMun")} - ${t(ende, "UF")}`].filter((x) => x.replace(/[ ,-]/g, "")).join(" · "),
    ie: t(emit, "IE"),
    totais,
    duplicatas: dups,
    pagamento: pags.join(" · "),
    informacoes: [t(doc, "infAdFisco"), t(doc, "infCpl")].filter(Boolean).join(" "),
    transporte: FRETE[t(doc, "modFrete")] ?? "",
  };
}

function NotaAberta({ nota, empresa, onFechar }: { nota: Nota; empresa?: string; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [xmlTexto, setXmlTexto] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [verPdf, setVerPdf] = useState(false);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from("notas_itens").select("n_item,codigo,descricao,ncm,cfop,unidade,quantidade,valor_unitario,valor_total,desconto,frete,preco_efetivo").eq("chave", nota.chave).order("n_item"),
        nota.origem === "sefaz" ? supabase.from("notas").select("xml").eq("chave", nota.chave).single() : Promise.resolve({ data: null }),
      ]);
      setItens((a.data ?? []) as Item[]);
      const x = (b.data as { xml: string | null } | null)?.xml ?? null;
      setXmlTexto(x);
      if (x && nota.completa) { try { setExtra(lerXml(x)); } catch { setExtra(null); } }
      if (nota.foto) {
        const s = await supabase.storage.from("notas-avulsas").createSignedUrl(nota.foto, 3600);
        setFoto(s.data?.signedUrl ?? null);
      }
    })();
  }, [supabase, nota]);

  // Abre embaixo da linha clicada: rola até a nota e o Esc fecha (quando o PDF não está aberto)
  useEffect(() => {
    painel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const f = (e: KeyboardEvent) => e.key === "Escape" && !verPdf && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar, verPdf]);

  function baixarXml() {
    if (!xmlTexto) return;
    const url = URL.createObjectURL(new Blob([xmlTexto], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nota.chave}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const somaItens = (itens ?? []).reduce((s, i) => s + (i.valor_total ?? 0), 0);
  return (
    <div className="nf-aberta" ref={painel} onClick={(e) => e.stopPropagation()} aria-label={`Nota de ${nota.emitente_nome ?? "fornecedor"}`}>
        <header className="nf-aberta-cabeca">
          <div className="ft-painel-titulo">
            <span className="es-sobre">{nota.origem === "avulsa" ? "Nota avulsa" : `NF-e nº ${numeroNota(nota.chave)} · série ${serieNota(nota.chave)}`}</span>
            <h2 className="nf-painel-nome">{nota.emitente_nome ?? "Fornecedor"}</h2>
            <p className="muted nf-painel-sub">{nota.origem === "avulsa" ? nota.observacao ?? "" : `CNPJ ${cnpjMask(nota.emitente_cnpj)}${extra?.ie ? ` · IE ${extra.ie}` : ""}`}{extra?.endereco ? ` · ${extra.endereco}` : ""}</p>
            <div className="ft-indicadores">
              <span><small>Emissão</small><b>{dia(nota.emissao)}</b></span>
              <span><small>Valor</small><b>{brl(nota.valor)}</b></span>
              <span><small>Para</small><b>{empresa ?? "—"}</b></span>
              <span><small>Situação</small><b><Selo n={nota} /></b></span>
            </div>
          </div>
          <div className="ft-painel-acoes">
            {nota.origem === "sefaz" && nota.completa && <button className="small" onClick={() => setVerPdf(true)}>Ver PDF</button>}
            {foto && <a className="botao small" href={foto} target="_blank" rel="noreferrer">Ver foto</a>}
            {xmlTexto && <button className="ghost small" onClick={baixarXml}>Baixar XML</button>}
            <button className="ghost small" onClick={onFechar}>Fechar</button>
          </div>
        </header>

        <div className="nf-painel-corpo">
          {nota.origem === "sefaz" && !nota.completa && (
            <p className="es-aviso">Só o resumo desta nota chegou da SEFAZ. Os itens e o PDF aparecem quando a nota completa chegar (depois da ciência da operação).</p>
          )}
          {extra && (
            <dl className="nf-dados">
              <div><dt>Natureza da operação</dt><dd>{extra.natureza || "—"}</dd></div>
              <div><dt>Protocolo de autorização</dt><dd>{extra.protocolo || "—"}</dd></div>
              <div><dt>Pagamento</dt><dd>{extra.pagamento || "—"}</dd></div>
              <div><dt>Frete</dt><dd>{extra.transporte || "—"}</dd></div>
              <div className="nf-dados-largo"><dt>Chave de acesso</dt><dd className="nf-chave">{chaveFmt(nota.chave)}</dd></div>
            </dl>
          )}

          <section className="nf-bloco">
            <h3>Itens da nota {itens && itens.length > 0 && <span className="muted">· {itens.length}</span>}</h3>
            {itens === null ? <p className="muted">Carregando os itens…</p> : !itens.length ? <p className="muted">Nenhum item.</p> : (
              <div className="nf-tabela-wrap">
                <table className="nf-tabela nf-itens-tabela">
                  <thead><tr><th>#</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th className="n">Qtd.</th><th>Un.</th><th className="n">V. unit.</th><th className="n">Desconto</th><th className="n">Total</th><th className="n">Preço efetivo</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.n_item}>
                        <td className="muted">{i.n_item}</td>
                        <td><strong>{i.descricao}</strong>{i.codigo && <small>cód. {i.codigo}</small>}</td>
                        <td>{i.ncm ?? ""}</td>
                        <td>{i.cfop ?? ""}</td>
                        <td className="n">{qtd(i.quantidade)}</td>
                        <td>{i.unidade ?? ""}</td>
                        <td className="n">{brl(i.valor_unitario)}</td>
                        <td className="n">{i.desconto ? brl(i.desconto) : "—"}</td>
                        <td className="n">{brl(i.valor_total)}</td>
                        <td className="n">{i.preco_efetivo != null ? brl(i.preco_efetivo) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={8}><strong>Soma dos itens</strong></td><td className="n"><strong>{brl(somaItens)}</strong></td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </section>

          {extra && (
            <div className="nf-colunas">
              <section className="nf-bloco">
                <h3>Totais da nota</h3>
                <dl className="nf-totais">{extra.totais.map(([k, v]) => <div key={k} className={k === "Total da nota" ? "total" : ""}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              </section>
              <section className="nf-bloco">
                <h3>Duplicatas</h3>
                {extra.duplicatas.length ? (
                  <dl className="nf-totais">{extra.duplicatas.map(([n, d, v]) => <div key={n + d}><dt>{n} · vence {dia(d ? `${d}T12:00:00-03:00` : null)}</dt><dd>{v}</dd></div>)}</dl>
                ) : <p className="muted">Sem duplicatas na nota.</p>}
                {extra.informacoes && (<><h3 className="nf-h3-espaco">Informações complementares</h3><p className="nf-info">{extra.informacoes}</p></>)}
              </section>
            </div>
          )}
          {foto && <a href={foto} target="_blank" rel="noreferrer"><img className="nf-foto" src={foto} alt="Foto do cupom ou recibo" /></a>}
        </div>
      {verPdf && <VisorPdfNota nota={nota} onFechar={() => setVerPdf(false)} />}
    </div>
  );
}

// O PDF (DANFE) numa janela por cima da tela; Esc ou clicar fora fecha
function VisorPdfNota({ nota, onFechar }: { nota: Nota; onFechar: () => void }) {
  const url = `/api/notas/danfe/${nota.chave}`;
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [onFechar]);
  return (
    <div className="nf-pdf-fundo" onClick={onFechar}>
      <div className="nf-pdf" role="dialog" aria-modal="true" aria-label={`PDF da nota ${numeroNota(nota.chave)}`} tabIndex={-1} ref={caixa} onClick={(e) => e.stopPropagation()}>
        <header className="nf-pdf-cabeca">
          <span><strong>DANFE · NF-e nº {numeroNota(nota.chave)}</strong><small>{nota.emitente_nome ?? ""} · {brl(nota.valor)}</small></span>
          <span className="nf-pdf-acoes">
            <a className="botao small" href={url} target="_blank" rel="noreferrer">Abrir em outra aba</a>
            <a className="botao small ghost" href={url} download={`DANFE-${nota.chave}.pdf`}>Baixar</a>
            <button className="ghost small" onClick={onFechar} aria-label="Fechar o PDF">Fechar</button>
          </span>
        </header>
        <iframe className="nf-pdf-quadro" src={url} title={`PDF da nota ${numeroNota(nota.chave)}`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Aba Leitura da SEFAZ: cada empresa num cartão (situação, leitura diária, ciência) e o andamento das buscas
// ---------------------------------------------------------------------
function LeituraSefaz({ empresas, onMudou }: { empresas: Empresa[]; onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [doMes, setDoMes] = useState<Record<string, { notas: number; valor: number }>>({});
  const [aviso, setAviso] = useState("");
  const mesAtual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).slice(0, 7);
  const carregar = useCallback(async () => {
    const [x, m] = await Promise.all([
      supabase.from("notas_execucoes").select("id,empresa_cnpj,tipo,status,origem,resultado,cstat,erro,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("notas_meses").select("*").eq("mes", mesAtual),
    ]);
    setExecucoes((x.data ?? []) as Execucao[]);
    setDoMes(Object.fromEntries(((m.data ?? []) as Mes[]).map((r) => [r.empresa_cnpj, { notas: r.notas, valor: Number(r.valor) }])));
  }, [supabase, mesAtual]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const canal = supabase.channel("notas-execucoes").on("postgres_changes", { event: "*", schema: "public", table: "notas_execucoes" }, () => { carregar(); onMudou(); }).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, carregar, onMudou]);

  async function buscar(cnpj: string) {
    setAviso("");
    const { error } = await supabase.rpc("notas_buscar", { p_cnpj: cnpj, p_tipo: "distribuicao" });
    setAviso(error ? error.message : "Busca pedida à SEFAZ. O andamento aparece ao lado.");
    onMudou(); carregar();
  }
  async function ajustar(cnpj: string, campo: "ativa" | "ciencia", valor: boolean) {
    const { error } = await supabase.rpc("notas_ajustar", { p_cnpj: cnpj, p_ativa: campo === "ativa" ? valor : null, p_ciencia: campo === "ciencia" ? valor : null });
    if (error) setAviso(error.message);
    onMudou();
  }
  const nomeEmpresa = Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome]));
  const agora = new Date();
  const h = Number(agora.toLocaleString("en-US", { timeZone: "America/Fortaleza", hour: "numeric", hour12: false }));
  const proximaTexto = h < 6 ? "hoje às 6h" : h < 9 ? "hoje às 9h" : "amanhã às 6h";

  return (
    <div className="sf">
      <section className="sf-faixa">
        <span className="sf-faixa-icone" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
        </span>
        <div>
          <strong>Leitura automática todo dia, às 6h e às 9h</strong>
          <p>O Brasico pergunta à SEFAZ, sem custo, por todas as notas emitidas contra as empresas marcadas. A rodada das 9h traz as notas completas que só tinham chegado em resumo. Próxima leitura: {proximaTexto}.</p>
        </div>
      </section>
      {aviso && <p className="es-aviso">{aviso}</p>}

      <div className="sf-grade">
        <div className="sf-empresas">
          {empresas.map((e) => {
            const bloqueada = !!e.bloqueado_ate && new Date(e.bloqueado_ate) > agora;
            const falha = !bloqueada && !!e.ultimo_status && /falha|erro|rejei|656|indevido/i.test(e.ultimo_status);
            const estado = bloqueada ? { cls: "espera", txt: `SEFAZ libera às ${hora(e.bloqueado_ate!)}` } : falha ? { cls: "falha", txt: "Precisa de atenção" }
              : e.ativa ? { cls: "ok", txt: "Em dia" } : { cls: "parada", txt: "Fora da leitura diária" };
            const m = doMes[e.cnpj];
            return (
              <article key={e.cnpj} className="sf-empresa">
                <header className="sf-empresa-cabeca">
                  <span className="nf-grupo-icone" aria-hidden="true">{e.nome.slice(0, 1)}</span>
                  <span className="sf-empresa-nome"><strong>{e.nome}</strong><small>CNPJ {cnpjMask(e.cnpj)}</small></span>
                  <span className={`sf-estado ${estado.cls}`}>{estado.txt}</span>
                </header>
                <dl className="sf-numeros">
                  <div><dt>Notas no mês</dt><dd>{m ? m.notas : 0}</dd></div>
                  <div><dt>Valor no mês</dt><dd>{brl(m?.valor ?? 0)}</dd></div>
                  <div><dt>Última leitura</dt><dd>{e.ultima_consulta ? `${dia(e.ultima_consulta)} · ${hora(e.ultima_consulta)}` : "nunca"}</dd></div>
                </dl>
                {e.ultimo_status && !STATUS[e.ultimo_status] && <p className="sf-ultimo">{e.ultimo_status}</p>}
                <footer className="sf-empresa-rodape">
                  <label className="sf-chave">
                    <input type="checkbox" checked={e.ativa} onChange={(v) => ajustar(e.cnpj, "ativa", v.target.checked)} />
                    <span className="sf-chave-trilho" aria-hidden="true" /><span>Leitura diária</span>
                  </label>
                  <label className="sf-chave">
                    <input type="checkbox" checked={e.ciencia} onChange={(v) => ajustar(e.cnpj, "ciencia", v.target.checked)} />
                    <span className="sf-chave-trilho" aria-hidden="true" /><span>Ciência da operação</span>
                  </label>
                  <button className="ghost small" disabled={bloqueada} onClick={() => buscar(e.cnpj)}>Buscar agora</button>
                </footer>
              </article>
            );
          })}
        </div>

        <section className="sf-andamento">
          <h3>Andamento</h3>
          {!execucoes.length ? <p className="muted">Nenhuma leitura ainda.</p> : (
            <ol className="sf-linha-tempo">
              {execucoes.map((x) => {
                const cls = x.status === "falha" ? "falha" : x.status === "rodando" || x.status === "na_fila" ? "andando" : "ok";
                return (
                  <li key={x.id} className={cls}>
                    <span className="sf-ponto" aria-hidden="true" />
                    <div>
                      <strong>{x.tipo === "ciencia" ? "Ciência" : "Leitura"} · {(nomeEmpresa[x.empresa_cnpj] ?? x.empresa_cnpj).replace(/ EMPREENDIMENTOS TURISTICOS LTDA| HOTELARIAS LTDA/i, "")}</strong>
                      <small>{dia(x.created_at)} às {hora(x.created_at)} · {x.origem === "agenda" ? "automática" : "pedida no site"}</small>
                      <span className="sf-resultado">
                        <span className={`estado tv-${x.status === "sem_dados" ? "ok" : x.status}`}>{STATUS[x.status] ?? x.status}</span>
                        {x.resultado?.notas != null && <span>{String(x.resultado.notas)} nota(s)</span>}
                        {x.resultado?.registradas != null && <span>{String(x.resultado.registradas)} ciência(s)</span>}
                      </span>
                      {x.erro && <p className="sf-erro">{x.erro}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <p className="muted es-nota">
        A SEFAZ entrega as NF-e dos últimos 90 dias, até 50 por consulta. Quando não há nota nova, ela pede 1 hora de espera antes da
        próxima. A ciência da operação só registra que a empresa sabe da nota (não confirma nem recusa a compra) e libera a nota completa.
        O PDF de cada nota é montado na hora a partir do XML oficial que veio da SEFAZ.
      </p>
    </div>
  );
}

type Linha = { descricao: string; quantidade: string; unidade: string; valor: string };
const linhaVazia = (): Linha => ({ descricao: "", quantidade: "", unidade: "", valor: "" });
const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

// Nota avulsa: compra sem NF-e (cupom ou recibo) com foto, itens e valor
export function NotaAvulsa({ empresas, onPronto }: { empresas: Empresa[]; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [empresa, setEmpresa] = useState("");
  const [loja, setLoja] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia()]);
  const [total, setTotal] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!arquivo) { setPrevia(null); return; }
    const u = URL.createObjectURL(arquivo);
    setPrevia(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);

  const somaItens = linhas.reduce((s, l) => s + (numero(l.valor) || 0), 0);
  const mudar = (k: number, campo: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === k ? { ...l, [campo]: v } : l)));
  const valorFinal = numero(total) || somaItens;

  async function lancar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(""); setOk("");
    const itens = linhas.filter((l) => l.descricao.trim()).map((l) => ({
      descricao: l.descricao.trim(), quantidade: numero(l.quantidade) || null, unidade: l.unidade.trim() || null, valor_total: numero(l.valor) || null,
    }));
    if (!loja.trim()) return setErro("Informe onde foi a compra.");
    if (!itens.length) return setErro("Inclua pelo menos um item com nome.");
    if (!(valorFinal > 0)) return setErro("Informe o valor total da compra.");
    setEnviando(true);
    let caminho = "";
    if (arquivo) {
      caminho = `${data.slice(0, 7)}/${crypto.randomUUID()}.${(arquivo.name.split(".").pop() || "jpg").toLowerCase()}`;
      const up = await supabase.storage.from("notas-avulsas").upload(caminho, arquivo, { contentType: arquivo.type || "image/jpeg" });
      if (up.error) { setEnviando(false); return setErro(`Não consegui guardar a foto: ${up.error.message}`); }
    }
    const { error } = await supabase.rpc("notas_lancar_avulsa", {
      p_empresa: empresa, p_loja: loja, p_data: data, p_valor: valorFinal, p_itens: itens, p_foto: caminho, p_observacao: obs,
    });
    setEnviando(false);
    if (error) return setErro(error.message);
    setOk(`Nota avulsa de ${loja.trim()} lançada (${brl(valorFinal)}).`);
    setLoja(""); setLinhas([linhaVazia()]); setTotal(""); setArquivo(null); setObs("");
    (ev.target as HTMLFormElement).reset();
    onPronto();
  }

  return (
    <form className="av" id="avulsa" onSubmit={lancar}>
      <div className="av-principal">
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">1</span><div><h3>A compra</h3><p className="muted">onde, quando e para qual empresa</p></div></header>
          <div className="av-campos">
            <label className="av-largo">Onde comprou<input value={loja} onChange={(v) => setLoja(v.target.value)} placeholder="Mercadinho do centro" /></label>
            <label>Data<input type="date" value={data} onChange={(v) => setData(v.target.value)} /></label>
            <label>Empresa<select value={empresa} onChange={(v) => setEmpresa(v.target.value)}>
              <option value="">Não sei</option>
              {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
            </select></label>
          </div>
        </section>

        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">2</span><div><h3>Os itens</h3><p className="muted">um por linha, com quantidade e valor</p></div></header>
          <div className="av-itens">
            <div className="av-item av-item-cabeca" aria-hidden="true"><span>Item</span><span>Qtd.</span><span>Unid.</span><span>Valor (R$)</span><span /></div>
            {linhas.map((l, k) => (
              <div className="av-item" key={k}>
                <input value={l.descricao} onChange={(v) => mudar(k, "descricao", v.target.value)} placeholder="Limão" aria-label={`Item ${k + 1}`} />
                <input value={l.quantidade} onChange={(v) => mudar(k, "quantidade", v.target.value)} inputMode="decimal" placeholder="2" aria-label="Quantidade" />
                <input value={l.unidade} onChange={(v) => mudar(k, "unidade", v.target.value)} placeholder="kg" aria-label="Unidade" />
                <input value={l.valor} onChange={(v) => mudar(k, "valor", v.target.value)} inputMode="decimal" placeholder="21,98" aria-label="Valor do item" />
                <button type="button" className="ghost small av-tirar" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== k) : ls))} aria-label="Tirar item">×</button>
              </div>
            ))}
            <button type="button" className="ghost small av-mais" onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}>+ Mais um item</button>
          </div>
        </section>
      </div>

      <aside className="av-lado">
        <section className="av-bloco">
          <header className="av-bloco-cabeca"><span className="av-passo">3</span><div><h3>A foto</h3><p className="muted">do cupom ou do recibo</p></div></header>
          <label className={previa ? "av-foto com" : "av-foto"}>
            <input type="file" accept="image/*" capture="environment" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} />
            {previa ? <img src={previa} alt="Foto escolhida do cupom" /> : (
              <span className="av-foto-vazia">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                <b>Tirar ou escolher a foto</b><small>JPG ou PNG</small>
              </span>
            )}
          </label>
        </section>
        <section className="av-bloco av-resumo">
          <div className="av-total"><span>Soma dos itens</span><b>{brl(somaItens)}</b></div>
          <label>Valor total pago (R$)<input value={total} onChange={(v) => setTotal(v.target.value)} inputMode="decimal" placeholder={somaItens ? somaItens.toFixed(2).replace(".", ",") : "0,00"} /></label>
          <label>Observação<input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="Compra de emergência para o bar" /></label>
          {erro && <p className="tv-alerta">{erro}</p>}
          {ok && <p className="es-aviso">{ok}</p>}
          <button disabled={enviando}>{enviando ? "Lançando…" : `Lançar nota avulsa${valorFinal > 0 ? ` · ${brl(valorFinal)}` : ""}`}</button>
          <p className="muted av-nota">A nota avulsa não passa por nenhum órgão: fica guardada com a foto e os itens, junto das notas da SEFAZ.</p>
        </section>
      </aside>
    </form>
  );
}
