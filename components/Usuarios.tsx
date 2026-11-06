"use client";

// Usuários (/usuarios, só os sócios): todos os logins da equipe (operacao_pessoas) num lugar só — quem é, o
// usuário de entrada, o último acesso e o que cada um abre: Compras, Câmara fria e Escala (os grupos que
// lidera). Clicar abre o painel para mudar os dados, criar ou trocar a senha e escolher os grupos da escala.
// Os logins das Compras são reaproveitados: basta marcar os grupos da escala. Nada se apaga: desativar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

type Usuario = {
  id: string; nome: string; papel: Papel; unidade: string; setor: string; wa_nome: string; ativo: boolean; registra_estoque: boolean;
  tem_login: boolean; usuario: string; ultimo_acesso: string | null; criado_em: string; grupos: string[];
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
const FILTROS = ["Ativos", "Compras", "Câmara fria", "Escala", "Sem login", "Desativados"] as const;
type Filtro = (typeof FILTROS)[number];

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

export default function Usuarios({ userEmail, cliente }: { userEmail: string; cliente?: ReturnType<typeof createClient> }) {
  const supabase = useMemo(() => cliente ?? createClient(), [cliente]);
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("Ativos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<Usuario | "novo" | null>(null);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const [u, g] = await Promise.all([supabase.rpc("usuarios_lista"), supabase.rpc("usuarios_grupos_escala")]);
    if (u.error) return setErro(u.error.message);
    setLista((u.data ?? []) as Usuario[]);
    setGrupos((g.data ?? []) as Grupo[]);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const nomeGrupo = new Map(grupos.map((g) => [g.id, g.nome]));
  const termo = busca.trim().toLowerCase();
  const passa: Record<Filtro, (u: Usuario) => boolean> = {
    Ativos: (u) => u.ativo, Compras: (u) => u.ativo && abreCompras(u), "Câmara fria": (u) => u.ativo && abreCamara(u),
    Escala: (u) => u.ativo && u.grupos.length > 0, "Sem login": (u) => u.ativo && !u.tem_login, Desativados: (u) => !u.ativo,
  };
  const vistos = (lista ?? []).filter(passa[filtro]).filter((u) => !termo || u.nome.toLowerCase().includes(termo) || u.usuario.toLowerCase().includes(termo));
  const ativos = (lista ?? []).filter((u) => u.ativo);
  const semLider = grupos.filter((g) => !ativos.some((u) => u.grupos.includes(g.id)));

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="usuarios" />
      <main className="miolo es es-sistema us">
        <div className="es-topo">
          <div>
            <span className="es-sobre">Companhia · Acessos</span>
            <h1>Usuários</h1>
            <p className="muted">Quem da equipe entra no Brasico, com qual usuário, e o que cada um abre. A equipe entra em brasico.vercel.app/colaboradores.</p>
          </div>
          <button className="small" onClick={() => setAberto("novo")}>Novo usuário</button>
        </div>
        {erro && <p className="tv-alerta">{erro}</p>}
        {aviso && <p className="es-aviso">{aviso}</p>}

        {!lista ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div> : (
          <>
            <div className="es-numeros">
              <Numero rotulo="Ativos" valor={ativos.length} detalhe={`${ativos.filter((u) => u.tem_login).length} com login`} />
              <Numero rotulo="Compras" valor={ativos.filter(abreCompras).length} detalhe="pedem ou compram" />
              <Numero rotulo="Câmara fria" valor={ativos.filter(abreCamara).length} detalhe="registram o estoque" />
              <Numero rotulo="Líderes de escala" valor={ativos.filter((u) => u.grupos.length).length}
                detalhe={semLider.length ? `${semLider.length} grupo${semLider.length === 1 ? "" : "s"} sem líder` : "todos os grupos com líder"} alerta={semLider.length > 0} />
            </div>

            <div className="us-filtros">
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou usuário" aria-label="Buscar usuário" />
              <div className="es-segmentos" role="tablist" aria-label="Filtro">
                {FILTROS.map((f) => (
                  <button key={f} role="tab" aria-selected={filtro === f} className={filtro === f ? "on" : ""} onClick={() => setFiltro(f)}>
                    {f} <span className="muted">{(lista ?? []).filter(passa[f]).length}</span>
                  </button>
                ))}
              </div>
            </div>

            <ul className="us-lista">
              {vistos.map((u) => (
                <li key={u.id}>
                  <button className={`us-cartao${u.ativo ? "" : " desativado"}`} onClick={() => setAberto(u)}>
                    <span className="us-avatar" aria-hidden="true">{iniciais(u.nome)}</span>
                    <span className="us-quem">
                      <strong>{u.nome}</strong>
                      <span className="muted">{u.tem_login ? <>usuário <b>{u.usuario}</b></> : "sem login"} · {quando(u.ultimo_acesso)}</span>
                    </span>
                    <span className="us-acessos">
                      {abreCompras(u) && <i className="us-chip compras">{u.papel === "compras" ? "Setor de compras" : `Compras${u.unidade ? ` · ${UNIDADES[u.unidade] ?? u.unidade}` : ""}`}</i>}
                      {u.papel === "compras" && <i className="us-chip notas">Notas</i>}
                      {abreCamara(u) && <i className="us-chip camara">Câmara fria</i>}
                      {u.grupos.map((g) => <i key={g} className="us-chip escala">Escala · {nomeGrupo.get(g) ?? "grupo"}</i>)}
                      {!abreCompras(u) && !abreCamara(u) && !u.grupos.length && <i className="us-chip nada">sem acesso a nada</i>}
                    </span>
                    {!u.ativo && <span className="es-selo">desativado</span>}
                  </button>
                </li>
              ))}
              {vistos.length === 0 && <li className="muted tv-nada">Ninguém neste filtro.</li>}
            </ul>

            {semLider.length > 0 && (
              <section className="es-bloco us-semlider">
                <h2>Grupos da escala sem líder</h2>
                <p className="muted">Abra um usuário e marque o grupo na parte Escala. Os grupos acompanham os locais e setores da escala do RH.</p>
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
