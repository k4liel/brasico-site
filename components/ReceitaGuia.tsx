"use client";

import { useEffect, useMemo, useState } from "react";
import { renderConteudo } from "@/lib/livre";
import { IDIOMAS, ehIdioma, type Idioma } from "@/lib/idioma";

// Peças da área da Receita que vêm do banco e não de uma consulta ao governo:
// o acervo fiscal (capítulos copiados do antigo projeto "Organograma Fiscal Brasico", supabase/receita_acervo.sql),
// o mapa de acessos (fiscal_fontes), o catálogo do Integra Contador (receita_servicos) e as rotinas (receita_rotinas),
// em supabase/receita_mapa.sql. O conteúdo fica só no banco: o repositório é público.

export type Capitulo = {
  id: string; secao: string; ordem: number; titulo: string; conteudo: string; atualizado_na_origem: string | null;
  titulo_en: string | null; conteudo_en: string | null; titulo_pl: string | null; conteudo_pl: string | null;
  titulo_fr: string | null; conteudo_fr: string | null; titulo_de: string | null; conteudo_de: string | null;
};
export type Fonte = { id: string; area: string; nome: string; o_que_da: string; situacao: string; como: string; falta: string; custo: string; prioridade: string; onde: string; ordem: number };
export type Servico = { id_sistema: string; id_servico: string; endpoint: string; grupo: string; nome: string; para_que: string; aplica: string; situacao: string; rotina: string; conferido: boolean; ordem: number };
export type Rotina = { id: string; nome: string; o_que_faz: string; quando: string; custo_mes_empresa: string; ligada: boolean; ordem: number; ultima_vez: string | null };
export type Evento = { empresa_id: string; evento: string; atualizado_em: string | null; lido_em: string };

const TZ = "America/Sao_Paulo";
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

// ---------------------------------------------------------------------
// Acervo: os capítulos de uma seção, com a escolha do capítulo e do idioma
// ---------------------------------------------------------------------
const tituloLimpo = (t: string) => t.replace(/^\s*\d+\s*·\s*/, "");
function textoNoIdioma(c: Capitulo, idioma: Idioma): { titulo: string; conteudo: string; traduzido: boolean } {
  if (idioma === "pt") return { titulo: c.titulo, conteudo: c.conteudo, traduzido: true };
  const t = c[`titulo_${idioma}` as const];
  const x = c[`conteudo_${idioma}` as const];
  return x ? { titulo: t || c.titulo, conteudo: x, traduzido: true } : { titulo: c.titulo, conteudo: c.conteudo, traduzido: false };
}

export function Acervo({ capitulos, aviso }: { capitulos: Capitulo[]; aviso?: string }) {
  const lista = useMemo(() => [...capitulos].sort((a, b) => a.ordem - b.ordem), [capitulos]);
  const [aberto, setAberto] = useState(lista[0]?.id ?? "");
  const [idioma, setIdioma] = useState<Idioma>("pt");
  // Mesmo idioma escolhido na área de projetos (guardado neste navegador)
  useEffect(() => {
    try {
      const v = localStorage.getItem("brasico-idioma");
      if (ehIdioma(v)) setIdioma(v);
    } catch {}
  }, []);
  useEffect(() => {
    if (!lista.some((c) => c.id === aberto) && lista[0]) setAberto(lista[0].id);
  }, [lista, aberto]);
  const cap = lista.find((c) => c.id === aberto) ?? lista[0];
  const html = useMemo(() => (cap ? renderConteudo(textoNoIdioma(cap, idioma).conteudo, idioma) : ""), [cap, idioma]);
  if (!cap) return <p className="muted">Nada guardado aqui ainda.</p>;
  const t = textoNoIdioma(cap, idioma);
  return (
    <>
      <div className="rf-acervo-barra">
        {lista.length > 1 && (
          <div className="rf-filtros" role="tablist" aria-label="Capítulos">
            {lista.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === cap.id} className={c.id === cap.id ? "botao-painel on" : "botao-painel"} onClick={() => setAberto(c.id)}>
                {tituloLimpo(textoNoIdioma(c, idioma).titulo)}
              </button>
            ))}
          </div>
        )}
        <div className="rf-idiomas" role="tablist" aria-label="Idioma do texto">
          {IDIOMAS.map((i) => (
            <button key={i.id} role="tab" aria-selected={i.id === idioma} title={i.nome} className={i.id === idioma ? "on" : ""}
              onClick={() => { setIdioma(i.id); try { localStorage.setItem("brasico-idioma", i.id); } catch {} }}>{i.sigla}</button>
          ))}
        </div>
      </div>
      {(aviso || !t.traduzido) && (
        <p className="es-aviso rf-acervo-aviso">
          {!t.traduzido && "Este capítulo ainda não tem tradução neste idioma; mostrando em português. "}
          {aviso}
        </p>
      )}
      <article className="es-bloco rf-acervo" dangerouslySetInnerHTML={{ __html: html }} />
      <p className="muted small rf-acervo-origem">
        Do acervo fiscal (antigo projeto “Organograma Fiscal Brasico”){cap.atualizado_na_origem ? `, versão de ${dataHora(cap.atualizado_na_origem)}` : ""}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------
