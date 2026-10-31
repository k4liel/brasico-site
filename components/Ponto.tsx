"use client";

// Partes do RH que vêm do ponto (RHiD, relógios da Control iD), cruzadas com o RH do eSocial. Os dados são
// lidos uma vez pela página do RH (usePonto, components/PontoDados.ts) e cada aba mostra a sua parte:
// Escala (a grade na página toda), Início (hoje no ponto), Equipe (ponto do mês), Ausências e contratos
// (justificativas) e Folha e governo (ponto × eSocial e relógios). Só leitura.
import { useState, type ReactNode } from "react";
import { cpfVisivel, dataBR, somarDias } from "@/lib/esocial/rh";
import PontoEscala, { ordemDaGrade, type Alvo, type PessoaEscala } from "./PontoEscala";
import {
  ESTADOS, chave, diaFortaleza, horaCurta, horas, iniciais, nomeProprio,
  type Estado, type ItemOrdem, type LinhaPonto, type Ponto,
} from "./PontoDados";

// Bolinha da situação de hoje (grade e listas)
const BOLINHA: Record<Estado, string> = {
  Trabalhando: "ok", Atrasado: "atraso", "Entra mais tarde": "espera", "Já saiu": "saiu", Afastado: "afastado", Folga: "folga", "Sem escala": "",
};
const CRUZAMENTO: Record<string, { rotulo: string; texto: string }> = {
  batendo: { rotulo: "Batendo ponto", texto: "Bateu nos últimos 3 dias. O eSocial relê a cada 21 dias." },
  parou: { rotulo: "Parou de bater", texto: "Ativo no relógio, mas sem batida há mais de 7 dias. Lido primeiro no eSocial: pode ser afastamento ou saída." },
  inativo: { rotulo: "Inativo no relógio", texto: "Desativado no RHiD. Lido primeiro no eSocial para confirmar a saída." },
  afastado: { rotulo: "Afastado pelo RHiD", texto: "Férias, atestado ou licença lançados no RHiD cobrindo hoje. O eSocial relê a cada 21 dias." },
  sem_ponto: { rotulo: "Sem ponto", texto: "CPF não encontrado no RHiD (sem CPF no cadastro do relógio, ou não bate ponto)." },
};

function Aguarde({ ponto }: { ponto: Ponto }) {
  if (ponto.acesso === false) return <section className="es-bloco"><p className="muted">Você não tem acesso ao ponto (RHiD).</p></section>;
  return <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>;
}
const pronto = (p: Ponto) => p.acesso === true && p.carregado;
const atualizadoEm = (p: Ponto) => (p.lendo ? "Lendo o RHiD…" : p.ultima ? `atualizado ${horaCurta(p.ultima.fim!)}` : "ainda não lido");

