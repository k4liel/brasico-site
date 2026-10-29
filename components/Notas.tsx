"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cssDoProjeto } from "@/lib/livre";
import Topo from "./Topo";
import DocView from "./DocView";

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
      <main className="miolo tv es nf">
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
                return (
                  <div key={e.cnpj} className="nf-grupo">
                    <div className="nf-grupo-cabeca">
                      <span><strong>{nomeEmpresa[e.cnpj] ?? "Empresa"}</strong><small>CNPJ {cnpjMask(e.cnpj)}</small></span>
                      <span className="muted">{t ? `${t.notas} notas · ${brl(Number(t.valor))} no mês` : ""}</span>
                    </div>
                    <div className="nf-tabela-wrap">
                      <table className="nf-tabela nf-lista">
                        <thead><tr><th>Emissão</th><th>Número</th><th>Fornecedor</th><th className="n">Valor</th><th>Situação</th></tr></thead>
                        <tbody>
                          {e.notas.map((n) => (
                            <tr key={n.chave} onClick={() => setAberta(n)} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && setAberta(n)}>
                              <td>{dia(n.emissao)}</td>
                              <td>{n.origem === "avulsa" ? "avulsa" : <>{numeroNota(n.chave)}<small>série {serieNota(n.chave)}</small></>}</td>
                              <td><strong>{n.emitente_nome ?? "—"}</strong><small>{n.origem === "avulsa" ? n.observacao ?? "" : cnpjMask(n.emitente_cnpj)}</small></td>
                              <td className="n">{brl(n.valor)}</td>
                              <td><Selo n={n} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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

      {aberta && <NotaAberta nota={aberta} empresa={nomeEmpresa[aberta.empresa_cnpj]} onFechar={() => setAberta(null)} />}
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

  useEffect(() => {
    painel.current?.focus();
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = ""; };
  }, [onFechar]);

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
    <div className="ft-fundo" onClick={onFechar}>
      <div className="ft-painel es nf-painel" role="dialog" aria-modal="true" aria-label={`Nota de ${nota.emitente_nome ?? "fornecedor"}`} tabIndex={-1} ref={painel} onClick={(e) => e.stopPropagation()}>
        <header className="ft-painel-cabeca nf-painel-cabeca">
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
            {nota.origem === "sefaz" && nota.completa && <a className="botao small" href={`/api/notas/danfe/${nota.chave}`} target="_blank" rel="noreferrer">Ver PDF</a>}
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Aba Índice de preços: o mesmo conteúdo do projeto Índice de Preços, nas cores do sistema
// ---------------------------------------------------------------------
type CapIndice = { numero: number; titulo: string; conteudo: string };
// As cores do projeto trocadas pelas do sistema (as de unidade e de alta/queda continuam)
const CORES_SISTEMA = `:root .ip-escopo .doc.doc-pagina, .ip-escopo .doc.doc-pagina {
  --doc-navy: var(--strong); --doc-heading: var(--strong); --doc-gold: var(--gold); --doc-ink: var(--text); --doc-muted: var(--muted);
  --doc-line: var(--border); --doc-line-soft: var(--border); --doc-paper: var(--panel);
  --ip-ink: var(--strong); --ip-txt: var(--text); --ip-mut: var(--muted); --ip-fraco: var(--muted); --ip-linha: var(--border);
  --ip-linha2: var(--border); --ip-suave: var(--soft); --ip-papel: var(--panel); --ip-acento: var(--gold);
  background: transparent;
}`;

function IndicePrecos() {
  const supabase = useMemo(() => createClient(), []);
  const [dados, setDados] = useState<{ css: string | null; atualizado_em: string | null; capitulos: CapIndice[] } | null>(null);
  const [num, setNum] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async (aoVivo: boolean) => {
    setCarregando(true); setErro("");
    const { data, error } = await supabase.rpc("notas_indice_precos", { p_ao_vivo: aoVivo });
    setCarregando(false);
    if (error) return setErro(error.message);
    setDados(data as { css: string | null; atualizado_em: string | null; capitulos: CapIndice[] });
  }, [supabase]);
  useEffect(() => { carregar(false); }, [carregar]);

  const caps = dados?.capitulos ?? [];
  const principais = caps.filter((c) => !c.titulo.includes("Catálogo"));
  const catalogo = caps.filter((c) => c.titulo.includes("Catálogo"));
  const nome = (t: string) => t.replace(/^\s*\d+\s*·\s*/, "").replace(/^Catálogo · /, "");
  const atual = caps.find((c) => c.numero === num) ?? caps[0];
  const noCatalogo = atual ? catalogo.includes(atual) : false;

  return (
    <>
      <AlertasPreco />
      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>Índice de preços</h2>
          <span className="muted">{dados?.atualizado_em ? `atualizado em ${dia(dados.atualizado_em)} às ${hora(dados.atualizado_em)}` : ""}
            <button className="ghost small nf-atualizar" disabled={carregando} onClick={() => carregar(true)}>{carregando ? "Calculando…" : "Atualizar agora"}</button></span>
        </div>
        <p className="muted cp-ajuda">As compras de todas as notas do Cicchetti Management, recalculadas todo dia às 6h: índice do mês, altas e quedas, oscilação, fornecedores e o catálogo de cada produto.</p>
        {erro && <p className="es-aviso tv-alerta">{erro}</p>}
        <div className="ft-chips" role="tablist" aria-label="Parte do índice">
          {principais.map((c) => <button key={c.numero} role="tab" aria-selected={atual?.numero === c.numero} className={atual?.numero === c.numero ? "on" : ""} onClick={() => setNum(c.numero)}>{nome(c.titulo)}</button>)}
          {catalogo.length > 0 && <button role="tab" aria-selected={noCatalogo} className={noCatalogo ? "on" : ""} onClick={() => setNum(catalogo[0].numero)}>Catálogo</button>}
        </div>
        {noCatalogo && (
          <div className="ft-chips ft-chips-sub nf-sub" role="tablist" aria-label="Catálogo">
            {catalogo.map((c) => <button key={c.numero} role="tab" aria-selected={atual?.numero === c.numero} className={atual?.numero === c.numero ? "on" : ""} onClick={() => setNum(c.numero)}>{nome(c.titulo)}</button>)}
          </div>
        )}
      </section>
      {dados?.css && <style dangerouslySetInnerHTML={{ __html: cssDoProjeto(dados.css, ".ip-escopo") + "\n" + CORES_SISTEMA }} />}
      <div className="ip-escopo nf-indice">
        {!dados ? <p className="muted">Carregando o índice…</p> : atual && <DocView key={atual.numero} capitulos={[{ titulo: atual.titulo, conteudo: atual.conteudo }]} modo="pagina" />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Aba Leitura da SEFAZ: empresas, rotina, ciência e o andamento
// ---------------------------------------------------------------------
function LeituraSefaz({ empresas, onMudou }: { empresas: Empresa[]; onMudou: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [aviso, setAviso] = useState("");
  const carregar = useCallback(async () => {
    const { data } = await supabase.from("notas_execucoes").select("id,empresa_cnpj,tipo,status,origem,resultado,cstat,erro,created_at").order("created_at", { ascending: false }).limit(15);
    setExecucoes((data ?? []) as Execucao[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const canal = supabase.channel("notas-execucoes").on("postgres_changes", { event: "*", schema: "public", table: "notas_execucoes" }, () => { carregar(); onMudou(); }).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, carregar, onMudou]);

  async function buscar(cnpj: string) {
    setAviso("");
    const { error } = await supabase.rpc("notas_buscar", { p_cnpj: cnpj, p_tipo: "distribuicao" });
    setAviso(error ? error.message : "Busca pedida à SEFAZ. O andamento aparece abaixo.");
    onMudou(); carregar();
  }
  async function ajustar(cnpj: string, campo: "ativa" | "ciencia", valor: boolean) {
    const { error } = await supabase.rpc("notas_ajustar", { p_cnpj: cnpj, p_ativa: campo === "ativa" ? valor : null, p_ciencia: campo === "ciencia" ? valor : null });
    if (error) setAviso(error.message);
    onMudou();
  }
  const nomeEmpresa = Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome]));

  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Empresas consultadas na SEFAZ</h2><span className="muted">rotina toda segunda às 6h, nova rodada às 9h</span></div>
      <div className="nf-tabela-wrap">
        <table className="nf-tabela">
          <thead><tr><th>Empresa</th><th>Na rotina</th><th>Ciência</th><th>Última consulta</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {empresas.map((e) => {
              const bloqueada = e.bloqueado_ate && new Date(e.bloqueado_ate) > new Date();
              return (
                <tr key={e.cnpj}>
                  <td><strong>{e.nome}</strong><small>{cnpjMask(e.cnpj)}</small></td>
                  <td><input type="checkbox" checked={e.ativa} onChange={(v) => ajustar(e.cnpj, "ativa", v.target.checked)} aria-label={`Incluir ${e.nome} na rotina semanal`} /></td>
                  <td><input type="checkbox" checked={e.ciencia} onChange={(v) => ajustar(e.cnpj, "ciencia", v.target.checked)} aria-label={`Registrar a ciência das notas de ${e.nome}`} /></td>
                  <td>{e.ultima_consulta ? `${dia(e.ultima_consulta)} ${hora(e.ultima_consulta)}` : "nunca"}</td>
                  <td>{e.ultimo_status ? (STATUS[e.ultimo_status] ?? e.ultimo_status) : "—"}{bloqueada && <small>SEFAZ libera às {hora(e.bloqueado_ate!)}</small>}</td>
                  <td><button className="ghost small" disabled={!!bloqueada} onClick={() => buscar(e.cnpj)}>Buscar agora</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {aviso && <p className="es-aviso">{aviso}</p>}
      {execucoes.length > 0 && (
        <ul className="nf-execucoes">
          {execucoes.map((x) => (
            <li key={x.id}>
              <span className={`estado tv-${x.status === "sem_dados" ? "ok" : x.status}`}>{STATUS[x.status] ?? x.status}</span>
              <span>{x.tipo === "ciencia" ? "Ciência" : "Busca"} · {nomeEmpresa[x.empresa_cnpj] ?? x.empresa_cnpj}</span>
              <span className="muted">{dia(x.created_at)} {hora(x.created_at)}
                {x.resultado?.notas != null && ` · ${x.resultado.notas} nota(s)`}
                {x.resultado?.registradas != null && ` · ${x.resultado.registradas} ciência(s)`}
                {x.erro && ` · ${x.erro}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted es-nota">
        A SEFAZ entrega as NF-e dos últimos 90 dias, até 50 por consulta. Quando não há nota nova, ela pede 1 hora de espera antes da
        próxima. A ciência da operação só registra que a empresa sabe da nota: não confirma nem recusa a compra. O PDF de cada nota
        é montado na hora a partir do XML oficial que veio da SEFAZ.
      </p>
    </section>
  );
}

type Linha = { descricao: string; quantidade: string; unidade: string; valor: string };
const linhaVazia = (): Linha => ({ descricao: "", quantidade: "", unidade: "", valor: "" });
const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export function NotaAvulsa({ empresas, onPronto }: { empresas: Empresa[]; onPronto: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [empresa, setEmpresa] = useState("");
  const [loja, setLoja] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [linhas, setLinhas] = useState<Linha[]>([linhaVazia()]);
  const [total, setTotal] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  const somaItens = linhas.reduce((s, l) => s + (numero(l.valor) || 0), 0);
  const mudar = (k: number, campo: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === k ? { ...l, [campo]: v } : l)));

  async function lancar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(""); setOk("");
    const itens = linhas.filter((l) => l.descricao.trim()).map((l) => ({
      descricao: l.descricao.trim(), quantidade: numero(l.quantidade) || null, unidade: l.unidade.trim() || null, valor_total: numero(l.valor) || null,
    }));
    if (!loja.trim()) return setErro("Informe onde foi a compra.");
    if (!itens.length) return setErro("Inclua pelo menos um item com nome.");
    const valor = numero(total) || somaItens;
    if (!(valor > 0)) return setErro("Informe o valor total da compra.");
    setEnviando(true);
    let caminho = "";
    if (arquivo) {
      caminho = `${data.slice(0, 7)}/${crypto.randomUUID()}.${(arquivo.name.split(".").pop() || "jpg").toLowerCase()}`;
      const up = await supabase.storage.from("notas-avulsas").upload(caminho, arquivo, { contentType: arquivo.type || "image/jpeg" });
      if (up.error) { setEnviando(false); return setErro(`Não consegui guardar a foto: ${up.error.message}`); }
    }
    const { error } = await supabase.rpc("notas_lancar_avulsa", {
      p_empresa: empresa, p_loja: loja, p_data: data, p_valor: valor, p_itens: itens, p_foto: caminho, p_observacao: obs,
    });
    setEnviando(false);
    if (error) return setErro(error.message);
    setOk(`Nota avulsa de ${loja.trim()} lançada (${brl(valor)}).`);
    setLoja(""); setLinhas([linhaVazia()]); setTotal(""); setArquivo(null); setObs("");
    (ev.currentTarget as HTMLFormElement).reset();
    onPronto();
  }

  return (
    <section className="es-bloco" id="avulsa">
      <div className="es-bloco-cabeca"><h2>Lançar nota avulsa</h2><span className="muted">compra sem NF-e: cupom ou recibo</span></div>
      <form className="nf-avulsa" onSubmit={lancar}>
        <div className="nf-campos">
          <label>Onde comprou<input value={loja} onChange={(v) => setLoja(v.target.value)} placeholder="Mercadinho do centro" /></label>
          <label>Data<input type="date" value={data} onChange={(v) => setData(v.target.value)} /></label>
          <label>Empresa<select value={empresa} onChange={(v) => setEmpresa(v.target.value)}>
            <option value="">Não sei</option>
            {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
          </select></label>
          <label>Foto do cupom ou recibo<input type="file" accept="image/*" capture="environment" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="nf-itens">
          <div className="nf-item nf-item-cabeca"><span>Item</span><span>Qtd.</span><span>Unid.</span><span>Valor (R$)</span><span /></div>
          {linhas.map((l, k) => (
            <div className="nf-item" key={k}>
              <input value={l.descricao} onChange={(v) => mudar(k, "descricao", v.target.value)} placeholder="Limão" aria-label={`Item ${k + 1}`} />
              <input value={l.quantidade} onChange={(v) => mudar(k, "quantidade", v.target.value)} inputMode="decimal" placeholder="2" aria-label="Quantidade" />
              <input value={l.unidade} onChange={(v) => mudar(k, "unidade", v.target.value)} placeholder="kg" aria-label="Unidade" />
              <input value={l.valor} onChange={(v) => mudar(k, "valor", v.target.value)} inputMode="decimal" placeholder="21,98" aria-label="Valor do item" />
              <button type="button" className="ghost small" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== k) : ls))} aria-label="Tirar item">×</button>
            </div>
          ))}
          <button type="button" className="ghost small" onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}>Mais um item</button>
        </div>
        <div className="nf-campos">
          <label>Valor total (R$)<input value={total} onChange={(v) => setTotal(v.target.value)} inputMode="decimal" placeholder={somaItens ? somaItens.toFixed(2).replace(".", ",") : "0,00"} /></label>
          <label className="nf-largo">Observação<input value={obs} onChange={(v) => setObs(v.target.value)} placeholder="Compra de emergência para o bar" /></label>
        </div>
        <button disabled={enviando}>{enviando ? "Lançando…" : "Lançar nota avulsa"}</button>
        {erro && <p className="tv-alerta">{erro}</p>}
        {ok && <p className="es-aviso">{ok}</p>}
      </form>
    </section>
  );
}

// Índice de Preços: itens das notas da SEFAZ e avulsas junto com a base do Cicchetti Management
// Alertas de preço (fase 6): compra dos últimos 14 dias 15% ou mais acima da média das compras anteriores
// do mesmo item no mesmo fornecedor (view precos_alertas, supabase/automacao.sql)
type Alerta = { chave: string; emissao: string; fornecedor: string | null; descricao: string; unidade: string | null; quantidade: number;
  preco: number; media_anterior: number; compras_anteriores: number; alta_pct: number };
function AlertasPreco() {
  const supabase = useMemo(() => createClient(), []);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [todos, setTodos] = useState(false);
  useEffect(() => {
    supabase.from("precos_alertas").select("*").order("alta_pct", { ascending: false }).limit(200)
      .then(({ data }) => setAlertas((data ?? []) as Alerta[]));
  }, [supabase]);
  if (!alertas?.length) return null;
  const vistos = todos ? alertas : alertas.slice(0, 8);
  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Alertas de preço</h2><span className="muted">{alertas.length} itens subiram 15% ou mais nos últimos 14 dias</span></div>
      <div className="nf-tabela-wrap">
        <table className="nf-tabela">
          <thead><tr><th>Item</th><th>Fornecedor</th><th className="n">Pago</th><th className="n">Média antes</th><th className="n">Alta</th></tr></thead>
          <tbody>
            {vistos.map((a) => (
              <tr key={a.chave + a.descricao}>
                <td><strong>{a.descricao}</strong><small>{a.emissao ? new Date(a.emissao).toLocaleDateString("pt-BR") : ""} · {a.unidade ?? ""}</small></td>
                <td>{a.fornecedor ?? "—"}</td>
                <td className="n">{brl(a.preco)}</td>
                <td className="n">{brl(a.media_anterior)}<small>{a.compras_anteriores} compras</small></td>
                <td className="n"><span className="es-ruim">+{a.alta_pct.toLocaleString("pt-BR")}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {alertas.length > 8 && <button className="ghost small" onClick={() => setTodos((t) => !t)}>{todos ? "Mostrar menos" : `Ver todos os ${alertas.length}`}</button>}
      <p className="muted es-nota">Compara com a média das compras do mesmo item, na mesma unidade e no mesmo fornecedor, nos 120 dias anteriores (pelo menos 2 compras).</p>
    </section>
  );
}

