"use client";

// Seção Banco de horas do RH: o saldo de cada pessoa segundo o RHiD (apuração do ponto, rhid_dias.saldo_banco),
// agrupado por unidade, com a variação dos últimos 30 dias. Só leitura.
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, hoje, somarDias } from "@/lib/esocial/rh";
import { FiltroUnidade } from "./Ponto";

type Pessoa = { cliente_id: number; id: number; nome: string; cpf: string; empresa_id: number | null; departamento_id: number | null };
type Dia = { cliente_id: number; pessoa_id: number; dia: string; saldo_banco: number | null };
type Empresa = { cliente_id: number; id: number; cnpj: string };
type Departamento = { cliente_id: number; id: number; nome: string };

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
// 436 → "7h16"; −1047 → "−17h27"
const horas = (min: number, sinal = false) => {
  const m = Math.abs(Math.round(min));
  return `${min < 0 ? "−" : sinal && min > 0 ? "+" : ""}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
const chave = (c: number, id: number) => `${c}:${id}`;

async function tudo<T>(pedir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pedir(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

const ORDENS = ["Mais negativo", "Mais positivo", "Nome"] as const;
type Ordem = (typeof ORDENS)[number];

export default function BancoHoras({ supabase, filtroEmpresa, chavesRH, onAbrirPessoa, icone }: {
  supabase: SupabaseClient; filtroEmpresa: string; chavesRH: Set<string>; onAbrirPessoa: (chave: string) => void; icone: (nome: string) => ReactNode;
}) {
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [dias, setDias] = useState<Dia[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("Mais negativo");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [pe, em, de, di] = await Promise.all([
        tudo<Pessoa>((a, b) => supabase.from("rhid_pessoas").select("cliente_id,id,nome,cpf,empresa_id,departamento_id")
          .eq("situacao", 1).eq("presente", true).order("nome").range(a, b)),
        supabase.from("rhid_empresas").select("cliente_id,id,cnpj"),
        supabase.from("rhid_departamentos").select("cliente_id,id,nome"),
        tudo<Dia>((a, b) => supabase.from("rhid_dias").select("cliente_id,pessoa_id,dia,saldo_banco")
          .gte("dia", somarDias(hoje(), -35)).lte("dia", hoje()).not("saldo_banco", "is", null).order("dia").range(a, b)),
      ]);
      setPessoas(pe);
      setEmpresas((em.data ?? []) as Empresa[]);
      setDepartamentos((de.data ?? []) as Departamento[]);
      setDias(di);
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler o banco de horas.");
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

  const raizDe = useMemo(() => new Map(empresas.map((e) => [chave(e.cliente_id, e.id), e.cnpj.slice(0, 8)])), [empresas]);
  const nomeDepto = useMemo(() => new Map(departamentos.map((d) => [chave(d.cliente_id, d.id), d.nome])), [departamentos]);
  const linhas = useMemo(() => {
    const porPessoa = new Map<string, Dia[]>();
    for (const d of dias) {
      const k = chave(d.cliente_id, d.pessoa_id);
      if (!porPessoa.has(k)) porPessoa.set(k, []);
      porPessoa.get(k)!.push(d);
    }
    const corte = somarDias(hoje(), -30);
    return pessoas.map((p) => {
      const ds = porPessoa.get(chave(p.cliente_id, p.id)) ?? [];
      const ultimo = ds[ds.length - 1];
      const antes = [...ds].reverse().find((d) => d.dia <= corte);
      const saldo = ultimo?.saldo_banco ?? null;
      return {
        p, saldo, dia: ultimo?.dia ?? "",
        variacao: saldo != null && antes?.saldo_banco != null ? saldo - antes.saldo_banco : null,
        raiz: p.empresa_id != null ? raizDe.get(chave(p.cliente_id, p.empresa_id)) ?? "" : "",
        unidade: p.departamento_id != null ? nomeDepto.get(chave(p.cliente_id, p.departamento_id)) ?? "" : "",
      };
    });
  }, [pessoas, dias, raizDe, nomeDepto]);

  if (acesso === false) return <section className="es-bloco"><p className="muted">Você não tem acesso ao ponto (RHiD).</p></section>;
  if (!carregado) return <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>;

  const daEmpresa = linhas.filter((l) => l.saldo != null && (filtroEmpresa === "todas" || l.raiz === filtroEmpresa));
  const unidades = [...new Set(daEmpresa.map((l) => l.unidade).filter(Boolean))].sort();
  const termo = busca.trim().toLowerCase();
  const vistas = daEmpresa.filter((l) => !unidade || l.unidade === unidade).filter((l) => !termo || l.p.nome.toLowerCase().includes(termo));
  const positivos = vistas.filter((l) => l.saldo! > 0);
  const negativos = vistas.filter((l) => l.saldo! < 0);
  const totalPos = positivos.reduce((t, l) => t + l.saldo!, 0);
  const totalNeg = negativos.reduce((t, l) => t + l.saldo!, 0);
  const maior = Math.max(1, ...vistas.map((l) => Math.abs(l.saldo!)));
  const ordenar = (a: typeof vistas[number], b: typeof vistas[number]) =>
    ordem === "Nome" ? a.p.nome.localeCompare(b.p.nome) : ordem === "Mais negativo" ? a.saldo! - b.saldo! : b.saldo! - a.saldo!;
  const grupos = [...new Set(vistas.map((l) => l.unidade || "Sem unidade"))].sort();
  const diaMaisNovo = vistas.map((l) => l.dia).sort().at(-1);
  const semSaldo = linhas.filter((l) => l.saldo == null && (filtroEmpresa === "todas" || l.raiz === filtroEmpresa)).length;

  return (
    <>
      {erro && <p className="tv-alerta">{erro}</p>}
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Saldo da equipe</span><span className={`es-numero-valor ${totalPos + totalNeg < 0 ? "es-ruim" : ""}`}>{horas(totalPos + totalNeg, true)}</span><span className="tv-cartao-detalhe">{vistas.length} pessoas com saldo{diaMaisNovo ? ` · até ${dataBR(diaMaisNovo)}` : ""}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">A pagar (horas extras)</span><span className="es-numero-valor es-ok">{horas(totalPos)}</span><span className="tv-cartao-detalhe">{positivos.length} pessoas com saldo positivo</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">A compensar (horas devidas)</span><span className="es-numero-valor es-ruim">{horas(totalNeg)}</span><span className="tv-cartao-detalhe">{negativos.length} pessoas com saldo negativo</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Maiores saldos</span><span className="es-numero-valor">{vistas.length ? horas(Math.max(...vistas.map((l) => l.saldo!))) : "—"}</span><span className="tv-cartao-detalhe">{vistas.length ? `menor: ${horas(Math.min(...vistas.map((l) => l.saldo!)))}` : ""}</span></div>
      </div>

      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>{icone("banco")}Saldo por pessoa</h2>
          <div className="tv-unidades" role="group" aria-label="Ordem">
            {ORDENS.map((o) => <button key={o} className={ordem === o ? "botao-painel on" : "botao-painel"} onClick={() => setOrdem(o)}>{o}</button>)}
          </div>
        </div>
        <div className="es-filtros">
          <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome" aria-label="Buscar" />
          <FiltroUnidade unidades={unidades} valor={unidade} onMudar={setUnidade} contar={(u) => daEmpresa.filter((l) => l.unidade === u).length} />
        </div>
        {vistas.length === 0 ? (
          <p className="muted tv-nada">{pessoas.length ? "Ninguém neste filtro." : "O ponto ainda não foi lido. A leitura roda sozinha às 5h, 12h e 17h."}</p>
        ) : (
          <>
            <div className="bh-cabeca" aria-hidden="true"><span>Pessoa</span><span>Devendo · Crédito</span><span>Saldo</span><span>30 dias</span></div>
            <ul className="bh-lista">
              {grupos.map((g) => {
                const do_ = vistas.filter((l) => (l.unidade || "Sem unidade") === g).sort(ordenar);
                const soma = do_.reduce((t, l) => t + l.saldo!, 0);
                return (
                  <Fragment key={g}>
                    <li className="bh-grupo"><span>{g} <span className="muted">· {do_.length}</span></span><span className={`muted ${soma < 0 ? "es-ruim" : ""}`}>{horas(soma, true)}</span></li>
                    {do_.map((l) => {
                      const k = `${l.raiz}:${l.p.cpf}`;
                      const temRH = chavesRH.has(k);
                      const pct = Math.round((Math.abs(l.saldo!) / maior) * 50);
                      return (
                        <li key={chave(l.p.cliente_id, l.p.id)}>
                          <button className={temRH ? "bh-linha" : "bh-linha sem-ficha"} onClick={() => temRH && onAbrirPessoa(k)} aria-disabled={!temRH}
                            title={temRH ? "Ver a ficha no RH" : "Sem ficha no RH (CPF fora do cadastro do eSocial)"}>
                            <span className="bh-nome"><strong>{nomeProprio(l.p.nome)}</strong><span className="muted">saldo em {dataBR(l.dia)}</span></span>
                            <span className="bh-barra" aria-hidden="true"><i className={l.saldo! < 0 ? "neg" : "pos"} style={{ width: `${pct}%` }} /></span>
                            <span className={`bh-saldo ${l.saldo! < 0 ? "neg" : l.saldo! > 0 ? "pos" : ""}`}>{horas(l.saldo!, true)}</span>
                            <span className="bh-var">{l.variacao == null ? "—" : l.variacao === 0 ? "igual" : horas(l.variacao, true)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}
        <p className="muted es-nota">Saldo do banco de horas calculado pelo RHiD (apuração do ponto) no último dia lido de cada pessoa. "30 dias" é quanto o saldo mudou desde {dataBR(somarDias(hoje(), -30))}.
          {semSaldo > 0 ? ` ${semSaldo} pessoa${semSaldo === 1 ? "" : "s"} ativa${semSaldo === 1 ? "" : "s"} no relógio ainda sem saldo lido.` : ""}</p>
      </section>
    </>
  );
}
