"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Conferência fiscal das NFC-e (aba NFC-e → "Conferência fiscal"; supabase/nfce_conferencia.sql, 22/11/2026).
// Confere, por produto, todos os itens das NFC-e autorizadas do mês: CFOP × CST, alíquota de ICMS entre as casas, NCM,
// taxas tributadas, PIS/Cofins das bebidas monofásicas, cClassTrib da reforma. Regras fixas, sem IA, sempre com os dados
// do momento (as notas chegam a cada minuto). As decisões da contabilidade ficam em nfce_conferencia_regras: enquanto
// estão "a definir", a conferência aponta a inconsistência; decididas, ela cobra o valor.
type Achado = {
  regra: string; sev: "erro" | "atencao"; unidade_id: string; cod: string | null; nome: string; campo: string;
  atual: string | null; esperado: string | null; itens: number; notas: number; valor: number; impacto: number | null;
  sentido: "pago" | "a_menos" | null; exemplo: number | null;
};
type Regra = { chave: string; nome: string; valor: string | null; decisao: string | null; definido_por: string | null; definido_em: string | null };
type Resultado = { de: string; ate: string; itens: number; produtos: number; achados: Achado[]; regras: Regra[] };

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number) => Number(v).toLocaleString("pt-BR");

// As regras na ordem em que aparecem, com o que cada uma confere
const REGRAS: { id: string; titulo: string; explica: string; ok?: string }[] = [
  { id: "taxa_tributada", titulo: "Taxa de serviço tributada", explica: "A taxa de serviço (gorjeta) sai com ICMS, PIS e Cofins. Pela Lei 13.419/2017 ela é dos empregados, e a gorjeta costuma ficar fora da base. O impacto é o imposto pago sobre a taxa no mês.", ok: "Taxa de serviço sem imposto" },
  { id: "aliq_casas", titulo: "Bebida alcoólica com alíquota de ICMS diferente entre as casas", explica: "A mesma empresa cobra alíquotas diferentes de ICMS na bebida alcoólica em cada casa. Uma das duas está errada: se for a menor, há ICMS recolhido a menos (risco de autuação).", ok: "Bebida alcoólica com a mesma alíquota nas casas" },
  { id: "taxa_ncm", titulo: "Taxa cadastrada com NCM de mercadoria", explica: "Taxa de serviço e taxa de rolha não são mercadoria, mas estão cadastradas com NCM de produto (vinho, copo de vidro, preparação alimentícia).", ok: "Taxas sem NCM de mercadoria" },
  { id: "cclass_vazio", titulo: "Itens sem classificação da reforma (cClassTrib vazio)", explica: "Parte dos itens sai com o grupo IBS/CBS sem CST e sem cClassTrib, às vezes o mesmo produto que em outra nota sai preenchido. Parece falha do caixa: vale a partir de 2027.", ok: "Todo item com cClassTrib" },
  { id: "pis_monofasico", titulo: "PIS/Cofins pago em bebida monofásica", explica: "Água, refrigerante e cerveja já têm PIS/Cofins pago pelo fabricante: o restaurante não paga de novo (CST 04 ou 06).", ok: "Água, refrigerante e cerveja sem PIS/Cofins" },
  { id: "cst_cfop", titulo: "CST que não combina com o CFOP", explica: "Tributado (CST 000) deve sair com CFOP 5102; substituição tributária (CST 060) com 5405.", ok: "CST combinando com o CFOP" },
  { id: "icms_conta", titulo: "Conta do ICMS errada", explica: "Base × alíquota diferente do ICMS destacado na nota.", ok: "Conta do ICMS certa (base × alíquota)" },
  { id: "aliq_cafe", titulo: "Café e chá com alíquota diferente da comida", explica: "Café e chá saem com alíquota de ICMS diferente da comida da mesma casa.", ok: "Café e chá com a alíquota da comida" },
  { id: "ncm_prato", titulo: "Prato pronto com NCM de ingrediente", explica: "Pratos de restaurante cadastrados com NCM de ingrediente (legume congelado, pão, massa crua, carne preparada). Na reforma, benefícios saem por NCM.", ok: "Pratos com NCM de prato pronto" },
  { id: "ncm_casas", titulo: "Mesmo produto com NCM diferente entre as casas", explica: "O mesmo produto (mesmo nome) tem NCM diferente no Cicchetti Pipa e no Filha da Lua.", ok: "Mesmo NCM para o mesmo produto nas casas" },
  { id: "variacao", titulo: "Produto com classificação variando", explica: "Na mesma casa, o mesmo produto saiu com NCM, CST, CFOP ou alíquota diferentes em notas diferentes.", ok: "Cada produto com uma classificação só" },
  { id: "unidade", titulo: "Prato com unidade CX (caixa)", explica: "Prato vendido em porção cadastrado com unidade de caixa.", ok: "Pratos com unidade certa" },
  { id: "cclass_restaurante", titulo: "Comida fora da classificação de restaurante", explica: "A tabela oficial da Receita tem o cClassTrib 200047 (bares e restaurantes, 40% de redução de CBS e IBS a partir de 2027). A confirmar com a contabilidade.", ok: "Comida na classificação de restaurante" },
  { id: "cclass_casas", titulo: "cClassTrib diferente entre as casas", explica: "O mesmo produto tem classificação da reforma diferente em cada casa.", ok: "Mesmo cClassTrib nas casas" },
  { id: "cclass_gorjeta", titulo: "Taxa de serviço fora do 410019", explica: "Na reforma, a gorjeta no fornecimento de alimentação tem classificação própria (410019) para ficar fora da base do IBS/CBS.", ok: "Taxa de serviço no 410019" },
];

