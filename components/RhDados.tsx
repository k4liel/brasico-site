"use client";

// Saúde dos dados do RH (10/11/2026, revisão pedida pelo dono: "essa página de forma alguma pode ficar desatualizada").
// SaudeFaixa: a faixa do topo do Painel — cada fonte (ponto, eSocial, fichas) com a hora da última leitura boa e uma
// bolinha verde/amarela/vermelha. Conferencia: a aba "Dados", com quanto da equipe tem cada informação e a lista
// de quem falta (salário, pagamento, ponto, desligamento). Dados: rh_saude() (supabase/rh_saude.sql) + montarCobertura.
import type { ReactNode } from "react";
import { nomeCurto, type Cobertura, type Pessoa } from "@/lib/esocial/rh";

export type SaudeRH = {
  agora: string;
  rhid: { ultima_agora: string | null; ultima_apuracao: string | null; ultimo_cadastro: string | null; falhas_24h: number; ativos: number; com_banco: number };
  esocial: { empresa_id: string; nome: string; ligada: boolean; limite: number; ultima_resposta: string | null; acessos_hoje: number;
    ativos: number; nunca_lidos: number; fila_admissao: number; a_baixar: number; baixados: number }[];
};
type Estado = "ok" | "atencao" | "erro";

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "von", "van"]);
const nomeProprio = (s: string) =>
  s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");

