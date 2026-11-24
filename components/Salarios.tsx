"use client";

// Aba "Folha e salários" do RH (refeita em 23/11/2026, prévia A escolhida pelo dono com os cartões das casas e a
// Folha do mês da prévia B). O salário de cada pessoa é o de hoje: o da folha do último mês (S-1200, rubrica 8781;
// view rh_salario_folha) quando é mais novo que o contrato (S-2200/S-2206), senão o de contrato (montarPessoas em
// lib/esocial/rh.ts). Líquido = S-1210 (view rh_pagamentos). Dado sensível: CPF e valores vêm escondidos e se mostram
// na barra "Privacidade" (os dois interruptores juntos, pedido do dono); o valor nunca sai desta tela (não vai para o conector).
// CSS num bloco só em globals.css ("Folha e salários", classes fs-*).
import { useMemo, useState } from "react";
import { cpfVisivel, dataBR, hoje, mesAnterior, nomeCurto, nomeMes, type EmpresaRH, type Folha, type Pessoa } from "@/lib/esocial/rh";
import { localDaUnidadeRH } from "@/lib/esocial/locais";

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
const titulo = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b(i{1,3}|iv)$/, (m) => m.toUpperCase()) : "");
const iniciais = (s: string) => s.split(/\s+/).filter((p) => p && !MINUSCULAS.has(p.toLowerCase())).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mil = (v: number) => (v >= 10000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : reais(v));
const soMes = (am: string) => nomeMes(am).split("/")[0];
const mesCurto = (am: string) => `${nomeMes(am).slice(0, 3)}/${am.slice(2, 4)}`;
const ESCONDIDO = "R$ •••••";
// Cores das casas (mesma ordem em toda a aba; tons que funcionam no claro e no escuro)
const CORES = ["#c9a463", "#7fa7c9", "#8cbf9a", "#b49ad6", "#d99a7c", "#7fc1bd", "#c98fa8"];
const FAIXAS: { rotulo: string; ate: number }[] = [
  { rotulo: "até 1,7", ate: 1700 }, { rotulo: "1,7–2", ate: 2000 }, { rotulo: "2–2,5", ate: 2500 }, { rotulo: "2,5–3", ate: 3000 },
  { rotulo: "3–4", ate: 4000 }, { rotulo: "4–6", ate: 6000 }, { rotulo: "6+", ate: Infinity },
];

type Linha = { p: Pessoa; local: string; salario: number | null };

