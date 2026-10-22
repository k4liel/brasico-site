"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Receita Federal (Integra Contador do SERPRO): caixa postal, situação fiscal e pagamentos.
// Os pedidos vão por receita_consultar e são feitos pelo site em /api/receita (supabase/receita.sql).
type Ambiente = "demonstracao" | "producao";
type Tipo = "caixa_postal" | "situacao_fiscal" | "pagamentos";
type Empresa = { id: string; nome: string };
type Config = { id: string; producao_ligada: boolean; limite_diario_cobradas: number };
type Execucao = { id: string; tipo: Tipo; status: string; erro: string; resultado: Record<string, unknown>; created_at: string; empresa_id: string };
type Mensagem = { isn: string; assunto: string; remetente: string; enviada_em: string | null; lida_na_receita: boolean; corpo: string | null; relevancia: string };
type Relatorio = { id: string; tamanho: number; created_at: string };
type Pagamento = { numero_documento: string; tipo_documento: string; codigo_receita: string; descricao_receita: string; data_arrecadacao: string | null; valor_total: number | null };
type Chamada = { custo: number; cobrada: boolean };

const TIPOS: { tipo: Tipo; nome: string; botao: string; explica: string }[] = [
  { tipo: "caixa_postal", nome: "Caixa Postal", botao: "Ver mensagens", explica: "Mensagens e avisos que a Receita mandou para a empresa no e-CAC." },
  { tipo: "situacao_fiscal", nome: "Situação fiscal", botao: "Baixar relatório", explica: "O relatório de pendências do e-CAC (dívidas, declarações em atraso), em PDF." },
  { tipo: "pagamentos", nome: "Pagamentos", botao: "Ver pagamentos", explica: "Impostos pagos que já aparecem na Receita (DARF, DAS etc.)." },
];
const NOME_TIPO = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.nome])) as Record<Tipo, string>;
const STATUS: Record<string, { texto: string; classe: string }> = {
  na_fila: { texto: "Na fila", classe: "tv-revisar" },
  rodando: { texto: "Rodando…", classe: "tv-revisar" },
  ok: { texto: "Deu certo", classe: "tv-ok" },
  sem_dados: { texto: "Nada novo", classe: "tv-ok" },
  falha: { texto: "Falhou", classe: "tv-falha" },
};

