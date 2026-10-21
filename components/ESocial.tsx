"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NOMES } from "@/lib/esocial/nomes";
import Topo from "./Topo";

type Empresa = {
  id: string; nome: string; cnpj: string | null; leitura_automatica: boolean; limite_diario: number; historico_desde: string;
  cert_validade: string | null; cert_emissor: string | null; cert_atualizado_em: string | null;
};
type Execucao = {
  id: string; empresa_id: string; ambiente: number; tipo: string; parametros: Record<string, unknown>; origem: string; status: string;
  cd_resposta: number | null; desc_resposta: string; resultado: Record<string, unknown>; erro: string; created_at: string;
};
type Evento = {
  id_evento: string; tipo: string | null; cpf_trab: string | null; per_apur: string | null; situacao: string;
  resumo: Record<string, string>; descoberto_em: string; baixado_em: string | null;
};
type Trabalhador = { cpf: string; nome: string; matricula: string; origem: string; ativo: boolean; consultado_ate: string | null };

const ABAS = ["Eventos", "Trabalhadores", "Pedidos"] as const;
type Aba = (typeof ABAS)[number];

const TIPO_PEDIDO: Record<string, string> = {
  teste_conexao: "Teste de conexão", identificadores_tabela: "Consulta de tabela", identificadores_empregador: "Consulta da empresa",
  identificadores_trabalhador: "Consulta de trabalhador", download_id: "Download", download_recibo: "Download por recibo",
  consulta_lote: "Consulta de lote", envio_lote: "Envio de lote",
};
const STATUS: Record<string, string> = { na_fila: "Na fila", rodando: "Falando com o eSocial…", ok: "Ok", sem_dados: "Nada encontrado", falha: "Falhou" };
const SITUACAO: Record<string, string> = { pendente: "A baixar", baixado: "Baixado", indisponivel: "Indisponível" };

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const cpfMask = (c: string | null) => (c ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : "");
const cnpjMask = (c: string | null) => (c ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : "");
const diasAte = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
const diaDoMes = () => Number(new Date().toLocaleString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(8, 10));

