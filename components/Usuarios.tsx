"use client";

// Usuários (/usuarios, só os sócios): todos os logins da equipe (operacao_pessoas) num lugar só — quem é, o
// usuário de entrada, o último acesso e o que cada um abre: Compras, Câmara fria e Escala (os grupos que
// lidera). Clicar abre o painel para mudar os dados, criar ou trocar a senha e escolher os grupos da escala.
// Os logins das Compras são reaproveitados: basta marcar os grupos da escala. Nada se apaga: desativar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { ChipsAcesso, NOME_TIPO, PainelAcesso, ProjetosRestritos, nomeAcesso, type PessoaAcesso, type ProjetoAcesso } from "./AcessosSite";
import SeuClaude from "./SeuClaude";

type Usuario = {
  id: string; user_id: string | null; nome: string; papel: Papel; unidade: string; setor: string; wa_nome: string; ativo: boolean; registra_estoque: boolean;
  tem_login: boolean; usuario: string; ultimo_acesso: string | null; criado_em: string; grupos: string[];
  // Casas inteiras que lidera na escala (escala_lideres_locais; 15/11/2026)
  casas?: string[];
};
type Grupo = { id: string; nome: string; local: string; setor: string; pessoas: number };
type Papel = "solicitante" | "compras" | "estoque" | "lider";
const PAPEIS: { id: Papel; nome: string; texto: string }[] = [
  { id: "solicitante", nome: "Pede compras", texto: "faz os pedidos da casa no grupo COMPRAS e aprova a lista dela" },
  { id: "compras", nome: "Setor de compras", texto: "junta as listas, faz os pedidos e vê as notas (a Fernanda)" },
  { id: "estoque", nome: "Câmara fria", texto: "registra entradas e saídas da câmara fria e a produção" },
  { id: "lider", nome: "Só escala", texto: "abre só a escala dos grupos que lidera" },
];
const UNIDADES: Record<string, string> = { cicchetti_centro: "Cicchetti Centro", sempre_vivo: "Sempre Vivo", filha_da_lua: "Filha da Lua" };
const SETORES: Record<string, string> = { bar: "Bar", cozinha: "Cozinha", salao: "Salão", producao: "Produção" };
const FILTROS = ["Todos", "Administradores", "Com Claude", "Só o site", "Equipe das casas", "Escala", "Sem login", "Desativados"] as const;
type Filtro = (typeof FILTROS)[number];
// Uma lista só: quem entra pelo login dos sócios (acessos ao site) e a equipe das casas (operacao_pessoas)
type Linha = { tipo: "acesso"; p: PessoaAcesso; nome: string } | { tipo: "equipe"; u: Usuario; nome: string };

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
function quando(iso: string | null) {
  if (!iso) return "nunca entrou";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return "entrou hoje";
  if (dias === 1) return "entrou ontem";
  if (dias < 30) return `entrou há ${dias} dias`;
  return `entrou em ${new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}`;
}
const abreCompras = (u: Usuario) => u.papel === "solicitante" || u.papel === "compras";
const abreCamara = (u: Usuario) => u.papel === "estoque" || u.registra_estoque;