const dia = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const dataHora = (iso: string) =>
  `${dia(iso)} às ${new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;
const reais = (v: number | null) => (v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
// O texto da mensagem vem em HTML da Receita: mostra só o texto, sem executar nada
const textoDe = (html: string) => {
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
};

export default function Receita({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [ambiente, setAmbiente] = useState<Ambiente>("demonstracao");
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [custoMes, setCustoMes] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [abrindo, setAbrindo] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("receita_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      const [e, c] = await Promise.all([
        supabase.from("esocial_empresas").select("id,nome").order("ordem").order("nome"),
        supabase.from("receita_empresas").select("id,producao_ligada,limite_diario_cobradas"),
      ]);
      const lista = (e.data ?? []) as Empresa[];
      setEmpresas(lista);
      setConfigs((c.data ?? []) as Config[]);
      if (lista[0]) setEmpresa(lista[0].id);
    })();
  }, [supabase, userId]);

  const carregar = useCallback(async () => {
    if (!empresa) return;
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const [x, m, r, p, c] = await Promise.all([
      supabase.from("receita_execucoes").select("id,tipo,status,erro,resultado,created_at,empresa_id")
        .eq("empresa_id", empresa).eq("ambiente", ambiente).order("created_at", { ascending: false }).limit(12),
      supabase.from("receita_mensagens").select("isn,assunto,remetente,enviada_em,lida_na_receita,corpo,relevancia")
        .eq("empresa_id", empresa).eq("ambiente", ambiente).order("enviada_em", { ascending: false }).limit(100),
      supabase.from("receita_relatorios").select("id,tamanho,created_at")
        .eq("empresa_id", empresa).eq("ambiente", ambiente).order("created_at", { ascending: false }).limit(10),
      supabase.from("receita_pagamentos").select("numero_documento,tipo_documento,codigo_receita,descricao_receita,data_arrecadacao,valor_total")
        .eq("empresa_id", empresa).eq("ambiente", ambiente).order("data_arrecadacao", { ascending: false }).limit(100),
      supabase.from("receita_chamadas").select("custo,cobrada")
        .eq("empresa_id", empresa).eq("ambiente", "producao").eq("cobrada", true).gte("created_at", inicioMes.toISOString()),
    ]);
    setExecucoes((x.data ?? []) as Execucao[]);
    setMensagens((m.data ?? []) as Mensagem[]);
    setRelatorios((r.data ?? []) as Relatorio[]);
    setPagamentos((p.data ?? []) as Pagamento[]);
    setCustoMes(((c.data ?? []) as Chamada[]).reduce((s, k) => s + Number(k.custo), 0));
  }, [supabase, empresa, ambiente]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Enquanto houver pedido em andamento, atualiza a cada 2 segundos
  const andamento = execucoes.some((x) => x.status === "na_fila" || x.status === "rodando");
  useEffect(() => {
    if (!andamento) return;
    const t = setInterval(carregar, 2000);
    return () => clearInterval(t);
  }, [andamento, carregar]);

  const config = configs.find((c) => c.id === empresa);
  const producaoLigada = !!config?.producao_ligada;

  async function pedir(tipo: Tipo) {
    setAviso("");
    const { error } = await supabase.rpc("receita_consultar", { p_empresa: empresa, p_ambiente: ambiente, p_tipo: tipo, p_parametros: {} });
    if (error) return setAviso(error.message);
    carregar();
  }

  async function abrirPdf(id: string) {
    setAbrindo(id);
    const { data, error } = await supabase.from("receita_relatorios").select("pdf_base64").eq("id", id).single();
    setAbrindo(null);
    if (error || !data) return setAviso("Não consegui abrir o relatório.");
    const bytes = Uint8Array.from(atob((data as { pdf_base64: string }).pdf_base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="receita" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à Receita Federal.</p></main>
      </div>
    );
  }

  const teste = ambiente === "demonstracao";
  const naoLidas = mensagens.filter((m) => !m.lida_na_receita).length;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="receita" />
      <main className="miolo tv es">
        <div className="es-topo">
          <div>
            <h1>Receita Federal{teste && <span className="rf-selo rf-selo-grande">EM TESTE</span>}</h1>
            <p className="muted">O que se faz no e-CAC, direto da Receita pelo serviço oficial do SERPRO (Integra Contador).</p>
          </div>
          <div className="es-filtros" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} aria-label="Empresa">
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <select value={ambiente} onChange={(e) => setAmbiente(e.target.value as Ambiente)} aria-label="Ambiente">
              <option value="demonstracao">Teste (dados de mentira)</option>
              <option value="producao">Real</option>
            </select>
          </div>
        </div>

        {ambiente === "demonstracao" ? (
          <div className="rf-teste" role="note">
            <span className="rf-teste-icone" aria-hidden="true">⚠</span>
            <div>
              <strong>FASE DE TESTE · DADOS NÃO REAIS</strong>
              <p>
                Nada do que aparece nesta página é da {empresas.find((e) => e.id === empresa)?.nome ?? "empresa"}.
                São dados de mentira do ambiente de demonstração do SERPRO, iguais para qualquer empresa, só para
                mostrar que a ligação com a Receita funciona. Nenhuma consulta é cobrada.
                Os dados reais só aparecem depois que o contrato com o SERPRO for feito e o modo real for ligado.
              </p>
            </div>
          </div>
        ) : !producaoLigada ? (
          <p className="es-aviso">
            <strong>O modo real ainda não foi ligado para esta empresa.</strong> Falta contratar o Integra Contador na loja
            do SERPRO e guardar as chaves do contrato no cofre. Até lá, use o modo teste.
          </p>
        ) : (
          <p className="es-aviso">
            <strong>Modo real.</strong> Cada consulta é cobrada pelo SERPRO (centavos). Limite de {config?.limite_diario_cobradas} chamadas cobradas por dia.
          </p>
        )}
        {aviso && <p className="es-aviso" role="alert">{aviso}</p>}

        <div className="es-numeros">
          <div className="es-numero"><span className="muted">Mensagens{teste && " (teste)"}</span><span className="es-numero-valor">{mensagens.length}</span><span className="muted">{naoLidas} não lidas no e-CAC</span></div>
          <div className="es-numero"><span className="muted">Relatórios de pendências{teste && " (teste)"}</span><span className="es-numero-valor">{relatorios.length}</span><span className="muted">{relatorios[0] ? `último em ${dia(relatorios[0].created_at)}` : "nenhum ainda"}</span></div>
          <div className="es-numero"><span className="muted">Pagamentos{teste && " (teste)"}</span><span className="es-numero-valor">{pagamentos.length}</span><span className="muted">registrados na Receita</span></div>
          <div className="es-numero"><span className="muted">Custo no mês</span><span className="es-numero-valor">{reais(custoMes)}</span><span className="muted">só o modo real é cobrado</span></div>
        </div>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{teste && <SeloTeste />}Consultar agora</h2></div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {TIPOS.map((t) => {
              const rodando = execucoes.some((x) => x.tipo === t.tipo && (x.status === "na_fila" || x.status === "rodando"));
              const bloqueado = !empresa || rodando || (ambiente === "producao" && !producaoLigada);
              return (
                <div key={t.tipo} className="es-numero">
                  <strong>{t.nome}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>{t.explica}</span>
                  <button className="botao-painel" style={{ marginTop: 8 }} disabled={bloqueado} onClick={() => pedir(t.tipo)}>
                    {rodando ? "Consultando…" : t.botao}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{teste && <SeloTeste />}Caixa Postal</h2><span className="muted">{mensagens.length} mensagens</span></div>
          {mensagens.length === 0 ? (
            <p className="muted">Nenhuma mensagem ainda. Clique em “Ver mensagens”.</p>
          ) : (
            <div className="tv-tabela-caixa">
              <table className="tv-tabela">
                <thead><tr><th>Assunto</th><th>De</th><th>Enviada</th><th>No e-CAC</th></tr></thead>
                <tbody>
                  {mensagens.map((m) => (
                    <FragmentoMensagem key={m.isn} m={m} aberta={aberta === m.isn} alternar={() => setAberta(aberta === m.isn ? null : m.isn)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{teste && <SeloTeste />}Situação fiscal (pendências)</h2></div>
          {relatorios.length === 0 ? (
            <p className="muted">Nenhum relatório ainda. Clique em “Baixar relatório”.</p>
          ) : (
            <div className="tv-tabela-caixa">
              <table className="tv-tabela">
                <thead><tr><th>Gerado em</th><th>Tamanho</th><th></th></tr></thead>
                <tbody>
                  {relatorios.map((r) => (
                    <tr key={r.id}>
                      <td>{dataHora(r.created_at)}</td>
                      <td>{Math.round(r.tamanho / 1024)} KB</td>
                      <td><button className="botao-painel" onClick={() => abrirPdf(r.id)} disabled={abrindo === r.id}>{abrindo === r.id ? "Abrindo…" : "Abrir PDF"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{teste && <SeloTeste />}Pagamentos</h2></div>
          {pagamentos.length === 0 ? (
            <p className="muted">Nenhum pagamento ainda. Clique em “Ver pagamentos”.</p>
          ) : (
            <div className="tv-tabela-caixa">
              <table className="tv-tabela">
                <thead><tr><th>Pago em</th><th>Guia</th><th>Imposto</th><th>Documento</th><th>Valor</th></tr></thead>
                <tbody>
                  {pagamentos.map((p) => (
                    <tr key={p.numero_documento}>
                      <td>{dia(p.data_arrecadacao)}</td>
                      <td>{p.tipo_documento}</td>
                      <td>{p.codigo_receita} · {p.descricao_receita}</td>
                      <td>{p.numero_documento}</td>
                      <td>{reais(p.valor_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{teste && <SeloTeste />}Últimos pedidos</h2></div>
          {execucoes.length === 0 ? (
            <p className="muted">Nenhum pedido ainda.</p>
          ) : (
            <div className="tv-tabela-caixa">
              <table className="tv-tabela">
                <thead><tr><th>Quando</th><th>O quê</th><th>Detalhe</th><th>Situação</th></tr></thead>
                <tbody>
                  {execucoes.map((x) => (
                    <tr key={x.id}>
                      <td>{dataHora(x.created_at)}</td>
                      <td>{NOME_TIPO[x.tipo] ?? x.tipo}</td>
                      <td className="muted">{x.erro || resumo(x)}</td>
                      <td><span className={STATUS[x.status]?.classe}>{STATUS[x.status]?.texto ?? x.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SeloTeste() {
  return <span className="rf-selo" title="Dados de mentira do ambiente de demonstração do SERPRO">DADOS DE TESTE</span>;
}

function resumo(x: Execucao): string {
  const r = x.resultado ?? {};
  if (x.tipo === "caixa_postal") {
    if (r.mensagensNovas === false) return "Nenhuma mensagem nova";
    return `${r.listadas ?? 0} mensagens lidas`;
  }
  if (x.tipo === "situacao_fiscal" && r.tamanho) return `PDF de ${Math.round(Number(r.tamanho) / 1024)} KB`;
  if (x.tipo === "pagamentos") return `${r.pagamentos ?? 0} pagamentos`;
  return "";
}

function FragmentoMensagem({ m, aberta, alternar }: { m: Mensagem; aberta: boolean; alternar: () => void }) {
  return (
    <>
      <tr onClick={m.corpo ? alternar : undefined} style={{ cursor: m.corpo ? "pointer" : "default" }}>
        <td>
          {m.relevancia === "2" && <strong title="Relevante">• </strong>}
          {m.assunto}
          {m.corpo && <span className="muted"> {aberta ? "▲" : "▼ ler"}</span>}
        </td>
        <td>{m.remetente}</td>
        <td>{dia(m.enviada_em)}</td>
        <td>{m.lida_na_receita ? "Lida" : "Não lida"}</td>
      </tr>
      {aberta && m.corpo && (
        <tr>
          <td colSpan={4} style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>{textoDe(m.corpo)}</td>
        </tr>
      )}
    </>
  );
}