export default function ESocial({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("Eventos");
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [trabalhadores, setTrabalhadores] = useState<Trabalhador[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregarEmpresas = useCallback(async () => {
    const { data } = await supabase.from("esocial_empresas")
      .select("id,nome,cnpj,leitura_automatica,limite_diario,historico_desde,cert_validade,cert_emissor,cert_atualizado_em")
      .order("ordem").order("nome");
    const lista = (data ?? []) as Empresa[];
    setEmpresas(lista);
    setEmpresa((atual) => (atual && lista.some((e) => e.id === atual) ? atual : lista[0]?.id ?? null));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("esocial_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      carregarEmpresas();
    })();
  }, [supabase, userId, carregarEmpresas]);

  const carregar = useCallback(async () => {
    if (!empresa) return;
    const [ev, tr, ex] = await Promise.all([
      supabase.from("esocial_eventos").select("id_evento,tipo,cpf_trab,per_apur,situacao,resumo,descoberto_em,baixado_em")
        .eq("empresa_id", empresa).eq("ambiente", 1).order("descoberto_em", { ascending: false }).limit(500),
      supabase.from("esocial_trabalhadores").select("cpf,nome,matricula,origem,ativo,consultado_ate").eq("empresa_id", empresa).order("nome"),
      supabase.from("esocial_execucoes").select("id,empresa_id,ambiente,tipo,parametros,origem,status,cd_resposta,desc_resposta,resultado,erro,created_at")
        .eq("empresa_id", empresa).order("created_at", { ascending: false }).limit(40),
    ]);
    setEventos((ev.data ?? []) as Evento[]);
    setTrabalhadores((tr.data ?? []) as Trabalhador[]);
    setExecucoes((ex.data ?? []) as Execucao[]);
  }, [supabase, empresa]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Atualiza sozinho quando um pedido termina
  useEffect(() => {
    if (!acesso) return;
    const ch = supabase
      .channel("esocial")
      .on("postgres_changes", { event: "*", schema: "public", table: "esocial_execucoes" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, acesso, carregar]);

  const emAndamento = execucoes.some((x) => ["na_fila", "rodando"].includes(x.status) && Date.now() - new Date(x.created_at).getTime() < 15 * 60 * 1000);
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [emAndamento, carregar]);

  async function rodar(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setOcupado(true);
    setErro("");
    setAviso("");
    const { error } = await fn();
    setOcupado(false);
    if (error) setErro(error.message);
    else {
      setAviso(ok);
      carregar();
    }
  }

  const e = empresas.find((x) => x.id === empresa);
  const pendentes = eventos.filter((x) => x.situacao === "pendente").length;
  const tipos = [...new Set(eventos.map((x) => x.tipo).filter(Boolean))].sort() as string[];
  const lista = filtroTipo ? eventos.filter((x) => x.tipo === filtroTipo) : eventos;
  const bloqueado = diaDoMes() <= 7;

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="esocial" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso ao eSocial.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="esocial" />
      <main className="miolo tv es">
        <div className="tv-cabeca">
          <h1>eSocial</h1>
          <p className="muted">
            Leitura direta do governo dos eventos que o contador transmite (admissões, folha, desligamentos, totais de INSS e FGTS).
            Nada é enviado ao eSocial por aqui.
          </p>
        </div>

        {empresas.length > 0 && (
          <div className="tv-barra">
            <div className="tv-unidades" role="tablist" aria-label="Empresa">
              {empresas.map((x) => (
                <button key={x.id} role="tab" aria-selected={x.id === empresa} className={x.id === empresa ? "botao-painel on" : "botao-painel"} onClick={() => setEmpresa(x.id)}>
                  {x.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        {erro && <p className="tv-alerta">{erro}</p>}
        {aviso && <p className="es-aviso">{aviso}</p>}
        {bloqueado && <p className="es-aviso">Do dia 1 ao dia 7 de cada mês o eSocial não aceita consultas nem downloads. O teste de conexão funciona.</p>}

        {e && (
          <section className="es-empresa">
            <div className="es-linha">
              <div>
                <strong className="es-nome">{e.nome}</strong>
                <span className="muted"> · CNPJ {cnpjMask(e.cnpj)}</span>
              </div>
              {e.cert_validade && (
                <span className={`estado ${diasAte(e.cert_validade) < 30 ? "tv-falha" : "tv-ok"}`}>
                  Certificado até {dia(e.cert_validade)}{diasAte(e.cert_validade) < 30 ? ` (faltam ${Math.max(0, diasAte(e.cert_validade))} dias)` : ""}
                </span>
              )}
            </div>

            <div className="es-acoes">
              <button className="ghost small" disabled={ocupado} onClick={() => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: 2, p_tipo: "teste_conexao", p_parametros: {} }), "Teste na Produção Restrita pedido. O resultado aparece em Pedidos.")}>
                Testar conexão (ambiente de testes)
              </button>
              <button className="ghost small" disabled={ocupado} onClick={() => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: 1, p_tipo: "teste_conexao", p_parametros: {} }), "Teste na produção pedido. Ele não conta no limite de downloads.")}>
                Testar conexão (produção)
              </button>
              <label className="es-chave">
                <input type="checkbox" checked={e.leitura_automatica} disabled={ocupado}
                  onChange={(v) => rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: v.target.checked, p_limite: null, p_historico_desde: null }).then((r) => (carregarEmpresas(), r)), v.target.checked ? "Leitura automática ligada: um passo a cada 15 minutos, das 8h às 20h, do dia 8 em diante." : "Leitura automática desligada.")} />
                Leitura automática
              </label>
              <label className="es-campo">
                Limite por dia
                <select value={e.limite_diario} disabled={ocupado}
                  onChange={(v) => rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: null, p_limite: Number(v.target.value), p_historico_desde: null }).then((r) => (carregarEmpresas(), r)), "Limite atualizado.")}>
                  {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
              <label className="es-campo">
                Ler desde
                <input type="date" value={e.historico_desde} disabled={ocupado}
                  onChange={(v) => v.target.value && rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: null, p_limite: null, p_historico_desde: v.target.value }).then((r) => (carregarEmpresas(), r)), "Início do histórico atualizado.")} />
              </label>
            </div>
            <p className="muted es-nota">
              O governo permite 10 acessos por dia por empresa ao download, somando os do contador. A leitura automática usa só o limite acima.
            </p>
          </section>
        )}

        {e && (
          <>
            <div className="tv-abas" role="tablist">
              {ABAS.map((a) => (
                <button key={a} role="tab" aria-selected={a === aba} className={a === aba ? "botao-painel on" : "botao-painel"} onClick={() => setAba(a)}>
                  {a}
                  {a === "Eventos" && eventos.length ? <span className="muted"> {eventos.length}</span> : null}
                  {a === "Trabalhadores" && trabalhadores.length ? <span className="muted"> {trabalhadores.length}</span> : null}
                </button>
              ))}
            </div>

            <div className="tv-tabela-caixa">
              {aba === "Eventos" && (
                <>
                  <div className="es-ferramentas">
                    <select value={filtroTipo} onChange={(v) => setFiltroTipo(v.target.value)} aria-label="Tipo de evento">
                      <option value="">Todos os tipos</option>
                      {tipos.map((t) => <option key={t} value={t}>{t} {NOMES[t] ?? ""}</option>)}
                    </select>
                    {pendentes > 0 && (
                      <button className="small" disabled={ocupado || emAndamento || bloqueado}
                        onClick={() => rodar(() => supabase.rpc("esocial_baixar_pendentes", { p_empresa: e.id, p_ambiente: 1 }), "Download pedido.")}>
                        Baixar {Math.min(pendentes, 50)} de {pendentes} pendentes
                      </button>
                    )}
                  </div>
                  <Tabela
                    vazio="Nenhum evento lido ainda. Ligue a leitura automática ou faça uma consulta em Pedidos."
                    cab={["Evento", "Competência", "Trabalhador", "Detalhes", "Situação"]}
                    linhas={lista.map((x) => [
                      x.tipo ? `${x.tipo} ${NOMES[x.tipo] ?? ""}` : "—",
                      x.per_apur ?? "",
                      [cpfMask(x.cpf_trab), x.resumo?.nome].filter(Boolean).join(" · "),
                      detalhes(x.resumo),
                      SITUACAO[x.situacao] ?? x.situacao,
                    ])}
                  />
                </>
              )}

              {aba === "Trabalhadores" && (
                <>
                  <AdicionarCpfs ocupado={ocupado} onEnviar={(cpfs) => rodar(async () => {
                    const r = await supabase.rpc("esocial_adicionar_cpfs", { p_empresa: e.id, p_cpfs: cpfs });
                    if (!r.error && (r.data as { invalidos: string[] })?.invalidos?.length) {
                      return { error: { message: `CPFs inválidos ignorados: ${(r.data as { invalidos: string[] }).invalidos.join(", ")}` } };
                    }
                    return r;
                  }, "CPFs adicionados. Eles entram na leitura automática.")} />
                  <Tabela
                    vazio="Nenhum CPF ainda. O eSocial só entrega os eventos de cada trabalhador pelo CPF; os que aparecerem nos eventos entram sozinhos."
                    cab={["CPF", "Nome", "Matrícula", "Origem", "Lido até"]}
                    linhas={trabalhadores.map((t) => [cpfMask(t.cpf), t.nome, t.matricula, t.origem === "manual" ? "Cadastrado" : "Dos eventos", t.consultado_ate ? dia(t.consultado_ate) : "—"])}
                  />
                </>
              )}

              {aba === "Pedidos" && (
                <>
                  <ConsultaAvulsa ocupado={ocupado || emAndamento} bloqueado={bloqueado}
                    onPedir={(tipo, ambiente, parametros) => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: ambiente, p_tipo: tipo, p_parametros: parametros }), "Consulta pedida.")} />
                  <Tabela
                    vazio="Nenhum pedido ainda."
                    cab={["Quando", "Pedido", "Ambiente", "Situação", "Resposta do eSocial"]}
                    linhas={execucoes.map((x) => [
                      hora(x.created_at),
                      `${TIPO_PEDIDO[x.tipo] ?? x.tipo}${parametrosCurtos(x.parametros)}${x.origem === "agenda" ? " (automático)" : ""}`,
                      x.ambiente === 1 ? "Produção" : "Testes",
                      STATUS[x.status] ?? x.status,
                      [x.cd_resposta != null ? `${x.cd_resposta}` : "", x.desc_resposta, x.erro && x.erro !== x.desc_resposta ? x.erro : "", resultadoCurto(x.resultado)].filter(Boolean).join(" · "),
                    ])}
                  />
                </>
              )}
            </div>
          </>
        )}

        <EnviarCertificado temEmpresas={empresas.length > 0} onPronto={(nome) => {
          setAviso(`Certificado de ${nome} guardado. Agora teste a conexão.`);
          carregarEmpresas();
        }} />
      </main>
    </div>
  );
}

