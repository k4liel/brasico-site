"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Unidade = { id: string; nome: string; loja: number | null; ativa: boolean; ordem: number };
type Resumo = Record<string, number>;
type Dia = {
  unidade_id: string; dia: string; status: "ok" | "revisar" | "sem_movimento"; vendas: number; pessoas: number; total: number;
  resumo: Resumo; produtos: Produto[]; pagamentos: Pagamento[]; garcons: Garcom[]; sangrias: Sangria[];
  fechamentos: Fechamento[]; cancelados: Cancelado[]; divergencias: Divergencia[]; atualizado_em: string;
};
type Produto = { codigo: number | null; nome: string; grupo: string; subgrupo: string; categoria: string; quantidade: number; valor: number };
type Pagamento = { forma: string; tipo: string; vezes: number; valor: number };
type Garcom = { codigo: number | null; nome: string; itens: number; valor: number; vendas: number };
type Sangria = { caixa: number | null; quando: string; operador: string; motivo: string; forma: string; valor: number };
type Fechamento = { caixa: number | null; abertura: string; encerramento: string; operador: string; sistema: number; recebido: number };
type Cancelado = { tipo: string; cupom: number | null; total?: number; produto?: string; operador: string; motivo: string };
type Divergencia = { conferencia: string; a?: number; b?: number; diferenca?: number; valor?: number };
type Execucao = { id: string; unidade_id: string; dia: string; status: string; erro: string; origem: string; created_at: string; fim: string | null };
type Curto = { dia: string; total: number; status: string };

const ABAS = ["Produtos", "Pagamentos", "Garçons", "Caixa", "Cancelados"] as const;
type Aba = (typeof ABAS)[number];

const reais = (v: number) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (v: number) => (v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataLonga = (d: string) => {
  const [a, m, dia] = d.split("-").map(Number);
  const w = new Date(Date.UTC(a, m - 1, dia)).getUTCDay();
  return `${SEMANA[w]}, ${dia} ${MES[m - 1]} ${a}`;
};
const dataCurta = (d: string) => {
  const [, m, dia] = d.split("-").map(Number);
  return `${dia}/${String(m).padStart(2, "0")}`;
};
// Dia operacional em Fortaleza (UTC-3)
const hojeFortaleza = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const horaTotvs = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "");

const STATUS: Record<string, string> = {
  ok: "Conferido", revisar: "Para revisar", sem_movimento: "Sem movimento",
  na_fila: "Na fila", rodando: "Puxando da TOTVS…", falha: "Falhou",
};

