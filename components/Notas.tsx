"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Notas fiscais (Operação · fase 1): NF-e das empresas baixadas da SEFAZ toda segunda, notas avulsas
// lançadas com foto e o Índice de Preços. Tabelas e funções em supabase/notas.sql e notas_lotes.sql.
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
  n_item: number; descricao: string; unidade: string | null; quantidade: number | null; valor_unitario: number | null;
  valor_total: number | null; desconto: number; frete: number; preco_efetivo: number | null;
};
type Preco = { produto: string; fornecedor: string; data: string; unidade: string; quantidade: number; preco: number; origem: string };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const qtd = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const cnpjMask = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "");
const STATUS: Record<string, string> = { na_fila: "na fila", rodando: "rodando", ok: "concluída", sem_dados: "sem notas novas", falha: "falha" };

export default function Notas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [busca, setBusca] = useState("");
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [aberta, setAberta] = useState<Nota | null>(null);
  const [aviso, setAviso] = useState("");

  const carregarEmpresas = useCallback(async () => {
    const [e, x] = await Promise.all([
      supabase.from("notas_empresas").select("*").order("nome"),
      supabase.from("notas_execucoes").select("id,empresa_cnpj,tipo,status,origem,resultado,cstat,erro,created_at").order("created_at", { ascending: false }).limit(12),
    ]);
    setEmpresas((e.data ?? []) as Empresa[]);
    setExecucoes((x.data ?? []) as Execucao[]);
  }, [supabase]);

  const carregarNotas = useCallback(async () => {
    const ini = `${mes}-01`;
    const fim = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1).toISOString().slice(0, 10);
    let q = supabase.from("notas").select("chave,empresa_cnpj,origem,emitente_cnpj,emitente_nome,emissao,valor,situacao,completa,foto,observacao")
      .gte("emissao", ini).lt("emissao", fim).order("emissao", { ascending: false }).limit(500);
    if (filtroEmpresa) q = q.eq("empresa_cnpj", filtroEmpresa);
    if (filtroOrigem) q = q.eq("origem", filtroOrigem);
    const { data } = await q;
    setNotas((data ?? []) as Nota[]);
  }, [supabase, mes, filtroEmpresa, filtroOrigem]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notas_acesso").select("user_id").eq("user_id", userId);
      if (!data?.length) return setAcesso(false);
      setAcesso(true);
      carregarEmpresas();
    })();
  }, [supabase, userId, carregarEmpresas]);

  useEffect(() => { if (acesso) carregarNotas(); }, [acesso, carregarNotas]);

  // Andamento ao vivo das buscas na SEFAZ
  useEffect(() => {
    if (!acesso) return;
    const canal = supabase.channel("notas-execucoes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notas_execucoes" }, () => { carregarEmpresas(); carregarNotas(); })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [acesso, supabase, carregarEmpresas, carregarNotas]);

  async function buscar(cnpj: string) {
    setAviso("");
    const { error } = await supabase.rpc("notas_buscar", { p_cnpj: cnpj, p_tipo: "distribuicao" });
    setAviso(error ? error.message : "Busca pedida à SEFAZ. O andamento aparece abaixo.");
    carregarEmpresas();
  }
  async function ajustar(cnpj: string, campo: "ativa" | "ciencia", valor: boolean) {
    const { error } = await supabase.rpc("notas_ajustar", { p_cnpj: cnpj, p_ativa: campo === "ativa" ? valor : null, p_ciencia: campo === "ciencia" ? valor : null });
    if (error) setAviso(error.message);
    carregarEmpresas();
  }

  const nomeEmpresa = useMemo(() => Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome])), [empresas]);
  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? notas.filter((n) => (n.emitente_nome ?? "").toLowerCase().includes(b) || (n.emitente_cnpj ?? "").includes(b)) : notas;
  }, [notas, busca]);
  const totais = useMemo(() => ({
    valor: visiveis.filter((n) => n.situacao !== "cancelada").reduce((s, n) => s + (n.valor ?? 0), 0),
    resumo: visiveis.filter((n) => !n.completa).length,
    avulsas: visiveis.filter((n) => n.origem === "avulsa").length,
  }), [visiveis]);

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
            <p>As NF-e recebidas pelas empresas, baixadas da SEFAZ toda segunda, e as notas avulsas lançadas com foto.</p>
          </div>
        </div>

        <div className="es-numeros">
          <div className="es-numero"><span className="tv-cartao-rotulo">Notas no mês</span><span className="es-numero-valor">{visiveis.length}</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Valor das notas</span><span className="es-numero-valor">{brl(totais.valor)}</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Só em resumo</span><span className="es-numero-valor">{totais.resumo}</span><span className="tv-cartao-detalhe">os itens chegam depois da ciência</span></div>
          <div className="es-numero"><span className="tv-cartao-rotulo">Avulsas</span><span className="es-numero-valor">{totais.avulsas}</span></div>
        </div>

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
        </section>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>Notas</h2><span className="muted">{visiveis.length} no período</span></div>
          <div className="es-filtros nf-filtros">
            <input type="month" value={mes} onChange={(v) => setMes(v.target.value)} aria-label="Mês" />
            <select value={filtroEmpresa} onChange={(v) => setFiltroEmpresa(v.target.value)} aria-label="Empresa">
              <option value="">Todas as empresas</option>
              {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
            </select>
            <select value={filtroOrigem} onChange={(v) => setFiltroOrigem(v.target.value)} aria-label="Origem">
              <option value="">SEFAZ e avulsas</option>
              <option value="sefaz">Só SEFAZ</option>
              <option value="avulsa">Só avulsas</option>
            </select>
            <input value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Fornecedor ou CNPJ" aria-label="Buscar fornecedor" />
          </div>
          {visiveis.length === 0 ? (
            <div className="es-vazio"><p className="muted">Nenhuma nota neste mês. As notas da SEFAZ chegam pela busca da segunda-feira ou pelo botão Buscar agora.</p></div>
          ) : (
            <div className="nf-tabela-wrap">
              <table className="nf-tabela nf-lista">
                <thead><tr><th>Data</th><th>Fornecedor</th><th>Empresa</th><th className="n">Valor</th><th>Situação</th></tr></thead>
                <tbody>
                  {visiveis.map((n) => (
                    <tr key={n.chave} onClick={() => setAberta(n)} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && setAberta(n)}>
                      <td>{dia(n.emissao)}</td>
                      <td><strong>{n.emitente_nome ?? "—"}</strong><small>{n.origem === "avulsa" ? "nota avulsa" : cnpjMask(n.emitente_cnpj)}</small></td>
                      <td>{nomeEmpresa[n.empresa_cnpj] ?? "—"}</td>
                      <td className="n">{brl(n.valor)}</td>
                      <td>
                        {n.situacao === "cancelada" ? <span className="estado tv-falha">cancelada</span>
                          : n.origem === "avulsa" ? <span className="estado">avulsa</span>
                          : n.completa ? <span className="estado tv-ok">completa</span>
                          : <span className="estado tv-revisar">só resumo</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {aberta && <Detalhe nota={aberta} empresa={nomeEmpresa[aberta.empresa_cnpj]} onFechar={() => setAberta(null)} />}

        <AlertasPreco />
        <NotaAvulsa empresas={empresas} onPronto={() => { carregarNotas(); }} />
        <IndicePrecos />

        <p className="muted es-nota">
          A SEFAZ entrega as NF-e dos últimos 90 dias, até 50 por consulta. Quando não há nota nova, ela pede 1 hora de espera antes da
          próxima. A ciência da operação só registra que a empresa sabe da nota: não confirma nem recusa a compra. Cupons e recibos
          entram como nota avulsa.
        </p>
      </main>
    </div>
  );
}

function Detalhe({ nota, empresa, onFechar }: { nota: Nota; empresa?: string; onFechar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [foto, setFoto] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notas_itens").select("n_item,descricao,unidade,quantidade,valor_unitario,valor_total,desconto,frete,preco_efetivo")
        .eq("chave", nota.chave).order("n_item");
      setItens((data ?? []) as Item[]);
      if (nota.foto) {
        const s = await supabase.storage.from("notas-avulsas").createSignedUrl(nota.foto, 3600);
        setFoto(s.data?.signedUrl ?? null);
      }
    })();
  }, [supabase, nota]);

  async function baixarXml() {
    const { data } = await supabase.from("notas").select("xml").eq("chave", nota.chave).single();
    const xml = (data as { xml: string | null } | null)?.xml;
    if (!xml) return;
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nota.chave}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="es-bloco nf-detalhe" aria-label="Nota aberta">
      <div className="es-bloco-cabeca">
        <h2>{nota.emitente_nome ?? "Nota"} <span className="muted">{dia(nota.emissao)} · {brl(nota.valor)}</span></h2>
        <div className="nf-acoes">
          {nota.origem === "sefaz" && <button className="ghost small" onClick={baixarXml}>Baixar XML</button>}
          <button className="ghost small" onClick={onFechar}>Fechar</button>
        </div>
      </div>
      <p className="muted nf-chave">{nota.origem === "avulsa" ? "Nota avulsa" : `Chave ${nota.chave}`} · {empresa ?? ""}{nota.observacao ? ` · ${nota.observacao}` : ""}</p>
      {foto && <a href={foto} target="_blank" rel="noreferrer"><img className="nf-foto" src={foto} alt="Foto do cupom ou recibo" /></a>}
      {itens === null ? <p className="muted">Carregando os itens…</p>
        : itens.length === 0 ? <p className="muted">{nota.completa ? "Nota sem itens." : "Só o resumo chegou até agora. Os itens vêm depois da ciência da operação."}</p>
        : (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead><tr><th>Item</th><th className="n">Quantidade</th><th className="n">Valor</th><th className="n">Preço efetivo</th></tr></thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.n_item}>
                    <td>{i.descricao}</td>
                    <td className="n">{qtd(i.quantidade)} {i.unidade ?? ""}</td>
                    <td className="n">{brl(i.valor_total)}</td>
                    <td className="n">{i.preco_efetivo != null ? `${brl(i.preco_efetivo)} / ${i.unidade ?? "un"}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

function IndicePrecos() {
  const supabase = useMemo(() => createClient(), []);
  const [termo, setTermo] = useState("");
  const [linhas, setLinhas] = useState<Preco[] | null>(null);

  async function procurar(ev: React.FormEvent) {
    ev.preventDefault();
    const t = termo.trim();
    if (t.length < 2) return;
    const [a, b] = await Promise.all([
      supabase.from("notas_itens").select("descricao,unidade,quantidade,preco_efetivo,notas!inner(emitente_nome,emitente_cnpj,emissao,origem,situacao)")
        .ilike("descricao", `%${t}%`).not("preco_efetivo", "is", null).limit(150),
      supabase.from("precos_historico").select("produto,fornecedor,data_emissao,unidade_compra,quantidade,preco_efetivo")
        .ilike("produto", `%${t}%`).order("data_emissao", { ascending: false }).limit(150),
    ]);
    type LinhaA = { descricao: string; unidade: string | null; quantidade: number | null; preco_efetivo: number;
      notas: { emitente_nome: string | null; emitente_cnpj: string | null; emissao: string | null; origem: string; situacao: string } };
    const daSefaz: Preco[] = ((a.data ?? []) as unknown as LinhaA[]).filter((r) => r.notas.situacao !== "cancelada").map((r) => ({
      produto: r.descricao, fornecedor: r.notas.emitente_nome ?? "—", data: r.notas.emissao ?? "", unidade: r.unidade ?? "",
      quantidade: r.quantidade ?? 0, preco: r.preco_efetivo, origem: r.notas.origem === "avulsa" ? "avulsa" : "SEFAZ",
    }));
    type LinhaB = { produto: string; fornecedor: string; data_emissao: string; unidade_compra: string | null; quantidade: number; preco_efetivo: number };
    // Mesma compra nas duas bases: fica a da SEFAZ (fornecedor, dia e preço iguais)
    const vistos = new Set(daSefaz.map((p) => `${p.fornecedor.slice(0, 12).toLowerCase()}|${p.data.slice(0, 10)}|${p.preco.toFixed(2)}`));
    const doCicchetti: Preco[] = ((b.data ?? []) as LinhaB[]).map((r) => ({
      produto: r.produto, fornecedor: r.fornecedor, data: r.data_emissao, unidade: r.unidade_compra ?? "",
      quantidade: Number(r.quantidade), preco: Number(r.preco_efetivo), origem: "Cicchetti",
    })).filter((p) => !vistos.has(`${p.fornecedor.slice(0, 12).toLowerCase()}|${p.data.slice(0, 10)}|${p.preco.toFixed(2)}`));
    setLinhas([...daSefaz, ...doCicchetti].sort((x, y) => y.data.localeCompare(x.data)).slice(0, 200));
  }

  return (
    <section className="es-bloco" id="precos">
      <div className="es-bloco-cabeca"><h2>Índice de Preços</h2><span className="muted">notas da SEFAZ, avulsas e Cicchetti Management</span></div>
      <form className="es-filtros" onSubmit={procurar}>
        <input value={termo} onChange={(v) => setTermo(v.target.value)} placeholder="Produto, por exemplo limão" aria-label="Produto" />
        <button className="small">Procurar</button>
      </form>
      {linhas === null ? <p className="muted">Procure um produto para ver o preço pago em cada compra. Compare só compras na mesma unidade.</p>
        : linhas.length === 0 ? <p className="muted">Nenhuma compra encontrada com esse nome.</p>
        : (
          <div className="nf-tabela-wrap">
            <table className="nf-tabela">
              <thead><tr><th>Data</th><th>Produto</th><th>Fornecedor</th><th className="n">Quantidade</th><th className="n">Preço efetivo</th><th>Origem</th></tr></thead>
              <tbody>
                {linhas.map((p, k) => (
                  <tr key={k}>
                    <td>{dia(p.data)}</td><td>{p.produto}</td><td>{p.fornecedor}</td>
                    <td className="n">{qtd(p.quantidade)} {p.unidade}</td><td className="n">{brl(p.preco)} / {p.unidade || "un"}</td>
                    <td><span className="estado">{p.origem}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
