"use client";

// Página da escala de uma casa (/escala/<casa>) e dos líderes de grupo (/escala). Os líderes entram com usuário
// e senha (login de colaborador) e veem e montam só a escala dos grupos que lideram, separada por casa (abas no
// topo quando lideram em mais de uma). Os sócios abrem /escala/cicchetti-centro e /escala/outras-casas pelo grupo
// Hotéis do menu; a escala dos hotéis fica na aba Escala de cada hotel. A escala do RH é só para ver.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaCasa from "./EscalaCasa";
import { CASAS, casaDoLocal, casaPorId } from "@/lib/escala/casas";
import { hoje } from "@/lib/esocial/rh";

export default function EscalaLider({ userEmail, casa: casaInicial }: { userEmail: string; casa?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [eu, setEu] = useState<{ papel: string | null; nome: string; lider: boolean } | null>(null);
  const [casas, setCasas] = useState<string[] | null>(null);
  const [casa, setCasa] = useState(casaInicial ?? "");

  useEffect(() => {
    (async () => {
      const [r, d] = await Promise.all([
        supabase.rpc("operacao_eu"),
        supabase.rpc("escala_dados", { p_de: hoje(), p_ate: hoje() }),
      ]);
      const x = (r.data ?? {}) as { papel: string | null; lider?: boolean; pessoa: { nome: string } | null };
      setEu({ papel: x.papel ?? null, nome: x.pessoa?.nome ?? "", lider: !!x.lider });
      const locais = ((d.data as { grupos?: { local: string }[] } | null)?.grupos ?? []).map((g) => casaDoLocal(g.local));
      const lista = CASAS.map((c) => c.id).filter((id) => locais.includes(id));
      setCasas(lista);
      setCasa((c) => c || lista[0] || "");
    })();
  }, [supabase]);

  function escolher(id: string) {
    setCasa(id);
    try { history.replaceState(null, "", `/escala/${id}`); } catch {}
  }

  const socio = eu?.papel === "socio";
  const outra = eu?.papel === "solicitante" || eu?.papel === "compras" ? { href: "/compras", nome: "Compras" }
    : eu?.papel === "estoque" ? { href: "/estoque", nome: "Câmara fria" } : undefined;
  const nomeCasa = casaPorId(casa)?.nome ?? "";
  // O sócio troca de casa pelo menu (grupo Hotéis); o líder, pelas abas quando lidera em mais de uma
  const abas = !socio || !casaInicial ? (casas ?? []) : [];

  return (
    <div className="pagina">
      {socio ? <Topo email={userEmail} ativo={casaInicial ? `hotel:${casaInicial}` : "esocial"} />
        : <TopoSimples email={userEmail} nome={eu?.nome ?? ""} area="Escala" outra={outra} />}
      <main className="miolo es es-sistema es-largo">
        <div className="es-topo">
          <div>
            <span className="es-sobre">{socio ? "Hotéis e casas · Escala" : "Escala da equipe"}</span>
            <h1>{nomeCasa ? `Escala · ${nomeCasa}` : "Escala"}</h1>
            <p className="muted">Monte a escala do mês, compare com o que foi batido no ponto, veja na hora o que sai da lei e mande para a equipe.</p>
          </div>
        </div>
        {abas.length > 1 && (
          <div className="ep-casas" role="tablist" aria-label="Casa">
            {abas.map((id) => (
              <button key={id} role="tab" aria-selected={casa === id} className={casa === id ? "on" : ""} onClick={() => escolher(id)}>{casaPorId(id)?.nome}</button>
            ))}
          </div>
        )}
        {!eu || casas === null ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
          : !socio && !eu.lider ? <section className="es-bloco"><p className="muted">Você ainda não é líder de nenhum grupo da escala. Peça a um dos sócios.</p></section>
          : !casa ? <section className="es-bloco"><p className="muted">Nenhum grupo da escala ainda. Os grupos seguem a escala do RH: um sócio abre RH › Escala uma vez para montá-los.</p></section>
          : <EscalaCasa supabase={supabase} casa={casa} />}
      </main>
    </div>
  );
}
