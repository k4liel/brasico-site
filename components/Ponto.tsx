"use client";

// Seção Ponto do RH: o que o RHiD (relógios de ponto da Control iD) registrou, cruzado com o RH do eSocial.
// Dados copiados pelo Brasico (supabase/rhid.sql): pessoas, apuração do dia (batidas, horas, faltas,
// atrasos, banco de horas) e relógios. Só leitura.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cpfVisivel, dataBR, hoje, somarDias } from "@/lib/esocial/rh";
import PontoEscala, { type PessoaEscala } from "./PontoEscala";

type PessoaPonto = { cliente_id: number; id: number; nome: string; cpf: string; empresa_id: number | null; departamento_id: number | null };
type Batida = { hora: string; tipo: string };
type DiaPonto = {
  cliente_id: number; pessoa_id: number; dia: string; horario: string; folga: boolean; feriado: boolean; falta: boolean; justificado: boolean;
  minutos_trabalhados: number; minutos_atraso: number; minutos_falta: number; saldo_banco: number | null; alerta: string; batidas: Batida[];
};
type EmpresaPonto = { cliente_id: number; id: number; cnpj: string };
type Departamento = { cliente_id: number; id: number; nome: string };
type Relogio = { cliente_id: number; id: number; nome: string; situacao: string; ultima_conexao: string | null; rep_p: boolean };
type Execucao = { id: string; status: string; created_at: string; fim: string | null; erro: string };
type Cruzamento = { empresa_id: string; cpf: string; nome: string; ponto_situacao: string; ponto_ultima_batida: string | null; ativo: boolean };