export default function Usuarios({ userId, userEmail, cliente }: { userId?: string; userEmail: string; cliente?: ReturnType<typeof createClient> }) {
  const supabase = useMemo(() => cliente ?? createClient(), [cliente]);
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [acessos, setAcessos] = useState<PessoaAcesso[]>([]);
  const [projetos, setProjetos] = useState<ProjetoAcesso[]>([]);
  const [admin, setAdmin] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [podeClaude, setPodeClaude] = useState(false);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("Todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<Usuario | "novo" | null>(null);
  const [acessoAberto, setAcessoAberto] = useState<PessoaAcesso | null>(null);
  const [verRestritos, setVerRestritos] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const [u, g, a, eu] = await Promise.all([
      supabase.rpc("usuarios_lista"), supabase.rpc("usuarios_grupos_escala"), supabase.rpc("acessos_lista"), supabase.rpc("minhas_areas"),
    ]);
    // admin (vê a lista de acessos) ou editor (área conectar) conecta o Claude aqui
    const areas = eu.data as string[] | null;
    setPodeClaude(!a.error || (Array.isArray(areas) && areas.includes("conectar")));
    setAdmin(!a.error);
    if (!a.error) {
      const d = a.data as { pessoas: PessoaAcesso[]; projetos: ProjetoAcesso[] };
      setAcessos(d.pessoas);
      setProjetos(d.projetos);
    }
    if (!u.error) {
      setLista((u.data ?? []) as Usuario[]);
      setGrupos((g.data ?? []) as Grupo[]);
    } else if (!a.error) setErro(u.error.message);
    setCarregado(true);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const nomeGrupo = new Map(grupos.map((g) => [g.id, g.nome]));
  // Lidera a escala: por setor (grupos) ou a casa inteira (casas)
  const lideraEscala = (u: Usuario) => u.grupos.length > 0 || (u.casas?.length ?? 0) > 0;
  const lideraGrupo = (u: Usuario, g: Grupo) => u.grupos.includes(g.id) || !!u.casas?.includes(g.local);

  // todos numa lista só; quem já está nos acessos ao site não se repete na equipe
  const comAcesso = new Set(acessos.map((p) => p.id));
  const linhas: Linha[] = [
    ...acessos.map((p) => ({ tipo: "acesso" as const, p, nome: nomeAcesso(p) })),
    ...(lista ?? []).filter((u) => !u.user_id || !comAcesso.has(u.user_id)).map((u) => ({ tipo: "equipe" as const, u, nome: u.nome })),
  ];
  const ativa = (l: Linha) => l.tipo === "acesso" || l.u.ativo;
  const passa: Record<Filtro, (l: Linha) => boolean> = {
    Todos: ativa,
    Administradores: (l) => l.tipo === "acesso" && l.p.tipo === "admin",
    "Com Claude": (l) => l.tipo === "acesso" && l.p.claude,
    "Só o site": (l) => l.tipo === "acesso" && l.p.tipo !== "admin",
    "Equipe das casas": (l) => l.tipo === "equipe" && l.u.ativo,
    Escala: (l) => l.tipo === "equipe" && l.u.ativo && lideraEscala(l.u),
    "Sem login": (l) => l.tipo === "equipe" && l.u.ativo && !l.u.tem_login,
    Desativados: (l) => l.tipo === "equipe" && !l.u.ativo,
  };
  const termo = busca.trim().toLowerCase();
  const vistos = linhas.filter(passa[filtro]).filter((l) => !termo || l.nome.toLowerCase().includes(termo)
    || (l.tipo === "equipe" ? l.u.usuario : l.p.email ?? "").toLowerCase().includes(termo));
  const ativos = (lista ?? []).filter((u) => u.ativo);
  const semLider = grupos.filter((g) => !ativos.some((u) => lideraGrupo(u, g)));
  const restritos = projetos.filter((p) => p.restrito).length;

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="usuarios" />
      <main className="miolo es es-sistema us">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Companhia · Acessos</span>
            <h1>Usuários</h1>
            <p className="muted">Todo mundo que entra no Brasico num lugar só: os sócios, quem conecta o Claude e a equipe das casas, e o que cada um pode ver ou editar.</p>
          </div>
          {admin && (
            <span className="us-botoes">
              <button className="ghost small" onClick={() => setVerRestritos(true)}>Projetos restritos{restritos ? ` · ${restritos}` : ""}</button>
              <button className="small" onClick={() => setAberto("novo")}>Novo usuário</button>
            </span>
          )}
        </div>
        {erro && <p className="tv-alerta">{erro}</p>}
        {aviso && <p className="es-aviso">{aviso}</p>}

        {podeClaude && userId && <SeuClaude supabase={supabase} userId={userId} userEmail={userEmail} />}

        {!carregado ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div> : admin && (
          <>
            <div className="es-numeros">
              <Numero rotulo="Pessoas" valor={linhas.filter(ativa).length} detalhe={`${acessos.length} pelo login dos sócios`} />
              <Numero rotulo="Com Claude" valor={acessos.filter((p) => p.claude).length} detalhe={`${acessos.filter((p) => p.tipo === "admin").length} administradores`} />
              <Numero rotulo="Equipe das casas" valor={ativos.length} detalhe={`${ativos.filter(abreCompras).length} em compras · ${ativos.filter(abreCamara).length} na câmara fria`} />
              <Numero rotulo="Líderes de escala" valor={ativos.filter(lideraEscala).length}
                detalhe={semLider.length ? `${semLider.length} grupo${semLider.length === 1 ? "" : "s"} sem líder` : "todos os grupos com líder"} alerta={semLider.length > 0} />
            </div>

            <div className="us-filtros">
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, usuário ou e-mail" aria-label="Buscar usuário" />
              <div className="es-segmentos" role="tablist" aria-label="Filtro">
                {FILTROS.map((f) => (
                  <button key={f} role="tab" aria-selected={filtro === f} className={filtro === f ? "on" : ""} onClick={() => setFiltro(f)}>
                    {f} <span className="muted">{linhas.filter(passa[f]).length}</span>
                  </button>
                ))}
              </div>
            </div>

            <ul className="us-lista">
              {vistos.map((l) => l.tipo === "acesso" ? (
                <li key={`a${l.p.id}`}>
                  <button className="us-cartao" onClick={() => setAcessoAberto(l.p)}>
                    <span className={`us-avatar${l.p.tipo === "admin" ? " admin" : ""}`} aria-hidden="true">{iniciais(l.nome)}</span>
                    <span className="us-quem">
                      <strong>{l.nome}</strong>
                      <span className="muted">{l.p.tipo ? NOME_TIPO[l.p.tipo] : "Login dos sócios"}{l.p.claude ? " · Claude conectado" : ""} · {quando(l.p.ultimo_acesso)}</span>
                    </span>
                    <span className="us-acessos"><ChipsAcesso p={l.p} /></span>
                  </button>
                </li>
              ) : (
                <li key={l.u.id}>
                  <button className={`us-cartao${l.u.ativo ? "" : " desativado"}`} onClick={() => setAberto(l.u)}>
                    <span className="us-avatar" aria-hidden="true">{iniciais(l.u.nome)}</span>
                    <span className="us-quem">
                      <strong>{l.u.nome}</strong>
                      <span className="muted">Equipe das casas · {l.u.tem_login ? <>usuário <b>{l.u.usuario}</b></> : "sem login"} · {quando(l.u.ultimo_acesso)}</span>
                    </span>
                    <span className="us-acessos">
                      {abreCompras(l.u) && <i className="us-chip compras">{l.u.papel === "compras" ? "Setor de compras" : `Compras${l.u.unidade ? ` · ${UNIDADES[l.u.unidade] ?? l.u.unidade}` : ""}`}</i>}
                      {l.u.papel === "compras" && <i className="us-chip notas">Notas</i>}
                      {abreCamara(l.u) && <i className="us-chip camara">Câmara fria</i>}
                      {(l.u.casas ?? []).map((c) => <i key={`c${c}`} className="us-chip escala">Escala · {c} (casa inteira)</i>)}
                      {l.u.grupos.filter((g) => !l.u.casas?.includes(grupos.find((x) => x.id === g)?.local ?? "")).map((g) => <i key={g} className="us-chip escala">Escala · {nomeGrupo.get(g) ?? "grupo"}</i>)}
                      {!abreCompras(l.u) && !abreCamara(l.u) && !lideraEscala(l.u) && <i className="us-chip nada">sem acesso a nada</i>}
                    </span>
                    {!l.u.ativo && <span className="es-selo">desativado</span>}
                  </button>
                </li>
              ))}
              {vistos.length === 0 && <li className="muted tv-nada">Ninguém neste filtro.</li>}
            </ul>

            {semLider.length > 0 && (
              <section className="es-bloco us-semlider">
                <h2>Grupos da escala sem líder</h2>
                <p className="muted">Abra um usuário da equipe e marque o grupo na parte Escala. Os grupos acompanham os locais e setores da escala do RH.</p>
                <div className="us-chips">{semLider.map((g) => <i key={g.id} className="us-chip escala">{g.nome} · {g.pessoas} pessoas</i>)}</div>
              </section>
            )}
          </>
        )}
      </main>
      {aberto && (
        <Painel usuario={aberto === "novo" ? null : aberto} grupos={grupos} supabase={supabase}
          onFechar={() => setAberto(null)}
          onSalvo={(texto) => { setAberto(null); setAviso(texto); carregar(); }} />
      )}
      {acessoAberto && (
        <PainelAcesso pessoa={acessoAberto} supabase={supabase} onFechar={() => setAcessoAberto(null)}
          onSalvo={(texto) => { setAcessoAberto(null); setAviso(texto); carregar(); }} />
      )}
      {verRestritos && (
        <ProjetosRestritos projetos={projetos} supabase={supabase} onFechar={() => setVerRestritos(false)} onMudou={carregar} />
      )}
    </div>
  );
}

