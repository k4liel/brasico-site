"use client";

// Peças dos acessos ao site (página Usuários; supabase/acessos.sql). Cada pessoa do login dos sócios tem um
// tipo — Administrador (edita tudo e conecta o Claude), Editor com Claude (conecta o Claude com limites) ou
// Usuário (só o site) — e, área por área, nada / ver / editar. A trava é do banco (gatilho acesso_guarda):
// quem só vê não grava nada, nem pelo Claude. Projetos restritos ficam só com os administradores.
import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import Gaveta from "./Gaveta";

export type Tipo = "admin" | "editor" | "usuario";
type Nivel = "" | "ver" | "editar";
export type PessoaAcesso = {
  id: string; nome: string | null; email: string | null; tipo: Tipo | null;
  areas: Record<string, "ver" | "editar">; papel_antigo: string | null; claude: boolean; ultimo_acesso: string | null;
};
export type ProjetoAcesso = { id: string; nome: string; restrito: boolean };

export const AREAS: { id: string; nome: string; texto: string }[] = [
  { id: "projetos", nome: "Projetos", texto: "documentos dos projetos (menos os restritos)" },
  { id: "brainstorm", nome: "Brainstorm", texto: "quadro de tarefas e ideias" },
  { id: "hoteis", nome: "Hotéis · dados do PMS", texto: "reservas, mapa, hóspedes e números dos dois hotéis" },
  { id: "op_filha_da_lua", nome: "Operação · Filha da Lua", texto: "área de criação: editar = o Claude cria tabelas e telas" },
  { id: "op_sempre_vivo", nome: "Operação · Sempre Vivo", texto: "área de criação: editar = o Claude cria tabelas e telas" },
  { id: "totvs", nome: "Vendas", texto: "faturamento das casas (TOTVS)" },
  { id: "operacao", nome: "Operação", texto: "notas, compras, fichas, câmara fria" },
  { id: "rh", nome: "RH e escala", texto: "equipe, ponto, folha e escala" },
  { id: "receita", nome: "Fiscal", texto: "Receita Federal, dívidas e certidões" },
  { id: "whatsapp", nome: "WhatsApp", texto: "conversas e resumos dos grupos" },
  { id: "integracoes", nome: "Integrações", texto: "painel das ligações com os sistemas" },
  { id: "certificados", nome: "Certificados", texto: "certificados digitais das empresas" },
  { id: "usuarios", nome: "Usuários", texto: "esta página" },
];
const TIPOS: { id: Tipo; nome: string; texto: string }[] = [
  { id: "admin", nome: "Administrador", texto: "vê e edita tudo, gerencia os acessos e conecta o Claude" },
  { id: "editor", nome: "Editor com Claude", texto: "conecta o Claude e edita só as áreas marcadas como Editar" },
  { id: "usuario", nome: "Só o site", texto: "entra pelo site, sem Claude; cada área nada, ver ou editar" },
];
export const NOME_TIPO: Record<Tipo, string> = { admin: "Administrador", editor: "Editor com Claude", usuario: "Só o site" };
export const nomeAcesso = (p: PessoaAcesso) => p.nome || p.email?.split("@")[0] || "Sem nome";

// chips do cartão: o que a pessoa abre
export function ChipsAcesso({ p }: { p: PessoaAcesso }) {
  if (!p.tipo) return <i className="us-chip nada">regras antigas · ainda não organizado</i>;
  if (p.tipo === "admin") return <i className="us-chip ac-tudo">tudo, com edição</i>;
  const marcadas = AREAS.filter((a) => p.areas[a.id]);
  if (!marcadas.length) return <i className="us-chip nada">sem acesso a nada</i>;
  return (
    <>
      {marcadas.map((a) => (
        <i key={a.id} className={`us-chip ${p.areas[a.id] === "editar" ? "ac-editar" : "ac-ver"}`}>
          {a.nome} · {p.areas[a.id] === "editar" ? "edita" : "vê"}
        </i>
      ))}
    </>
  );
}


