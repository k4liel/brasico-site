"use client";

// Acessos ao site (topo da página Usuários, só administradores; supabase/acessos.sql).
// Cada pessoa tem um tipo — Administrador (edita tudo e conecta o Claude), Editor com Claude
// (conecta o Claude com limites) ou Usuário (só o site) — e, área por área, nada / ver / editar.
// A trava é do banco (gatilho acesso_guarda): quem só vê não grava nada, nem pelo Claude.
// Projetos restritos ficam só com os administradores.
import { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import Gaveta from "./Gaveta";

type Tipo = "admin" | "editor" | "usuario";
type Nivel = "" | "ver" | "editar";
type Pessoa = {
  id: string; nome: string | null; email: string | null; tipo: Tipo | null;
  areas: Record<string, "ver" | "editar">; papel_antigo: string | null; claude: boolean;
};
type Projeto = { id: string; nome: string; restrito: boolean };

const AREAS: { id: string; nome: string; texto: string }[] = [
  { id: "projetos", nome: "Projetos", texto: "documentos dos projetos (menos os restritos)" },
  { id: "brainstorm", nome: "Brainstorm", texto: "quadro de tarefas e ideias" },
  { id: "hoteis", nome: "Hotéis", texto: "Filha da Lua e Sempre Vivo" },
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
  { id: "usuario", nome: "Usuário", texto: "entra só pelo site, sem Claude; cada área nada, ver ou editar" },
];
const NOME_TIPO: Record<Tipo, string> = { admin: "Administrador", editor: "Editor com Claude", usuario: "Usuário" };

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const nomeDe = (p: Pessoa) => p.nome || p.email?.split("@")[0] || "Sem nome";

export default function AcessosSite({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [admin, setAdmin] = useState(true);
  const [aberta, setAberta] = useState<Pessoa | null>(null);
  const [verProjetos, setVerProjetos] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("acessos_lista");
    if (error) { setAdmin(false); return; }
    const d = data as { pessoas: Pessoa[]; projetos: Projeto[] };
    setPessoas(d.pessoas);
    setProjetos(d.projetos);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function restringir(p: Projeto) {
    const { error } = await supabase.rpc("acessos_projeto_restrito", { p_projeto: p.id, p_restrito: !p.restrito });
    if (error) return setAviso(error.message);
    carregar();
  }

  if (!admin) return null;
  const restritos = projetos.filter((p) => p.restrito).length;

  return (
    <section className="es-bloco ac">
      <div className="ac-cabeca">
        <div>
          <h2>Acessos ao site</h2>
          <p className="muted">Quem entra pelo login dos sócios e o que pode ver ou editar em cada área. A trava vale também para o Claude conectado.</p>
        </div>
        <button className="ghost small" onClick={() => setVerProjetos(true)}>
          Projetos restritos{restritos ? ` · ${restritos}` : ""}
        </button>
      </div>
      {aviso && <p className="tv-alerta">{aviso}</p>}
      {!pessoas ? <div className="es-esqueleto" aria-hidden="true"><i /><i /></div> : (
        <ul className="us-lista">
          {pessoas.map((p) => {
            const marcadas = AREAS.filter((a) => p.areas[a.id]);
            return (
              <li key={p.id}>
                <button className="us-cartao" onClick={() => setAberta(p)}>
                  <span className="us-avatar" aria-hidden="true">{iniciais(nomeDe(p))}</span>
                  <span className="us-quem">
                    <strong>{nomeDe(p)}</strong>
                    <span className="muted">
                      {p.tipo ? NOME_TIPO[p.tipo] : "Regras antigas (ainda não organizado)"}
                      {p.claude ? " · Claude conectado" : ""}
                    </span>
                  </span>
                  <span className="us-acessos">
                    {p.tipo === "admin" && <i className="us-chip ac-tudo">tudo, com edição</i>}
                    {p.tipo !== "admin" && marcadas.map((a) => (
                      <i key={a.id} className={`us-chip ${p.areas[a.id] === "editar" ? "ac-editar" : "ac-ver"}`}>
                        {a.nome} · {p.areas[a.id] === "editar" ? "edita" : "vê"}
                      </i>
                    ))}
                    {p.tipo && p.tipo !== "admin" && marcadas.length === 0 && <i className="us-chip nada">sem acesso a nada</i>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {aberta && (
        <PainelAcesso pessoa={aberta} supabase={supabase} onFechar={() => setAberta(null)}
          onSalvo={(t) => { setAberta(null); setAviso(t); carregar(); }} />
      )}

      {verProjetos && (
        <Gaveta titulo="Projetos restritos" sub="Só os administradores veem e editam um projeto restrito." fechar={() => setVerProjetos(false)}>
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
      )}
    </section>
  );
}

function PainelAcesso({ pessoa, supabase, onFechar, onSalvo }: {
  pessoa: Pessoa; supabase: ReturnType<typeof createClient>; onFechar: () => void; onSalvo: (texto: string) => void;
}) {
  const [tipo, setTipo] = useState<Tipo>(pessoa.tipo ?? "usuario");
  const [areas, setAreas] = useState<Record<string, Nivel>>(() => ({ ...pessoa.areas }));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const todas = (n: Nivel) => setAreas(Object.fromEntries(AREAS.map((a) => [a.id, n])));

  async function salvar() {
    setSalvando(true);
    setErro("");
    const limpas = Object.fromEntries(Object.entries(areas).filter(([, n]) => n));
    const { error } = await supabase.rpc("acessos_salvar", { p_user: pessoa.id, p_tipo: tipo, p_areas: limpas });
    setSalvando(false);
    if (error) return setErro(error.message);
    onSalvo(`Acessos de ${nomeDe(pessoa)} salvos.`);
  }

  return (
    <Gaveta titulo={nomeDe(pessoa)} sub={pessoa.email ?? undefined} fechar={onFechar}>
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
          {tipo === "editor" && <p className="muted ac-nota">O editor também abre a página para conectar o Claude. O Claude dele só consegue mudar as áreas marcadas como Editar.</p>}
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