function detalhes(r: Record<string, string> | null) {
  if (!r) return "";
  const p: string[] = [];
  if (r.dtAdm) p.push(`admissão ${r.dtAdm}`);
  if (r.dtDeslig) p.push(`desligamento ${r.dtDeslig}`);
  if (r.dtIniAfast) p.push(`afastamento desde ${r.dtIniAfast}`);
  if (r.dtAso) p.push(`ASO ${r.dtAso}`);
  if (r.nmCargo) p.push(r.nmCargo);
  if (r.indRetif === "2") p.push("retificação");
  if (r.recebido_em) p.push(`recebido ${r.recebido_em.slice(0, 10)}`);
  return p.join(" · ");
}

function parametrosCurtos(p: Record<string, unknown>) {
  if (!p) return "";
  if (p.tpEvt) return ` ${p.tpEvt}${p.perApur ? ` ${p.perApur}` : ""}`;
  if (p.cpf) return ` ${cpfMask(String(p.cpf))}`;
  if (Array.isArray(p.ids)) return ` (${p.ids.length} eventos)`;
  return "";
}

function resultadoCurto(r: Record<string, unknown>) {
  if (!r) return "";
  if (r.total != null) return `${r.total} encontrados`;
  if (r.baixados != null) return `${r.baixados} baixados`;
  return "";
}