const ESTADOS = ["Trabalhando", "Saiu", "Ainda sem batida", "Folga", "Sem escala"] as const;
type Estado = (typeof ESTADOS)[number];
const CLASSE_ESTADO: Record<Estado, string> = {
  Trabalhando: "trabalhando", Saiu: "ferias", "Ainda sem batida": "afastado", Folga: "", "Sem escala": "",
};
const CRUZAMENTO: Record<string, { rotulo: string; texto: string }> = {
  batendo: { rotulo: "Batendo ponto", texto: "Bateu nos últimos 3 dias. O eSocial relê a cada 7 dias em vez de 2." },
  parou: { rotulo: "Parou de bater", texto: "Ativo no relógio, mas sem batida há mais de 7 dias. Lido primeiro no eSocial: pode ser afastamento ou saída." },
  inativo: { rotulo: "Inativo no relógio", texto: "Desativado no RHiD. Lido primeiro no eSocial para confirmar a saída." },
  sem_ponto: { rotulo: "Sem ponto", texto: "CPF não encontrado no RHiD (sem CPF no cadastro do relógio, ou não bate ponto)." },
};

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const iniciais = (nome: string) => (nome ? nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "?");
// 436 → "7h16"; −1047 → "−17h27"
const horas = (min: number) => {
  const m = Math.abs(Math.round(min));
  return `${min < 0 ? "−" : ""}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
const horaCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const chave = (cliente: number, id: number) => `${cliente}:${id}`;

// O banco devolve no máximo 1000 linhas por pedido: busca em páginas
async function tudo<T>(pedir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pedir(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

export default function Ponto({ supabase, filtroEmpresa, verCpf, alternarCpf, chavesRH, onAbrirPessoa, icone, olho }: {
  supabase: SupabaseClient; filtroEmpresa: string; verCpf: boolean; alternarCpf: () => void;
  chavesRH: Set<string>; onAbrirPessoa: (chave: string) => void; icone: (nome: string) => ReactNode; olho: ReactNode;
}) {
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [pessoas, setPessoas] = useState<PessoaPonto[]>([]);
  const [dias, setDias] = useState<DiaPonto[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPonto[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [relogios, setRelogios] = useState<Relogio[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [cruzamento, setCruzamento] = useState<Cruzamento[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("");
  const [estado, setEstado] = useState<Estado | "">("");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      const desde = somarDias(hoje(), -30);
      const [pe, em, de, re, ex, cr, di] = await Promise.all([
        tudo<PessoaPonto>((a, b) => supabase.from("rhid_pessoas").select("cliente_id,id,nome,cpf,empresa_id,departamento_id")
          .eq("situacao", 1).eq("presente", true).order("nome").range(a, b)),
        supabase.from("rhid_empresas").select("cliente_id,id,cnpj"),
        supabase.from("rhid_departamentos").select("cliente_id,id,nome"),
        supabase.from("rhid_relogios").select("cliente_id,id,nome,situacao,ultima_conexao,rep_p").order("nome"),
        supabase.from("rhid_execucoes").select("id,status,created_at,fim,erro").eq("tipo", "batidas").order("created_at", { ascending: false }).limit(5),
        tudo<Cruzamento>((a, b) => supabase.from("esocial_trabalhadores").select("empresa_id,cpf,nome,ponto_situacao,ponto_ultima_batida,ativo")
          .eq("ativo", true).order("nome").range(a, b)),
        tudo<DiaPonto>((a, b) => supabase.from("rhid_dias")
          .select("cliente_id,pessoa_id,dia,horario,folga,feriado,falta,justificado,minutos_trabalhados,minutos_atraso,minutos_falta,saldo_banco,alerta,batidas")
          .gte("dia", desde).order("dia").range(a, b)),
      ]);
      setPessoas(pe);
      setEmpresas((em.data ?? []) as EmpresaPonto[]);
      setDepartamentos((de.data ?? []) as Departamento[]);
      setRelogios(((re.data ?? []) as Relogio[]).filter((r) => !r.rep_p));
      setExecucoes((ex.data ?? []) as Execucao[]);
      setCruzamento(cr);
      setDias(di);
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler o ponto.");
    }
    setCarregado(true);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const { data: a } = await supabase.from("rhid_acesso").select("user_id").eq("user_id", data.user?.id ?? "");
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      carregar();
    })();
  }, [supabase, carregar]);

  // Atualiza sozinho quando uma leitura do ponto termina
  useEffect(() => {
    if (!acesso) return;
    const ch = supabase.channel("rhid-ponto")
      .on("postgres_changes", { event: "*", schema: "public", table: "rhid_execucoes" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, acesso, carregar]);

  const lendo = execucoes.some((x) => ["na_fila", "rodando"].includes(x.status) && Date.now() - new Date(x.created_at).getTime() < 10 * 60 * 1000);
  useEffect(() => {
    if (!lendo) return;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [lendo, carregar]);

  async function atualizar() {
    const { error } = await supabase.rpc("rhid_atualizar_ponto");
    if (error) setErro(error.message);
    else carregar();
  }

  // Empresa do RH (raiz do CNPJ) de cada pessoa do relógio
  const raizDe = useMemo(() => new Map(empresas.map((e) => [chave(e.cliente_id, e.id), e.cnpj.slice(0, 8)])), [empresas]);
  const nomeDepto = useMemo(() => new Map(departamentos.map((d) => [chave(d.cliente_id, d.id), d.nome])), [departamentos]);
  const diasDe = useMemo(() => {
    const m = new Map<string, DiaPonto[]>();
    for (const d of dias) {
      const k = chave(d.cliente_id, d.pessoa_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(d);
    }
    return m;
  }, [dias]);

  const agora = hoje();
  const linhas = useMemo(() => pessoas.map((p) => {
    const raiz = p.empresa_id != null ? raizDe.get(chave(p.cliente_id, p.empresa_id)) ?? "" : "";
    const ds = diasDe.get(chave(p.cliente_id, p.id)) ?? [];
    const dHoje = ds.find((d) => d.dia === agora);
    const batidasHoje = dHoje?.batidas ?? [];
    const est: Estado = batidasHoje.length ? (batidasHoje.length % 2 ? "Trabalhando" : "Saiu")
      : !dHoje ? "Sem escala" : dHoje.horario && !dHoje.folga && !dHoje.feriado ? "Ainda sem batida" : "Folga";
    // Hoje fica de fora das faltas: o dia ainda não acabou
    const passados = ds.filter((d) => d.dia < agora);
    const saldo = [...ds].reverse().find((d) => d.saldo_banco != null)?.saldo_banco ?? null;
    return {
      p, raiz, unidade: p.departamento_id != null ? nomeDepto.get(chave(p.cliente_id, p.departamento_id)) ?? "" : "",
      estado: est, batidasHoje, horarioHoje: dHoje?.horario ?? "",
      diasTrabalhados: passados.filter((d) => d.minutos_trabalhados > 0).length,
      minutos: passados.reduce((t, d) => t + d.minutos_trabalhados, 0),
      faltas: passados.filter((d) => d.falta && !d.justificado).length,
      atraso: passados.reduce((t, d) => t + d.minutos_atraso, 0),
      saldo, chaveRH: `${raiz}:${p.cpf}`,
    };
  }), [pessoas, raizDe, diasDe, nomeDepto, agora]);

  if (acesso === false) return <section className="es-bloco"><p className="muted">Você não tem acesso ao ponto (RHiD).</p></section>;
  if (!carregado) return <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>;

  const daEmpresa = linhas.filter((l) => filtroEmpresa === "todas" || l.raiz === filtroEmpresa);
  const unidades = [...new Set(daEmpresa.map((l) => l.unidade).filter(Boolean))].sort();
  const termo = busca.trim().toLowerCase();
  const vistas = daEmpresa.filter((l) => !unidade || l.unidade === unidade)
    .filter((l) => !termo || l.p.nome.toLowerCase().includes(termo) || l.p.cpf.includes(termo.replace(/\D/g, "") || "#"));
  const hojeLista = vistas.filter((l) => !estado || l.estado === estado)
    .sort((a, b) => ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado) || a.p.nome.localeCompare(b.p.nome));

  const bateram = vistas.filter((l) => l.batidasHoje.length > 0).length;
  const semBatida = vistas.filter((l) => l.estado === "Ainda sem batida").length;
  const faltas = vistas.reduce((t, l) => t + l.faltas, 0);
  const atrasos = vistas.reduce((t, l) => t + l.atraso, 0);
  const relogiosVistos = relogios.filter((r) => filtroEmpresa === "todas"
    || empresas.some((e) => e.cliente_id === r.cliente_id && e.cnpj.startsWith(filtroEmpresa)));
  const relogiosOk = relogiosVistos.filter((r) => r.ultima_conexao && Date.now() - new Date(r.ultima_conexao).getTime() < 24 * 3600 * 1000);
  const ultima = execucoes.find((x) => x.status === "ok" && x.fim);
  const cruz = cruzamento.filter((c) => filtroEmpresa === "todas" || c.empresa_id === filtroEmpresa);
  const atencao = cruz.filter((c) => c.ponto_situacao === "parou" || c.ponto_situacao === "inativo");

  return (
    <>
      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>{icone("ponto")}Escala e ponto <span className="muted">{dataBR(agora)}</span></h2>
          <span className="pt-acoes">
            <span className="muted">{lendo ? "Lendo o RHiD…" : ultima ? `atualizado ${horaCurta(ultima.fim!)}` : "ainda não lido"}</span>
            <button className="ghost small" onClick={atualizar} disabled={lendo}>Atualizar</button>
          </span>
        </div>
        {erro && <p className="tv-alerta">{erro}</p>}
        <div className="es-numeros">
          <Cartao rotulo="Bateram hoje" valor={`${bateram}`} detalhe={`de ${vistas.length} pessoas ativas no relógio`} />
          <Cartao rotulo="Ainda sem batida" valor={`${semBatida}`} detalhe="com escala hoje e nenhuma batida" />
          <Cartao rotulo="Faltas em 30 dias" valor={`${faltas}`} detalhe="sem justificativa no RHiD" />
          <Cartao rotulo="Atrasos em 30 dias" valor={horas(atrasos)} detalhe="somando a equipe" />
          <Cartao rotulo="Relógios conectados" valor={`${relogiosOk.length} de ${relogiosVistos.length}`} detalhe="falaram com o RHiD nas últimas 24h" />
        </div>
        <div className="es-filtros">
          <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome ou CPF" aria-label="Buscar no ponto" />
          <div className="tv-unidades" role="group" aria-label="Situação hoje">
            <button className={estado === "" ? "botao-painel on" : "botao-painel"} onClick={() => setEstado("")}>Todos <span className="muted">{vistas.length}</span></button>
            {ESTADOS.map((e) => {
              const n = vistas.filter((l) => l.estado === e).length;
              return n ? <button key={e} className={estado === e ? "botao-painel on" : "botao-painel"} onClick={() => setEstado(e)}>{e} <span className="muted">{n}</span></button> : null;
            })}
          </div>
          {unidades.length > 1 && (
            <div className="tv-unidades" role="group" aria-label="Unidade">
              <button className={unidade === "" ? "botao-painel on" : "botao-painel"} onClick={() => setUnidade("")}>Todas as unidades</button>
              {unidades.map((u) => (
                <button key={u} className={unidade === u ? "botao-painel on" : "botao-painel"} onClick={() => setUnidade(u)}>
                  {u} <span className="muted">{daEmpresa.filter((l) => l.unidade === u).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {pessoas.length === 0 ? (
          <p className="muted tv-nada">O ponto ainda não foi lido. A leitura roda sozinha às 5h, 12h e 17h.</p>
        ) : (
          <PontoEscala onAbrir={(k) => chavesRH.has(k) && onAbrirPessoa(k)}
            pessoas={vistas.map<PessoaEscala>((l) => ({
              chave: l.chaveRH, nome: nomeProprio(l.p.nome), unidade: l.unidade,
              dias: new Map((diasDe.get(chave(l.p.cliente_id, l.p.id)) ?? []).map((d) => [d.dia, d])),
            }))} />
        )}
        {hojeLista.length > 0 && (
          <details className="pt-lista-hoje">
          <summary>Lista de hoje <span className="muted">{hojeLista.length}</span></summary>
          <ul className="es-equipe">
            {hojeLista.map((l) => {
              const temRH = chavesRH.has(l.chaveRH);
              return (
                <li key={chave(l.p.cliente_id, l.p.id)}>
                  <button className="es-pessoa" onClick={() => temRH && onAbrirPessoa(l.chaveRH)} disabled={!temRH}
                    title={temRH ? "Ver a ficha no RH" : "Sem ficha no RH (CPF fora do cadastro do eSocial)"}>
                    <span className="es-avatar" aria-hidden="true">{iniciais(l.p.nome)}</span>
                    <span className="es-pessoa-nome">
                      <strong>{nomeProprio(l.p.nome)}</strong>
                      <span className="muted">
                        {l.unidade && <span className="es-unidade">{l.unidade}</span>}
                        {[l.horarioHoje ? `escala ${l.horarioHoje.replace(/\s+/g, " · ")}` : "", l.p.cpf ? cpfVisivel(l.p.cpf, verCpf) : "sem CPF no relógio"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="pt-batidas">{l.batidasHoje.map((b) => b.hora).join(" · ")}</span>
                    <span className={`es-selo ${CLASSE_ESTADO[l.estado]}`}>{l.estado}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          </details>
        )}
      </section>

      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>{icone("calendario")}Últimos 30 dias</h2>
          <button className="ghost small es-olho" onClick={alternarCpf} aria-pressed={verCpf}>{olho} {verCpf ? "Esconder CPF" : "Mostrar CPF"}</button>
        </div>
        <div className="tv-rolagem">
          <table className="tv-tabela pt-tabela">
            <thead><tr><th>Pessoa</th><th>Unidade</th><th>Dias</th><th>Horas</th><th>Faltas</th><th>Atrasos</th><th>Banco de horas</th></tr></thead>
            <tbody>
              {[...vistas].sort((a, b) => b.faltas - a.faltas || b.atraso - a.atraso || a.p.nome.localeCompare(b.p.nome)).map((l) => (
                <tr key={chave(l.p.cliente_id, l.p.id)}>
                  <td>{nomeProprio(l.p.nome)}</td>
                  <td>{l.unidade}</td>
                  <td>{l.diasTrabalhados}</td>
                  <td>{horas(l.minutos)}</td>
                  <td className={l.faltas ? "es-ruim" : ""}>{l.faltas}</td>
                  <td>{l.atraso ? horas(l.atraso) : "—"}</td>
                  <td className={l.saldo != null && l.saldo < 0 ? "es-ruim" : ""}>{l.saldo == null ? "—" : horas(l.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted pt-nota">Contas do RHiD (apuração do ponto). O dia de hoje não entra nas faltas. Banco de horas: saldo no último dia lido.</p>
      </section>

      <div className="es-duas">
        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{icone("leitura")}Ponto × RH (eSocial)</h2></div>
          <ul className="es-lista pt-cruzamento">
            {Object.entries(CRUZAMENTO).map(([k, c]) => (
              <li key={k}><strong>{cruz.filter((x) => x.ponto_situacao === k).length}</strong><span><b>{c.rotulo}</b><span className="muted"> · {c.texto}</span></span></li>
            ))}
          </ul>
          {atencao.length > 0 && (
            <>
              <h3 className="pt-sub">Vale conferir</h3>
              <ul className="es-lista">
                {atencao.map((c) => (
                  <li key={`${c.empresa_id}:${c.cpf}`}>
                    <button className="es-linha-botao" onClick={() => onAbrirPessoa(`${c.empresa_id}:${c.cpf}`)}>
                      <span className="es-lista-texto"><strong>{c.nome ? nomeProprio(c.nome) : cpfVisivel(c.cpf, verCpf)}</strong>
                        <span className="muted">{CRUZAMENTO[c.ponto_situacao]?.rotulo}{c.ponto_ultima_batida ? ` · última batida ${dataBR(c.ponto_ultima_batida)}` : ""}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{icone("tecnico")}Relógios</h2><span className="muted">{relogiosOk.length} de {relogiosVistos.length} conectados</span></div>
          <ul className="es-lista">
            {relogiosVistos.map((r) => {
              const ok = relogiosOk.includes(r);
              return (
                <li key={chave(r.cliente_id, r.id)} className="pt-relogio">
                  <span className={ok ? "es-ok" : "es-ruim"} aria-hidden="true">●</span>
                  <span className="es-lista-texto"><strong>{r.nome}</strong>
                    <span className="muted">{r.ultima_conexao ? `última conexão ${horaCurta(r.ultima_conexao)}` : "nunca conectou"}</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <div className="es-numero">
      <span className="tv-cartao-rotulo">{rotulo}</span>
      <span className="es-numero-valor">{valor}</span>
      <span className="tv-cartao-detalhe">{detalhe}</span>
    </div>
  );
}