// Hora de Fortaleza (UTC−3)
const fort = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
export function quando(iso: string | null, agoraIso: string): string {
  if (!iso) return "nunca";
  const min = Math.round((new Date(agoraIso).getTime() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const a = fort(agoraIso), d = fort(iso);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const dias = Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);
  if (dias === 0) return `hoje às ${hm}`;
  if (dias === 1) return `ontem às ${hm}`;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} às ${hm}`;
}

// Ponto: a leitura "agora" roda a cada minuto, 24 h (desde 14/11/2026)
export function estadoPonto(s: SaudeRH): { estado: Estado; texto: string } {
  const min = s.rhid.ultima_agora ? (new Date(s.agora).getTime() - new Date(s.rhid.ultima_agora).getTime()) / 60000 : Infinity;
  if (min <= 10) return { estado: "ok", texto: `atualizado ${quando(s.rhid.ultima_agora, s.agora)}` };
  if (min <= 60) return { estado: "atencao", texto: `atrasado: último ${quando(s.rhid.ultima_agora, s.agora)}` };
  return { estado: "erro", texto: `parado desde ${quando(s.rhid.ultima_agora, s.agora)}` };
}

// eSocial: lê das 8h às 20h, do dia 8 em diante; parado = nada respondido há mais de 2 dias úteis de leitura
export function estadoEsocial(e: SaudeRH["esocial"][number], agoraIso: string): { estado: Estado; texto: string } {
  const a = fort(agoraIso);
  if (!e.ligada) return { estado: "atencao", texto: "leitura desligada" };
  if (!e.ultima_resposta) return { estado: "erro", texto: "nunca leu" };
  const dias = (new Date(agoraIso).getTime() - new Date(e.ultima_resposta).getTime()) / 86400000;
  const liberado = a.getUTCDate() > 7;
  const limite = liberado ? (a.getUTCDate() <= 9 ? 9 : 2.5) : 10;
  return dias > limite ? { estado: "erro", texto: `parada desde ${quando(e.ultima_resposta, agoraIso)}` }
    : { estado: "ok", texto: `última leitura ${quando(e.ultima_resposta, agoraIso)}${liberado ? ` · ${e.acessos_hoje} de ${e.limite} acessos hoje` : " · o governo libera do dia 8 em diante"}` };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function SaudeFaixa({ saude, cobertura, onVer }: { saude: SaudeRH | null; cobertura: Cobertura; onVer: () => void }) {
  if (!saude) return null;
  const ponto = estadoPonto(saude);
  const es = saude.esocial.map((e) => estadoEsocial(e, saude.agora));
  const piorEs: Estado = es.some((x) => x.estado === "erro") ? "erro" : es.some((x) => x.estado === "atencao") ? "atencao" : "ok";
  const ultimaEs = saude.esocial.map((e) => e.ultima_resposta).filter(Boolean).sort().at(-1) ?? null;
  const fichas: Estado = cobertura.saiuPonto.length || pct(cobertura.comSalario, cobertura.ativos) < 80 ? "atencao" : "ok";
  return (
    <section className="rd-faixa" aria-label="Saúde dos dados">
      <div className={`rd-fonte ${ponto.estado}`}><i aria-hidden="true" /><span><b>Ponto (RHiD)</b><small>{ponto.texto}</small></span></div>
      <div className={`rd-fonte ${piorEs}`}><i aria-hidden="true" /><span><b>eSocial</b><small>{piorEs === "ok" ? `última leitura ${quando(ultimaEs, saude.agora)}` : es.find((x) => x.estado !== "ok")!.texto}</small></span></div>
      <div className={`rd-fonte ${fichas}`}><i aria-hidden="true" /><span><b>Fichas</b><small>{cobertura.comSalario} de {cobertura.ativos} com salário · {cobertura.comLiquido} com pagamento</small></span></div>
      <button className="ghost small" onClick={onVer}>Ver conferência</button>
    </section>
  );
}

function Barra({ rotulo, valor, total, detalhe }: { rotulo: string; valor: number; total: number; detalhe: string }) {
  const p = pct(valor, total);
  return (
    <div className="rd-barra">
      <div className="rd-barra-cabeca"><span>{rotulo}</span><b>{valor} de {total}</b></div>
      <div className={`rd-barra-trilho ${p >= 95 ? "ok" : p >= 70 ? "atencao" : "erro"}`}><i style={{ width: `${p}%` }} /></div>
      <small className="muted">{detalhe}</small>
    </div>
  );
}

function ListaPessoas({ titulo, explica, pessoas, nomeEmpresa, onAbrir, extra }: {
  titulo: string; explica: string; pessoas: Pessoa[]; nomeEmpresa: (id: string) => string; onAbrir: (chave: string) => void; extra?: (p: Pessoa) => ReactNode;
}) {
  if (!pessoas.length) return null;
  return (
    <details className="rd-lista">
      <summary><b>{titulo}</b> <span className="rd-n">{pessoas.length}</span><small className="muted">{explica}</small></summary>
      <ul>
        {pessoas.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => (
          <li key={p.chave}>
            <button className="es-linha-botao" onClick={() => onAbrir(p.chave)}>
              <span className="es-lista-texto"><strong>{p.nome ? nomeProprio(p.nome) : "Nome ainda não lido"}</strong>
                <span className="muted">{[p.unidade, nomeEmpresa(p.empresa_id)].filter(Boolean).join(" · ")}</span></span>
              {extra?.(p)}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Conferencia({ saude, cobertura, nomeEmpresa, onAbrir }: {
  saude: SaudeRH | null; cobertura: Cobertura; nomeEmpresa: (id: string) => string; onAbrir: (chave: string) => void;
}) {
  const ponto = saude ? estadoPonto(saude) : null;
  return (
    <section className="es-bloco rd-conferencia">
      <div className="es-bloco-cabeca"><h2>Conferência dos dados</h2><span className="muted">o que já chegou de cada fonte e o que falta</span></div>

      {saude && (
        <div className="rd-fontes">
          <div className={`rd-fonte-cartao ${ponto!.estado}`}>
            <span className="rd-fonte-titulo"><i aria-hidden="true" />Ponto (RHiD)</span>
            <dl>
              <div><dt>Batidas do dia</dt><dd>{ponto!.texto}</dd></div>
              <div><dt>Apuração (horas e banco)</dt><dd>{quando(saude.rhid.ultima_apuracao, saude.agora)}</dd></div>
              <div><dt>Cadastro das pessoas</dt><dd>{quando(saude.rhid.ultimo_cadastro, saude.agora)}</dd></div>
              <div><dt>Banco de horas</dt><dd>{saude.rhid.com_banco} de {saude.rhid.ativos} pessoas em dia</dd></div>
              {saude.rhid.falhas_24h > 0 && <div><dt>Falhas em 24 h</dt><dd className="es-ruim">{saude.rhid.falhas_24h}</dd></div>}
            </dl>
          </div>
          {saude.esocial.map((e) => {
            const st = estadoEsocial(e, saude.agora);
            return (
              <div key={e.empresa_id} className={`rd-fonte-cartao ${st.estado}`}>
                <span className="rd-fonte-titulo"><i aria-hidden="true" />eSocial · {nomeCurto(e.nome)}</span>
                <dl>
                  <div><dt>Leitura</dt><dd>{st.texto}</dd></div>
                  <div><dt>Pessoas na lista</dt><dd>{e.ativos}{e.nunca_lidos ? <span className="muted"> · {e.nunca_lidos} nunca lidas</span> : null}</dd></div>
                  <div><dt>Admissões a buscar</dt><dd>{e.fila_admissao ? `${e.fila_admissao} (de onde vem o salário)` : "nenhuma ✓"}</dd></div>
                  <div><dt>Eventos guardados</dt><dd>{e.baixados}{e.a_baixar ? <span className="muted"> · {e.a_baixar} a baixar</span> : null}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      )}

      <div className="rd-barras">
        <Barra rotulo="Salário de contrato" valor={cobertura.comSalario} total={cobertura.ativos}
          detalhe="Vem da admissão (S-2200) ou da última alteração (S-2206) no eSocial; a leitura busca 10 por dia por empresa." />
        <Barra rotulo="Pagamento do mês" valor={cobertura.comLiquido} total={cobertura.ativos}
          detalhe="Líquido pago (S-1210). Falta para quem entrou depois da última folha ou ainda não foi lido." />
        <Barra rotulo="Lidos no eSocial" valor={cobertura.lidos} total={cobertura.ativos} detalhe="Pessoas com pelo menos um mês lido do governo." />
        <Barra rotulo="No relógio de ponto" valor={cobertura.noPonto} total={cobertura.ativos} detalhe="Cadastradas no RHiD (instrutores e quem não bate ponto ficam fora)." />
      </div>

      <div className="rd-listas">
        <ListaPessoas titulo="Saíram do ponto, falta o desligamento" pessoas={cobertura.saiuPonto} nomeEmpresa={nomeEmpresa} onAbrir={onAbrir}
          explica="Inativas no RHiD e sem desligamento (S-2299) no eSocial. Quase sempre já saíram: confira com o contador se a rescisão foi enviada." />
        <ListaPessoas titulo="Sem salário de contrato" pessoas={cobertura.semSalario} nomeEmpresa={nomeEmpresa} onAbrir={onAbrir}
          explica="A leitura da admissão vai trazendo; quem entrou antes de 04/2019 só aparece se houver alteração de contrato."
          extra={(p) => (p.liquido ? <span className="muted">tem pagamento</span> : null)} />
        <ListaPessoas titulo="Sem pagamento lido" pessoas={cobertura.semLiquido} nomeEmpresa={nomeEmpresa} onAbrir={onAbrir}
          explica="Ainda sem o S-1210. Normal para quem entrou neste mês." />
        <ListaPessoas titulo="Fora do relógio de ponto" pessoas={cobertura.semPonto} nomeEmpresa={nomeEmpresa} onAbrir={onAbrir}
          explica="Na equipe do eSocial mas sem cadastro ativo no RHiD." />
      </div>
    </section>
  );
}
