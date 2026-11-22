"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "../Topo";
import VisorMenu from "../VisorMenu";

// Cardápios de um restaurante (22/11/2026, pedido do dono: "separar melhor o que é de edição e o que é
// de impressão"). Duas partes, cada uma numa grade só:
//  1. Editar na tela — os menus vivos (cardapios_vivos): clicar abre o VisorMenu (Editar, Salvar, Versões).
//  2. Para imprimir — os PDFs (cardapios_impressos) e o link público (/menus/<código>) que a equipe e o
//     marketing usam para baixar sempre a versão atual. Quando um menu muda, o Claude gera o PDF novo e troca
//     `arquivo`; o link continua o mesmo. Os pausados aparecem marcados e ficam fora do link.

type Vivo = { id: string; codigo: string; title: string; versao: number; updated_at: string };
type Impresso = {
  id: string; codigo: string; menu_codigo: string | null; menu_versao: number | null; titulo: string; descricao: string; formato: string;
  paginas: number | null; arquivo: string; situacao: "ativo" | "pausado"; ordem: number; atualizado_em: string;
};
type Link = { slug: string; nome: string; ativo: boolean; criado_em: string };

const data = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function capaDe(projeto: string, arquivo: string) {
  const i = arquivo.lastIndexOf("/");
  const pasta = i >= 0 ? arquivo.slice(0, i + 1) : "";
  return `/api/arquivo/${projeto}/${pasta}capas/${arquivo.slice(i + 1)}.jpg`;
}

// `previa`: dados de exemplo, sem ler o banco (para conferir o visual)
export type PreviaCardapios = { vivos: Vivo[]; impressos: Impresso[]; link: Link | null };

