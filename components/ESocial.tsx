"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NOMES } from "@/lib/esocial/nomes";
import {
  cpfVisivel, dataBR, diasEntre, hoje, linhaDoTempo, mesAnterior, montarAlertas, montarFolhas, montarNumeros, montarPassos,
  montarCalendario, montarPessoas, nomeMes, ROTULO_SITUACAO, tempoDeCasa,
  type Alerta, type EmpresaRH as Empresa, type EventoRH as Evento, type ExecucaoRH as Execucao, type Pessoa, type Situacao,
  type TrabalhadorRH as Trabalhador,
} from "@/lib/esocial/rh";
import Topo from "./Topo";

type Consulta = { id: string; user_id: string | null; origem: string; ferramenta: string; parametros: Record<string, unknown>; quantidade: number; created_at: string };

const ABAS = ["Eventos", "Trabalhadores", "Pedidos"] as const;
type Aba = (typeof ABAS)[number];
const FILTROS = ["Trabalhando", "Em experiência", "Afastados", "Saíram", "Aguardando leitura", "Todos"] as const;
type Filtro = (typeof FILTROS)[number];
const NO_FILTRO: Record<Filtro, (s: Situacao) => boolean> = {
  Trabalhando: (s) => ["trabalhando", "experiencia", "afastado", "ferias"].includes(s),
  "Em experiência": (s) => s === "experiencia",
  Afastados: (s) => s === "afastado" || s === "ferias",
  Saíram: (s) => s === "saiu",
  "Aguardando leitura": (s) => s === "aguardando",
  Todos: () => true,
};

const TIPO_PEDIDO: Record<string, string> = {
  teste_conexao: "Teste de conexão", identificadores_tabela: "Consulta de tabela", identificadores_empregador: "Consulta da empresa",
  identificadores_trabalhador: "Consulta de trabalhador", download_id: "Download", download_recibo: "Download por recibo",
  consulta_lote: "Consulta de lote", envio_lote: "Envio de lote",
};
const STATUS: Record<string, string> = { na_fila: "Na fila", rodando: "Falando com o eSocial…", ok: "Ok", sem_dados: "Nada encontrado", falha: "Falhou" };
const SITUACAO: Record<string, string> = { pendente: "A baixar", baixado: "Baixado", indisponivel: "Indisponível" };

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const horaCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const cnpjMask = (c: string | null) => (c ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : "");
const diasAte = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
const diaDoMes = () => Number(hoje().slice(8, 10));
const reais = (v: string | null) => (v ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "");
// "AUXILIAR DE COZINHA" → "Auxiliar de cozinha"; "SUB CHEFE I" → "Sub chefe I"
const titulo = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b(i{1,3}|iv)$/, (m) => m.toUpperCase()) : "");
// "ALCIDES EDUARDO DE LIMA" → "Alcides Eduardo de Lima"
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const nomeCurto = (nome: string) => nome.replace(/\s+(LTDA|EIRELI|ME|EPP|S\/?A)\.?$/i, "").replace(/\b(EMPREENDIMENTOS TURISTICOS)\b/i, "").trim();

function lerLocal(chave: string) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarLocal(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {}
}

