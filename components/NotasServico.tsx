"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Aba NFS-e da página Notas: as notas de serviço do Ambiente de Dados Nacional (supabase/nfse.sql).
// Emitidas = a empresa prestou o serviço (a favor); tomadas = a empresa contratou (contra).
// Totais por mês em nfse_meses; a leitura de cada empresa fica no bloco "Leitura do Portal Nacional".
type Empresa = { cnpj: string; raiz: string; nome: string; ativa: boolean; ult_nsu: number; bloqueado_ate: string | null; ultima_consulta: string | null; ultimo_status: string | null };
type Mes = { mes: string; empresa_cnpj: string; papel: string; notas: number; canceladas: number; valor: number; iss: number; iss_retido: number };
type NotaS = {
  empresa_cnpj: string; chave: string; papel: string; numero: string | null; emissao: string | null; competencia: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; emitente_municipio: string | null; tomador_doc: string | null;
  tomador_nome: string | null; local_incidencia: string | null; codigo_servico: string | null; descricao: string | null;
  valor_servico: number | null; base_calculo: number | null; aliquota: number | null; iss: number | null; iss_retido: boolean | null;
  valor_liquido: number | null; situacao: string;
};
type Execucao = { id: string; empresa_cnpj: string; status: string; origem: string; resultado: Record<string, unknown>; erro: string | null; created_at: string };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const doc = (c: string | null) =>
  c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c && c.length === 11 ? `${c.slice(0, 3)}.***.***-${c.slice(9)}` : c ?? "";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const STATUS: Record<string, string> = { na_fila: "na fila", rodando: "rodando", ok: "concluída", sem_dados: "sem notas novas", falha: "falha" };
const PAPEL: Record<string, string> = { emitida: "Emitida (a favor)", tomada: "Tomada (contra)", intermediada: "Intermediada" };