// =====================================================================
// Escala: a grade na página toda, com filtros por local, setor, busca e situação de hoje
// =====================================================================
export function EscalaSecao({ ponto, chavesRH, onAbrirPessoa }: { ponto: Ponto; chavesRH: Set<string>; onAbrirPessoa: (chave: string) => void }) {
  const [local, setLocal] = useState("");
  const [setor, setSetor] = useState("");
  const [estado, setEstado] = useState<Estado | "">("");
  const [busca, setBusca] = useState("");
  const [organizar, setOrganizar] = useState(false);
  if (!pronto(ponto)) return <Aguarde ponto={ponto} />;

  const { vistas } = ponto;
  const locais = [...new Set(vistas.map((l) => l.local || "Sem local"))].sort();
  const doLocal = vistas.filter((l) => !local || (l.local || "Sem local") === local);
  const setores = [...new Set(doLocal.map((l) => l.setor).filter(Boolean))].sort();
  const termo = busca.trim().toLowerCase();
  const filtradas = doLocal.filter((l) => !setor || l.setor === setor)
    .filter((l) => !termo || l.p.nome.toLowerCase().includes(termo) || l.cargo.toLowerCase().includes(termo) || l.p.cpf.includes(termo.replace(/\D/g, "") || "#"));
  // Organizando, valem só o local escolhido e a ordem: setor, busca e situação ficam de lado (ninguém some do grupo)
  const mostradas = (organizar ? doLocal : filtradas.filter((l) => !estado || l.estado === estado))
    .slice().sort((a, b) => (a.posicao ?? 1e6) - (b.posicao ?? 1e6) || a.p.nome.localeCompare(b.p.nome));
  const linhaDe = new Map(mostradas.map((l) => [l.k, l]));
  const pessoas = mostradas.map<PessoaEscala>((l) => ({
    chave: l.k, ficha: l.chaveRH, nome: nomeProprio(l.p.nome), cargo: l.cargo, local: l.local, setor: l.setor, dias: l.dias,
    hoje: { texto: l.estado + (l.estado === "Atrasado" || l.estado === "Entra mais tarde" ? ` (entrada ${l.entradaHoje})` : l.afastado ? ` (${l.afastado.tipo})` : ""), classe: BOLINHA[l.estado] },
  }));

  // Solta a pessoa arrastada: antes ou depois de outra (e fica no grupo dela) ou no começo de um setor/local.
  // Renumera só os grupos que mudaram e grava; quem trocou de grupo guarda o grupo novo.
  const grupoDe = (x: PessoaEscala) => `${x.local || "Sem local"}|${x.setor}`;
  function soltar(k: string, alvo: Alvo) {
    const lista = ordemDaGrade(pessoas);
    const eu = lista.find((x) => x.chave === k);
    if (!eu) return;
    const resto = lista.filter((x) => x.chave !== k);
    let idx: number, local: string, setor: string;
    if ("chave" in alvo) {
      const a = resto.findIndex((x) => x.chave === alvo.chave);
      if (a < 0) return;
      idx = alvo.lado === "antes" ? a : a + 1;
      ({ local, setor } = resto[a]);
    } else {
      ({ local, setor } = alvo);
      idx = resto.findIndex((x) => grupoDe(x) === `${local || "Sem local"}|${setor}`);
      if (idx < 0) idx = resto.length;
    }
    const movido = { ...eu, local, setor };
    const nova = [...resto.slice(0, idx), movido, ...resto.slice(idx)];
    if (nova.every((x, i) => x.chave === lista[i].chave) && grupoDe(movido) === grupoDe(eu)) return;
    const trocouGrupo = grupoDe(movido) !== grupoDe(eu);
    const afetados = new Set([grupoDe(eu), grupoDe(movido)]);
    const conta = new Map<string, number>();
    const itens: ItemOrdem[] = [];
    for (const x of nova) {
      const g = grupoDe(x);
      if (!afetados.has(g)) continue;
      const pos = conta.get(g) ?? 0;
      conta.set(g, pos + 1);
      const l: LinhaPonto = linhaDe.get(x.chave)!;
      const it: ItemOrdem = { cliente_id: l.p.cliente_id, pessoa_id: l.p.id, posicao: pos };
      // Quem trocou de grupo guarda o grupo novo (ou volta ao automático, se for o dele)
      if (x.chave === k && trocouGrupo) {
        it.local = x.local === l.localAuto ? null : x.local;
        it.setor = x.setor === l.setorAuto ? null : x.setor;
      }
      itens.push(it);
    }
    ponto.ordenar(itens);
  }
  // Setas do teclado na alça: uma linha por vez; na ponta do grupo, passa para o vizinho
  function mover(k: string, direcao: -1 | 1) {
    const lista = ordemDaGrade(pessoas);
    const i = lista.findIndex((x) => x.chave === k);
    const alvo = lista[i + direcao];
    if (i < 0 || !alvo) return;
    const mesmo = grupoDe(alvo) === grupoDe(lista[i]);
    soltar(k, { chave: alvo.chave, lado: (direcao === -1) === mesmo ? "antes" : "depois" });
  }

  return (
    <section className="es-bloco pt-escala-bloco">
      {ponto.erro && <p className="tv-alerta">{ponto.erro}</p>}
      <div className="pt-agora" role="group" aria-label="Situação de hoje">
        <button className={estado === "" ? "on" : ""} onClick={() => setEstado("")}><b>{filtradas.length}</b> todos</button>
        {ESTADOS.map((e) => {
          const n = filtradas.filter((l) => l.estado === e).length;
          return n ? (
            <button key={e} className={estado === e ? "on" : ""} onClick={() => setEstado(estado === e ? "" : e)}>
              <i className={`pe-agora ${BOLINHA[e]}`} aria-hidden="true" /><b>{n}</b> {e.toLowerCase()}
            </button>
          ) : null;
        })}
        <span className="pt-agora-hora muted">agora, {ponto.relogio}</span>
      </div>
      <div className="pt-filtros">
        <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome, cargo ou CPF" aria-label="Buscar na escala" />
        {locais.length > 1 && (
          <div className="tv-unidades" role="group" aria-label="Local">
            <button className={local === "" ? "botao-painel on" : "botao-painel"} onClick={() => { setLocal(""); setSetor(""); }}>Todos os locais</button>
            {locais.map((u) => (
              <button key={u} className={local === u ? "botao-painel on" : "botao-painel"} onClick={() => { setLocal(u); setSetor(""); }}>
                {u} <span className="muted">{vistas.filter((l) => (l.local || "Sem local") === u).length}</span>
              </button>
            ))}
          </div>
        )}
        <FiltroUnidade unidades={setores} valor={setor} onMudar={setSetor} rotulo="setores" contar={(u) => doLocal.filter((l) => l.setor === u).length} />
      </div>
      {organizar && (
        <p className="pt-organizar">
          <b>Organizando a escala.</b> Segure o nome e arraste para cima ou para baixo; a linha dourada mostra onde a pessoa vai cair.
          Solte em outro setor ou local para mudar a pessoa de grupo. Perto da borda, a escala rola sozinha. Tudo é salvo na hora e vale para quem vê a escala.
          <button className="ghost small" onClick={() => {
            if (window.confirm("Voltar todo mundo para a ordem e os grupos automáticos (do RHiD)?")) ponto.ordenar([], true);
          }}>Voltar ao automático</button>
        </p>
      )}
      {ponto.linhas.length === 0 ? (
        <p className="muted tv-nada">O ponto ainda não foi lido. A leitura roda sozinha de madrugada e ao longo do dia.</p>
      ) : mostradas.length === 0 ? (
        <p className="muted tv-nada">Ninguém neste filtro.</p>
      ) : (
        <PontoEscala garantir={ponto.garantir} onAbrir={(k) => chavesRH.has(k) && onAbrirPessoa(k)}
          organizar={organizar} onMover={mover} onSoltar={soltar} pessoas={pessoas}
          extra={(
            <span className="pt-acoes">
              <span className="muted">{atualizadoEm(ponto)}</span>
              <button className="ghost small" onClick={ponto.atualizar} disabled={ponto.lendo}>Atualizar</button>
              <button className={organizar ? "small" : "ghost small"} onClick={() => setOrganizar((v) => !v)} aria-pressed={organizar}>
                {organizar ? "Pronto" : "Organizar"}
              </button>
            </span>
          )} />
      )}
    </section>
  );
}

