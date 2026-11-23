"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Conferência fiscal das NF-e de compra (aba NF-e → "Conferência fiscal"; supabase/nfe_conferencia.sql, 22/11/2026).
// Lê os campos fiscais do XML de cada nota completa (notas_fiscal, notas_itens_fiscal) e confere, com regras fixas e sem
// IA: total da nota, CFOP × estado do fornecedor, CFOP que não é compra comum, NCM, conta do ICMS, ST, IBS/CBS da reforma,
// nota em dobro, destinatário, nota só em resumo e cancelada. Mesmo visual da conferência das NFC-e (classes cf-*).
type Achado = {
  regra: string; sev: "erro" | "atencao"; empresa_cnpj: string; chave: string | null; numero: string | null; fornecedor: string;
  emissao: string | null; item: string | null; campo: string; atual: string | null; esperado: string | null; itens: number;
  valor: number | null; impacto: number | null;
};
type Resultado = {
  de: string; ate: string; notas: number; completas: number; valor: number; itens: number; icms: number; st: number;
  cbs_ibs: number; base_ibscbs: number; achados: Achado[];
};

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number) => Number(v).toLocaleString("pt-BR");
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");

const REGRAS: { id: string; titulo: string; explica: string; ok: string }[] = [
  { id: "total_nota", titulo: "Total da nota não fecha", explica: "A soma dos itens, frete, seguro, outras despesas, IPI, ST e FCP, menos o desconto, não bate com o total da nota. Pode ser cobrança a mais.", ok: "Total de cada nota fecha com os itens" },
  { id: "cfop_uf", titulo: "CFOP trocado entre dentro e fora do estado", explica: "Fornecedor do RN deve usar CFOP 5xxx; de outro estado, 6xxx. CFOP trocado muda o ICMS e o crédito.", ok: "CFOP de acordo com o estado do fornecedor" },
  { id: "ncm_invalido", titulo: "NCM vazio ou inválido", explica: "Item sem NCM de 8 dígitos (ou 00000000). Sem NCM não dá para conferir ST nem a classificação da reforma.", ok: "Todo item com NCM válido" },
  { id: "icms_conta", titulo: "Conta do ICMS do item não fecha", explica: "Base × alíquota diferente do ICMS destacado no item.", ok: "Conta do ICMS certa em todos os itens" },
  { id: "cfop_especial", titulo: "Nota que não é compra comum", explica: "CFOP de bonificação, brinde, remessa, transferência, devolução ou \"outra saída\". Confira se é isso mesmo e se não houve cobrança.", ok: "Só CFOPs de compra comum" },
  { id: "st_misturado", titulo: "Mesmo NCM com e sem substituição tributária", explica: "O mesmo NCM veio com ST de um fornecedor e sem ST de outro. Um dos dois pode estar errado, ou falta recolher a antecipação.", ok: "ST igual para o mesmo NCM em todos os fornecedores" },
  { id: "ibscbs_ausente", titulo: "Fornecedor do regime normal sem IBS/CBS na nota", explica: "Desde 2026 a NF-e de quem é do regime normal deve trazer o IBS/CBS destacado (teste: 0,9% de CBS e 0,1% de IBS, sem pagamento). A partir de 2027 o crédito da CBS depende do imposto destacado na nota.", ok: "IBS/CBS destacado por todos os fornecedores do regime normal" },
  { id: "duplicada", titulo: "Possível nota em dobro", explica: "Duas notas do mesmo fornecedor, para a mesma empresa, com o mesmo valor, em até 3 dias. Confira se não foi cobrado duas vezes.", ok: "Nenhuma nota repetida" },
  { id: "destinatario", titulo: "Nota emitida para outro CNPJ", explica: "O CNPJ do destinatário da nota não é o da empresa que a recebeu.", ok: "Destinatário certo em todas as notas" },
  { id: "so_resumo", titulo: "Nota só em resumo há mais de 10 dias", explica: "A SEFAZ só mandou o resumo e o prazo da ciência passou: sem o XML completo os itens não são conferidos. Peça o XML ao fornecedor.", ok: "Todas as notas completas" },
  { id: "cancelada", titulo: "Nota cancelada pelo fornecedor", explica: "Confirme que não foi paga, ou que o boleto também foi cancelado.", ok: "Nenhuma nota cancelada" },
];

