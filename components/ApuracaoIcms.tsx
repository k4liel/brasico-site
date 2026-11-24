"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Apuração do ICMS feita pelo Brasico (aba "Apuração ICMS" da página Notas; supabase/icms_apuracao.sql, 22/11/2026).
// Débitos = ICMS das NFC-e autorizadas; créditos = ICMS das NF-e de compra que dão crédito (insumos, ativo em 48 meses,
// frete como tomador); DIFAL e antecipação das compras de fora do RN. Estimativa para conferir o contador: as premissas
// que dependem da contabilidade ficam em icms_regras ("a definir" usa o padrão).
type Debito = { tipo: string; aliquota: number; taxa: boolean; itens: number; valor: number; base: number; icms: number };
type Credito = { tipo: string; itens: number; notas: number; valor: number; icms: number };
type Fora = {
  chave: string; fornecedor: string | null; emissao: string; emit_uf: string; tipo: string; cfops: string; itens: number;
  valor: number; icms: number; aliq_min: number | null; aliq_max: number | null; diferenca: number; exemplo: string | null;
};
type Cobertura = { dias_venda: number; dias_lidos: number; total_caixa: number; total_sem_nota: number | null; falta_de: string | null; falta_ate: string | null };
type Empresa = {
  cnpj: string; nome: string; casas_nome?: string | null; regime: string | null; debito: number; debito_taxa: number; credito_insumos: number; icms_ativo: number;
  credito_ativo_mes: number; credito_cte: number; difal: number; antecipacao: number; debito_estimado_faltante: number;
  cobertura: Cobertura | null; vendido: { valor: number; icms: number } | null;
  debitos: Debito[]; creditos: Credito[]; fora: Fora[]; cte: { ctes: number; valor: number; icms: number } | null;
};
type Regra = { chave: string; nome: string; valor: string | null; padrao: string; decisao: string | null; definido_por: string | null };
type Resultado = { mes: string; aliquota_interna: number; regras: Regra[]; empresas: Empresa[] };

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number) => Number(v).toLocaleString("pt-BR");
const dataBr = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const cnpjMask = (c: string) => (c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const CREDITO: Record<string, { nome: string; entra: string; explica: string }> = {
  insumo: { nome: "Comida e bebida (insumos)", entra: "dá crédito", explica: "O ICMS pago na compra do que vira prato ou bebida abate o ICMS das vendas." },
  ativo: { nome: "Máquinas e equipamentos", entra: "1/48 por mês", explica: "Ativo imobilizado: o crédito entra em 48 parcelas mensais (CIAP)." },
  uso_consumo: { nome: "Uso e consumo", entra: "não dá crédito", explica: "Limpeza, utensílios, embalagens, escritório: pela Lei Kandir o crédito só vale a partir de 2033." },
  st: { nome: "Com substituição tributária", entra: "não dá crédito", explica: "O ICMS já foi pago antes, pelo fornecedor; a venda sai sem ICMS (CST 060)." },
  simples_credito: { nome: "Fornecedor do Simples com crédito", entra: "a conferir", explica: "CSOSN 101: a nota informa um crédito pequeno nas observações; ainda não está somado." },
  sem_icms: { nome: "Sem ICMS destacado", entra: "nada a abater", explica: "Fornecedor do Simples sem crédito, isento ou não tributado." },
  faturamento: { nome: "Simples faturamento (entrega futura)", entra: "espera a entrega", explica: "CFOP 5922/6922: a mercadoria ainda não veio; o ICMS (e o DIFAL) vêm na nota de entrega." },
};
const TIPO_FORA: Record<string, string> = {
  insumo: "insumo: antecipação possível", uso_consumo: "uso e consumo: DIFAL", ativo: "ativo: DIFAL", sem_icms: "sem ICMS: DIFAL",
  st: "com ST", simples_credito: "Simples",
};

export default function ApuracaoIcms() {
  const supabase = useMemo(() => createClient(), []);
  const meses = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 12 }, (_, k) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
  }, []);
  const [mes, setMes] = useState(meses[0]);
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setR(null); setErro("");
    supabase.rpc("icms_apuracao", { p_mes: mes }).then(({ data, error }) => {
      if (error) setErro(error.message); else setR(data as Resultado);
    });
  }, [supabase, mes]);

  const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
  const alternar = (k: string) => setAbertos((x) => ({ ...x, [k]: !x[k] }));

  return (
    <div className="cf ap">
      <div className="nc-barra">
        <h2>Apuração do ICMS</h2>
        <div className="cf-acoes">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            {meses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
        </div>
      </div>
      <p className="nc-explica cf-escopo">
        ICMS das vendas (NFC-e do caixa) menos o ICMS das compras que dá crédito (NF-e), mais o DIFAL das compras de fora do RN.
        É uma estimativa feita com as notas que o Brasico já lê, para conferir a apuração do contador. Não substitui a apuração oficial.
      </p>

      {erro && <p className="es-aviso">Não deu para montar a apuração: {erro}</p>}
      {!r && !erro && <p className="muted">Somando as notas do mês…</p>}

      {r && (
        <>
          <section className="cf-decisoes">
            <header><h3>Premissas (a confirmar com a contabilidade)</h3><span>{r.regras.filter((x) => !x.valor).length} a definir</span></header>
            <ul>
              {r.regras.map((x) => (
                <li key={x.chave} className={x.valor ? "ok" : "falta"}>
                  <span className="cf-dec-nome">{x.nome}</span>
                  <span className="cf-dec-valor">{x.valor ? <b>{x.valor}</b> : <>a definir · usando <b>{x.padrao}</b></>}</span>
                  {x.decisao && <small>{x.decisao}{x.definido_por ? ` · ${x.definido_por}` : ""}</small>}
                </li>
              ))}
            </ul>
          </section>

          {!r.empresas.length && <p className="muted">Nenhuma venda com NFC-e neste mês.</p>}

          {r.empresas.map((e) => {
            const credito = Number(e.credito_insumos) + Number(e.credito_cte) + Number(e.credito_ativo_mes);
            const debitoTotal = Number(e.debito) + Number(e.debito_estimado_faltante);
            const saldo = debitoTotal - credito;
            const c = e.cobertura;
            const falta = c && c.dias_venda > c.dias_lidos;
            return (
              <section key={e.cnpj} className="ap-empresa">
                <header className="ap-cabeca">
                  <div><h3>{e.casas_nome || e.nome}</h3><small>{e.casas_nome ? `${e.nome} · ` : ""}CNPJ {cnpjMask(e.cnpj)}{e.regime ? ` · ${e.regime.toLowerCase()}` : ""}</small></div>
                  {c && <span className={falta ? "ap-cob falta" : "ap-cob"}>{num(c.dias_lidos)} de {num(c.dias_venda)} dias com NFC-e lidas</span>}
                </header>

                {falta && (
                  <p className="nc-aviso ap-aviso">
                    Faltam as NFC-e de {dataBr(c!.falta_de)} a {dataBr(c!.falta_ate)} ({brl(c!.total_sem_nota)} no caixa).
                    A TOTVS só entrega as vendas dos últimos 16 dias; o ICMS desses dias foi estimado pela média dos dias lidos ({brl(e.debito_estimado_faltante)}).
                  </p>
                )}

                <dl className="nc-numeros">
                  <div><dt>ICMS das vendas</dt><dd>{brl(debitoTotal)}</dd>
                    <small>{brl(e.debito)} nas NFC-e{Number(e.debito_estimado_faltante) > 0 ? ` + ${brl(e.debito_estimado_faltante)} estimado` : ""}</small></div>
                  <div><dt>Créditos das compras</dt><dd>{brl(credito)}</dd>
                    <small>insumos {brl(e.credito_insumos)}{Number(e.credito_ativo_mes) > 0 ? ` · ativo ${brl(e.credito_ativo_mes)}` : ""}{Number(e.credito_cte) > 0 ? ` · frete ${brl(e.credito_cte)}` : ""}</small></div>
                  <div><dt>{saldo >= 0 ? "ICMS a recolher (estimado)" : "Saldo credor (estimado)"}</dt><dd className={saldo >= 0 ? "" : "ap-bom"}>{brl(Math.abs(saldo))}</dd>
                    <small>vendas menos créditos</small></div>
                  <div><dt>Compras de fora do RN</dt><dd>{brl(e.difal)}</dd>
                    <small>DIFAL{Number(e.antecipacao) > 0 ? ` · antecipação possível ${brl(e.antecipacao)}` : ""}</small></div>
                </dl>

                {Number(e.debito_taxa) > 0 && (
                  <p className="nc-explica ap-nota">
                    Do ICMS das vendas, {brl(e.debito_taxa)} vêm da taxa de serviço, que sai tributada (assunto levado à contabilidade).
                  </p>
                )}

                <div className="ap-blocos">
                  <Bloco titulo="ICMS das vendas por alíquota" aberto={!!abertos[`${e.cnpj}|d`]} onClick={() => alternar(`${e.cnpj}|d`)} resumo={`${num(e.debitos.reduce((s, d) => s + d.itens, 0))} itens`}>
                    <table className="nf-tabela cf-tabela">
                      <thead><tr><th>Itens vendidos</th><th className="n">Alíquota</th><th className="n">Itens</th><th className="n">Vendido</th><th className="n">Base</th><th className="n">ICMS</th></tr></thead>
                      <tbody>
                        {e.debitos.map((d, k) => (
                          <tr key={k}>
                            <td>{d.tipo === "st" ? "Com substituição tributária (sem ICMS na venda)" : d.tipo === "sem_icms" ? "Sem ICMS" : d.taxa ? "Taxa de serviço" : "Tributados"}</td>
                            <td className="n">{d.aliquota ? `${num(d.aliquota)}%` : "—"}</td>
                            <td className="n">{num(d.itens)}</td>
                            <td className="n">{brl(d.valor)}</td>
                            <td className="n">{brl(d.base)}</td>
                            <td className="n">{brl(d.icms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Bloco>

                  <Bloco titulo="ICMS das compras: o que dá crédito" aberto={!!abertos[`${e.cnpj}|c`]} onClick={() => alternar(`${e.cnpj}|c`)} resumo={`${num(e.creditos.reduce((s, x) => s + x.notas, 0))} notas`}>
                    <table className="nf-tabela cf-tabela">
                      <thead><tr><th>Tipo de compra</th><th>Crédito</th><th className="n">Notas</th><th className="n">Comprado</th><th className="n">ICMS na nota</th></tr></thead>
                      <tbody>
                        {e.creditos.map((x) => {
                          const t = CREDITO[x.tipo] ?? { nome: x.tipo, entra: "", explica: "" };
                          return (
                            <tr key={x.tipo}>
                              <td><strong>{t.nome}</strong><small>{t.explica}</small></td>
                              <td><span className={`ap-entra ${x.tipo === "insumo" ? "sim" : x.tipo === "ativo" ? "parte" : "nao"}`}>{t.entra}</span></td>
                              <td className="n">{num(x.notas)}</td>
                              <td className="n">{brl(x.valor)}</td>
                              <td className="n">{brl(x.icms)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Bloco>

                  {e.fora.length > 0 && (
                    <Bloco titulo="Compras de fora do RN" aberto={!!abertos[`${e.cnpj}|f`]} onClick={() => alternar(`${e.cnpj}|f`)} resumo={`${num(e.fora.length)} nota${e.fora.length === 1 ? "" : "s"}`}>
                      <p className="cf-explica">
                        Na compra de outro estado o fornecedor destaca a alíquota interestadual (4%, 7% ou 12%). Para uso e consumo e ativo, a
                        empresa paga ao RN a diferença até a alíquota interna ({num(r.aliquota_interna)}%), o DIFAL. Nos insumos, o RN pode cobrar
                        antecipação: a conta mostra o valor possível, a confirmar.
                      </p>
                      <table className="nf-tabela cf-tabela">
                        <thead><tr><th>Fornecedor</th><th>Nota</th><th>Tipo</th><th className="n">Valor</th><th className="n">Alíquota</th><th className="n">Diferença</th></tr></thead>
                        <tbody>
                          {e.fora.map((f) => (
                            <tr key={`${f.chave}|${f.tipo}`}>
                              <td><strong>{f.fornecedor ?? "—"}</strong><small>{f.emit_uf}{f.exemplo ? ` · ${f.exemplo}` : ""}</small></td>
                              <td><a href={`/api/notas/danfe/${f.chave}`} target="_blank" rel="noreferrer">Nº {Number(f.chave.slice(25, 34)).toLocaleString("pt-BR")}</a><small>{dataBr(f.emissao)} · CFOP {f.cfops}</small></td>
                              <td>{TIPO_FORA[f.tipo] ?? f.tipo}</td>
                              <td className="n">{brl(f.valor)}</td>
                              <td className="n">{f.aliq_min == null ? "—" : f.aliq_min === f.aliq_max ? `${num(f.aliq_min)}%` : `${num(f.aliq_min)}–${num(f.aliq_max ?? 0)}%`}</td>
                              <td className="n">{Number(f.diferenca) > 0 ? brl(f.diferenca) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Bloco>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Bloco({ titulo, resumo, aberto, onClick, children }: { titulo: string; resumo: string; aberto: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <section className={`cf-regra cf-info${aberto ? " aberta" : ""}`}>
      <button className="cf-regra-cabeca ap-bloco-cabeca" onClick={onClick} aria-expanded={aberto}>
        <span className="cf-regra-titulo"><strong>{titulo}</strong><small>{resumo}</small></span>
        <span className="ip-seta" aria-hidden="true" />
      </button>
      {aberto && <div className="cf-regra-corpo"><div className="nf-tabela-wrap">{children}</div></div>}
    </section>
  );
}