// =====================================================================
// Início: hoje no ponto (resumo e quem está atrasado)
// =====================================================================
export function HojeNoPonto({ ponto, icone, onAbrirEscala }: { ponto: Ponto; icone: (nome: string) => ReactNode; onAbrirEscala: () => void }) {
  if (ponto.acesso === false) return null;
  if (!ponto.carregado) return <div className="es-esqueleto" aria-hidden="true"><i /></div>;
  const { vistas } = ponto;
  const atrasados = vistas.filter((l) => l.estado === "Atrasado").sort((a, b) => a.entradaHoje.localeCompare(b.entradaHoje));
  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca">
        <h2>{icone("ponto")}Hoje no ponto <span className="muted">{ponto.relogio}</span></h2>
        <span className="pt-acoes"><span className="muted">{atualizadoEm(ponto)}</span><button className="ghost small" onClick={onAbrirEscala}>Abrir a escala</button></span>
      </div>
      <div className="pt-agora estatico">
        {ESTADOS.map((e) => {
          const n = vistas.filter((l) => l.estado === e).length;
          return n ? <span key={e}><i className={`pe-agora ${BOLINHA[e]}`} aria-hidden="true" /><b>{n}</b> {e.toLowerCase()}</span> : null;
        })}
      </div>
      {atrasados.length > 0 && (
        <ul className="pt-atrasados">
          {atrasados.slice(0, 8).map((l) => (
            <li key={l.k}><b>{nomeProprio(l.p.nome)}</b><span className="muted">{[l.local, l.setor].filter(Boolean).join(" · ")} · entrada {l.entradaHoje}</span></li>
          ))}
          {atrasados.length > 8 && <li className="muted">e mais {atrasados.length - 8}</li>}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// Equipe › Ponto do mês: dias, horas, faltas, atrasos e banco de horas de cada pessoa (30 dias)
// =====================================================================
export function PontoMes({ ponto, verCpf }: { ponto: Ponto; verCpf: boolean }) {
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");
  if (!pronto(ponto)) return <Aguarde ponto={ponto} />;
  const { vistas } = ponto;
  const locais = [...new Set(vistas.map((l) => l.local || "Sem local"))].sort();
  const termo = busca.trim().toLowerCase();
  const linhas = vistas.filter((l) => !local || (l.local || "Sem local") === local)
    .filter((l) => !termo || l.p.nome.toLowerCase().includes(termo) || l.cargo.toLowerCase().includes(termo))
    .sort((a, b) => b.faltas - a.faltas || b.atraso - a.atraso || a.p.nome.localeCompare(b.p.nome));
  const faltas = linhas.reduce((t, l) => t + l.faltas, 0);
  const atrasos = linhas.reduce((t, l) => t + l.atraso, 0);
  return (
    <section className="es-bloco">
      <div className="es-numeros">
        <Cartao rotulo="Faltas em 30 dias" valor={`${faltas}`} detalhe="sem justificativa no RHiD" />
        <Cartao rotulo="Atrasos em 30 dias" valor={horas(atrasos)} detalhe="somando quem está na lista" />
        <Cartao rotulo="Pessoas no relógio" valor={`${linhas.length}`} detalhe="ativas no RHiD" />
      </div>
      <div className="es-filtros">
        <input type="search" value={busca} onChange={(v) => setBusca(v.target.value)} placeholder="Buscar por nome ou cargo" aria-label="Buscar no ponto do mês" />
        {locais.length > 1 && (
          <div className="tv-unidades" role="group" aria-label="Local">
            <button className={local === "" ? "botao-painel on" : "botao-painel"} onClick={() => setLocal("")}>Todos os locais</button>
            {locais.map((u) => <button key={u} className={local === u ? "botao-painel on" : "botao-painel"} onClick={() => setLocal(u)}>{u}</button>)}
          </div>
        )}
      </div>
      <div className="tv-rolagem">
        <table className="tv-tabela pt-tabela">
          <thead><tr><th>Pessoa</th><th>Cargo</th><th>Local</th><th>Setor</th><th>Escala</th><th>Dias</th><th>Horas</th><th>Faltas</th><th>Atrasos</th><th>Banco de horas</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.k}>
                <td>{nomeProprio(l.p.nome)}{verCpf && l.p.cpf ? <small className="muted"> · {cpfVisivel(l.p.cpf, true)}</small> : null}</td>
                <td>{l.cargo || "—"}</td>
                <td>{l.local}</td>
                <td>{l.setor}</td>
                <td className="pt-escala-nome" title={l.escala}>{l.escala || "—"}</td>
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
      <p className="muted pt-nota">Contas do RHiD (apuração do ponto), dos últimos 30 dias sem contar hoje. Banco de horas: saldo no último dia lido.</p>
    </section>
  );
}

// =====================================================================
// Ausências e contratos › Justificativas do RHiD (afastados hoje e as últimas lançadas)
// =====================================================================
export function Justificativas({ ponto, icone }: { ponto: Ponto; icone: (nome: string) => ReactNode }) {
  if (ponto.acesso === false) return null;
  if (!ponto.carregado) return <div className="es-esqueleto" aria-hidden="true"><i /></div>;
  const { just, agora } = ponto;
  const afastadosHoje = just.filter((x) => x.afasta && x.hoje).sort((a, b) => a.fim.localeCompare(b.fim));
  const recentes = just.filter((x) => !(x.afasta && x.hoje) && x.inicio <= agora && x.inicio >= somarDias(agora, -45)).slice(0, 60);
  const proximas = just.filter((x) => x.inicio > agora).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const periodo = (a: string, b: string) => (a === b ? dataBR(a) : `${dataBR(a)} a ${dataBR(b)}`);
  return (
    <section className="es-bloco">
      <div className="es-bloco-cabeca">
        <h2>{icone("ausencias")}Justificativas do ponto</h2>
        <span className="muted">lançadas no RHiD</span>
      </div>
      <h3 className="pt-sub">Afastados hoje <span className="muted">{afastadosHoje.length}</span></h3>
      {afastadosHoje.length === 0 ? <p className="muted tv-nada">Ninguém com férias, atestado ou licença lançados no RHiD para hoje.</p> : (
        <ul className="es-equipe pt-just">
          {afastadosHoje.map(({ j, l, tipo, inicio, fim }) => (
            <li key={chave(j.cliente_id, j.id)}>
              <span className="es-pessoa">
                <span className="es-avatar" aria-hidden="true">{iniciais(l.p.nome)}</span>
                <span className="es-pessoa-nome"><strong>{nomeProprio(l.p.nome)}</strong><span className="muted">{[l.local, l.setor, l.cargo].filter(Boolean).join(" · ")}</span></span>
                <span className="pt-just-texto"><b>{tipo || j.texto}</b><span className="muted">{periodo(inicio, fim)}{j.tem_arquivo ? " · com arquivo" : ""}</span></span>
                <span className="es-selo afastado">volta {dataBR(somarDias(fim, 1))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {proximas.length > 0 && (
        <>
          <h3 className="pt-sub">Já marcadas para os próximos dias <span className="muted">{proximas.length}</span></h3>
          <ul className="es-lista">
            {proximas.slice(0, 20).map(({ j, l, tipo, inicio, fim }) => (
              <li key={chave(j.cliente_id, j.id)} className="pt-just-linha">
                <strong>{nomeProprio(l.p.nome)}</strong><span>{tipo || j.texto}</span><span className="muted">{periodo(inicio, fim)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {recentes.length > 0 && (
        <>
          <h3 className="pt-sub">Últimas justificativas <span className="muted">45 dias</span></h3>
          <div className="tv-rolagem">
            <table className="tv-tabela pt-tabela">
              <thead><tr><th>Pessoa</th><th>Tipo</th><th>Período</th><th>Texto</th><th>Arquivo</th><th>Lançada em</th></tr></thead>
              <tbody>
                {recentes.map(({ j, l, tipo, inicio, fim }) => (
                  <tr key={chave(j.cliente_id, j.id)}>
                    <td>{nomeProprio(l.p.nome)}</td>
                    <td>{tipo || "—"}</td>
                    <td>{periodo(inicio, fim)}</td>
                    <td className="pt-just-livre" title={j.descricao || j.texto}>{j.texto && j.texto !== tipo ? j.texto : j.descricao}</td>
                    <td>{j.tem_arquivo ? "Sim" : "—"}</td>
                    <td>{j.inserido_em ? dataBR(diaFortaleza(j.inserido_em)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted pt-nota">Atestados, férias, licenças, abonos e ajustes de banco lançados no RHiD. Os arquivos anexados ficam só lá.</p>
    </section>
  );
}

// =====================================================================
// Folha e governo › Ponto × RH (eSocial) e relógios
// =====================================================================
export function PontoGoverno({ ponto, icone, verCpf, onAbrirPessoa }: {
  ponto: Ponto; icone: (nome: string) => ReactNode; verCpf: boolean; onAbrirPessoa: (chave: string) => void;
}) {
  if (!pronto(ponto)) return ponto.acesso === false ? null : <Aguarde ponto={ponto} />;
  const { cruz, relogiosVistos, relogiosOk } = ponto;
  const atencao = cruz.filter((c) => c.ponto_situacao === "parou" || c.ponto_situacao === "inativo");
  return (
    <div className="es-duas">
      <section className="es-bloco">
        <div className="es-bloco-cabeca"><h2>{icone("leitura")}Ponto × eSocial</h2></div>
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
        <div className="es-bloco-cabeca"><h2>{icone("tecnico")}Relógios de ponto</h2><span className="muted">{relogiosOk.length} de {relogiosVistos.length} conectados</span></div>
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
        <p className="muted pt-nota">Leitura do ponto: a cada 10 minutos (das 6h à meia-noite) o Brasico vê as últimas batidas de cada empresa e atualiza o dia de quem bateu; de hora em hora confere o dia de quem tem escala hoje; às 5h, 12h, 17h e 22h relê a semana e a escala das próximas 5 semanas.</p>
      </section>
    </div>
  );
}

// Até 8 unidades: botões; mais que isso: uma caixa de escolha
export function FiltroUnidade({ unidades, valor, onMudar, contar, rotulo = "unidades" }: { unidades: string[]; valor: string; onMudar: (u: string) => void; contar: (u: string) => number; rotulo?: string }) {
  if (unidades.length < 2) return null;
  if (unidades.length > 8) {
    return (
      <select className="es-filtro-select" value={valor} onChange={(v) => onMudar(v.target.value)} aria-label={rotulo}>
        <option value="">{`Todos os ${rotulo}`}</option>
        {unidades.map((u) => <option key={u} value={u}>{u} ({contar(u)})</option>)}
      </select>
    );
  }
  return (
    <div className="tv-unidades" role="group" aria-label="Unidade">
      <button className={valor === "" ? "botao-painel on" : "botao-painel"} onClick={() => onMudar("")}>{`Todos os ${rotulo}`}</button>
      {unidades.map((u) => (
        <button key={u} className={valor === u ? "botao-painel on" : "botao-painel"} onClick={() => onMudar(u)}>{u} <span className="muted">{contar(u)}</span></button>
      ))}
    </div>
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

