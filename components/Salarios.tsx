"use client";

// Seção Salários do RH: o salário de hoje de cada pessoa — o da folha do último mês (S-1200, rubrica 8781; view
// rh_salario_folha, desde 23/11/2026) quando é mais novo que o contrato (último S-2200/S-2206), senão o de contrato — e o
// líquido pago no último mês (S-1210, view rh_pagamentos; desde 10/11/2026), agrupados por local, com totais. Dado sensível: vem escondido e só aparece com o olhinho,
// e o valor nunca sai desta tela (não vai para o conector).
import { useState, type ReactNode } from "react";
import { cpfVisivel, dataBR, nomeCurto, nomeMes, type EmpresaRH, type Pessoa } from "@/lib/esocial/rh";
import { localDaUnidadeRH } from "@/lib/esocial/locais";

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const titulo = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b(i{1,3}|iv)$/, (m) => m.toUpperCase()) : "");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ESCONDIDO = "R$ •••••";

export default function Salarios({ pessoas, empresas, verCpf, onAbrirPessoa, icone }: {
  pessoas: Pessoa[]; empresas: EmpresaRH[]; verCpf: boolean; onAbrirPessoa: (chave: string) => void; icone: (nome: string) => ReactNode;
}) {
  const [ver, setVer] = useState(false);
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");
  const termo = busca.trim().toLowerCase();

  // Só quem está na equipe (inclui férias e afastados); quem saiu (ou saiu do ponto) fica de fora
  const ativas = pessoas.filter((p) => p.situacao !== "saiu" && p.situacao !== "saiu_ponto")
    .map((p) => ({ p, local: localDaUnidadeRH(p.unidade) || nomeCurto(empresas.find((e) => e.id === p.empresa_id)?.nome ?? ""), salario: p.salario ? Number(p.salario) : null }));
  const locais = [...new Set(ativas.map((x) => x.local || "Sem local"))].sort();
  const vistas = ativas.filter((x) => !local || (x.local || "Sem local") === local)
    .filter((x) => !termo || x.p.nome.toLowerCase().includes(termo) || x.p.cargo.toLowerCase().includes(termo));
  const comSalario = vistas.filter((x) => x.salario != null);
  const total = comSalario.reduce((t, x) => t + x.salario!, 0);
  const media = comSalario.length ? total / comSalario.length : 0;
  const comLiquido = vistas.filter((x) => x.p.liquido);
  const totalLiquido = comLiquido.reduce((t, x) => t + x.p.liquido!.valor, 0);
  const mesLiquido = comLiquido.map((x) => x.p.liquido!.mes).sort().at(-1);
  const valor = (v: number | null) => (v == null ? "—" : ver ? reais(v) : ESCONDIDO);

  return (
    <>
      <div className="es-numeros">
        <div className="es-numero"><span className="tv-cartao-rotulo">Soma dos salários</span><span className="es-numero-valor">{ver ? reais(total) : ESCONDIDO}</span><span className="tv-cartao-detalhe">salário de hoje · {comSalario.length} pessoas</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Líquido pago</span><span className="es-numero-valor">{ver ? reais(totalLiquido) : ESCONDIDO}</span><span className="tv-cartao-detalhe">{mesLiquido ? `último mês pago (${nomeMes(mesLiquido)}) · ${comLiquido.length} pessoas` : "nenhum pagamento lido ainda"}</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Salário médio</span><span className="es-numero-valor">{ver ? reais(media) : ESCONDIDO}</span><span className="tv-cartao-detalhe">entre quem já tem o salário lido</span></div>
        <div className="es-numero"><span className="tv-cartao-rotulo">Salários lidos</span><span className="es-numero-valor">{comSalario.length} de {vistas.length}</span><span className="tv-cartao-detalhe">{comSalario.filter((x) => x.p.salarioFonte?.fonte === "folha").length} pela folha do mês · {comSalario.filter((x) => x.p.salarioFonte?.fonte === "contrato").length} pelo contrato</span></div>
      </div>

      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>{icone("salario")}Salário por pessoa</h2>
          <button className="ghost small es-olho" onClick={() => setVer((v) => !v)} aria-pressed={ver}>{ver ? "Esconder valores" : "Mostrar valores"}</button>
        </div>
        <div className="es-filtros">
          <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome ou cargo" aria-label="Buscar" />
          {locais.length > 1 && (
            <div className="tv-unidades" role="group" aria-label="Local">
              <button className={local === "" ? "botao-painel on" : "botao-painel"} onClick={() => setLocal("")}>Todos os locais</button>
              {locais.map((u) => (
                <button key={u} className={local === u ? "botao-painel on" : "botao-painel"} onClick={() => setLocal(u)}>
                  {u} <span className="muted">{ativas.filter((x) => (x.local || "Sem local") === u).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {vistas.length === 0 ? (
          <p className="muted tv-nada">Ninguém neste filtro.</p>
        ) : (
          <>
            <div className="bh-cabeca sl-cabeca" aria-hidden="true"><span>Pessoa</span><span>Cargo</span><span>Salário</span><span>Líquido</span><span>Fonte</span></div>
            <ul className="bh-lista">
              {locais.filter((g) => !local || g === local).map((g) => {
                const do_ = vistas.filter((x) => (x.local || "Sem local") === g).sort((a, b) => (b.salario ?? -1) - (a.salario ?? -1) || a.p.nome.localeCompare(b.p.nome));
                if (!do_.length) return null;
                const soma = do_.reduce((t, x) => t + (x.salario ?? 0), 0);
                const lidos = do_.filter((x) => x.salario != null).length;
                return (
                  <li key={g} className="sl-grupo-wrap">
                    <div className="bh-grupo"><span>{g} <span className="muted">· {do_.length}</span></span><span className="muted">{lidos ? `${ver ? reais(soma) : ESCONDIDO} · ${lidos} de ${do_.length} lidos` : "nenhum salário lido ainda"}</span></div>
                    <ul className="bh-lista">
                      {do_.map((x) => {
                        const f = x.p.salarioFonte;
                        return (
                          <li key={x.p.chave}>
                            <button className="bh-linha sl-linha" onClick={() => onAbrirPessoa(x.p.chave)} title="Ver a ficha">
                              <span className="bh-nome"><strong>{x.p.nome ? nomeProprio(x.p.nome) : "Nome ainda não lido"}</strong><span className="muted">{cpfVisivel(x.p.cpf, verCpf)}</span></span>
                              <span className="sl-cargo muted">{titulo(x.p.cargo) || "—"}</span>
                              <span className={`bh-saldo ${x.salario == null ? "muted" : ""}`}>{valor(x.salario)}</span>
                              <span className={`bh-saldo sl-liquido ${x.p.liquido ? "" : "muted"}`} title={x.p.liquido ? `Líquido de ${nomeMes(x.p.liquido.mes)}` : "Nenhum pagamento lido"}>
                                {valor(x.p.liquido?.valor ?? null)}{x.p.liquido && <small>{nomeMes(x.p.liquido.mes).slice(0, 3)}</small>}
                              </span>
                              <span className="bh-var" title={f?.fonte === "folha" ? `Salário da folha de ${nomeMes(f.mes!)}${f.proporcional ? " (mês incompleto, levado a 30 dias)" : ""}` : f ? "Salário de contrato (admissão ou última alteração)" : "Sem folha nem contrato lidos"}>
                                {f?.fonte === "folha" ? `folha ${nomeMes(f.mes!).slice(0, 3)}/${f.mes!.slice(2, 4)}` : f ? `contrato ${dataBR(x.p.salarioContratoDesde)}` : "não lido"}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="muted es-nota">Salário = o salário de hoje: o da folha do último mês que o contador mandou ao eSocial (S-1200, salário do mês; num mês incompleto, levado a 30 dias) e, quando a folha ainda não foi lida ou é mais velha, o de contrato (admissão S-2200 ou alteração S-2206). Os reajustes do mínimo e da convenção quase nunca chegam como alteração de contrato: por isso vale a folha. Líquido = o que foi pago no último mês de referência (pagamentos do S-1210, com horas extras, adicionais e descontos), sem férias, 13º e rescisão.
          Os valores não saem desta tela: o conector do Claude não tem acesso a eles.</p>
      </section>
    </>
  );
}