// Como resolver cada achado: o que mudar no cadastro do produto no Chef Web (parte de tributação / regra fiscal).
// Onde a decisão é da contabilidade, a instrução diz isso: o Brasico só lê a TOTVS, não altera o cadastro.
export const COMO_RESOLVER: Record<string, string> = {
  taxa_tributada: "No cadastro da taxa de serviço, deixar o ICMS não tributado e o PIS/Cofins sem incidência, como a contabilidade definir (a gorjeta é dos empregados, Lei 13.419/2017).",
  taxa_ncm: "Tirar da taxa o NCM de mercadoria; usar o código que a contabilidade indicar para serviço.",
  aliq_casas: "Igualar a alíquota de ICMS da bebida alcoólica nas duas casas, na alíquota que a contabilidade confirmar.",
  aliq_cafe: "Usar no café e no chá a mesma alíquota de ICMS da comida, se a contabilidade confirmar.",
  ncm_casas: "Usar o mesmo NCM para o mesmo produto nas duas casas.",
  ncm_prato: "Trocar o NCM de ingrediente pelo NCM de prato pronto que a contabilidade indicar.",
  unidade: "Trocar a unidade CX (caixa) por UN ou porção.",
  cst_cfop: "Ajustar o CFOP ao CST: tributado (CST 000) com CFOP 5102; substituição tributária (CST 060) com CFOP 5405.",
  icms_conta: "Revisar a regra fiscal do produto: base × alíquota não bate com o ICMS que sai na nota.",
  pis_monofasico: "Água, refrigerante e cerveja: PIS/Cofins com CST 04 (monofásico), sem imposto na venda.",
  variacao: "O produto sai com classificações diferentes em vendas diferentes: deixar uma só no cadastro (e conferir regra fiscal por caixa).",
  cclass_vazio: "Preencher o CST e o cClassTrib do IBS/CBS no cadastro do produto (vale a partir de 2027).",
  cclass_restaurante: "Comida: cClassTrib 200047 (bares e restaurantes), a confirmar com a contabilidade.",
  cclass_casas: "Usar o mesmo cClassTrib para o mesmo produto nas duas casas.",
  cclass_gorjeta: "Taxa de serviço: cClassTrib 410019 (gorjeta fora da base do IBS/CBS).",
};