function Tabela({ cab, linhas, vazio }: { cab: string[]; linhas: string[][]; vazio: string }) {
  if (!linhas.length) return <p className="muted tv-nada">{vazio}</p>;
  return (
    <div className="tv-rolagem">
      <table className="tv-tabela">
        <thead>
          <tr>{cab.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>{l.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdicionarCpfs({ ocupado, onEnviar }: { ocupado: boolean; onEnviar: (cpfs: string[]) => void }) {
  const [texto, setTexto] = useState("");
  const cpfs = texto.split(/[\s,;]+/).map((c) => c.replace(/\D/g, "")).filter(Boolean);
  return (
    <form className="es-form" onSubmit={(ev) => {
      ev.preventDefault();
      if (!cpfs.length) return;
      onEnviar(cpfs);
      setTexto("");
    }}>
      <textarea rows={2} value={texto} onChange={(v) => setTexto(v.target.value)} placeholder="Cole os CPFs dos funcionários (um por linha ou separados por vírgula)" aria-label="CPFs" />
      <button className="small" disabled={ocupado || !cpfs.length}>Adicionar {cpfs.length || ""}</button>
    </form>
  );
}

function ConsultaAvulsa({ ocupado, bloqueado, onPedir }: {
  ocupado: boolean; bloqueado: boolean; onPedir: (tipo: string, ambiente: number, parametros: Record<string, string>) => void;
}) {
  const [tipo, setTipo] = useState("identificadores_empregador");
  const [ambiente, setAmbiente] = useState(1);
  const [tpEvt, setTpEvt] = useState("S-1299");
  const [perApur, setPerApur] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [cpf, setCpf] = useState("");
  const [de, setDe] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [ate, setAte] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));

  function pedir(ev: React.FormEvent) {
    ev.preventDefault();
    if (tipo === "identificadores_empregador") onPedir(tipo, ambiente, { tpEvt, perApur });
    else if (tipo === "identificadores_tabela") onPedir(tipo, ambiente, { tpEvt });
    else onPedir(tipo, ambiente, { cpf: cpf.replace(/\D/g, ""), dtIni: `${de}T00:00:00`, dtFim: `${ate}T23:59:59` });
  }

  return (
    <form className="es-form es-consulta" onSubmit={pedir}>
      <select value={tipo} onChange={(v) => {
        setTipo(v.target.value);
        setTpEvt(v.target.value === "identificadores_tabela" ? "S-1005" : "S-1299");
      }} aria-label="Tipo de consulta">
        <option value="identificadores_empregador">Empresa (fechamento e totais do mês)</option>
        <option value="identificadores_tabela">Tabelas (empresa, estabelecimentos, rubricas)</option>
        <option value="identificadores_trabalhador">Trabalhador (por CPF)</option>
      </select>
      {tipo === "identificadores_empregador" && (
        <>
          <select value={tpEvt} onChange={(v) => setTpEvt(v.target.value)} aria-label="Evento">
            {["S-1299", "S-1298", "S-5011", "S-5012", "S-5013", "S-1280", "S-1270"].map((t) => <option key={t} value={t}>{t} {NOMES[t] ?? ""}</option>)}
          </select>
          <input type="month" value={perApur} onChange={(v) => setPerApur(v.target.value)} aria-label="Competência" />
        </>
      )}
      {tipo === "identificadores_tabela" && (
        <select value={tpEvt} onChange={(v) => setTpEvt(v.target.value)} aria-label="Tabela">
          {["S-1000", "S-1005", "S-1010", "S-1020", "S-1070"].map((t) => <option key={t} value={t}>{t} {NOMES[t] ?? ""}</option>)}
        </select>
      )}
      {tipo === "identificadores_trabalhador" && (
        <>
          <input value={cpf} onChange={(v) => setCpf(v.target.value)} placeholder="CPF" inputMode="numeric" aria-label="CPF" />
          <input type="date" value={de} onChange={(v) => setDe(v.target.value)} aria-label="De" />
          <input type="date" value={ate} onChange={(v) => setAte(v.target.value)} aria-label="Até" />
        </>
      )}
      <select value={ambiente} onChange={(v) => setAmbiente(Number(v.target.value))} aria-label="Ambiente">
        <option value={1}>Produção</option>
        <option value={2}>Testes</option>
      </select>
      <button className="small" disabled={ocupado || bloqueado}>Consultar</button>
    </form>
  );
}

function EnviarCertificado({ temEmpresas, onPronto }: { temEmpresas: boolean; onPronto: (nome: string) => void }) {
  const [aberto, setAberto] = useState(!temEmpresas);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => setAberto(!temEmpresas), [temEmpresas]);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!arquivo) return;
    setEnviando(true);
    setErro("");
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    fd.append("senha", senha);
    const r = await fetch("/api/esocial/certificado", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ erro: "Falha de conexão com o site." }));
    setEnviando(false);
    setSenha("");
    if (r.erro) return setErro(r.erro);
    setArquivo(null);
    setAberto(false);
    onPronto(r.nome ?? "a empresa");
  }

  if (!aberto) {
    return (
      <p className="es-rodape">
        <button className="ghost small" onClick={() => setAberto(true)}>Enviar ou trocar certificado</button>
      </p>
    );
  }
  return (
    <section className="es-empresa es-certificado">
      <strong>Certificado digital da empresa (e-CNPJ A1)</strong>
      <p className="muted">
        Envie o arquivo .pfx (ou .p12) e a senha. A empresa é reconhecida pelo CNPJ do certificado. O certificado fica guardado
        no cofre do Supabase e só é usado para falar com o eSocial; a senha não é guardada. Um certificado por empresa (raiz do CNPJ).
      </p>
      <form className="es-form" onSubmit={enviar}>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} aria-label="Arquivo do certificado" />
        <input type="password" value={senha} onChange={(v) => setSenha(v.target.value)} placeholder="Senha do certificado" autoComplete="off" aria-label="Senha do certificado" />
        <button className="small" disabled={!arquivo || enviando}>{enviando ? "Conferindo…" : "Guardar certificado"}</button>
        {temEmpresas && <button type="button" className="ghost small" onClick={() => setAberto(false)}>Cancelar</button>}
      </form>
      {erro && <p className="tv-alerta">{erro}</p>}
    </section>
  );
}
