"use client";

// Página Escala (/escala, 09/11/2026): subpágina do RH, com item próprio no menu. Abas no topo:
// - sócios: "Todas" (a grade do RHiD de todo mundo, só para ver) e uma aba por casa com a escala editável
//   (Planejada, Ponto e Comparar; PDF e texto para mandar à equipe). Ao abrir, os grupos da escala planejada
//   acompanham o local e o setor da grade (escala_membros_sincronizar).
// - líderes (login de colaborador): só as casas dos grupos que lideram, sem a grade de todos.
// O endereço guarda a casa (/escala/<casa>); casas em lib/escala/casas.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaCasa from "./EscalaCasa";
import { EscalaSecao } from "./Ponto";
import { usePonto } from "./PontoDados";
import { CASAS, casaDoLocal, casaPorId } from "@/lib/escala/casas";
import { hoje } from "@/lib/esocial/rh";

const TODAS = "todas";

export default function EscalaLider({ userEmail, casa: casaInicial }: { userEmail: string; casa?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [eu, setEu] = useState<{ papel: string | null; nome: string; lider: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("operacao_eu");
      const x = (data ?? {}) as { papel: string | null; lider?: boolean; pessoa: { nome: string } | null };
      setEu({ papel: x.papel ?? null, nome: x.pessoa?.nome ?? "", lider: !!x.lider });
    })();
  }, [supabase]);

  const socio = eu?.papel === "socio";
  const outra = eu?.papel === "solicitante" || eu?.papel === "compras" ? { href: "/compras", nome: "Compras" }
    : eu?.papel === "estoque" ? { href: "/estoque", nome: "Câmara fria" } : undefined;

  return (
    <div className="pagina">
      {!eu ? null : socio ? <Topo email={userEmail} ativo="escala" />
        : <TopoSimples email={userEmail} nome={eu.nome} area="Escala" outra={outra} />}
      <main className="miolo es es-sistema es-largo">
        <div className="es-topo">
          <div>
            <span className="es-sobre">{socio ? "Recursos humanos · Escala" : "Escala da equipe"}</span>
            <h1>Escala</h1>
            <p className="muted">A escala de cada casa: monte o mês, compare com o que foi batido no ponto, veja na hora o que sai da lei e mande para a equipe.</p>
          </div>
          {socio && <a className="ghost small ep-voltar-rh" href="/esocial">← RH</a>}
        </div>
        {!eu ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
          : socio ? <EscalaSocio supabase={supabase} casaInicial={casaInicial} />
          : !eu.lider ? <section className="es-bloco"><p className="muted">Você ainda não é líder de nenhum grupo da escala. Peça a um dos sócios.</p></section>
          : <EscalaDoLider supabase={supabase} casaInicial={casaInicial} />}
      </main>
    </div>
  );
}

function trocarEndereco(casa: string) {
  try { history.replaceState(null, "", casa === TODAS ? "/escala" : `/escala/${casa}`); } catch {}
  try { localStorage.setItem("brasico-escala-casa", casa); } catch {}
}
function casaGuardada() {
  try { return localStorage.getItem("brasico-escala-casa") ?? ""; } catch { return ""; }
}

function Abas({ casas, casa, onMudar, todas }: { casas: string[]; casa: string; onMudar: (c: string) => void; todas?: boolean }) {
  return (
    <div className="ep-casas-rh">
      <div className="ep-casas" role="tablist" aria-label="Qual escala">
        {todas && <button role="tab" aria-selected={casa === TODAS} className={casa === TODAS ? "on" : ""} onClick={() => onMudar(TODAS)}>Todas <small>só ver</small></button>}
        {casas.map((id) => (
          <button key={id} role="tab" aria-selected={casa === id} className={casa === id ? "on" : ""} onClick={() => onMudar(id)}>{casaPorId(id)?.nome}</button>
        ))}
      </div>
      <span className="muted">{casa === TODAS ? "A escala do relógio de todas as casas. Para montar e editar, escolha a casa." : "Monte a escala da casa, compare com o ponto e mande para a equipe."}</span>
    </div>
  );
}

function EscalaSocio({ supabase, casaInicial }: { supabase: SupabaseClient; casaInicial?: string }) {
  const ponto = usePonto(supabase, "todas");
  const [casa, setCasa] = useState(casaInicial ?? TODAS);
  useEffect(() => {
    if (casaInicial) return;
    const c = casaGuardada();
    if (c && (c === TODAS || casaPorId(c))) setCasa(c);
  }, [casaInicial]);
  function mudar(c: string) {
    setCasa(c);
    trocarEndereco(c);
  }
  const casas = useMemo(() => {
    const tem = new Set(ponto.linhas.map((l) => casaDoLocal(l.local)));
    return CASAS.filter((c) => tem.has(c.id)).map((c) => c.id);
  }, [ponto.linhas]);

  // Os grupos da escala planejada acompanham o local e o setor da grade (com o que foi organizado à mão)
  const sincronizado = useRef(false);
  useEffect(() => {
    if (sincronizado.current || !ponto.carregado || !ponto.linhas.length) return;
    sincronizado.current = true;
    supabase.rpc("escala_membros_sincronizar", {
      p_itens: ponto.linhas.map((l) => ({ cliente_id: l.p.cliente_id, pessoa_id: l.p.id, local: l.local, setor: l.setor })),
    }).then(() => {}, () => {});
  }, [ponto.carregado, ponto.linhas, supabase]);

  return (
    <>
      <Abas casas={casas} casa={casa} onMudar={mudar} todas />
      {casa === TODAS ? <EscalaSecao ponto={ponto} chavesRH={new Set()} onAbrirPessoa={() => {}} />
        : <EscalaCasa supabase={supabase} casa={casa} />}
    </>
  );
}

function EscalaDoLider({ supabase, casaInicial }: { supabase: SupabaseClient; casaInicial?: string }) {
  const [casas, setCasas] = useState<string[] | null>(null);
  const [casa, setCasa] = useState(casaInicial ?? "");
  useEffect(() => {
    supabase.rpc("escala_dados", { p_de: hoje(), p_ate: hoje() }).then(({ data }) => {
      const locais = ((data as { grupos?: { local: string }[] } | null)?.grupos ?? []).map((g) => casaDoLocal(g.local));
      const lista = CASAS.map((c) => c.id).filter((id) => locais.includes(id));
      setCasas(lista);
      setCasa((c) => (c && lista.includes(c) ? c : lista.includes(casaGuardada()) ? casaGuardada() : lista[0] ?? ""));
    });
  }, [supabase]);
  function mudar(c: string) {
    setCasa(c);
    trocarEndereco(c);
  }
  if (casas === null) return <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>;
  if (!casa) return <section className="es-bloco"><p className="muted">Nenhum grupo da escala ainda. Peça a um dos sócios.</p></section>;
  return (
    <>
      {casas.length > 1 && <Abas casas={casas} casa={casa} onMudar={mudar} />}
      <EscalaCasa supabase={supabase} casa={casa} />
    </>
  );
}