function Interruptor({ ligado, onClick, rotulo, icone }: { ligado: boolean; onClick: () => void; rotulo: string; icone: "olho" | "real" }) {
  return (
    <button type="button" className={`fs-tg ${ligado ? "on" : ""}`} onClick={onClick} aria-pressed={ligado} title={ligado ? `Esconder ${rotulo}` : `Mostrar ${rotulo}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {icone === "olho" ? <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
          : <path d="M12 2v20M17 6.5a4 4 0 0 0-4-2.5H11a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5" />}
      </svg>
      {rotulo}<i className="fs-sw" aria-hidden="true" />
    </button>
  );
}

function Etapa({ ok, espera, texto }: { ok: boolean; espera?: boolean; texto: string }) {
  return <span className={`fs-st ${ok ? "ok" : espera ? "espera" : ""}`}><i>{ok ? "✓" : espera ? "…" : "·"}</i>{texto}</span>;
}

export default function Salarios({ pessoas, empresas, folhas, verCpf, onAlternarCpf, onAbrirPessoa, nomeEmpresa }: {
  pessoas: Pessoa[]; empresas: EmpresaRH[]; folhas: Folha[]; verCpf: boolean; onAlternarCpf: () => void;
  onAbrirPessoa: (chave: string) => void; nomeEmpresa: (id: string) => string;
}) {
  const [ver, setVer] = useState(false);
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");
  const termo = busca.trim().toLowerCase();
  const v = (n: number | null, curto = false) => (n == null ? "—" : ver ? (curto ? mil(n) : reais(n)) : ESCONDIDO);
  const escolher = (nome: string) => setLocal((atual) => (atual === nome ? "" : nome));

  // Só quem está na equipe (inclui férias e afastados); quem saiu (ou saiu do ponto) fica de fora
  const ativas: Linha[] = useMemo(() => pessoas.filter((p) => p.situacao !== "saiu" && p.situacao !== "saiu_ponto")
    .map((p) => ({ p, local: localDaUnidadeRH(p.unidade) || nomeCurto(empresas.find((e) => e.id === p.empresa_id)?.nome ?? "") || "Sem local", salario: p.salario ? Number(p.salario) : null })),
  [pessoas, empresas]);
  const locais = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const x of ativas) m.set(x.local, [...(m.get(x.local) ?? []), x]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([nome, l], i) => {
      const com = l.filter((x) => x.salario != null);
      const total = com.reduce((t, x) => t + x.salario!, 0);
      return { nome, linhas: l, com: com.length, total, media: com.length ? total / com.length : 0, cor: CORES[i % CORES.length] };
    });
  }, [ativas]);
  const corDe = (nome: string) => locais.find((l) => l.nome === nome)?.cor ?? CORES[0];

  // Números do topo (a casa escolhida filtra a lista, não o topo)
  const comSalario = ativas.filter((x) => x.salario != null);
  const total = comSalario.reduce((t, x) => t + x.salario!, 0);
  const media = comSalario.length ? total / comSalario.length : 0;
  const pelaFolha = comSalario.filter((x) => x.p.salarioFonte?.fonte === "folha");
  const mesFolha = pelaFolha.map((x) => x.p.salarioFonte!.mes!).sort().at(-1);
  const comLiquido = ativas.filter((x) => x.p.liquido);
  const mesLiquido = comLiquido.map((x) => x.p.liquido!.mes).sort().at(-1);
  const totalLiquido = comLiquido.filter((x) => x.p.liquido!.mes === mesLiquido).reduce((t, x) => t + x.p.liquido!.valor, 0);
  const faixas = FAIXAS.map((f, i) => ({ ...f, n: comSalario.filter((x) => x.salario! <= f.ate && (i === 0 || x.salario! > FAIXAS[i - 1].ate)).length }));
  const maxFaixa = Math.max(1, ...faixas.map((f) => f.n));

  // Folha do mês: a competência mais nova de cada empresa, com a anterior em uma linha
  const competencias = [...new Set(folhas.map((f) => f.competencia))].sort().reverse();
  const ultima = competencias[0];
  const folhasUltimas = folhas.filter((f) => f.competencia === ultima);
  const fechadas = folhasUltimas.filter((f) => f.fechada != null).length;
  const noPrazo = ultima === mesAnterior() && Number(hoje().slice(8, 10)) <= 15;

  // Lista
  const vistas = ativas.filter((x) => !local || x.local === local)
    .filter((x) => !termo || x.p.nome.toLowerCase().includes(termo) || x.p.cargo.toLowerCase().includes(termo));
  const maxSalario = Math.max(1, ...vistas.map((x) => x.salario ?? 0));

  return (
    <div className="fs">
      <div className="fs-priv" role="group" aria-label="Privacidade">
        <span className="fs-priv-rot">Privacidade</span>
        <Interruptor ligado={verCpf} onClick={onAlternarCpf} rotulo="CPF" icone="olho" />
        <Interruptor ligado={ver} onClick={() => setVer((x) => !x)} rotulo="Valores" icone="real" />
      </div>

      {/* Topo: soma dos salários, líquido, média, folhas fechadas e a divisão por casa · faixas salariais */}
      <div className="fs-hero">
        <section className="fs-card fs-soma">
          <span className="fs-eyebrow">Soma dos salários de hoje</span>
          <strong className="fs-grande">{v(total)}</strong>
          <span className="muted">{comSalario.length} de {ativas.length} pessoas
            {pelaFolha.length > 0 && <> · {pelaFolha.length} pela folha{mesFolha ? ` de ${soMes(mesFolha)}` : ""}</>}
            {comSalario.length - pelaFolha.length > 0 && <> · {comSalario.length - pelaFolha.length} pelo contrato</>}</span>
          <div className="fs-sub">
            <div><b>{v(mesLiquido ? totalLiquido : null)}</b><small>{mesLiquido ? `líquido pago em ${soMes(mesLiquido)}` : "nenhum pagamento lido"}</small></div>
            <div><b>{v(comSalario.length ? media : null)}</b><small>salário médio</small></div>
            {ultima && <div><b className={fechadas === folhasUltimas.length ? "fs-ok" : noPrazo ? "" : "fs-ruim"}>{fechadas === folhasUltimas.length ? "✓ " : ""}{fechadas} de {folhasUltimas.length}</b>
              <small>folhas de {soMes(ultima)} fechadas</small></div>}
          </div>
          <div className="fs-pilha" aria-hidden="true">
            {locais.map((l) => <i key={l.nome} style={{ flex: Math.max(l.total, 1), background: l.cor }} />)}
          </div>
          <div className="fs-legenda">
            {locais.map((l) => (
              <button key={l.nome} type="button" className={local === l.nome ? "on" : ""} onClick={() => escolher(l.nome)}>
                <i style={{ background: l.cor }} />{l.nome}<b>{ver ? mil(l.total) : `${l.linhas.length} pessoas`}</b>
              </button>
            ))}
          </div>
        </section>
        <section className="fs-card fs-faixas">
          <span className="fs-eyebrow">Faixa salarial · pessoas</span>
          <small className="muted">em mil reais por mês</small>
          <div className="fs-hist">
            {faixas.map((f) => (
              <div key={f.rotulo} className="fs-hist-col" title={`${f.n} pessoa${f.n === 1 ? "" : "s"} · ${f.rotulo} mil`}>
                <span className="fs-hist-n">{f.n || ""}</span>
                <i style={{ height: `${(f.n / maxFaixa) * 100}%` }} />
                <span className="fs-hist-r">{f.rotulo}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Cartões das casas (da prévia B): clicar filtra a lista */}
      <div className="fs-casas">
        {locais.map((l, i) => {
          const ordenados = l.linhas.map((x) => x.salario ?? 0).sort((a, b) => b - a).slice(0, 18);
          const maxL = Math.max(1, ...ordenados);
          const cob = Math.round((l.com / l.linhas.length) * 100);
          return (
            <button key={l.nome} type="button" className={`fs-casa ${local === l.nome ? "on" : ""}`} style={{ ["--c" as string]: l.cor, animationDelay: `${i * 50}ms` }}
              onClick={() => escolher(l.nome)} aria-pressed={local === l.nome}>
              <span className="fs-casa-cab"><b>{l.nome}</b><span>{l.linhas.length} pessoa{l.linhas.length === 1 ? "" : "s"}</span></span>
              <strong>{v(l.total, true)}</strong>
              <small>média {v(l.com ? l.media : null)}</small>
              <span className="fs-mini" aria-hidden="true">{ordenados.map((s, j) => <i key={j} style={{ height: `${Math.max(8, (s / maxL) * 100)}%` }} />)}</span>
              <span className="fs-cob" aria-hidden="true"><i style={{ width: `${cob}%` }} /></span>
              <small>{cob}% com salário{l.com < l.linhas.length ? ` · faltam ${l.linhas.length - l.com}` : ""}</small>
            </button>
          );
        })}
      </div>

      {/* Folha do mês (da prévia B): cada empresa em etapas — fechada pelo contador → INSS → FGTS */}
      {folhasUltimas.length > 0 && (
        <section className="fs-card fs-folhas">
          <div className="fs-sec-cab">
            <h3>Folha de {nomeMes(ultima)}</h3>
            <small className="muted">O contador envia e fecha a folha até o dia 15; depois saem as guias do INSS (DCTFWeb) e do FGTS (FGTS Digital), que vencem no dia 20.</small>
          </div>
          <div className="fs-emps">
            {folhasUltimas.map((f) => {
              const anterior = folhas.find((x) => x.empresa_id === f.empresa_id && x.competencia === competencias[1]);
              const fechou = f.fechada != null;
              return (
                <div key={f.empresa_id} className="fs-emp">
                  <div className="fs-emp-cab"><b>{nomeEmpresa(f.empresa_id)}</b>
                    <small className={fechou ? "fs-ok" : noPrazo || !f.consultada ? "muted" : "fs-ruim"}>
                      {fechou ? `fechada${f.fechada ? ` em ${dataBR(f.fechada)}` : ""}` : !f.consultada ? "ainda não lida" : noPrazo ? "prazo até o dia 15" : "não vimos o fechamento"}
                    </small>
                  </div>
                  <div className="fs-steps">
                    <Etapa ok={fechou} espera={!fechou && noPrazo} texto="Fechada" /><span className={`fs-ln ${fechou ? "ok" : ""}`} />
                    <Etapa ok={f.inss} espera={fechou && !f.inss} texto="INSS" /><span className={`fs-ln ${f.inss ? "ok" : ""}`} />
                    <Etapa ok={f.fgts} espera={fechou && !f.fgts} texto="FGTS" />
                  </div>
                  {f.lidas > 0 && (
                    <small className={f.semFolha.length ? "fs-ruim" : "muted"}>
                      Folha individual de {f.lidas - f.semFolha.length} de {f.lidas}
                      {f.semFolha.length > 0 && <> · faltam {f.semFolha.slice(0, 2).map((p, j) => (
                        <span key={p.chave}>{j ? ", " : ""}<button type="button" className="es-link" onClick={() => onAbrirPessoa(p.chave)}>{p.nome ? nomeProprio(p.nome).split(" ")[0] : "sem nome"}</button></span>
                      ))}{f.semFolha.length > 2 ? ` e mais ${f.semFolha.length - 2}` : ""}</>}
                    </small>
                  )}
                  {anterior && <small className="muted fs-emp-ant">{nomeMes(anterior.competencia)}: {anterior.fechada != null ? "✓ fechada" : "não vimos o fechamento"}{anterior.inss ? " · INSS" : ""}{anterior.fgts ? " · FGTS" : ""}</small>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Lista (da prévia A) */}
      <section className="fs-card fs-lista">
        <div className="fs-lista-cab">
          <h3>Salário por pessoa</h3>
          <div className="fs-chips" role="group" aria-label="Casa">
            <button type="button" className={local === "" ? "on" : ""} onClick={() => setLocal("")}>Todas as casas</button>
            {locais.map((l) => <button key={l.nome} type="button" className={local === l.nome ? "on" : ""} onClick={() => setLocal(l.nome)}>{l.nome}</button>)}
          </div>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou cargo" aria-label="Buscar por nome ou cargo" />
        </div>
        {vistas.length === 0 ? <p className="muted fs-nada">Ninguém neste filtro.</p> : (
          <>
            <div className="fs-row fs-row-cab" aria-hidden="true"><span /><span>Pessoa</span><span>Cargo</span><span>Salário</span><span>Líquido</span><span>Fonte</span></div>
            {locais.filter((l) => !local || l.nome === local).map((l) => {
              const doLocal = vistas.filter((x) => x.local === l.nome).sort((a, b) => (b.salario ?? -1) - (a.salario ?? -1) || a.p.nome.localeCompare(b.p.nome));
              if (!doLocal.length) return null;
              const soma = doLocal.reduce((t, x) => t + (x.salario ?? 0), 0);
              const lidos = doLocal.filter((x) => x.salario != null).length;
              return (
                <div key={l.nome} className="fs-grupo">
                  <div className="fs-grupo-cab"><span><i style={{ background: corDe(l.nome) }} />{l.nome} · {doLocal.length}</span>
                    <span>{ver ? mil(soma) : ESCONDIDO} · {lidos} de {doLocal.length} com salário</span></div>
                  {doLocal.map((x) => {
                    const f = x.p.salarioFonte;
                    return (
                      <button key={x.p.chave} type="button" className="fs-row" onClick={() => onAbrirPessoa(x.p.chave)} title="Ver a ficha">
                        <span className="fs-av" style={{ color: corDe(l.nome) }}>{iniciais(x.p.nome || "?")}</span>
                        <span className="fs-nm"><b>{x.p.nome ? nomeProprio(x.p.nome) : "Nome ainda não lido"}</b><small>{cpfVisivel(x.p.cpf, verCpf)}</small></span>
                        <span className="fs-cargo">{titulo(x.p.cargo) || "—"}</span>
                        <span className="fs-bar">{ver && x.salario != null && <i style={{ width: `${Math.max(4, (x.salario / maxSalario) * 100)}%` }} />}<b className={x.salario == null ? "muted" : ""}>{v(x.salario)}</b></span>
                        <span className="fs-liq" title={x.p.liquido ? `Líquido de ${nomeMes(x.p.liquido.mes)}` : "Nenhum pagamento lido"}>
                          {v(x.p.liquido?.valor ?? null)}{x.p.liquido && <small>{nomeMes(x.p.liquido.mes).slice(0, 3)}</small>}
                        </span>
                        <span>{f ? <span className={`fs-tag ${f.fonte}`} title={f.fonte === "folha" ? `Salário da folha de ${nomeMes(f.mes!)}${f.proporcional ? " (mês incompleto, levado a 30 dias)" : ""}` : `Salário de contrato${x.p.salarioContratoDesde ? ` desde ${dataBR(x.p.salarioContratoDesde)}` : ""}`}>
                          {f.fonte === "folha" ? `folha ${mesCurto(f.mes!)}` : "contrato"}</span> : <span className="fs-tag">não lido</span>}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
        <p className="muted fs-nota">Salário = o de hoje: o da folha do último mês que o contador mandou ao eSocial (salário do mês; num mês incompleto, levado a 30 dias) e, quando a folha ainda não foi lida ou é mais velha, o de contrato (admissão ou alteração). Líquido = o que foi pago no último mês, sem férias, 13º e rescisão. Os valores não saem desta tela: o conector do Claude não tem acesso a eles.</p>
      </section>
    </div>
  );
}