// Link de 1 hora para a pessoa criar ou trocar a própria senha (função acessos-convidar; ninguém digita senha por ela).
async function pedirLinkSenha(supabase: ReturnType<typeof createClient>, email: string, nome = "") {
  const { data, error } = await supabase.functions.invoke("acessos-convidar", { body: { email, nome } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(corpo?.erro ?? "Não consegui gerar o link.");
  }
  return data as { link: string; user_id: string; novo: boolean };
}

function LinkSenha({ link, nome }: { link: string; nome: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="ac-link">
      <p>Mande este link para <strong>{nome}</strong> (pelo WhatsApp, por exemplo). Ela abre, escolhe a própria senha e já entra. Vale <strong>1 hora</strong> e uma vez só; depois disso, gere outro.</p>
      <div className="ac-link-caixa">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link para criar a senha" />
        <button className="small" onClick={async () => { await navigator.clipboard.writeText(link); setCopiado(true); }}>{copiado ? "Copiado" : "Copiar"}</button>
      </div>
    </div>
  );
}

export function NovoLogin({ supabase, onFechar, onCriado }: {
  supabase: ReturnType<typeof createClient>; onFechar: () => void; onCriado: () => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [link, setLink] = useState("");

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setErro("");
    try {
      const r = await pedirLinkSenha(supabase, email, nome);
      setLink(r.link);
      onCriado();
    } catch (x) { setErro((x as Error).message); }
    setOcupado(false);
  }

  return (
    <Gaveta titulo="Novo login" sub="Para sócios e editores com Claude (entram por e-mail)." fechar={onFechar}>
      {link ? (
        <>
          <LinkSenha link={link} nome={nome || email} />
          <p className="muted ac-nota">A pessoa começa sem acesso a nada. Abra o cartão dela na lista para marcar o tipo e as áreas.</p>
          <div className="ac-acoes"><button className="ghost" onClick={onFechar}>Fechar</button></div>
        </>
      ) : (
        <form onSubmit={criar} className="ac-form">
          <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Camila" /></label>
          <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" autoCapitalize="none" /></label>
          <p className="muted ac-nota">Ninguém digita a senha por ela: o site gera um link para ela mesma criar a senha.</p>
          {erro && <p className="tv-alerta">{erro}</p>}
          <div className="ac-acoes">
            <button disabled={ocupado || !email.includes("@")}>{ocupado ? "Criando…" : "Criar e gerar o link"}</button>
            <button type="button" className="ghost" onClick={onFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Gaveta>
  );
}

export function PainelAcesso({ pessoa, supabase, onFechar, onSalvo }: {
  pessoa: PessoaAcesso; supabase: ReturnType<typeof createClient>; onFechar: () => void; onSalvo: (texto: string) => void;
}) {
  const [tipo, setTipo] = useState<Tipo>(pessoa.tipo ?? "usuario");
  const [areas, setAreas] = useState<Record<string, Nivel>>(() => ({ ...pessoa.areas }));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [link, setLink] = useState("");
  const porEmail = !!pessoa.email && !pessoa.email.endsWith("@usuarios.brasico");

  async function gerarLink() {
    setErro("");
    try { setLink((await pedirLinkSenha(supabase, pessoa.email!)).link); } catch (x) { setErro((x as Error).message); }
  }

  const todas = (n: Nivel) => setAreas(Object.fromEntries(AREAS.map((a) => [a.id, n])));

  async function salvar() {
    setSalvando(true);
    setErro("");
    const limpas = Object.fromEntries(Object.entries(areas).filter(([, n]) => n));
    const { error } = await supabase.rpc("acessos_salvar", { p_user: pessoa.id, p_tipo: tipo, p_areas: limpas });
    setSalvando(false);
    if (error) return setErro(error.message);
    onSalvo(`Acessos de ${nomeAcesso(pessoa)} salvos.`);
  }

  return (
    <Gaveta titulo={nomeAcesso(pessoa)} sub={pessoa.email?.endsWith("@usuarios.brasico") ? `usuário ${pessoa.email.split("@")[0]}` : pessoa.email ?? undefined} fechar={onFechar}>
      {!pessoa.tipo && (
        <p className="es-aviso">Esta pessoa ainda segue as regras antigas. Ao salvar, passa a valer só o que estiver marcado aqui.</p>
      )}
      <h3 className="ac-titulo">Tipo de acesso</h3>
      <div className="ac-tipos" role="radiogroup" aria-label="Tipo de acesso">
        {TIPOS.map((t) => (
          <button key={t.id} role="radio" aria-checked={tipo === t.id} className={`ac-tipo${tipo === t.id ? " on" : ""}`} onClick={() => setTipo(t.id)}>
            <strong>{t.nome}</strong>
            <span className="muted">{t.texto}</span>
          </button>
        ))}
      </div>

      {tipo !== "admin" && (
        <>
          <div className="ac-areas-cabeca">
            <h3 className="ac-titulo">O que pode em cada área</h3>
            <span className="ac-atalhos">
              <button className="ghost small" onClick={() => todas("")}>Nada</button>
              <button className="ghost small" onClick={() => todas("ver")}>Ver tudo</button>
            </span>
          </div>
          <ul className="ac-areas">
            {AREAS.map((a) => (
              <li key={a.id}>
                <span className="ac-area-nome"><strong>{a.nome}</strong><span className="muted">{a.texto}</span></span>
                <span className="es-segmentos ac-nivel" role="radiogroup" aria-label={a.nome}>
                  {(["", "ver", "editar"] as Nivel[]).map((n) => (
                    <button key={n || "nada"} role="radio" aria-checked={(areas[a.id] ?? "") === n}
                      className={(areas[a.id] ?? "") === n ? "on" : ""}
                      onClick={() => setAreas({ ...areas, [a.id]: n })}>
                      {n === "" ? "Nada" : n === "ver" ? "Ver" : "Editar"}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {tipo === "editor" && <p className="muted ac-nota">O editor conecta o próprio Claude nesta página. O Claude dele só consegue mudar as áreas marcadas como Editar.</p>}
        </>
      )}

      {porEmail && (
        <>
          <h3 className="ac-titulo">Senha</h3>
          {link ? <LinkSenha link={link} nome={nomeAcesso(pessoa)} />
            : <button className="ghost small" onClick={gerarLink}>Gerar link para criar ou trocar a senha</button>}
        </>
      )}

      {erro && <p className="tv-alerta">{erro}</p>}
      <div className="ac-acoes">
        <button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar acessos"}</button>
        <button className="ghost" onClick={onFechar}>Cancelar</button>
      </div>
    </Gaveta>
  );
}

export function ProjetosRestritos({ projetos, supabase, onFechar, onMudou }: {
  projetos: ProjetoAcesso[]; supabase: ReturnType<typeof createClient>; onFechar: () => void; onMudou: () => void;
}) {
  const [erro, setErro] = useState("");
  async function restringir(p: ProjetoAcesso) {
    const { error } = await supabase.rpc("acessos_projeto_restrito", { p_projeto: p.id, p_restrito: !p.restrito });
    if (error) return setErro(error.message);
    onMudou();
  }
  return (
    <Gaveta titulo="Projetos restritos" sub="Só os administradores veem e editam um projeto restrito." fechar={onFechar}>
      {erro && <p className="tv-alerta">{erro}</p>}
      <ul className="ac-projetos">
        {projetos.map((p) => (
          <li key={p.id}>
            <label className="ac-check">
              <input type="checkbox" checked={p.restrito} onChange={() => restringir(p)} />
              <span>{p.nome}</span>
            </label>
          </li>
        ))}
      </ul>
    </Gaveta>
  );
}