// Mapa de acessos: o que já temos, o que falta e onde conseguir
// ---------------------------------------------------------------------
export const SITUACAO_FONTE: Record<string, { rotulo: string; classe: string; explica: string }> = {
  temos: { rotulo: "Já temos", classe: "rf-pilula ok", explica: "Ligado no Brasico e atualizando." },
  pronto: { rotulo: "Pronto para ligar", classe: "rf-pilula azul", explica: "O acesso já existe (o contrato cobre); falta programar a leitura." },
  falta: { rotulo: "Falta acesso", classe: "rf-pilula atencao", explica: "Precisa contratar, pedir ou cadastrar algo antes." },
  manual: { rotulo: "Manual", classe: "rf-pilula", explica: "Não existe API: alguém olha no portal; o Brasico lembra e guarda." },
  futuro: { rotulo: "Depois", classe: "rf-pilula roxo", explica: "Fica para uma fase seguinte do roteiro." },
};

export function MapaAcessos({ fontes }: { fontes: Fonte[] }) {
  const [filtro, setFiltro] = useState("todas");
  const conta = (s: string) => fontes.filter((f) => f.situacao === s).length;
  const lista = fontes.filter((f) => filtro === "todas" || f.situacao === filtro).sort((a, b) => a.ordem - b.ordem);
  const areas = [...new Set(lista.map((f) => f.area))];
  return (
    <>
      <div className="es-numeros">
        {(["temos", "pronto", "falta", "manual", "futuro"] as const).map((s) => (
          <button key={s} className={filtro === s ? "es-numero clicavel rf-numero on" : "es-numero clicavel rf-numero"} onClick={() => setFiltro(filtro === s ? "todas" : s)}>
            <span className="tv-cartao-rotulo"><span className={SITUACAO_FONTE[s].classe}>{SITUACAO_FONTE[s].rotulo}</span></span>
            <span className="es-numero-valor">{conta(s)}</span>
            <span className="tv-cartao-detalhe">{SITUACAO_FONTE[s].explica}</span>
          </button>
        ))}
      </div>
      {filtro !== "todas" && <p className="muted small">Mostrando só “{SITUACAO_FONTE[filtro].rotulo}”. <button className="rf-link" onClick={() => setFiltro("todas")}>Ver tudo</button></p>}
      {areas.map((a) => (
        <section key={a} className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{a}</h2><span className="muted">{lista.filter((f) => f.area === a).length} itens</span></div>
          <ul className="rf-fontes">
            {lista.filter((f) => f.area === a).map((f) => (
              <li key={f.id}>
                <div className="rf-fonte-cabeca">
                  <strong>{f.nome}</strong>
                  <span className="rf-tags">
                    {f.prioridade === "alta" && <span className="rf-pilula erro">prioridade alta</span>}
                    <span className={SITUACAO_FONTE[f.situacao]?.classe ?? "rf-pilula"}>{SITUACAO_FONTE[f.situacao]?.rotulo ?? f.situacao}</span>
                  </span>
                </div>
                <p>{f.o_que_da}</p>
                <dl className="rf-fonte-dados">
                  <div><dt>Como chega</dt><dd>{f.como || "—"}</dd></div>
                  {f.falta && f.falta !== "—" && <div><dt>{f.situacao === "temos" ? "Próximo passo" : "O que falta e onde conseguir"}</dt><dd>{f.falta}</dd></div>}
                  {f.custo && <div><dt>Custo</dt><dd>{f.custo}</dd></div>}
                </dl>
                {f.onde && <a className="rf-link" href={f.onde}>Abrir no Brasico →</a>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------
// Catálogo do Integra Contador
// ---------------------------------------------------------------------
const SITUACAO_SERVICO: Record<string, { rotulo: string; classe: string }> = {
  em_uso: { rotulo: "Em uso", classe: "rf-pilula ok" },
  pronto: { rotulo: "Contrato cobre · falta programar", classe: "rf-pilula azul" },
  nao_usar: { rotulo: "Não usar (é do contador)", classe: "rf-pilula" },
  nao_se_aplica: { rotulo: "Não se aplica", classe: "rf-pilula" },
};
const CUSTO_ENDPOINT: Record<string, string> = {
  Monitorar: "Grátis", Apoiar: "Grátis", Consultar: "Consulta · R$ 0,24", Emitir: "Emissão · R$ 0,32", Declarar: "Declaração · R$ 0,40",
};

export function CatalogoServicos({ servicos }: { servicos: Servico[] }) {
  const [ver, setVer] = useState<"uteis" | "todos">("uteis");
  const lista = servicos.filter((s) => ver === "todos" || s.situacao === "em_uso" || s.situacao === "pronto").sort((a, b) => a.ordem - b.ordem);
  const grupos = [...new Set(lista.map((s) => s.grupo))];
  const emUso = servicos.filter((s) => s.situacao === "em_uso").length;
  const prontos = servicos.filter((s) => s.situacao === "pronto").length;
  return (
    <>
      <section className="es-bloco">
        <div className="es-bloco-cabeca">
          <h2>O que o contrato do SERPRO já deixa ler</h2>
          <div className="rf-filtros" role="tablist">
            <button role="tab" aria-selected={ver === "uteis"} className={ver === "uteis" ? "botao-painel on" : "botao-painel"} onClick={() => setVer("uteis")}>Úteis para o grupo</button>
            <button role="tab" aria-selected={ver === "todos"} className={ver === "todos" ? "botao-painel on" : "botao-painel"} onClick={() => setVer("todos")}>Catálogo inteiro</button>
          </div>
        </div>
        <p className="rf-explica">
          <b>{emUso}</b> serviços já em uso e <b>{prontos}</b> que o contrato de cada empresa já cobre e só falta programar.
          Declarar, transmitir e fazer opções continua com o contador: o Brasico só lê e emite guias.
          “Conferido” quer dizer que o Brasico já chamou o serviço com sucesso.
        </p>
      </section>
      {grupos.map((g) => (
        <section key={g} className="es-bloco">
          <div className="es-bloco-cabeca"><h2>{g}</h2><span className="muted">{lista.find((s) => s.grupo === g)?.aplica}</span></div>
          <div className="tv-tabela-caixa">
            <table className="tv-tabela rf-tabela-servicos">
              <thead><tr><th>Serviço</th><th>Para que serve</th><th>Quando o Brasico usa</th><th>Custo</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.filter((s) => s.grupo === g).map((s) => (
                  <tr key={s.id_sistema + s.id_servico}>
                    <td><strong>{s.nome}</strong><div className="muted small rf-mono">{s.id_sistema} · {s.id_servico}</div></td>
                    <td>{s.para_que}</td>
                    <td>{s.rotina}</td>
                    <td className="rf-nowrap">{CUSTO_ENDPOINT[s.endpoint] ?? "—"}</td>
                    <td><span className={SITUACAO_SERVICO[s.situacao]?.classe}>{SITUACAO_SERVICO[s.situacao]?.rotulo}</span>{s.conferido && <div className="small rf-ok">✓ conferido</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="muted small">Fonte: catálogo de serviços do Integra Contador (SERPRO), conferido em 30/10/2026 com os serviços já chamados pelo Brasico. Preços da primeira faixa da loja do SERPRO; caem com o volume do ciclo.</p>
    </>
  );
}

// ---------------------------------------------------------------------
// Rotinas e eventos de atualização
// ---------------------------------------------------------------------
const NOME_EVENTO: Record<string, string> = { E0301: "DCTFWeb", E0601: "Caixa postal", E0701: "Pagamentos" };

export function Rotinas({ rotinas, eventos, empresas, nomeEmpresa, alternar }: {
  rotinas: Rotina[]; eventos: Evento[]; empresas: { id: string }[]; nomeEmpresa: (id: string) => string; alternar: (id: string, ligada: boolean) => void;
}) {
  return (
    <>
      <section className="es-bloco">
        <div className="es-bloco-cabeca"><h2>Como o Brasico gasta só o necessário</h2></div>
        <ol className="rf-passos">
          <li><b>7h · Eventos de atualização (grátis).</b> A Receita diz em que dia mudou a caixa postal, os pagamentos e a DCTFWeb de cada empresa.</li>
          <li><b>7h15 · Caixa postal.</b> Pergunta se há mensagem nova (grátis). Só se houver, baixa a lista e o texto das novas.</li>
          <li><b>Pagamentos só quando mudam.</b> Se o evento de pagamentos for mais novo que a última busca, busca de novo; senão, não gasta.</li>
          <li><b>Situação fiscal toda semana.</b> Um relatório a cada 7 dias por empresa (R$ 0,32).</li>
          <li><b>Proteções.</b> Cada empresa faz um pedido por vez; falhou, só tenta no dia seguinte; o limite do dia e o teto do ciclo valem também para a rotina.</li>
        </ol>
        <p className="muted small">A rotina passa a cada 15 minutos, das 7h às 9h45 (horário de Brasília/Fortaleza). Estimativa por empresa: de R$ 2 a R$ 6 por ciclo, bem abaixo do teto de R$ 30.</p>
      </section>
      <section className="es-bloco">
        <div className="es-bloco-cabeca"><h2>Rotinas</h2></div>
        <div className="tv-tabela-caixa">
          <table className="tv-tabela">
            <thead><tr><th>Rotina</th><th>O que faz</th><th>Quando</th><th>Última vez</th><th>Custo por empresa no ciclo</th><th>Ligada</th></tr></thead>
            <tbody>
              {[...rotinas].sort((a, b) => a.ordem - b.ordem).map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.nome}</strong></td>
                  <td>{r.o_que_faz}</td>
                  <td className="rf-nowrap">{r.quando}</td>
                  <td className="rf-nowrap">{r.ultima_vez ? dataHora(r.ultima_vez) : "ainda não rodou"}</td>
                  <td>{r.custo_mes_empresa}</td>
                  <td>
                    <label className="rf-chave">
                      <input type="checkbox" checked={r.ligada} onChange={(e) => alternar(r.id, e.target.checked)} />
                      <span>{r.ligada ? "Sim" : "Não"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="es-bloco">
        <div className="es-bloco-cabeca"><h2>Último dia em que a Receita registrou mudança</h2></div>
        <div className="tv-tabela-caixa">
          <table className="tv-tabela">
            <thead><tr><th>Empresa</th>{Object.values(NOME_EVENTO).map((n) => <th key={n}>{n}</th>)}<th>Lido em</th></tr></thead>
            <tbody>
              {empresas.map((e) => {
                const meus = eventos.filter((x) => x.empresa_id === e.id);
                const lido = meus.map((x) => x.lido_em).sort().pop();
                return (
                  <tr key={e.id}>
                    <td><strong>{nomeEmpresa(e.id)}</strong></td>
                    {Object.keys(NOME_EVENTO).map((k) => {
                      const ev = meus.find((x) => x.evento === k);
                      return <td key={k}>{ev ? (ev.atualizado_em ? dia(ev.atualizado_em) : "sem mudança") : "—"}</td>;
                    })}
                    <td>{lido ? dataHora(lido) : "ainda não lido"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function ResumoAcessos({ fontes, irPara }: { fontes: Fonte[]; irPara: () => void }) {
  const ordem = ["temos", "pronto", "falta", "manual", "futuro"] as const;
  const total = fontes.length || 1;
  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca"><h2>Mapa de acessos</h2><button className="ghost small" onClick={irPara}>Ver o mapa</button></div>
      <div className="rf-barra-situacao" aria-hidden="true">
        {ordem.map((s) => <i key={s} className={`s-${s}`} style={{ width: `${(fontes.filter((f) => f.situacao === s).length / total) * 100}%` }} />)}
      </div>
      <ul className="rf-legenda">
        {ordem.map((s) => (
          <li key={s}><span className={SITUACAO_FONTE[s].classe}>{SITUACAO_FONTE[s].rotulo}</span> {fontes.filter((f) => f.situacao === s).length}</li>
        ))}
      </ul>
      <ul className="es-lista rf-proximos">
        {fontes.filter((f) => f.prioridade === "alta" && f.situacao !== "temos").sort((a, b) => a.ordem - b.ordem).slice(0, 5).map((f) => (
          <li key={f.id}><span><strong>{f.nome}</strong><span className="muted"> · {f.falta}</span></span></li>
        ))}
      </ul>
    </section>
  );
}