export default function Vendas({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidade, setUnidade] = useState<string | null>(null);
  const [dia, setDia] = useState(() => somarDias(hojeFortaleza(), -1));
  const [dados, setDados] = useState<Dia | null | undefined>(undefined);
  const [execucao, setExecucao] = useState<Execucao | null>(null);
  const [historico, setHistorico] = useState<Curto[]>([]);
  const [aba, setAba] = useState<Aba>("Produtos");
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("totvs_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      const { data: u } = await supabase.from("totvs_unidades").select("id,nome,loja,ativa,ordem").order("ordem");
      const lista = (u ?? []) as Unidade[];
      setUnidades(lista);
      let salva: string | null = null;
      try {
        salva = localStorage.getItem("brasico-totvs-unidade");
      } catch {}
      setUnidade(lista.find((x) => x.id === salva)?.id ?? lista.find((x) => x.ativa && x.loja != null)?.id ?? lista[0]?.id ?? null);
    })();
  }, [supabase, userId]);

  const carregar = useCallback(async () => {
    if (!unidade) return;
    const [d, e, h] = await Promise.all([
      supabase.from("totvs_dias").select("*").eq("unidade_id", unidade).eq("dia", dia).maybeSingle(),
      supabase.from("totvs_execucoes").select("id,unidade_id,dia,status,erro,origem,created_at,fim")
        .eq("unidade_id", unidade).eq("dia", dia).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("totvs_dias").select("dia,total,status").eq("unidade_id", unidade)
        .gte("dia", somarDias(dia, -13)).lte("dia", somarDias(dia, 13)).order("dia"),
    ]);
    setDados((d.data as Dia) ?? null);
    setExecucao((e.data as Execucao) ?? null);
    setHistorico((h.data as Curto[]) ?? []);
  }, [supabase, unidade, dia]);

  useEffect(() => {
    setDados(undefined);
    carregar();
  }, [carregar]);

  // Atualiza sozinho quando uma extração termina
  useEffect(() => {
    if (!acesso) return;
    const ch = supabase
      .channel("totvs")
      .on("postgres_changes", { event: "*", schema: "public", table: "totvs_execucoes" }, () => carregar())
      .on("postgres_changes", { event: "*", schema: "public", table: "totvs_dias" }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, acesso, carregar]);

  const emAndamento = !!execucao && ["na_fila", "rodando"].includes(execucao.status) && Date.now() - new Date(execucao.created_at).getTime() < 10 * 60 * 1000;
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [emAndamento, carregar]);

  function escolherUnidade(id: string) {
    setUnidade(id);
    try {
      localStorage.setItem("brasico-totvs-unidade", id);
    } catch {}
  }

  async function atualizar() {
    if (!unidade) return;
    setPedindo(true);
    setErro("");
    const { error } = await supabase.rpc("totvs_extrair", { p_unidade: unidade, p_dia: dia });
    setPedindo(false);
    if (error) setErro(error.message);
    else carregar();
  }

  const u = unidades.find((x) => x.id === unidade);
  const extrai = !!u && u.ativa && u.loja != null;
  const hoje = hojeFortaleza();
  const r = dados?.resumo ?? {};
  const ticket = dados && dados.pessoas ? dados.total / dados.pessoas : 0;

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="vendas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso às vendas da TOTVS.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="vendas" />
      <main className="miolo tv">
        <div className="tv-cabeca">
          <div>
            <h1>Vendas TOTVS</h1>
            <p className="muted">Dados do Chef Web por data de movimento. Todo dia às 6h o dia anterior é puxado sozinho.</p>
          </div>
        </div>

        <div className="tv-barra">
          <div className="tv-unidades" role="tablist" aria-label="Unidade">
            {unidades.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === unidade} className={x.id === unidade ? "botao-painel on" : "botao-painel"} onClick={() => escolherUnidade(x.id)}>
                {x.nome}
              </button>
            ))}
          </div>
          <div className="tv-dia">
            <button className="ghost small" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior">‹</button>
            <input type="date" value={dia} max={hoje} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Dia" />
            <button className="ghost small" onClick={() => setDia(somarDias(dia, 1))} disabled={dia >= hoje} aria-label="Dia seguinte">›</button>
            <button onClick={atualizar} disabled={!extrai || pedindo || emAndamento}>
              {emAndamento ? "Puxando…" : dados ? "Atualizar" : "Puxar este dia"}
            </button>
          </div>
        </div>

        {historico.length > 0 && (
          <div className="tv-tira" aria-label="Dias próximos">
            {historico.map((h) => {
              const max = Math.max(...historico.map((x) => x.total), 1);
              return (
                <button key={h.dia} className={h.dia === dia ? "tv-tira-dia on" : "tv-tira-dia"} onClick={() => setDia(h.dia)} title={`${dataLonga(h.dia)} · ${reais(h.total)}`}>
                  <span className="tv-tira-barra"><i style={{ height: `${Math.max(4, (h.total / max) * 100)}%` }} className={h.status} /></span>
                  <span className="tv-tira-data">{dataCurta(h.dia)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="tv-situacao">
          <strong>{u?.nome ?? ""}</strong>
          <span className="muted">{dataLonga(dia)}</span>
          {dados && <span className={`estado tv-${dados.status}`}>{STATUS[dados.status]}</span>}
          {execucao && (emAndamento || execucao.status === "falha") && (
            <span className={`estado tv-${execucao.status}`}>{STATUS[execucao.status] ?? execucao.status}</span>
          )}
          {dados && <span className="muted tv-quando">atualizado {hora(dados.atualizado_em)}</span>}
        </div>

        {!extrai && u && <p className="tv-alerta">Esta unidade não tem loja TOTVS configurada, então não há extração.</p>}
        {erro && <p className="tv-alerta">{erro}</p>}
        {execucao?.status === "falha" && !emAndamento && (
          <p className="tv-alerta">
            A última tentativa ({hora(execucao.created_at)}) falhou: {execucao.erro || "erro desconhecido"}.
            {dados ? " Os números abaixo são da última extração que deu certo." : ""}
          </p>
        )}

        {dados === undefined ? (
          <p className="muted">Carregando…</p>
        ) : dados === null ? (
          <div className="vazio">
            <p><strong>Nenhum dado deste dia ainda.</strong></p>
            <p className="muted">{extrai ? "Clique em \"Puxar este dia\" para buscar na TOTVS." : ""}</p>
          </div>
        ) : (
          <>
            {dados.divergencias.length > 0 && (
              <div className="tv-divergencias">
                <strong>Conferências que não bateram</strong>
                <ul>
                  {dados.divergencias.map((d, i) => (
                    <li key={i}>
                      {d.conferencia}
                      {d.diferenca != null ? `: ${reais(d.a ?? 0)} × ${reais(d.b ?? 0)} (diferença ${reais(d.diferenca)})` : d.valor != null ? `: ${reais(d.valor)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="tv-cartoes">
              <Cartao rotulo="Faturamento" valor={reais(dados.total)} destaque detalhe={`${numero(dados.vendas)} vendas`} />
              <Cartao rotulo="Pessoas" valor={numero(dados.pessoas)} detalhe={`ticket médio ${reais(ticket)}`} />
              <Cartao rotulo="Comida" valor={reais(r.comida)} detalhe={pct(r.comida, r.valor_produtos)} />
              <Cartao rotulo="Bebida" valor={reais(r.bebida)} detalhe={pct(r.bebida, r.valor_produtos)} />
              {r.outros > 0 && <Cartao rotulo="Outros grupos" valor={reais(r.outros)} detalhe={pct(r.outros, r.valor_produtos)} />}
              <Cartao rotulo="Taxa de serviço" valor={reais(Math.max(r.servico ?? 0, r.itens_taxa_servico ?? 0))} />
              <Cartao rotulo="Descontos" valor={reais(r.descontos)} />
              <Cartao rotulo="Caixa (pagamentos)" valor={reais(r.pagamentos_caixa)} />
              <Cartao rotulo="Assinadas" valor={reais(r.assinadas)} />
              <Cartao rotulo="Cortesias" valor={reais(r.cortesias)} />
              <Cartao rotulo="Sangrias" valor={reais(r.sangrias)} detalhe={`${dados.sangrias.length} no dia`} />
              <Cartao rotulo="Cancelamentos" valor={numero(r.vendas_canceladas)} detalhe={`vendas · ${numero(r.itens_cancelados)} itens`} />
            </div>

            <div className="tv-abas" role="tablist">
              {ABAS.map((a) => (
                <button key={a} role="tab" aria-selected={a === aba} className={a === aba ? "botao-painel on" : "botao-painel"} onClick={() => setAba(a)}>
                  {a}
                </button>
              ))}
            </div>

            <div className="tv-tabela-caixa">
              {aba === "Produtos" && (
                <Tabela
                  cab={["Produto", "Grupo", "Qtd.", "Valor"]}
                  linhas={dados.produtos.map((p) => [p.nome, [p.grupo, p.subgrupo].filter(Boolean).join(" / "), numero(p.quantidade), reais(p.valor)])}
                  total={["Total", "", numero(dados.produtos.reduce((s, p) => s + p.quantidade, 0)), reais(r.valor_produtos)]}
                />
              )}
              {aba === "Pagamentos" && (
                <Tabela
                  cab={["Forma", "Tipo", "Vezes", "Valor"]}
                  linhas={dados.pagamentos.map((p) => [p.forma, p.tipo === "caixa" ? "Caixa" : p.tipo === "assinada" ? "Assinada" : "Cortesia", numero(p.vezes), reais(p.valor)])}
                  total={["Total", "", "", reais(r.pagamentos_total)]}
                />
              )}
              {aba === "Garçons" && (
                <Tabela
                  cab={["#", "Atendente", "Vendas", "Itens", "Valor"]}
                  linhas={dados.garcons.map((g, i) => [String(i + 1), g.nome, numero(g.vendas), numero(g.itens), reais(g.valor)])}
                />
              )}
              {aba === "Caixa" && (
                <>
                  <h3>Fechamentos de caixa</h3>
                  <Tabela
                    cab={["Caixa", "Abertura", "Fechamento", "Operador", "Sistema", "Recebido"]}
                    linhas={dados.fechamentos.map((f) => [String(f.caixa ?? ""), horaTotvs(f.abertura), horaTotvs(f.encerramento), f.operador, reais(f.sistema), reais(f.recebido)])}
                    total={["Total", "", "", "", reais(r.fechamento_sistema), reais(r.fechamento_recebido)]}
                  />
                  <h3>Sangrias</h3>
                  <Tabela
                    cab={["Caixa", "Quando", "Operador", "Motivo", "Valor"]}
                    linhas={dados.sangrias.map((s) => [String(s.caixa ?? ""), horaTotvs(s.quando), s.operador, s.motivo, reais(s.valor)])}
                    total={["Total", "", "", "", reais(r.sangrias)]}
                  />
                </>
              )}
              {aba === "Cancelados" && (
                <Tabela
                  cab={["Tipo", "Cupom", "O quê", "Quem cancelou", "Motivo"]}
                  linhas={dados.cancelados.map((c) => [c.tipo === "venda" ? "Venda" : "Item", String(c.cupom ?? ""), c.tipo === "venda" ? reais(c.total ?? 0) : c.produto ?? "", c.operador, c.motivo])}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% dos produtos` : "");

function Cartao({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className={destaque ? "tv-cartao destaque" : "tv-cartao"}>
      <span className="tv-cartao-rotulo">{rotulo}</span>
      <span className="tv-cartao-valor">{valor}</span>
      {detalhe && <span className="tv-cartao-detalhe">{detalhe}</span>}
    </div>
  );
}

function Tabela({ cab, linhas, total }: { cab: string[]; linhas: string[][]; total?: string[] }) {
  if (!linhas.length) return <p className="muted tv-nada">Nada neste dia.</p>;
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
        {total && (
          <tfoot>
            <tr>{total.map((c, i) => <td key={i}>{c}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