function Numero({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: number; detalhe: string; alerta?: boolean }) {
  return (
    <div className="es-numero">
      <span className="tv-cartao-rotulo">{rotulo}</span>
      <span className="es-numero-valor">{valor}</span>
      <span className={`tv-cartao-detalhe${alerta ? " es-ruim" : ""}`}>{detalhe}</span>
    </div>
  );
}

function Painel({ usuario, grupos, supabase, onFechar, onSalvo }: {
  usuario: Usuario | null; grupos: Grupo[]; supabase: ReturnType<typeof createClient>;
  onFechar: () => void; onSalvo: (texto: string) => void;
}) {
  const [f, setF] = useState({
    nome: usuario?.nome ?? "", papel: usuario?.papel ?? ("lider" as Papel), unidade: usuario?.unidade ?? "", setor: usuario?.setor ?? "",
    wa_nome: usuario?.wa_nome ?? "", registra_estoque: usuario?.registra_estoque ?? false, ativo: usuario?.ativo ?? true,
    grupos: new Set(usuario?.grupos ?? []), usuario: usuario?.tem_login ? usuario.usuario : "", senha: "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const locais = [...new Set(grupos.map((g) => g.local))].sort();
  const mudarGrupo = (id: string) => setF((x) => {
    const g = new Set(x.grupos);
    if (g.has(id)) g.delete(id);
    else g.add(id);
    return { ...x, grupos: g };
  });

  async function salvar() {
    setErro("");
    if (f.senha && f.senha.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.");
    if (f.senha && !f.usuario.trim()) return setErro("Informe o usuário para a senha.");
    if (!usuario && !f.senha) return setErro("Para um usuário novo, informe o usuário e a senha de entrada.");
    setSalvando(true);
    const { data: id, error } = await supabase.rpc("usuarios_salvar", {
      p_id: usuario?.id ?? null, p_nome: f.nome, p_papel: f.papel, p_unidade: f.unidade, p_setor: f.setor,
      p_wa_nome: f.wa_nome, p_registra_estoque: f.registra_estoque, p_ativo: f.ativo,
    });
    if (error) { setSalvando(false); return setErro(error.message); }
    const g = await supabase.rpc("usuarios_escala_grupos", { p_pessoa: id, p_grupos: [...f.grupos] });
    if (g.error) { setSalvando(false); return setErro(g.error.message); }
    if (f.senha) {
      const l = await supabase.rpc("operacao_definir_login", { p_pessoa: id, p_usuario: f.usuario, p_senha: f.senha });
      if (l.error) { setSalvando(false); return setErro(l.error.message); }
    }
    setSalvando(false);
    onSalvo(f.senha ? `${f.nome}: salvo. Usuário "${f.usuario.trim().toLowerCase()}" com a senha nova — entra em brasico.vercel.app/colaboradores.` : `${f.nome}: salvo.`);
  }

  return (
    <div className="us-fundo" onClick={onFechar}>
      <aside className="us-painel" role="dialog" aria-label={usuario ? `Editar ${usuario.nome}` : "Novo usuário"} onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="us-avatar grande" aria-hidden="true">{iniciais(f.nome || "?")}</span>
          <div><h2>{usuario ? usuario.nome : "Novo usuário"}</h2><p className="muted">{usuario ? quando(usuario.ultimo_acesso) : "login de colaborador (usuário e senha)"}</p></div>
          <button className="us-x" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <section>
          <h3>Quem é</h3>
          <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
          <div className="us-duas">
            <label>Casa<select value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>
              <option value="">—</option>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
            <label>Setor<select value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}>
              <option value="">—</option>{Object.entries(SETORES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          </div>
          <label>Nome no WhatsApp<input value={f.wa_nome} onChange={(e) => setF({ ...f, wa_nome: e.target.value })} placeholder="como aparece no grupo COMPRAS" /></label>
        </section>

        <section>
          <h3>O que acessa</h3>
          <div className="us-papeis" role="radiogroup" aria-label="Área principal">
            {PAPEIS.map((p) => (
              <button key={p.id} role="radio" aria-checked={f.papel === p.id} className={f.papel === p.id ? "on" : ""} onClick={() => setF({ ...f, papel: p.id })}>
                <b>{p.nome}</b><small>{p.texto}</small>
              </button>
            ))}
          </div>
          {f.papel !== "estoque" && (
            <label className="us-check"><input type="checkbox" checked={f.registra_estoque} onChange={(e) => setF({ ...f, registra_estoque: e.target.checked })} />
              Também registra a câmara fria</label>
          )}
          <h4>Escala · grupos que lidera</h4>
          {(usuario?.casas?.length ?? 0) > 0 && (
            <p className="es-aviso us-ajuda">Lidera a casa inteira: <b>{usuario!.casas!.join(", ")}</b> (todos os setores, inclusive os novos). Para mudar isso, use as bolinhas de líder no cabeçalho da casa, na página Escala.</p>
          )}
          <p className="muted us-ajuda">Vê, monta e compara a escala só desses grupos. Quem já tem login de Compras passa a abrir também a Escala.</p>
          {grupos.length === 0 ? <p className="muted">Os grupos aparecem depois que alguém abre a escala Planejada no RH.</p> : locais.map((l) => (
            <div key={l} className="us-grupos">
              <span>{l}</span>
              {grupos.filter((g) => g.local === l).map((g) => (
                <label key={g.id} className={`us-grupo${f.grupos.has(g.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={f.grupos.has(g.id)} onChange={() => mudarGrupo(g.id)} />
                  {g.setor || "Todo o local"} <small>{g.pessoas}</small>
                </label>
              ))}
            </div>
          ))}
        </section>

        <section>
          <h3>Login</h3>
          {usuario?.tem_login && <p className="muted us-ajuda">Entra com o usuário <b>{usuario.usuario}</b>. Para trocar a senha, digite a nova abaixo.</p>}
          <div className="us-duas">
            <label>Usuário<input value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} placeholder="primeiro nome" autoComplete="off" /></label>
            <label>{usuario?.tem_login ? "Nova senha" : "Senha"}<input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="8 ou mais caracteres" autoComplete="new-password" /></label>
          </div>
          <p className="muted us-ajuda">A senha não fica guardada à vista em lugar nenhum: combine com a pessoa e ela pode trocar depois em "Trocar senha".</p>
        </section>

        <section>
          <label className="us-check"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            Ativo {f.ativo ? "" : "(não entra mais em nada; o histórico fica)"}</label>
        </section>

        {erro && <p className="tv-alerta">{erro}</p>}
        <footer>
          <button className="ghost small" onClick={onFechar}>Cancelar</button>
          <button className="small" onClick={salvar} disabled={salvando || !f.nome.trim()}>{salvando ? "Salvando…" : "Salvar"}</button>
        </footer>
      </aside>
    </div>
  );
}