export default function NotasServico() {
  const supabase = useMemo(() => createClient(), []);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [mes, setMes] = useState("");
  const [papel, setPapel] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [busca, setBusca] = useState("");
  const [notas, setNotas] = useState<NotaS[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [aviso, setAviso] = useState("");

  const carregarBase = useCallback(async () => {
    const [e, m, x] = await Promise.all([
      supabase.from("nfse_empresas").select("cnpj,raiz,nome,ativa,ult_nsu,bloqueado_ate,ultima_consulta,ultimo_status").order("cnpj"),
      supabase.from("nfse_meses").select("*").order("mes", { ascending: false }),
      supabase.from("nfse_execucoes").select("id,empresa_cnpj,status,origem,resultado,erro,created_at").order("created_at", { ascending: false }).limit(12),
    ]);
    setEmpresas((e.data ?? []) as Empresa[]);
    const ms = (m.data ?? []) as Mes[];
    setMeses(ms);
    setMes((v) => v || ms[0]?.mes || "");
    setExecucoes((x.data ?? []) as Execucao[]);
  }, [supabase]);
  useEffect(() => { carregarBase(); }, [carregarBase]);
  useEffect(() => {
    const canal = supabase.channel("nfse-execucoes").on("postgres_changes", { event: "*", schema: "public", table: "nfse_execucoes" }, () => carregarBase()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [supabase, carregarBase]);

  useEffect(() => {
    (async () => {
      setNotas(null);
      let q = supabase.from("nfse_notas").select("empresa_cnpj,chave,papel,numero,emissao,competencia,emitente_cnpj,emitente_nome,emitente_municipio,tomador_doc,tomador_nome,local_incidencia,codigo_servico,descricao,valor_servico,base_calculo,aliquota,iss,iss_retido,valor_liquido,situacao");
      if (mes) {
        const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1);
        q = q.gte("emissao", `${mes}-01T00:00:00-03:00`).lt("emissao", `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}-01T00:00:00-03:00`);
      }
      const { data } = await q.order("emissao", { ascending: false }).limit(2000);
      setNotas((data ?? []) as NotaS[]);
    })();
  }, [supabase, mes]);

  async function buscar(cnpj: string) {
    setAviso("");
    const { error } = await supabase.rpc("nfse_buscar", { p_cnpj: cnpj });
    setAviso(error ? error.message : "Leitura pedida ao Portal Nacional. O andamento aparece abaixo.");
    carregarBase();
  }
  async function ajustar(cnpj: string, ativa: boolean) {
    const { error } = await supabase.rpc("nfse_ajustar", { p_cnpj: cnpj, p_ativa: ativa });
    if (error) setAviso(error.message);
    carregarBase();
  }

  const nomeEmpresa = Object.fromEntries(empresas.map((e) => [e.cnpj, e.nome]));
  const doMes = meses.filter((m) => (!mes || m.mes === mes) && (!empresa || m.empresa_cnpj === empresa));
  const soma = (p: string, k: "valor" | "iss" | "iss_retido" | "notas") => doMes.filter((m) => m.papel === p).reduce((s, m) => s + Number(m[k]), 0);
  const t = busca.trim().toLowerCase();
  const lista = (notas ?? []).filter((n) =>
    (!papel || n.papel === papel) && (!empresa || n.empresa_cnpj === empresa) &&
    (!t || [n.emitente_nome, n.tomador_nome, n.descricao, n.numero, n.emitente_cnpj, n.tomador_doc].some((v) => v?.toLowerCase().includes(t))));
  const listaMeses = [...new Set(meses.map((m) => m.mes))];
  const agora = new Date();
  // O Portal lê por raiz: a matriz (final 0001) lê as filiais junto (nfse_leitora no banco)
  const leitoras = empresas.filter((e) => e.cnpj === (empresas.find((x) => x.raiz === e.raiz && x.cnpj.slice(8, 12) === "0001") ?? empresas.find((x) => x.raiz === e.raiz))?.cnpj);
  const daRaiz = (raiz: string, papel: string) => meses.filter((m) => m.empresa_cnpj.startsWith(raiz) && m.papel === papel).reduce((s, m) => s + m.notas, 0);

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Emitidas · a favor</span><span className="es-numero-valor">{brl(soma("emitida", "valor"))}</span><span className="tv-cartao-detalhe">{soma("emitida", "notas")} notas · ISS {brl(soma("emitida", "iss"))}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Tomadas · contra</span><span className="es-numero-valor">{brl(soma("tomada", "valor"))}</span><span className="tv-cartao-detalhe">{soma("tomada", "notas")} notas · serviços contratados</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">ISS retido nas tomadas</span><span className="es-numero-valor">{brl(soma("tomada", "iss_retido"))}</span><span className="tv-cartao-detalhe">a empresa recolhe no lugar do prestador</span></div>
      </div>

      <div className="ft-barra nf-barra">
        <div className="nf-escolha">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            <option value="">Todos os meses</option>
            {listaMeses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
          <select value={papel} onChange={(e) => setPapel(e.target.value)} aria-label="Tipo">
            <option value="">Emitidas e tomadas</option>
            <option value="emitida">Só emitidas (a favor)</option>
            <option value="tomada">Só tomadas (contra)</option>
          </select>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Prestador, tomador, serviço ou número" aria-label="Buscar NFS-e" />
        </div>
      </div>
      <div className="ft-chips nf-empresas" role="tablist" aria-label="Empresa">
        <button role="tab" aria-selected={!empresa} className={!empresa ? "on" : ""} onClick={() => setEmpresa("")}>Todas as empresas</button>
        {empresas.filter((e) => e.ativa || meses.some((m) => m.empresa_cnpj === e.cnpj)).map((e) => (
          <button key={e.cnpj} role="tab" aria-selected={empresa === e.cnpj} className={empresa === e.cnpj ? "on" : ""} onClick={() => setEmpresa(e.cnpj)}>
            {e.nome}<span>{meses.filter((m) => m.empresa_cnpj === e.cnpj && (!mes || m.mes === mes)).reduce((s, m) => s + m.notas, 0)}</span>
          </button>
        ))}
      </div>

      {notas === null ? <p className="muted">Carregando as notas de serviço…</p> : !lista.length ? (
        <p className="muted vazio">{meses.length ? "Nenhuma NFS-e com esses filtros." : "Nenhuma NFS-e lida ainda. A primeira leitura aparece aqui assim que terminar."}</p>
      ) : (
        <ul className="nf-cards nfs-cards">
          {lista.map((n) => {
            const k = `${n.empresa_cnpj}|${n.chave}`;
            const esta = aberta === k;
            const outro = n.papel === "emitida" ? { nome: n.tomador_nome, doc: n.tomador_doc, rotulo: "para" } : { nome: n.emitente_nome, doc: n.emitente_cnpj, rotulo: "de" };
            return (
              <li key={k} className={esta ? "nf-card aberto" : "nf-card"}>
                <button className="nf-card-linha" onClick={() => setAberta(esta ? null : k)} aria-expanded={esta}>
                  <span className={`nf-card-marca ${n.situacao !== "normal" ? "cancelada" : n.papel === "emitida" ? "completa" : "resumo"}`} aria-hidden="true" />
                  <span className="nf-card-forn"><strong>{outro.nome ?? "—"}</strong><small>{outro.rotulo} {doc(outro.doc)} · {nomeEmpresa[n.empresa_cnpj] ?? ""}</small></span>
                  <span className="nf-card-num"><b>Nº {n.numero ?? "—"}</b><small>{n.papel === "emitida" ? "emitida" : n.papel === "tomada" ? "tomada" : "intermediada"}</small></span>
                  <span className="nf-card-data"><b>{dia(n.emissao)}</b><small>emissão</small></span>
                  <span className="nf-card-valor">{brl(n.valor_servico)}</span>
                  <span className="nf-card-selo">
                    {n.situacao !== "normal" ? <span className="estado tv-falha">{n.situacao === "substituida" ? "substituída" : "cancelada"}</span>
                      : n.papel === "emitida" ? <span className="estado tv-ok">a favor</span> : <span className="estado tv-revisar">contra</span>}
                  </span>
                  <span className="ip-seta" aria-hidden="true" />
                </button>
                {esta && <NotaServicoAberta n={n} empresa={nomeEmpresa[n.empresa_cnpj]} />}
              </li>
            );
          })}
        </ul>
      )}

      <section className="nfs-leitura">
        <h2>Leitura do Portal Nacional</h2>
        <p className="muted">Todo dia às 6h30 e às 12h30 o Brasico pergunta ao Ambiente de Dados Nacional da NFS-e, com o certificado de cada empresa e sem custo, por toda nota de serviço emitida ou tomada por ela.</p>
        {aviso && <p className="es-aviso">{aviso}</p>}
        <div className="sf-empresas">
          {leitoras.map((e) => {
            const filiais = empresas.filter((x) => x.raiz === e.raiz && x.cnpj !== e.cnpj);
            const bloqueada = !!e.bloqueado_ate && new Date(e.bloqueado_ate) > agora;
            const falha = !!e.ultimo_status && /falha|erro|rejei|portal|conex/i.test(e.ultimo_status);
            const estado = falha ? { cls: "falha", txt: "Precisa de atenção" } : !e.ativa ? { cls: "parada", txt: "Fora da leitura diária" }
              : e.ultima_consulta ? { cls: "ok", txt: "Em dia" } : { cls: "espera", txt: "Ainda não lida" };
            return (
              <article key={e.cnpj} className="sf-empresa">
                <header className="sf-empresa-cabeca">
                  <span className="nf-grupo-icone" aria-hidden="true">{e.nome.slice(0, 1)}</span>
                  <span className="sf-empresa-nome">
                    <strong>{e.nome}</strong>
                    <small>CNPJ {doc(e.cnpj)}{filiais.length ? ` · lê junto ${filiais.length === 1 ? "a filial" : `${filiais.length} filiais`} ${filiais.map((f) => f.cnpj.slice(8, 12)).join(", ")}` : ""}</small>
                  </span>
                  <span className={`sf-estado ${estado.cls}`}>{estado.txt}</span>
                </header>
                <dl className="sf-numeros">
                  <div><dt>Emitidas</dt><dd>{daRaiz(e.raiz, "emitida")}</dd></div>
                  <div><dt>Tomadas</dt><dd>{daRaiz(e.raiz, "tomada")}</dd></div>
                  <div><dt>Última leitura</dt><dd>{e.ultima_consulta ? `${dia(e.ultima_consulta)} · ${hora(e.ultima_consulta)}` : "nunca"}</dd></div>
                </dl>
                {e.ultimo_status && !STATUS[e.ultimo_status] && <p className="sf-ultimo">{e.ultimo_status}</p>}
                <footer className="sf-empresa-rodape">
                  <label className="sf-chave">
                    <input type="checkbox" checked={e.ativa} onChange={(v) => ajustar(e.cnpj, v.target.checked)} />
                    <span className="sf-chave-trilho" aria-hidden="true" /><span>Leitura diária</span>
                  </label>
                  <button className="ghost small" disabled={bloqueada} title={bloqueada ? `O Portal libera às ${hora(e.bloqueado_ate!)}` : undefined} onClick={() => buscar(e.cnpj)}>
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
                    {x.resultado?.notas != null && <span>{String(x.resultado.notas)} nota(s)</span>}
                    {Number(x.resultado?.eventos) > 0 && <span>{String(x.resultado.eventos)} evento(s)</span>}
                  </span>
                  {x.erro && <p className="sf-erro">{x.erro}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="muted es-nota">
          Desde janeiro de 2026 as prefeituras mandam as notas de serviço para o Ambiente Nacional. Notas mais antigas de prefeitura com sistema próprio
          podem não estar lá. As outras empresas do grupo só entram quando o certificado digital delas for enviado em Certificados digitais.
        </p>
      </section>
    </>
  );
}

function NotaServicoAberta({ n, empresa }: { n: NotaS; empresa?: string }) {
  const supabase = useMemo(() => createClient(), []);
  async function baixarXml() {
    const { data } = await supabase.from("nfse_notas").select("xml").eq("empresa_cnpj", n.empresa_cnpj).eq("chave", n.chave).single();
    if (!data?.xml) return;
    const url = URL.createObjectURL(new Blob([data.xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `NFSe-${n.chave}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="nf-aberta">
      <header className="nf-aberta-cabeca">
        <div className="ft-painel-titulo">
          <span className="es-sobre">NFS-e nº {n.numero ?? "—"} · {PAPEL[n.papel] ?? n.papel}</span>
          <h2 className="nf-painel-nome">{n.descricao ?? "Serviço"}</h2>
          <div className="ft-indicadores">
            <span><small>Emissão</small><b>{dia(n.emissao)}</b></span>
            <span><small>Competência</small><b>{n.competencia ? dia(`${n.competencia}T12:00:00-03:00`) : "—"}</b></span>
            <span><small>Valor do serviço</small><b>{brl(n.valor_servico)}</b></span>
            <span><small>Empresa do grupo</small><b>{empresa ?? "—"}</b></span>
          </div>
        </div>
        <div className="ft-painel-acoes"><button className="ghost small" onClick={baixarXml}>Baixar XML</button></div>
      </header>
      <div className="nf-painel-corpo">
        <dl className="nf-dados">
          <div><dt>Prestador</dt><dd>{n.emitente_nome ?? "—"}<br /><small className="muted">{doc(n.emitente_cnpj)}{n.emitente_municipio ? ` · ${n.emitente_municipio}` : ""}</small></dd></div>
          <div><dt>Tomador</dt><dd>{n.tomador_nome ?? "—"}<br /><small className="muted">{doc(n.tomador_doc)}</small></dd></div>
          <div><dt>ISS devido em</dt><dd>{n.local_incidencia ?? "—"}</dd></div>
          <div><dt>Código do serviço</dt><dd>{n.codigo_servico ?? "—"}</dd></div>
        </dl>
        <dl className="nf-totais nfs-totais">
          <div><dt>Valor do serviço</dt><dd>{brl(n.valor_servico)}</dd></div>
          <div><dt>Base de cálculo</dt><dd>{brl(n.base_calculo)}</dd></div>
          <div><dt>Alíquota do ISS</dt><dd>{n.aliquota != null ? `${Number(n.aliquota).toLocaleString("pt-BR")}%` : "—"}</dd></div>
          <div><dt>ISS</dt><dd>{brl(n.iss)}{n.iss_retido ? " · retido pelo tomador" : n.iss_retido === false ? " · pago pelo prestador" : ""}</dd></div>
          <div className="total"><dt>Valor líquido</dt><dd>{brl(n.valor_liquido)}</dd></div>
        </dl>
        <p className="muted nf-chave">Chave de acesso {n.chave}</p>
      </div>
    </div>
  );
}
