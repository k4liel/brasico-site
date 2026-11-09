"use client";

// Página Escala (/escala, 09/11/2026): saiu do RH e virou página própria (item do menu logo abaixo de "RH · eSocial"),
// igual era a aba Escala do RH: no topo a troca rápida entre Ponto (RHiD) — a grade de todo mundo, com Organizar —,
// Planejada (editável, com os avisos de lei, o PDF e o texto para o WhatsApp) e Comparar.
// Sócios veem todos os grupos e, ao abrir, os grupos da planejada acompanham o local e o setor da grade
// (escala_membros_sincronizar). Líderes (login de colaborador) veem só a planejada dos grupos que lideram.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaPlanejada, { ModosEscala } from "./EscalaPlanejada";
import type { ModoEscala } from "./PontoEscala";
import { EscalaSecao } from "./Ponto";
import { usePonto } from "./PontoDados";
import EscalaContratados, { type Contratado } from "./EscalaContratados";
import type { ExtraEscala, ItemExtra } from "./Ponto";

function useModo(padrao: ModoEscala) {
  const [modo, setModo] = useState<ModoEscala>(padrao);
  useEffect(() => {
    try {
      const m = localStorage.getItem("brasico-escala-modo");
      if (m === "real" || m === "planejada") setModo(m);
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
            <p className="muted">Quem trabalha em cada dia, por local e setor: o que foi batido no relógio (RHiD) e a escala planejada.</p>
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

  // Contratados do RH sem cadastro no relógio: lista para pôr na escala, e os já postos entram na grade do Ponto
  const [contratados, setContratados] = useState<Contratado[]>([]);
  const [versao, setVersao] = useState(0);
  const lerContratados = useCallback(async () => {
    const { data } = await supabase.rpc("escala_contratados_fora");
    setContratados((data ?? []) as Contratado[]);
  }, [supabase]);
  useEffect(() => { lerContratados(); }, [lerContratados]);
  // Grupos criados à mão (escala_grupos.fixo), para aparecerem mesmo vazios
  const [fixos, setFixos] = useState<{ local: string; setor: string }[]>([]);
  useEffect(() => {
    supabase.rpc("escala_grupos_fixos").then(({ data }) => setFixos((data ?? []) as { local: string; setor: string }[]));
  }, [supabase]);
  const locais = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of ponto.linhas) {
      const nome = l.local || "Sem local";
      if (!m.has(nome)) m.set(nome, new Set());
      if (l.setor) m.get(nome)!.add(l.setor);
    }
    for (const g of fixos) {
      if (!m.has(g.local)) m.set(g.local, new Set());
      if (g.setor) m.get(g.local)!.add(g.setor);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([local, s]) => ({ local, setores: [...s].sort() }));
  }, [ponto.linhas, fixos]);
  const extras = useMemo(() => contratados.filter((c) => c.situacao === "na_escala" && c.extra_id).map<ExtraEscala>((c) => ({
    extraId: c.extra_id!, posicao: c.posicao ?? null,
    chave: `0:${c.extra_id}`, nome: c.nome.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase()), cargo: c.cargo,
    local: c.local ?? "", setor: c.setor ?? "", dias: new Map(), obs: "fora do ponto",
  })), [contratados]);

  return (
    <>
      <ModosEscala modo={modo} onMudar={mudar} />
      {ponto.carregado && <EscalaContratados supabase={supabase} lista={contratados} locais={locais}
        onMudou={() => { lerContratados(); setVersao((v) => v + 1); }} />}
      {modo === "real" ? <EscalaSecao ponto={ponto} chavesRH={new Set()} onAbrirPessoa={() => {}} extras={extras} gruposVazios={fixos}
          onOrdenarExtras={async (itens: ItemExtra[]) => {
            // Na tela na hora; no banco em seguida
            setContratados((v) => v.map((c) => {
              const it = itens.find((i) => i.id === c.extra_id);
              return it ? { ...c, posicao: it.posicao, ...(it.local !== undefined ? { local: it.local, setor: it.setor ?? "" } : {}) } : c;
            }));
            await supabase.rpc("escala_extras_ordenar", { p_itens: itens });
            lerContratados();
            setVersao((x) => x + 1);
          }} />
        : !ponto.carregado ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        : <EscalaPlanejada key={versao} supabase={supabase} modo={modo} sincronizar={sincronizar} />}
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