export default function ESocial({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [trabalhadores, setTrabalhadores] = useState<Trabalhador[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("todas");
  const [filtro, setFiltro] = useState<Filtro>("Trabalhando");
  const [busca, setBusca] = useState("");
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [verCpf, setVerCpf] = useState(false);
  const [tecnicoAberto, setTecnicoAberto] = useState(false);
  const [painel, setPainel] = useState<"cpfs" | "historico" | "certificado" | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setVerCpf(lerLocal("brasico-esocial-ver-cpf") === "1");
    const e = lerLocal("brasico-esocial-empresa");
    if (e) setFiltroEmpresa(e);
  }, []);

  const carregar = useCallback(async () => {
    const [em, ev, tr, ex] = await Promise.all([
      supabase.from("esocial_empresas")
        .select("id,nome,cnpj,leitura_automatica,limite_diario,historico_desde,cert_validade,cert_emissor,cert_atualizado_em")
        .order("ordem").order("nome"),
      supabase.from("esocial_eventos").select("id_evento,empresa_id,tipo,cpf_trab,per_apur,situacao,nr_recibo,resumo,descoberto_em,baixado_em")
        .eq("ambiente", 1).order("descoberto_em", { ascending: false }).limit(5000),
      supabase.from("esocial_trabalhadores").select("empresa_id,cpf,nome,matricula,cargo,admissao,unidade,origem,ativo,consultado_ate").order("nome"),
      supabase.from("esocial_execucoes").select("id,empresa_id,ambiente,tipo,parametros,origem,status,cd_resposta,desc_resposta,resultado,erro,created_at")
        .order("created_at", { ascending: false }).limit(300),
    ]);
    setEmpresas((em.data ?? []) as Empresa[]);
    setEventos((ev.data ?? []) as Evento[]);
    setTrabalhadores((tr.data ?? []) as Trabalhador[]);
    setExecucoes((ex.data ?? []) as Execucao[]);
    const { data: cs } = await supabase.from("esocial_consultas").select("id,user_id,origem,ferramenta,parametros,quantidade,created_at")
      .order("created_at", { ascending: false }).limit(60);
    setConsultas((cs ?? []) as Consulta[]);
    setCarregado(true);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("esocial_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      carregar();
    })();
  }, [supabase, userId, carregar]);

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

  function escolherEmpresa(id: string) {
    setFiltroEmpresa(id);
    gravarLocal("brasico-esocial-empresa", id);
  }
  function alternarCpf() {
    setVerCpf((v) => {
      gravarLocal("brasico-esocial-ver-cpf", v ? "0" : "1");
      return !v;
    });
  }

  // Tudo o que a página mostra sai destes cálculos (lib/esocial/rh.ts)
  const daEmpresa = <T extends { empresa_id: string }>(l: T[]) => (filtroEmpresa === "todas" ? l : l.filter((x) => x.empresa_id === filtroEmpresa));
  const empresasVistas = filtroEmpresa === "todas" ? empresas : empresas.filter((e) => e.id === filtroEmpresa);
  const pessoas = useMemo(() => montarPessoas(eventos, trabalhadores), [eventos, trabalhadores]);
  const pessoasVistas = daEmpresa(pessoas);
  const competencias = [mesAnterior(), mesAnterior(hoje(), 2)];
  const folhas = montarFolhas(empresasVistas, eventos, execucoes, competencias);
  const calendario = montarCalendario(folhas, empresasVistas);
  const alertas = montarAlertas(empresasVistas, pessoasVistas, folhas, daEmpresa(execucoes));
  const numeros = montarNumeros(pessoasVistas, empresasVistas);
  const passos = montarPassos(empresas, trabalhadores, execucoes);
  const ultimaLeitura = execucoes.find((x) => x.ambiente === 1 && ["ok", "sem_dados"].includes(x.status) && x.tipo !== "teste_conexao");
  const desde = empresasVistas.map((e) => e.historico_desde).sort()[0];
  const nomeEmpresa = (id: string) => nomeCurto(empresas.find((e) => e.id === id)?.nome ?? id);
  const pessoaAberta = pessoas.find((p) => p.chave === aberta) ?? null;
  const bloqueado = diaDoMes() <= 7;

  const termo = busca.trim().toLowerCase();
  const equipe = pessoasVistas.filter((p) => NO_FILTRO[filtro](p.situacao))
    .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || p.cpf.includes(termo.replace(/\D/g, "") || "#") || p.cargo.toLowerCase().includes(termo));
  // Lista longa: mostra 30 e um botão para ver o resto (a busca mostra tudo)
  const visiveis = mostrarTodos || termo ? equipe : equipe.slice(0, 30);

  function verFiltro(f: Filtro) {
    setFiltro(f);
    document.getElementById("es-equipe")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function agirPasso(id: string) {
    if (id === "certificado") return setPainel("certificado");
    if (id === "cpfs") return setPainel("cpfs");
    if (id === "historico") return setPainel("historico");
    if (id === "teste") {
      return rodar(async () => {
        for (const e of empresas) {
          const r = await supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: 1, p_tipo: "teste_conexao", p_parametros: {} });
          if (r.error) return r;
        }
        return { error: null };
      }, "Teste pedido. Em alguns segundos o resultado aparece aqui.");
    }
    if (id === "leitura") {
      return rodar(async () => {
        for (const e of empresas.filter((x) => !x.leitura_automatica)) {
          const r = await supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: true, p_limite: null, p_historico_desde: null });
          if (r.error) return r;
        }
        return { error: null };
      }, "Leitura automática ligada: um passo a cada 15 minutos, das 8h às 20h, do dia 8 em diante.");
    }
  }

  function agirAlerta(a: Alerta) {
    if (a.pessoa) return setAberta(a.pessoa);
    if (a.acao === "certificado") return setPainel("certificado");
    if (a.acao === "leitura") return rodar(() => supabase.rpc("esocial_configurar", { p_empresa: a.empresa_id, p_leitura: true, p_limite: null, p_historico_desde: null }), "Leitura automática ligada.");
    if (a.acao === "tecnico") {
      setTecnicoAberto(true);
      setTimeout(() => document.getElementById("es-tecnico")?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="esocial" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso ao RH · eSocial.</p></main>
      </div>
    );
  }

  const feitos = passos.filter((p) => p.feito).length;
  const proximo = passos.find((p) => !p.feito);
  const semEmpresas = carregado && empresas.length === 0;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="esocial" />
      <main className="miolo tv es">
        {/* Cabeçalho */}
        <div className="es-topo">
          <div>
            <h1>RH · eSocial</h1>
            <p className="muted">
              {ultimaLeitura ? `Dados do governo lidos até ${horaCurta(ultimaLeitura.created_at)}` : "Ainda não lemos dados do governo"}
              {desde ? ` · histórico desde ${dataBR(desde)}` : ""}
              <Ajuda texto="Os dados vêm do eSocial, o sistema do governo onde o contador informa tudo sobre os funcionários. Aqui só lemos; nada é enviado ao governo." />
            </p>
          </div>
          {empresas.length > 1 && (
            <div className="tv-unidades" role="tablist" aria-label="Empresa">
              {[{ id: "todas", nome: "Todas" }, ...empresas].map((x) => (
                <button key={x.id} role="tab" aria-selected={x.id === filtroEmpresa}
                  className={x.id === filtroEmpresa ? "botao-painel on" : "botao-painel"} onClick={() => escolherEmpresa(x.id)}>
                  {x.id === "todas" ? "Todas" : nomeCurto(x.nome)}
                </button>
              ))}
            </div>
          )}
        </div>

        {bloqueado && <p className="es-aviso">Do dia 1 ao dia 7 o governo não libera a leitura. Voltamos no dia 8; os dados abaixo são da última leitura.</p>}
        {erro && <p className="tv-alerta">{erro}</p>}
        {aviso && <p className="es-aviso">{aviso}</p>}

        {!carregado ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : semEmpresas ? (
          <section className="es-bloco es-boasvindas">
            <h2>Bem-vindo à área de RH</h2>
            <p>Aqui você acompanha a equipe das empresas: quem entrou, quem saiu, férias, afastamentos e se a folha foi fechada pelo contador.
              Os dados vêm direto do governo (eSocial). Para começar, envie o certificado digital de uma empresa.</p>
            <EnviarCertificado aberto onFechar={() => {}} onPronto={(nome) => {
              setAviso(`Certificado de ${nome} guardado. Agora teste a conexão.`);
              carregar();
            }} />
          </section>
        ) : (
          <>
            {/* 0. Primeiros passos */}
            {proximo && (
              <section className="es-bloco">
                <div className="es-bloco-cabeca">
                  <h2><Icone nome="passos" />Primeiros passos</h2>
                  <span className="muted">{feitos} de {passos.length} feitos</span>
                </div>
                <div className="es-barra" aria-hidden="true"><i style={{ width: `${(feitos / passos.length) * 100}%` }} /></div>
                <ul className="es-passos">
                  {passos.map((p) => (
                    <li key={p.id} className={p.feito ? "feito" : p === proximo ? "proximo" : ""}>
                      <span className="es-caixa" aria-hidden="true">{p.feito ? "✓" : ""}</span>
                      <span>{p.texto}</span>
                      {!p.feito && <button className={p === proximo ? "small" : "ghost small"} disabled={ocupado} onClick={() => agirPasso(p.id)}>{p.acao}</button>}
                    </li>
                  ))}
                </ul>
                {painel === "cpfs" && (
                  <PainelCpfs empresas={empresas} ocupado={ocupado} onFechar={() => setPainel(null)}
                    onEnviar={(empresa, cpfs) => rodar(async () => {
                      const r = await supabase.rpc("esocial_adicionar_cpfs", { p_empresa: empresa, p_cpfs: cpfs });
                      const inv = (r.data as { invalidos?: string[] } | null)?.invalidos ?? [];
                      if (!r.error && inv.length) return { error: { message: `Adicionados. Estes CPFs estão errados e ficaram de fora: ${inv.join(", ")}` } };
                      return r;
                    }, "CPFs adicionados. A leitura automática vai buscar os dados de cada um.")} />
                )}
                {painel === "historico" && (
                  <PainelHistorico empresas={empresas} ocupado={ocupado} onFechar={() => setPainel(null)}
                    onSalvar={(data) => rodar(async () => {
                      for (const e of empresas) {
                        const r = await supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: null, p_limite: null, p_historico_desde: data });
                        if (r.error) return r;
                      }
                      setPainel(null);
                      return { error: null };
                    }, `Vamos ler desde ${dataBR(data)}. O histórico chega aos poucos (o governo libera 10 leituras por dia).`)} />
                )}
              </section>
            )}
            {painel === "certificado" && (
              <EnviarCertificado aberto onFechar={() => setPainel(null)} onPronto={(nome) => {
                setPainel(null);
                setAviso(`Certificado de ${nome} guardado.`);
                carregar();
              }} />
            )}

            {/* 1. Precisa de atenção */}
            <section className="es-bloco">
              <div className="es-bloco-cabeca"><h2><Icone nome="atencao" />Precisa de atenção</h2>{alertas.length > 5 && <span className="muted">5 de {alertas.length}</span>}</div>
              {alertas.length === 0 ? (
                <p className="es-tudo-certo">✓ Nada pendente. Olhamos contratos de experiência, afastamentos, prazos de admissão e desligamento, fechamento da folha e certificados.</p>
              ) : (
                <ul className="es-alertas">
                  {alertas.slice(0, 5).map((a, i) => (
                    <li key={i} className={`es-alerta ${a.nivel}`}>
                      <span className="es-alerta-icone" aria-hidden="true">{a.nivel === "erro" ? "!" : a.nivel === "atencao" ? "!" : "i"}</span>
                      <div>
                        <strong>{a.texto}</strong>
                        <span className="muted">{a.detalhe}</span>
                      </div>
                      {(a.pessoa || a.acao) && <button className="ghost small" onClick={() => agirAlerta(a)}>{a.pessoa ? "Ver ficha" : a.acao === "leitura" ? "Ligar" : "Ver"}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 2. Números */}
            <div className="es-numeros">
              <Numero rotulo="Trabalhando" valor={String(numeros.ativos)} detalhe={`+${numeros.entraram} entraram · −${numeros.sairam} saíram neste mês`}
                ajuda="Pessoas com admissão informada e sem desligamento. Inclui quem está de férias ou afastado." onClick={() => verFiltro("Trabalhando")} />
              <Numero rotulo="Afastados agora" valor={String(numeros.ferias + numeros.afastados)} detalhe={`${numeros.ferias} de férias · ${numeros.afastados} por outros motivos`}
                ajuda="Férias, licenças e afastamentos por saúde que ainda não terminaram." onClick={() => verFiltro("Afastados")} />
              <Numero rotulo="Rotatividade em 12 meses" valor={numeros.rotatividade == null ? "—" : `${numeros.rotatividade}%`}
                detalhe={numeros.rotatividade != null ? "Restaurantes: 73% a 78% ao ano" : numeros.mesesLidos < 12 ? `Precisa de 12 meses de histórico; temos ${numeros.mesesLidos}` : "Aparece quando lermos as saídas no governo"}
                ajuda="Quanto da equipe foi trocada no ano: média de entradas e saídas dividida pelo número de pessoas. Em bares e restaurantes fica perto de 75% ao ano (Abrasel/Caged)." />
              <Numero rotulo="Saíram antes de 90 dias" valor={String(numeros.cedo)} detalhe={`de ${numeros.saidasAno} saídas no ano · ${numeros.pediram} pediram para sair`}
                ajuda="Gente que saiu nos primeiros 3 meses. Número alto costuma indicar problema na contratação ou no treinamento." onClick={() => verFiltro("Saíram")} />
            </div>

            {/* 3. Folha do mês */}
            <section className="es-bloco">
              <div className="es-bloco-cabeca">
                <h2><Icone nome="folha" />Folha do mês</h2>
                <Ajuda texto="Todo mês o contador envia a folha ao governo e a 'fecha' até o dia 15. Depois disso saem as guias de INSS (DCTFWeb) e FGTS (FGTS Digital), que vencem no dia 20." />
              </div>
              <ul className="es-folhas">
                {folhas.map((f) => (
                  <li key={`${f.empresa_id}-${f.competencia}`}>
                    <span><strong>{nomeMes(f.competencia)}</strong> · {nomeEmpresa(f.empresa_id)}</span>
                    {f.fechada != null ? (
                      <span className="es-ok">✓ Fechada pelo contador{f.fechada ? ` em ${dataBR(f.fechada)}` : ""}</span>
                    ) : f.consultada ? (
                      <span className={f.competencia === mesAnterior() && diaDoMes() <= 15 ? "muted" : "es-ruim"}>
                        {f.competencia === mesAnterior() && diaDoMes() <= 15 ? "Ainda não fechada (prazo dia 15)" : "✕ Não vimos o fechamento"}
                      </span>
                    ) : (
                      <span className="muted">Ainda não lemos esta folha</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="muted es-nota">Lembretes: folha no eSocial até o dia 15 · guias de INSS e FGTS até o dia 20.</p>
            </section>

            {/* 3b. Calendário do mês */}
            <section className="es-bloco">
              <div className="es-bloco-cabeca">
                <h2><Icone nome="calendario" />Calendário de {nomeMes(hoje().slice(0, 7))}</h2>
                <Ajuda texto="As datas fixas do mês para o empregador: pagamento, prazo do contador no eSocial, declaração do INSS e guias. O que já aconteceu fica marcado com ✓." />
              </div>
              <ol className="es-calendario">
                {calendario.map((c, i) => (
                  <li key={i} className={`es-cal-item ${c.estado}`}>
                    <span className="es-cal-dia"><b>{c.dia}</b><small>{nomeMes(c.data.slice(0, 7)).slice(0, 3)}</small></span>
                    <div>
                      <strong>{c.titulo}</strong>
                      <span className="muted">{c.detalhe}</span>
                    </div>
                    <span className={`es-cal-quem ${c.quem}`}>{c.quem === "contador" ? "Contador" : c.quem === "governo" ? "Governo" : "Empresa"}</span>
                    <span className="es-cal-estado" aria-label={c.estado}>{c.estado === "feito" ? "✓" : c.estado === "atrasado" ? "!" : c.estado === "pendente" ? "•" : ""}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* 4. Equipe */}
            <section className="es-bloco" id="es-equipe">
              <div className="es-bloco-cabeca">
                <h2><Icone nome="equipe" />Equipe</h2>
                <button className="ghost small es-olho" onClick={alternarCpf} aria-pressed={verCpf} title={verCpf ? "Esconder CPFs" : "Mostrar CPFs"}>
                  <Olho aberto={verCpf} /> {verCpf ? "Esconder CPF" : "Mostrar CPF"}
                </button>
              </div>
              <div className="es-filtros">
                <div className="tv-unidades">
                  {FILTROS.map((f) => {
                    const n = pessoasVistas.filter((p) => NO_FILTRO[f](p.situacao)).length;
                    return (
                      <button key={f} className={f === filtro ? "botao-painel on" : "botao-painel"} onClick={() => setFiltro(f)}>
                        {f} <span className="muted">{n}</span>
                      </button>
                    );
                  })}
                </div>
                <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome, cargo ou CPF" aria-label="Buscar na equipe" />
              </div>
              {pessoasVistas.length === 0 ? (
                <div className="es-vazio">
                  <p><strong>Nenhum funcionário ainda.</strong></p>
                  <p className="muted">O governo entrega os dados de cada pessoa pelo CPF. Adicione os CPFs da equipe e a leitura automática traz admissões, férias e saídas.</p>
                  <button className="small" onClick={() => setPainel("cpfs")}>Adicionar CPFs</button>
                </div>
              ) : equipe.length === 0 ? (
                <p className="muted tv-nada">Ninguém neste filtro.</p>
              ) : (
                <ul className="es-equipe">
                  {visiveis.map((p) => (
                    <li key={p.chave}>
                      <button className="es-pessoa" onClick={() => setAberta(p.chave)}>
                        <span className="es-avatar" aria-hidden="true">{iniciais(p.nome)}</span>
                        <span className="es-pessoa-nome">
                          <strong>{p.nome ? nomeProprio(p.nome) : "Nome ainda não lido"}</strong>
                          <span className="muted">
                            {p.unidade && <span className="es-unidade">{p.unidade}</span>}
                            {[titulo(p.cargo), !p.unidade && filtroEmpresa === "todas" ? nomeEmpresa(p.empresa_id) : "", cpfVisivel(p.cpf, verCpf)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="es-pessoa-desde muted">{p.dtAdm ? `desde ${dataBR(p.dtAdm)}` : ""}</span>
                        <span className={`es-selo ${p.situacao}`}>{ROTULO_SITUACAO[p.situacao]}</span>
                        {p.alertas.length > 0 && <span className="es-pessoa-alerta" title={p.alertas[0].texto}>!</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {visiveis.length < equipe.length && (
                <p className="es-mais"><button className="ghost small" onClick={() => setMostrarTodos(true)}>Mostrar as outras {equipe.length - visiveis.length} pessoas</button></p>
              )}
            </section>

            {/* 5. Configurações e área técnica */}
            <details className="es-bloco es-tecnico" id="es-tecnico" open={tecnicoAberto} onToggle={(e) => setTecnicoAberto((e.target as HTMLDetailsElement).open)}>
              <summary>
                <span><Icone nome="tecnico" /><strong>Configurações e área técnica</strong> <span className="muted">· certificado, leitura automática, eventos do jeito que o governo guarda</span></span>
              </summary>
              {tecnicoAberto && (
                <AreaTecnica empresas={empresas} empresaInicial={filtroEmpresa === "todas" ? empresas[0]?.id ?? null : filtroEmpresa}
                  eventos={eventos} trabalhadores={trabalhadores} execucoes={execucoes} verCpf={verCpf} alternarCpf={alternarCpf}
                  ocupado={ocupado} emAndamento={emAndamento} bloqueado={bloqueado} rodar={rodar} supabase={supabase}
                  onCertificado={() => setPainel("certificado")} />
              )}
              {tecnicoAberto && <RegistroConsultas consultas={consultas} meuId={userId} />}
            </details>

            <Glossario />
          </>
        )}
      </main>

      {pessoaAberta && (
        <Ficha pessoa={pessoaAberta} empresa={nomeEmpresa(pessoaAberta.empresa_id)} verCpf={verCpf} alternarCpf={alternarCpf}
          historicoDesde={empresas.find((e) => e.id === pessoaAberta.empresa_id)?.historico_desde ?? ""} onFechar={() => setAberta(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------
const iniciais = (nome: string) => (nome ? nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "?");

// Ícones leves dos blocos (traço fino, no estilo dos painéis de RH)
const ICONES: Record<string, string> = {
  passos: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  atencao: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  folha: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  calendario: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  equipe: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  tecnico: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  livro: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z",
};
function Icone({ nome }: { nome: keyof typeof ICONES }) {
  return (
    <span className="es-icone" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONES[nome]} /></svg>
    </span>
  );
}

function Olho({ aberto }: { aberto: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!aberto && <path d="M4 4l16 16" />}
    </svg>
  );
}

function Ajuda({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <span className="es-ajuda">
      <button type="button" className="es-ajuda-botao" aria-label="O que é isso?" aria-expanded={aberta} onClick={() => setAberta((a) => !a)}>?</button>
      {aberta && <span className="es-ajuda-texto" role="note">{texto}</span>}
    </span>
  );
}

function Numero({ rotulo, valor, detalhe, ajuda, onClick }: { rotulo: string; valor: string; detalhe: string; ajuda: string; onClick?: () => void }) {
  return (
    <div className={onClick ? "es-numero clicavel" : "es-numero"}>
      <span className="tv-cartao-rotulo">{rotulo} <Ajuda texto={ajuda} /></span>
      <button className="es-numero-valor" onClick={onClick} disabled={!onClick} aria-label={`${rotulo}: ${valor}`}>{valor}</button>
      <span className="tv-cartao-detalhe">{detalhe}</span>
    </div>
  );
}

function Ficha({ pessoa: p, empresa, verCpf, alternarCpf, historicoDesde, onFechar }: {
  pessoa: Pessoa; empresa: string; verCpf: boolean; alternarCpf: () => void; historicoDesde: string; onFechar: () => void;
}) {
  const [verSalario, setVerSalario] = useState(false);
  const itens = linhaDoTempo(p);
  const agora = hoje();
  const futuros = itens.filter((i) => i.futuro);
  const passados = itens.filter((i) => !i.futuro);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar]);

  return (
    <>
      <div className="es-gaveta-fundo" onClick={onFechar} aria-hidden="true" />
      <aside className="es-gaveta" role="dialog" aria-label={`Ficha de ${p.nome || "funcionário"}`}>
        <div className="es-gaveta-cabeca">
          <span className="es-avatar grande" aria-hidden="true">{iniciais(p.nome)}</span>
          <div>
            <h2>{p.nome ? nomeProprio(p.nome) : "Nome ainda não lido"}</h2>
            <p className="muted">{[titulo(p.cargo), p.unidade, empresa].filter(Boolean).join(" · ")}</p>
          </div>
          <button className="fechar" onClick={onFechar} aria-label="Fechar ficha">×</button>
        </div>

        <dl className="es-dados">
          <div><dt>Situação</dt><dd><span className={`es-selo ${p.situacao}`}>{ROTULO_SITUACAO[p.situacao]}</span></dd></div>
          {p.dtAdm && <div><dt>Admissão</dt><dd>{dataBR(p.dtAdm)} · {tempoDeCasa(p.dtAdm, p.dtDeslig ?? agora)}{p.dtDeslig ? " de casa" : ""}</dd></div>}
          {p.dtDeslig && <div><dt>Saída</dt><dd>{dataBR(p.dtDeslig)}{p.motivoSaida ? ` · ${p.motivoSaida}` : ""}</dd></div>}
          {p.vinculo && <div><dt>Vínculo</dt><dd>{p.vinculo}</dd></div>}
          <div><dt>CPF</dt><dd>{cpfVisivel(p.cpf, verCpf)} <button className="es-olho-mini" onClick={alternarCpf} aria-label={verCpf ? "Esconder CPF" : "Mostrar CPF"}><Olho aberto={verCpf} /></button></dd></div>
          {p.matricula && <div><dt>Matrícula</dt><dd>{p.matricula}</dd></div>}
          {p.salario && <div><dt>Salário</dt><dd>{verSalario ? reais(p.salario) : "R$ •••••"} <button className="es-olho-mini" onClick={() => setVerSalario((v) => !v)} aria-label={verSalario ? "Esconder salário" : "Mostrar salário"}><Olho aberto={verSalario} /></button></dd></div>}
          {p.afastamento && <div><dt>Afastado desde</dt><dd>{dataBR(p.afastamento.desde)} ({diasEntre(p.afastamento.desde, agora)} dias)</dd></div>}
        </dl>

        {p.alertas.length > 0 && (
          <ul className="es-alertas compacto">
            {p.alertas.map((a, i) => (
              <li key={i} className={`es-alerta ${a.nivel}`}><span className="es-alerta-icone" aria-hidden="true">!</span><div><strong>{a.texto}</strong><span className="muted">{a.detalhe}</span></div></li>
            ))}
          </ul>
        )}

        <h3>Linha do tempo</h3>
        {itens.length === 0 ? (
          <p className="muted">Ainda não lemos eventos desta pessoa{historicoDesde ? ` desde ${dataBR(historicoDesde)}` : ""}. A leitura automática busca pelo CPF; pode levar alguns dias.</p>
        ) : (
          <ol className="es-linha-tempo">
            {futuros.map((i, k) => (
              <li key={`f${k}`} className="futuro"><span className="es-ponto" /><div><span className="es-data">{dataBR(i.data)}</span> {i.frase}<small>{i.tecnico}</small></div></li>
            ))}
            <li className="es-hoje"><span>hoje</span></li>
            {passados.map((i, k) => (
              <li key={`p${k}`} className={i.tipo}><span className="es-ponto" /><div><span className="es-data">{dataBR(i.data)}</span> {i.frase}<small>{i.tecnico}</small></div></li>
            ))}
          </ol>
        )}
      </aside>
    </>
  );
}

function PainelCpfs({ empresas, ocupado, onEnviar, onFechar }: {
  empresas: Empresa[]; ocupado: boolean; onEnviar: (empresa: string, cpfs: string[]) => void; onFechar: () => void;
}) {
  const [empresa, setEmpresa] = useState(empresas[0]?.id ?? "");
  const [texto, setTexto] = useState("");
  const cpfs = texto.split(/[\s,;]+/).map((c) => c.replace(/\D/g, "")).filter(Boolean);
  return (
    <form className="es-painel" onSubmit={(ev) => {
      ev.preventDefault();
      if (!cpfs.length || !empresa) return;
      onEnviar(empresa, cpfs);
      setTexto("");
    }}>
      <p><strong>Adicionar CPFs</strong> <span className="muted">· um por linha ou separados por vírgula; pode colar de uma planilha</span></p>
      <div className="es-form">
        <select value={empresa} onChange={(v) => setEmpresa(v.target.value)} aria-label="Empresa">
          {empresas.map((e) => <option key={e.id} value={e.id}>{nomeCurto(e.nome)}</option>)}
        </select>
        <textarea rows={3} value={texto} onChange={(v) => setTexto(v.target.value)} placeholder={"123.456.789-09\n987.654.321-00"} aria-label="CPFs" />
      </div>
      <div className="es-form">
        <button className="small" disabled={ocupado || !cpfs.length}>Adicionar {cpfs.length || ""}</button>
        <button type="button" className="ghost small" onClick={onFechar}>Fechar</button>
      </div>
    </form>
  );
}

function PainelHistorico({ empresas, ocupado, onSalvar, onFechar }: {
  empresas: Empresa[]; ocupado: boolean; onSalvar: (data: string) => void; onFechar: () => void;
}) {
  const [data, setData] = useState(() => `${Number(hoje().slice(0, 4)) - 1}-01-01`);
  return (
    <form className="es-painel" onSubmit={(ev) => {
      ev.preventDefault();
      onSalvar(data);
    }}>
      <p><strong>Desde quando ler o histórico?</strong> <span className="muted">· hoje: {empresas.map((e) => `${nomeCurto(e.nome)} desde ${dataBR(e.historico_desde)}`).join(", ")}</span></p>
      <p className="muted">Quanto mais para trás, mais completa fica a ficha (tempo de casa, férias) e mais dias leva para chegar tudo.</p>
      <div className="es-form">
        <input type="date" value={data} min="2018-01-01" max={hoje()} onChange={(v) => setData(v.target.value)} aria-label="Ler desde" />
        <button className="small" disabled={ocupado || !data}>Salvar para as {empresas.length} empresas</button>
        <button type="button" className="ghost small" onClick={onFechar}>Fechar</button>
      </div>
    </form>
  );
}

// Registro de cada leitura de dados de funcionários feita pelo Claude (LGPD, art. 37)
function RegistroConsultas({ consultas, meuId }: { consultas: Consulta[]; meuId: string }) {
  const FERRAMENTA: Record<string, string> = { esocial_situacao: "situação geral", esocial_equipe: "equipe", esocial_eventos: "eventos" };
  return (
    <section className="es-registro">
      <h3>Quem consultou os dados pelo Claude</h3>
      <p className="muted">Toda leitura de dados de funcionários feita pelo conector fica registrada aqui, com quem pediu e quantos registros saíram.</p>
      {consultas.length === 0 ? (
        <p className="muted tv-nada">Nenhuma consulta registrada ainda.</p>
      ) : (
        <ul className="es-registro-lista">
          {consultas.map((c) => (
            <li key={c.id}>
              <span className="muted">{hora(c.created_at)}</span>
              <span>{c.user_id === meuId ? "Você" : "Sócio"} · leu <strong>{FERRAMENTA[c.ferramenta] ?? c.ferramenta}</strong>
                {c.quantidade ? ` (${c.quantidade} registros)` : ""}{c.parametros && Object.keys(c.parametros).length ? ` · ${Object.entries(c.parametros).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Glossario() {
  const termos: [string, string][] = [
    ["eSocial", "Sistema do governo onde a empresa (pelo contador) informa tudo sobre os funcionários: admissão, salário, férias, afastamentos e saída."],
    ["Evento", "Cada informação enviada ao eSocial. Tem um código: S-2200 é admissão, S-2299 é desligamento, S-1200 é a folha de uma pessoa."],
    ["Competência", "O mês a que a folha se refere. A folha de setembro é a competência 09/2026, mesmo que seja paga em outubro."],
    ["Fechamento da folha (S-1299)", "O aviso do contador de que a folha do mês está completa. Sem ele não saem as guias de INSS e FGTS."],
    ["Contrato de experiência", "Os primeiros dias do contrato (até 90, podendo ser dividido em 45 + 45) em que a empresa pode encerrar sem aviso prévio."],
    ["Afastamento", "Período em que a pessoa não trabalha mas continua empregada: férias, doença, licença-maternidade. Por doença, depois de 15 dias quem paga é o INSS."],
    ["ASO", "Atestado de Saúde Ocupacional: o exame médico do trabalho, feito na admissão, periodicamente e na saída."],
    ["Rotatividade", "Quanto da equipe é trocado num período. Em restaurantes fica perto de 75% ao ano."],
    ["Recibo", "Número que o governo devolve quando aceita um evento. É a prova de que a informação foi entregue."],
    ["Certificado A1", "Arquivo de identidade digital da empresa (e-CNPJ). É com ele que o Brasico lê os dados do governo."],
  ];
  return (
    <details className="es-bloco es-glossario">
      <summary><Icone nome="livro" /><strong>Glossário</strong> <span className="muted">· o que quer dizer cada termo</span></summary>
      <dl>
        {termos.map(([t, d]) => (
          <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
        ))}
      </dl>
    </details>
  );
}

// ---------------------------------------------------------------------
// Área técnica (o que a página tinha antes)
// ---------------------------------------------------------------------
type Rodar = (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<void>;

function AreaTecnica({ empresas, empresaInicial, eventos, trabalhadores, execucoes, verCpf, alternarCpf, ocupado, emAndamento, bloqueado, rodar, supabase, onCertificado }: {
  empresas: Empresa[]; empresaInicial: string | null; eventos: Evento[]; trabalhadores: Trabalhador[]; execucoes: Execucao[];
  verCpf: boolean; alternarCpf: () => void; ocupado: boolean; emAndamento: boolean; bloqueado: boolean; rodar: Rodar;
  supabase: ReturnType<typeof createClient>; onCertificado: () => void;
}) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [aba, setAba] = useState<Aba>("Eventos");
  const [filtroTipo, setFiltroTipo] = useState("");
  const e = empresas.find((x) => x.id === empresa);
  const evs = eventos.filter((x) => x.empresa_id === empresa);
  const trs = trabalhadores.filter((x) => x.empresa_id === empresa);
  const exs = execucoes.filter((x) => x.empresa_id === empresa).slice(0, 40);
  const pendentes = evs.filter((x) => x.situacao === "pendente").length;
  const tipos = [...new Set(evs.map((x) => x.tipo).filter(Boolean))].sort() as string[];
  const lista = filtroTipo ? evs.filter((x) => x.tipo === filtroTipo) : evs;
  const cpf = (c: string | null) => (c ? cpfVisivel(c, verCpf) : "");

  return (
    <div className="es-tecnico-miolo">
      <p className="muted">Estes são os registros do jeito que o governo guarda. No dia a dia você não precisa mexer aqui.</p>
      {empresas.length > 1 && (
        <div className="tv-unidades">
          {empresas.map((x) => (
            <button key={x.id} className={x.id === empresa ? "botao-painel on" : "botao-painel"} onClick={() => setEmpresa(x.id)}>{nomeCurto(x.nome)}</button>
          ))}
        </div>
      )}
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
            <button className="ghost small" disabled={ocupado} onClick={() => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: 2, p_tipo: "teste_conexao", p_parametros: {} }), "Teste no ambiente de testes pedido. O resultado aparece em Pedidos.")}>
              Testar conexão (ambiente de testes)
            </button>
            <button className="ghost small" disabled={ocupado} onClick={() => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: 1, p_tipo: "teste_conexao", p_parametros: {} }), "Teste na produção pedido. Ele não conta no limite de downloads.")}>
              Testar conexão (produção)
            </button>
            <label className="es-chave">
              <input type="checkbox" checked={e.leitura_automatica} disabled={ocupado}
                onChange={(v) => rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: v.target.checked, p_limite: null, p_historico_desde: null }), v.target.checked ? "Leitura automática ligada: um passo a cada 15 minutos, das 8h às 20h, do dia 8 em diante." : "Leitura automática desligada.")} />
              Leitura automática
            </label>
            <label className="es-campo">
              Limite por dia
              <select value={e.limite_diario} disabled={ocupado}
                onChange={(v) => rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: null, p_limite: Number(v.target.value), p_historico_desde: null }), "Limite atualizado.")}>
                {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            <label className="es-campo">
              Ler desde
              <input type="date" value={e.historico_desde} disabled={ocupado}
                onChange={(v) => v.target.value && rodar(() => supabase.rpc("esocial_configurar", { p_empresa: e.id, p_leitura: null, p_limite: null, p_historico_desde: v.target.value }), "Início do histórico atualizado.")} />
            </label>
            <button className="ghost small" onClick={onCertificado}>Enviar ou trocar certificado</button>
          </div>
          <p className="muted es-nota">O governo permite 10 acessos por dia por empresa ao download, somando os do contador. A leitura automática usa só o limite acima.</p>
        </section>
      )}

      {e && (
        <>
          <div className="es-bloco-cabeca">
            <div className="tv-abas" role="tablist">
              {ABAS.map((a) => (
                <button key={a} role="tab" aria-selected={a === aba} className={a === aba ? "botao-painel on" : "botao-painel"} onClick={() => setAba(a)}>
                  {a}
                  {a === "Eventos" && evs.length ? <span className="muted"> {evs.length}</span> : null}
                  {a === "Trabalhadores" && trs.length ? <span className="muted"> {trs.length}</span> : null}
                </button>
              ))}
            </div>
            <button className="ghost small es-olho" onClick={alternarCpf} aria-pressed={verCpf}><Olho aberto={verCpf} /> {verCpf ? "Esconder CPF" : "Mostrar CPF"}</button>
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
                    [cpf(x.cpf_trab), x.resumo?.nome].filter(Boolean).join(" · "),
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
                  const inv = (r.data as { invalidos?: string[] } | null)?.invalidos ?? [];
                  if (!r.error && inv.length) return { error: { message: `Adicionados. Estes CPFs estão errados e ficaram de fora: ${inv.join(", ")}` } };
                  return r;
                }, "CPFs adicionados. Eles entram na leitura automática.")} />
                <Tabela
                  vazio="Nenhum CPF ainda. O eSocial só entrega os eventos de cada trabalhador pelo CPF; os que aparecerem nos eventos entram sozinhos."
                  cab={["CPF", "Nome", "Cargo", "Unidade", "Admissão", "Origem", "Lido até"]}
                  linhas={trs.map((t) => [cpf(t.cpf), t.nome, titulo(t.cargo), t.unidade, dataBR(t.admissao), t.origem === "manual" ? "Cadastro" : "Dos eventos", t.consultado_ate ? dia(t.consultado_ate) : "—"])}
                />
              </>
            )}

            {aba === "Pedidos" && (
              <>
                <ConsultaAvulsa ocupado={ocupado || emAndamento} bloqueado={bloqueado} cnpj={e.cnpj}
                  onPedir={(tipo, ambiente, parametros) => rodar(() => supabase.rpc("esocial_consultar", { p_empresa: e.id, p_ambiente: ambiente, p_tipo: tipo, p_parametros: parametros }), "Consulta pedida.")} />
                <Tabela
                  vazio="Nenhum pedido ainda."
                  cab={["Quando", "Pedido", "Ambiente", "Situação", "Resposta do eSocial"]}
                  linhas={exs.map((x) => [
                    hora(x.created_at),
                    `${TIPO_PEDIDO[x.tipo] ?? x.tipo}${parametrosCurtos(x.parametros, verCpf)}${x.origem === "agenda" ? " (automático)" : ""}`,
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
    </div>
  );
}

function detalhes(r: Record<string, string> | null) {
  if (!r) return "";
  const p: string[] = [];
  if (r.dtAdm) p.push(`admissão ${dataBR(r.dtAdm)}`);
  if (r.dtDeslig) p.push(`desligamento ${dataBR(r.dtDeslig)}`);
  if (r.dtIniAfast) p.push(`afastamento desde ${dataBR(r.dtIniAfast)}`);
  if (r.dtAso) p.push(`ASO ${dataBR(r.dtAso)}`);
  if (r.nmCargo) p.push(r.nmCargo);
  if (r.indRetif === "2") p.push("retificação");
  if (r.recebido_em) p.push(`recebido ${dataBR(r.recebido_em.slice(0, 10))}`);
  return p.join(" · ");
}

function parametrosCurtos(p: Record<string, unknown>, verCpf: boolean) {
  if (!p) return "";
  if (p.tpEvt) return ` ${p.tpEvt}${p.perApur ? ` ${p.perApur}` : ""}`;
  if (p.cpf) return ` ${cpfVisivel(String(p.cpf), verCpf)}`;
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

function ConsultaAvulsa({ ocupado, bloqueado, cnpj, onPedir }: {
  ocupado: boolean; bloqueado: boolean; cnpj: string | null; onPedir: (tipo: string, ambiente: number, parametros: Record<string, string>) => void;
}) {
  const [tipo, setTipo] = useState("identificadores_empregador");
  const [ambiente, setAmbiente] = useState(1);
  const [tpEvt, setTpEvt] = useState("S-1299");
  const [perApur, setPerApur] = useState(() => mesAnterior());
  const [cpf, setCpf] = useState("");
  const [de, setDe] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [ate, setAte] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));

  function pedir(ev: React.FormEvent) {
    ev.preventDefault();
    if (tipo === "identificadores_empregador") onPedir(tipo, ambiente, { tpEvt, perApur });
    // Estabelecimentos (S-1005) só se consultam com a chave do CNPJ (sem ela o eSocial responde 402)
    else if (tipo === "identificadores_tabela") onPedir(tipo, ambiente, tpEvt === "S-1005" && cnpj ? { tpEvt, chEvt: `tpInsc=1;nrInsc=${cnpj}` } : { tpEvt });
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

function EnviarCertificado({ aberto, onFechar, onPronto }: { aberto: boolean; onFechar: () => void; onPronto: (nome: string) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

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
    onPronto(r.nome ?? "a empresa");
  }

  if (!aberto) return null;
  return (
    <section className="es-bloco es-certificado">
      <strong>Certificado digital da empresa (e-CNPJ A1)</strong>
      <p className="muted">
        Envie o arquivo .pfx (ou .p12) e a senha. A empresa é reconhecida pelo CNPJ do certificado. O certificado fica guardado
        no cofre do Supabase e só é usado para ler o eSocial; a senha não é guardada. Um certificado por empresa (raiz do CNPJ).
      </p>
      <form className="es-form" onSubmit={enviar}>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} aria-label="Arquivo do certificado" />
        <input type="password" value={senha} onChange={(v) => setSenha(v.target.value)} placeholder="Senha do certificado" autoComplete="off" aria-label="Senha do certificado" />
        <button className="small" disabled={!arquivo || enviando}>{enviando ? "Conferindo…" : "Guardar certificado"}</button>
        <button type="button" className="ghost small" onClick={onFechar}>Fechar</button>
      </form>
      {erro && <p className="tv-alerta">{erro}</p>}
    </section>
  );
}