export default function ConferenciaFiscal({ mes, fimMes, unidade, nomeUnidade }: {
  mes: string; fimMes: string; unidade: string; nomeUnidade: Record<string, string>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [soErros, setSoErros] = useState(false);
  const [busca, setBusca] = useState("");
  const [abertas, setAbertas] = useState<Record<string, boolean>>({ taxa_tributada: true, aliq_casas: true, taxa_ncm: true });

  useEffect(() => {
    if (!mes || !fimMes) return;
    setR(null); setErro("");
    const ultimo = new Date(new Date(`${fimMes}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10);
    supabase.rpc("nfce_conferencia", { p_de: `${mes}-01`, p_ate: ultimo, p_unidade: unidade || null }).then(({ data, error }) => {
      if (error) setErro(error.message); else setR(data as Resultado);
    });
  }, [supabase, mes, fimMes, unidade]);

  if (erro) return <p className="es-aviso">Não deu para rodar a conferência: {erro}</p>;
  if (!r) return <p className="muted">Conferindo os itens das notas do mês…</p>;

  const t = busca.trim().toLowerCase();
  const lista = r.achados.filter((a) => (!soErros || a.sev === "erro") && (!t || a.nome.toLowerCase().includes(t) || (a.cod ?? "").includes(t)));
  const erros = r.achados.filter((a) => a.sev === "erro");
  const pago = r.achados.filter((a) => a.sentido === "pago").reduce((s, a) => s + Number(a.impacto ?? 0), 0);
  const aMenos = r.achados.filter((a) => a.sentido === "a_menos").reduce((s, a) => s + Number(a.impacto ?? 0), 0);
  const aDefinir = r.regras.filter((x) => !x.valor).length;
  // Produtos distintos (o mesmo produto pode cair em mais de uma regra)
  const chave = (a: Achado) => `${a.unidade_id}|${a.cod ?? a.nome}`;
  const prodErro = new Set(erros.map(chave));
  const prodAtencao = new Set(r.achados.filter((a) => a.sev === "atencao" && !prodErro.has(chave(a))).map(chave));

  function planilha() {
    const linhas = [["Regra", "Severidade", "Casa", "Código", "Produto", "Campo", "Como está", "Esperado", "Itens", "Notas", "Vendido", "Impacto", "Sentido", "Nota exemplo"]];
    for (const a of lista) {
      linhas.push([REGRAS.find((x) => x.id === a.regra)?.titulo ?? a.regra, a.sev, nomeUnidade[a.unidade_id] ?? a.unidade_id, a.cod ?? "", a.nome, a.campo,
        a.atual ?? "", a.esperado ?? "", String(a.itens), String(a.notas), String(a.valor).replace(".", ","), a.impacto == null ? "" : String(a.impacto).replace(".", ","),
        a.sentido === "pago" ? "pago a mais" : a.sentido === "a_menos" ? "a menos" : "", a.exemplo == null ? "" : String(a.exemplo)]);
    }
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `conferencia-fiscal-nfce-${mes}${unidade ? `-${unidade}` : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cf">
      <dl className="nc-numeros">
        <div><dt>Produtos com erro</dt><dd className={prodErro.size ? "cf-ruim" : ""}>{num(prodErro.size)}</dd><small>{num(erros.length)} achados de erro</small></div>
        <div><dt>Só com atenção</dt><dd>{num(prodAtencao.size)}</dd><small>produtos a conferir com a contabilidade</small></div>
        <div><dt>Pago a mais (estimado)</dt><dd>{brl(pago)}</dd><small>no mês, nos itens com problema</small></div>
        <div><dt>Possível a menos</dt><dd className={aMenos > 0 ? "cf-ruim" : ""}>{brl(aMenos)}</dd><small>risco se a alíquota maior for a certa</small></div>
      </dl>
      <p className="nc-explica cf-escopo">
        Conferidos {num(r.itens)} itens de {num(r.produtos)} produtos das NFC-e autorizadas de {new Date(`${r.de}T12:00:00`).toLocaleDateString("pt-BR")} a{" "}
        {new Date(`${r.ate}T12:00:00`).toLocaleDateString("pt-BR")}{unidade ? ` (${nomeUnidade[unidade] ?? unidade})` : ""}. A conferência roda de novo sempre que a tela abre, com as notas que acabaram de chegar.
      </p>

      <section className="cf-decisoes">
        <header><h3>Decisões da contabilidade</h3><span>{aDefinir ? `${aDefinir} a definir` : "todas definidas"}</span></header>
        <ul>
          {r.regras.map((x) => (
            <li key={x.chave} className={x.valor ? "ok" : "falta"}>
              <span className="cf-dec-nome">{x.nome}</span>
              <span className="cf-dec-valor">{x.valor ? <b>{x.valor}</b> : "a definir"}</span>
              {x.decisao && <small>{x.decisao}{x.definido_por ? ` · ${x.definido_por}` : ""}{x.definido_em ? ` · ${new Date(`${x.definido_em}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}</small>}
            </li>
          ))}
        </ul>
      </section>

      <div className="nc-barra">
        <h2>O que a conferência achou</h2>
        <div className="cf-acoes">
          <label className="cf-so"><input type="checkbox" checked={soErros} onChange={(e) => setSoErros(e.target.checked)} /> Só os erros</label>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou código" aria-label="Buscar produto" />
          <button className="ghost small" onClick={planilha}>Baixar planilha</button>
        </div>
      </div>

      {REGRAS.map((g) => {
        const doGrupo = lista.filter((a) => a.regra === g.id);
        const todos = r.achados.filter((a) => a.regra === g.id);
        if (!todos.length) return null;
        if (!doGrupo.length) return null;
        const sev = todos.some((a) => a.sev === "erro") ? "erro" : "atencao";
        const imp = doGrupo.reduce((s, a) => s + Number(a.impacto ?? 0), 0);
        const aberta = abertas[g.id] ?? false;
        return (
          <section key={g.id} className={`cf-regra cf-${sev}${aberta ? " aberta" : ""}`}>
            <button className="cf-regra-cabeca" onClick={() => setAbertas((x) => ({ ...x, [g.id]: !aberta }))} aria-expanded={aberta}>
              <span className="cf-sev">{sev === "erro" ? "Erro" : "Atenção"}</span>
              <span className="cf-regra-titulo"><strong>{g.titulo}</strong><small>{num(doGrupo.length)} produto{doGrupo.length === 1 ? "" : "s"} · {num(doGrupo.reduce((s, a) => s + a.itens, 0))} itens</small></span>
              <span className="cf-regra-imp">{imp > 0 ? <><b>{brl(imp)}</b><small>impacto no mês</small></> : null}</span>
              <span className="ip-seta" aria-hidden="true" />
            </button>
            {aberta && (
              <div className="cf-regra-corpo">
                <p className="cf-explica">{g.explica}</p>
                {COMO_RESOLVER[g.id] && <p className="cf-resolver"><b>Como resolver:</b> {COMO_RESOLVER[g.id]}</p>}
                <div className="nf-tabela-wrap">
                  <table className="nf-tabela cf-tabela">
                    <thead><tr><th>Casa</th><th>Produto</th><th>Como está</th><th>Esperado</th><th className="n">Itens</th><th className="n">Vendido</th><th className="n">Impacto</th><th className="n">Nota exemplo</th></tr></thead>
                    <tbody>
                      {doGrupo.map((a, k) => (
                        <tr key={`${a.unidade_id}|${a.cod}|${k}`}>
                          <td>{nomeUnidade[a.unidade_id] ?? a.unidade_id}</td>
                          <td><strong>{a.nome}</strong>{a.cod && <small>cód. {a.cod}</small>}</td>
                          <td><small className="muted">{a.campo}</small>{a.atual ?? "—"}</td>
                          <td>{a.esperado ?? "—"}</td>
                          <td className="n">{num(a.itens)}</td>
                          <td className="n">{brl(a.valor)}</td>
                          <td className="n">{a.impacto ? <>{brl(a.impacto)}<small className={a.sentido === "a_menos" ? "cf-ruim" : "muted"}>{a.sentido === "a_menos" ? "a menos" : "pago a mais"}</small></> : "—"}</td>
                          <td className="n">{a.exemplo ?? "—"}</td>
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
          {REGRAS.filter((g) => !r.achados.some((a) => a.regra === g.id)).map((g) => <li key={g.id}>{g.ok ?? g.titulo}</li>)}
        </ul>
      </section>
    </div>
  );
}