export default function Cardapios({ casa, nome, projeto, userEmail, previa }: { casa: string; nome: string; projeto: string; userEmail: string; previa?: PreviaCardapios }) {
  const supabase = useRef(createClient()).current;
  const [vivos, setVivos] = useState<Vivo[] | null>(null);
  const [impressos, setImpressos] = useState<Impresso[]>([]);
  const [link, setLink] = useState<Link | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [mexendo, setMexendo] = useState(false);
  const [origem, setOrigem] = useState("");

  const carregar = useCallback(async () => {
    if (previa) {
      setVivos(previa.vivos);
      setImpressos(previa.impressos);
      setLink(previa.link);
      return;
    }
    const [v, i, l] = await Promise.all([
      supabase.from("cardapios_vivos").select("id,codigo,title,versao,updated_at").eq("workspace_id", projeto).is("arquivado_em", null),
      supabase.from("cardapios_impressos").select("id,codigo,menu_codigo,menu_versao,titulo,descricao,formato,paginas,arquivo,situacao,ordem,atualizado_em").eq("workspace_id", projeto).is("arquivado_em", null).order("ordem"),
      supabase.from("cardapios_links").select("slug,nome,ativo,criado_em").eq("workspace_id", projeto).maybeSingle(),
    ]);
    if (v.error) setErro("Não foi possível ler os menus. Você precisa fazer parte do projeto da casa.");
    setVivos((v.data ?? []) as Vivo[]);
    setImpressos((i.data ?? []) as Impresso[]);
    setLink((l.data as Link | null) ?? null);
  }, [supabase, projeto, previa]);
  useEffect(() => {
    carregar();
    setOrigem(window.location.origin);
  }, [carregar]);

  // ordem dos menus editáveis = a do PDF correspondente; pausado = o PDF dele está pausado
  const porMenu = useMemo(() => new Map(impressos.filter((i) => i.menu_codigo).map((i) => [i.menu_codigo!, i])), [impressos]);
  const editaveis = useMemo(
    () => [...(vivos ?? [])].sort((a, b) => (porMenu.get(a.codigo)?.ordem ?? 999) - (porMenu.get(b.codigo)?.ordem ?? 999) || a.title.localeCompare(b.title)),
    [vivos, porMenu]
  );
  const vivoDe = useMemo(() => new Map((vivos ?? []).map((v) => [v.codigo, v])), [vivos]);
  const ativos = impressos.filter((i) => i.situacao === "ativo").length;

  const url = link ? `${origem}/menus/${link.slug}` : "";
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      prompt("Copie o link:", url);
    }
  }
  async function gerar() {
    if (link && !confirm("Gerar um link novo? O link atual para de abrir na hora (quem já recebeu precisa do novo).")) return;
    setMexendo(true);
    const { error } = await supabase.rpc("cardapios_link_gerar", { p_ws: projeto, p_nome: link?.nome ?? nome });
    setMexendo(false);
    if (error) return alert(error.message);
    carregar();
  }
  async function ligar(ligado: boolean) {
    if (!ligado && !confirm("Desligar o link? Ninguém consegue baixar até você ligar de novo.")) return;
    setMexendo(true);
    const { error } = await supabase.rpc("cardapios_link_ligar", { p_ws: projeto, p_ligado: ligado });
    setMexendo(false);
    if (error) return alert(error.message);
    carregar();
  }

  return (
    <div className="pagina rc-pagina">
      <Topo email={userEmail} ativo={`rest:${casa}/cardapios`} />
      <main className="rc-main">
        <header className="rc-cab">
          <span className="rc-olho">{nome}</span>
          <h1>Cardápios</h1>
          <p>Em cima, os menus que se editam aqui na tela. Embaixo, os PDFs prontos para imprimir e o link para a equipe e o marketing baixarem.</p>
        </header>

        {erro && <div className="rc-erro">{erro}</div>}

        {/* 1 · Editar na tela */}
        <section className="rc-secao">
          <div className="rc-secao-cab">
            <span className="rc-num">1</span>
            <div>
              <h2>Editar na tela</h2>
              <p>Clique num menu para abrir. <b>Editar</b> muda textos e preços ali mesmo; <b>Versões</b> mostra e restaura as anteriores. Prato novo ou arrumação nova: peça ao Claude.</p>
            </div>
          </div>
          {vivos === null ? (
            <div className="rc-grade">{[0, 1, 2, 3].map((k) => <div key={k} className="rc-cartao rc-esqueleto" />)}</div>
          ) : editaveis.length === 0 ? (
            <div className="rc-vazio">Nenhum menu editável nesta casa.</div>
          ) : (
            <div className="rc-grade">
              {editaveis.map((v) => {
                const imp = porMenu.get(v.codigo);
                const pausado = imp?.situacao === "pausado";
                const titulo = v.title.replace(/\s*\(pausado\)\s*$/i, "");
                return (
                  <button key={v.id} type="button" className={`rc-cartao${pausado ? " pausado" : ""}`} data-menu={v.codigo} data-titulo={titulo} data-codigo={imp?.formato ?? ""}>
                    <span className="rc-capa" data-menu-capa={v.codigo} style={imp ? { backgroundImage: `url(${capaDe(projeto, imp.arquivo)})` } : undefined} />
                    <span className="rc-info">
                      <span className="rc-etiquetas">
                        <span className="rc-tag editar">Editável</span>
                        {pausado && <span className="rc-tag pausa">Pausado</span>}
                      </span>
                      <b>{titulo}</b>
                      <span className="rc-meta">{[imp?.formato, imp?.paginas ? `${imp.paginas} ${imp.paginas > 1 ? "páginas" : "página"}` : ""].filter(Boolean).join(" · ")}</span>
                      <span className="rc-rodape">Versão {v.versao} · {dataHora(v.updated_at)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 2 · Para imprimir */}
        <section className="rc-secao">
          <div className="rc-secao-cab">
            <span className="rc-num">2</span>
            <div>
              <h2>Para imprimir</h2>
              <p>Os PDFs no tamanho certo da gráfica. Quando um menu muda na tela, peça ao Claude para gerar o PDF novo: ele troca aqui e no link, que continua o mesmo.</p>
            </div>
          </div>

          {link && (
            <div className={`rc-link${link.ativo ? "" : " desligado"}`}>
              <div className="rc-link-texto">
                <span className="rc-link-titulo">
                  <span className={`rc-ponto${link.ativo ? " on" : ""}`} aria-hidden="true" />
                  {link.ativo ? "Link público para baixar" : "Link público desligado"}
                </span>
                <span className="rc-link-desc">
                  {link.ativo
                    ? `Quem tiver o link baixa os ${ativos} cardápios ativos, sem login. Mande no grupo da casa e para o marketing.`
                    : "Ninguém consegue abrir agora. Ligue de novo para voltar a funcionar no mesmo endereço."}
                </span>
                <code className="rc-url">{url || `/menus/${link.slug}`}</code>
              </div>
              <div className="rc-link-acoes">
                {link.ativo ? (
                  <>
                    <button type="button" className="rc-botao forte" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar link"}</button>
                    <a className="rc-botao" href={`/menus/${link.slug}`} target="_blank" rel="noreferrer">Abrir a página</a>
                    <details className="rc-mais">
                      <summary className="rc-botao">Mais</summary>
                      <div>
                        <button type="button" onClick={gerar} disabled={mexendo}>Gerar link novo (derruba o atual)</button>
                        <button type="button" onClick={() => ligar(false)} disabled={mexendo}>Desligar o link</button>
                      </div>
                    </details>
                  </>
                ) : (
                  <button type="button" className="rc-botao forte" onClick={() => ligar(true)} disabled={mexendo}>Ligar o link</button>
                )}
              </div>
            </div>
          )}
          {!link && vivos !== null && !erro && (
            <div className="rc-link desligado">
              <div className="rc-link-texto">
                <span className="rc-link-titulo">Sem link público</span>
                <span className="rc-link-desc">Gere um link para a equipe e o marketing baixarem os PDFs sem login.</span>
              </div>
              <div className="rc-link-acoes"><button type="button" className="rc-botao forte" onClick={gerar} disabled={mexendo}>Gerar link</button></div>
            </div>
          )}

          {impressos.length === 0 ? (
            vivos !== null && <div className="rc-vazio">Nenhum PDF para imprimir ainda.</div>
          ) : (
            <div className="rc-grade">
              {impressos.map((i) => {
                const pdf = `/api/arquivo/${projeto}/${i.arquivo}.pdf`;
                const v = i.menu_codigo ? vivoDe.get(i.menu_codigo) : undefined;
                // o menu editável foi salvo de novo depois da versão que este PDF mostra
                const atrasado = !!v && i.menu_versao != null && v.versao > i.menu_versao;
                return (
                  <div key={i.id} className={`rc-cartao rc-pdf${i.situacao === "pausado" ? " pausado" : ""}`}>
                    <a className="rc-capa" href={pdf} target="_blank" rel="noreferrer" aria-label={`Abrir o PDF ${i.titulo}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={capaDe(projeto, i.arquivo)} alt="" loading="lazy" />
                    </a>
                    <span className="rc-info">
                      <span className="rc-etiquetas">
                        <span className="rc-tag pdf">PDF</span>
                        {i.situacao === "pausado" ? <span className="rc-tag pausa" title="Pausado: fica fora do link público">Pausado</span> : link?.ativo && <span className="rc-tag link">No link</span>}
                      </span>
                      <b>{i.titulo}</b>
                      <span className="rc-meta">{[i.formato, i.paginas ? `${i.paginas} ${i.paginas > 1 ? "páginas" : "página"}` : ""].filter(Boolean).join(" · ")}</span>
                      {atrasado ? (
                        <span className="rc-alerta">O menu foi editado na tela (versão {v!.versao}, {dataHora(v!.updated_at)}). Peça ao Claude o PDF novo.</span>
                      ) : (
                        <span className="rc-rodape">PDF de {data(i.atualizado_em)}{i.situacao === "pausado" ? " · fora do link" : v ? " · igual ao da tela" : ""}</span>
                      )}
                      <span className="rc-acoes">
                        <a className="rc-botao" href={pdf} target="_blank" rel="noreferrer">Abrir</a>
                        <a className="rc-botao forte" href={`${pdf}?baixar`}>Baixar</a>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <VisorMenu projectId={projeto} />
    </div>
  );
}
