"use client";

// Página Escala (/escala, 09/11/2026): saiu do RH e virou página própria (item do menu logo abaixo de "RH · eSocial"),
// igual era a aba Escala do RH: no topo a troca rápida entre Ponto (RHiD) — a grade de todo mundo, com Organizar —,
// Planejada (editável, com os avisos de lei, o PDF e o texto para o WhatsApp) e Comparar.
// Sócios veem todos os grupos e, ao abrir, os grupos da planejada acompanham o local e o setor da grade
// (escala_membros_sincronizar). Líderes (login de colaborador) veem só a planejada dos grupos que lideram.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaPlanejada, { ModosEscala } from "./EscalaPlanejada";
import type { ModoEscala } from "./PontoEscala";
import { EscalaSecao } from "./Ponto";
import { usePonto } from "./PontoDados";

function useModo(padrao: ModoEscala) {
  const [modo, setModo] = useState<ModoEscala>(padrao);
  useEffect(() => {
    try {
      const m = localStorage.getItem("brasico-escala-modo");
      if (m === "real" || m === "planejada" || m === "comparar") setModo(m);
    } catch {}
  }, []);
  function mudar(m: ModoEscala) {
    setModo(m);
    try { localStorage.setItem("brasico-escala-modo", m); } catch {}
  }
  return [modo, mudar] as const;
}

export default function EscalaLider({ userEmail }: { userEmail: string }) {
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
            <span className="es-sobre">{socio ? "Recursos humanos" : "Escala da equipe"}</span>
            <h1>Escala</h1>
            <p className="muted">Quem trabalha em cada dia, por local e setor: o que foi batido no relógio (RHiD), a escala planejada e a comparação das duas.</p>
          </div>
        </div>
        {!eu ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
          : socio ? <EscalaSocio supabase={supabase} />
          : !eu.lider ? <section className="es-bloco"><p className="muted">Você ainda não é líder de nenhum grupo da escala. Peça a um dos sócios.</p></section>
          : <EscalaDoLider supabase={supabase} />}
      </main>
    </div>
  );
}

function EscalaSocio({ supabase }: { supabase: SupabaseClient }) {
  const ponto = usePonto(supabase, "todas");
  const [modo, mudar] = useModo("real");
  // Os grupos da planejada acompanham o local e o setor da grade (com o que foi organizado à mão)
  const sincronizar = useMemo(() => ponto.linhas.map((l) => ({ cliente_id: l.p.cliente_id, pessoa_id: l.p.id, local: l.local, setor: l.setor })), [ponto.linhas]);
  return (
    <>
      <ModosEscala modo={modo} onMudar={mudar} />
      {modo === "real" ? <EscalaSecao ponto={ponto} chavesRH={new Set()} onAbrirPessoa={() => {}} />
        : !ponto.carregado ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        : <EscalaPlanejada supabase={supabase} modo={modo} sincronizar={sincronizar} />}
    </>
  );
}

function EscalaDoLider({ supabase }: { supabase: SupabaseClient }) {
  const [modo, mudar] = useModo("planejada");
  return (
    <>
      <ModosEscala modo={modo} onMudar={mudar} />
      <EscalaPlanejada supabase={supabase} modo={modo} />
    </>
  );
}