export default function ConferenciaCompras({ mes, empresa, nomeEmpresa }: {
  mes: string; empresa: string; nomeEmpresa: (cnpj: string) => string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [soErros, setSoErros] = useState(false);
  const [busca, setBusca] = useState("");
  const [abertas, setAbertas] = useState<Record<string, boolean>>({ total_nota: true, cfop_uf: true, duplicada: true });

  useEffect(() => {
    if (!mes) return;
    setR(null); setErro("");
    const prox = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0); // último dia do mês
    const ate = `${mes}-${String(prox.getDate()).padStart(2, "0")}`;
    supabase.rpc("nfe_conferencia", { p_de: `${mes}-01`, p_ate: ate, p_empresa: empresa || null }).then(({ data, error }) => {
      if (error) setErro(error.message); else setR(data as Resultado);
    });
  }, [supabase, mes, empresa]);

  if (!mes) return <p className="muted">Sem notas ainda.</p>;
  if (erro) return <p className="es-aviso">Não deu para rodar a conferência: {erro}</p>;
  if (!r) return <p className="muted">Conferindo as notas do mês…</p>;

  const t = busca.trim().toLowerCase();
  const lista = r.achados.filter((a) => (!soErros || a.sev === "erro")
    && (!t || a.fornecedor.toLowerCase().includes(t) || (a.numero ?? "").includes(t) || (a.item ?? "").toLowerCase().includes(t)));
  const notasErro = new Set(r.achados.filter((a) => a.sev === "erro").map((a) => a.chave ?? `${a.fornecedor}|${a.regra}`));
  const notasAtencao = new Set(r.achados.filter((a) => a.sev === "atencao" && !notasErro.has(a.chave ?? "")).map((a) => a.chave ?? `${a.fornecedor}|${a.regra}`));
  const impacto = r.achados.filter((a) => a.sev === "erro").reduce((s, a) => s + Number(a.impacto ?? 0), 0);

  function planilha() {
    const linhas = [["Regra", "Severidade", "Empresa", "Fornecedor", "Nota", "Emissão", "Item", "Campo", "Como está", "Esperado", "Itens", "Valor", "Impacto", "Chave"]];
    for (const a of lista) {
      linhas.push([REGRAS.find((x) => x.id === a.regra)?.titulo ?? a.regra, a.sev, nomeEmpresa(a.empresa_cnpj), a.fornecedor, a.numero ?? "", dia(a.emissao),
        a.item ?? "", a.campo, a.atual ?? "", a.esperado ?? "", String(a.itens), a.valor == null ? "" : String(a.valor).replace(".", ","),
        a.impacto == null ? "" : String(a.impacto).replace(".", ","), a.chave ?? ""]);
    }
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `conferencia-fiscal-nfe-${mes}${empresa ? `-${empresa}` : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cf">
      <dl className="nc-numeros">
        <div><dt>Notas conferidas</dt><dd>{num(r.completas)}</dd><small>{brl(r.valor)} · {num(r.itens)} itens</small></div>
        <div><dt>Notas com erro</dt><dd className={notasErro.size ? "cf-ruim" : ""}>{num(notasErro.size)}</dd><small>{impacto > 0 ? `${brl(impacto)} de diferença` : "nenhuma diferença de valor"}</small></div>
        <div><dt>A conferir</dt><dd>{num(notasAtencao.size)}</dd><small>notas ou fornecedores com atenção</small></div>
        <div><dt>IBS/CBS destacado</dt><dd>{brl(r.cbs_ibs)}</dd><small>teste de 2026 · base {brl(r.base_ibscbs)}</small></div>
      </dl>
      <p className="nc-explica cf-escopo">
        Conferidas as NF-e de compra emitidas de {new Date(`${r.de}T12:00:00`).toLocaleDateString("pt-BR")} a {new Date(`${r.ate}T12:00:00`).toLocaleDateString("pt-BR")}
        {empresa ? ` para ${nomeEmpresa(empresa)}` : " para todas as empresas"}. Impostos destacados nos itens: ICMS {brl(r.icms)}, ST {brl(r.st)}.
        Toda nota nova que chega da SEFAZ entra na conferência sozinha.
      </p>

      <div className="nc-barra">
        <h2>O que a conferência achou</h2>
        <div className="cf-acoes">
          <label className="cf-so"><input type="checkbox" checked={soErros} onChange={(e) => setSoErros(e.target.checked)} /> Só os erros</label>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, nota ou item" aria-label="Buscar" />
          <button className="ghost small" onClick={planilha}>Baixar planilha</button>
        </div>
      </div>

      {!r.achados.length && <p className="muted">Nenhum problema nas notas deste mês.</p>}

      {REGRAS.map((g) => {
        const doGrupo = lista.filter((a) => a.regra === g.id);
        if (!doGrupo.length) return null;
        const sev = doGrupo.some((a) => a.sev === "erro") ? "erro" : "atencao";
        const imp = doGrupo.reduce((s, a) => s + Number(a.impacto ?? 0), 0);
        const notas = new Set(doGrupo.map((a) => a.chave).filter(Boolean)).size;
        const aberta = abertas[g.id] ?? false;
        return (
          <section key={g.id} className={`cf-regra cf-${sev}${aberta ? " aberta" : ""}`}>
            <button className="cf-regra-cabeca" onClick={() => setAbertas((x) => ({ ...x, [g.id]: !aberta }))} aria-expanded={aberta}>
              <span className="cf-sev">{sev === "erro" ? "Erro" : "Atenção"}</span>
              <span className="cf-regra-titulo"><strong>{g.titulo}</strong>
                <small>{notas ? `${num(notas)} nota${notas === 1 ? "" : "s"}` : `${num(doGrupo.length)} fornecedor${doGrupo.length === 1 ? "" : "es"}`} · {brl(doGrupo.reduce((s, a) => s + Number(a.valor ?? 0), 0))}</small>
              </span>
              <span className="cf-regra-imp">{imp > 0 ? <><b>{brl(imp)}</b><small>{g.id === "duplicada" ? "em risco" : "de diferença"}</small></> : null}</span>
              <span className="ip-seta" aria-hidden="true" />
            </button>
            {aberta && (
              <div className="cf-regra-corpo">
                <p className="cf-explica">{g.explica}</p>
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela cf-tabela">
                    <thead><tr><th>Fornecedor</th><th>Nota</th><th>Como está</th><th>Esperado</th><th className="n">Valor</th><th className="n">Diferença</th></tr></thead>
                    <tbody>
                      {doGrupo.map((a, k) => (
                        <tr key={`${a.chave ?? a.fornecedor}|${k}`}>
                          <td><strong>{a.fornecedor}</strong><small>{nomeEmpresa(a.empresa_cnpj)}</small></td>
                          <td>{a.chave
                            ? <><a href={`/api/notas/danfe/${a.chave}`} target="_blank" rel="noreferrer">Nº {a.numero}</a><small>{dia(a.emissao)}</small></>
                            : <small className="muted">{a.itens} ite{a.itens === 1 ? "m" : "ns"} · até {dia(a.emissao)}</small>}</td>
                          <td><small className="muted">{a.campo}{a.item ? ` · ${a.item}` : ""}</small>{a.atual ?? "—"}</td>
                          <td>{a.esperado ?? "—"}</td>
                          <td className="n">{brl(a.valor)}</td>
                          <td className="n">{a.impacto ? brl(a.impacto) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="cf-ok">
        <h3>Conferido sem problema</h3>
        <ul>
          {REGRAS.filter((g) => !r.achados.some((a) => a.regra === g.id)).map((g) => <li key={g.id}>{g.ok}</li>)}
        </ul>
      </section>
    </div>
  );
}
