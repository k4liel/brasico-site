"use client";

// Página da escala para os líderes de grupo (/escala): entram com usuário e senha (login de colaborador) e
// veem e montam só a escala dos grupos que lideram — Planejada, Ponto (RHiD) e Comparar —, com os avisos de
// lei. Os sócios também abrem esta página (com o menu completo) e veem todos os grupos.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaPlanejada, { ModosEscala } from "./EscalaPlanejada";
import type { ModoEscala } from "./PontoEscala";

export default function EscalaLider({ userEmail }: { userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [eu, setEu] = useState<{ papel: string | null; nome: string; lider: boolean } | null>(null);
  const [modo, setModo] = useState<ModoEscala>("planejada");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("operacao_eu");
      const r = (data ?? {}) as { papel: string | null; lider?: boolean; pessoa: { nome: string } | null };
      setEu({ papel: r.papel ?? null, nome: r.pessoa?.nome ?? "", lider: !!r.lider });
    })();
  }, [supabase]);

  const socio = eu?.papel === "socio";
  const outra = eu?.papel === "solicitante" || eu?.papel === "compras" ? { href: "/compras", nome: "Compras" }
    : eu?.papel === "estoque" ? { href: "/estoque", nome: "Câmara fria" } : undefined;

  return (
    <div className="pagina">
      {socio ? <Topo email={userEmail} ativo="esocial" /> : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} area="Escala" outra={outra} />}
      <main className="miolo es es-sistema es-largo">
        <div className="es-topo">
          <div>
            <span className="es-sobre">{socio ? "Companhia · Recursos humanos" : "Escala da equipe"}</span>
            <h1>Escala</h1>
            <p className="muted">Monte a escala do mês, compare com o que foi batido no ponto e veja na hora o que sai da lei.</p>
          </div>
        </div>
        {!eu ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
          : !socio && !eu.lider ? <section className="es-bloco"><p className="muted">Você ainda não é líder de nenhum grupo da escala. Peça a um dos sócios.</p></section>
          : (
            <>
              <ModosEscala modo={modo} onMudar={setModo} />
              <EscalaPlanejada supabase={supabase} modo={modo} />
            </>
          )}
      </main>
    </div>
  );
}
