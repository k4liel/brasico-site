"use client";

// Página Escala (/escala), escala única (09/11/2026, pedido do dono): uma grade só, organizada como o Ponto
// (casas, setores, ordem, Afastados, "fora do ponto", grupos criados à mão). Nas células, a escala montada; dia sem
// escala fica vazio. Para editar: clicar no bloquinho (ou arrastar sobre vários) e escolher na janelinha.
// "Ver o ponto (RHiD)" mostra, nas mesmas linhas, o horário do relógio e o que foi batido — só quando ligado.
// Sócios: "Organizar" (arrastar as linhas, a grade do Ponto), "Quem monta a escala" (líderes por casa inteira ou por
// setores) e "Contratados sem ponto". Líderes (login de colaborador): só o que lideram, sem Organizar nem os quadros.
// A organização do Ponto vira os grupos da escala sozinha (escala_membros_sincronizar) sempre que um sócio abre a página
// ou organiza.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import EscalaPlanejada from "./EscalaPlanejada";
import { EscalaSecao } from "./Ponto";
import { usePonto } from "./PontoDados";
import EscalaContratados, { type Contratado } from "./EscalaContratados";
import EscalaLideranca from "./EscalaLideranca";
import type { ExtraEscala, ItemExtra } from "./Ponto";

function useVerPonto() {
  const [ver, setVer] = useState(false);
  useEffect(() => {
    try { setVer(localStorage.getItem("brasico-escala-ver-ponto") === "1"); } catch {}
  }, []);
  function mudar(v: boolean) {
    setVer(v);
    try { localStorage.setItem("brasico-escala-ver-ponto", v ? "1" : "0"); } catch {}
  }
  return [ver, mudar] as const;
}

// Interruptor: de um lado a escala editável (o normal), do outro o ponto oficial do RHiD, atualizado a cada minuto
function ChaveVerPonto({ ver, onMudar }: { ver: boolean; onMudar: (v: boolean) => void }) {
  return (
    <div className="ep-toggle">
      <button className={!ver ? "on" : ""} onClick={() => onMudar(false)}>Escala editável</button>
      <button role="switch" aria-checked={ver} aria-label="Ver o ponto oficial do RHiD" className={`ep-toggle-chave${ver ? " ligada" : ""}`} onClick={() => onMudar(!ver)}><i /></button>
      <button className={ver ? "on" : ""} onClick={() => onMudar(true)}>Ponto oficial (RHiD) <small>ao vivo</small></button>
    </div>
  );
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
            <p className="muted">Quem trabalha em cada dia, por casa e setor. Clique num dia para definir a escala.</p>
          </div>
        </div>
        {!eu ? <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
          : socio ? <EscalaSocio supabase={supabase} />
          : !eu.lider ? <section className="es-bloco"><p className="muted">Você ainda não monta a escala de nenhuma casa. Peça a um dos sócios.</p></section>
          : <EscalaDoLider supabase={supabase} />}
      </main>
    </div>
  );
}

function EscalaSocio({ supabase }: { supabase: SupabaseClient }) {
  const ponto = usePonto(supabase, "todas");
  const [verPonto, setVerPonto] = useVerPonto();
  const [organizando, setOrganizando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  // A organização do Ponto (local, setor e ordem de cada pessoa) vira os grupos da escala: ao abrir e a cada mudança
  const chaveOrg = useMemo(() => ponto.linhas.map((l) => `${l.p.cliente_id}:${l.p.id}:${l.local}:${l.setor}:${l.posicao ?? ""}`).join("|"), [ponto.linhas]);
  const ultimaOrg = useRef("");
  useEffect(() => {
    if (!ponto.carregado || !ponto.linhas.length || chaveOrg === ultimaOrg.current) return;
    const t = setTimeout(async () => {
      ultimaOrg.current = chaveOrg;
      await supabase.rpc("escala_membros_sincronizar", {
        p_itens: ponto.linhas.map((l) => ({ cliente_id: l.p.cliente_id, pessoa_id: l.p.id, local: l.local, setor: l.setor })),
      });
      setRecarga((n) => n + 1);
    }, 1200);
    return () => clearTimeout(t);
  }, [chaveOrg, ponto.carregado, ponto.linhas, supabase]);

  // Contratados do RH sem cadastro no relógio: lista para pôr na escala; os já postos entram nas linhas
  const [contratados, setContratados] = useState<Contratado[]>([]);
  const lerContratados = useCallback(async () => {
    const { data } = await supabase.rpc("escala_contratados_fora");
    setContratados((data ?? []) as Contratado[]);
  }, [supabase]);
  useEffect(() => { lerContratados(); }, [lerContratados]);
  // Apelidos da escala, para a grade do Ponto (a escala editável já os recebe do banco)
  const [apelidos, setApelidos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    supabase.from("escala_apelidos").select("cliente_id,pessoa_id,apelido").neq("apelido", "").then(({ data }) =>
      setApelidos(new Map(((data ?? []) as { cliente_id: number; pessoa_id: number; apelido: string }[]).map((a) => [`${a.cliente_id}:${a.pessoa_id}`, a.apelido]))));
  }, [supabase, recarga]);
  // Grupos criados à mão (escala_grupos.fixo), para aparecerem mesmo vazios no Organizar
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
      <EscalaLideranca supabase={supabase} onMudou={() => setRecarga((n) => n + 1)} />
      {ponto.carregado && <EscalaContratados supabase={supabase} lista={contratados} locais={locais}
        onMudou={() => { lerContratados(); setRecarga((n) => n + 1); }} />}
      <div className="ep-topo-acoes">
        {!organizando && <ChaveVerPonto ver={verPonto} onMudar={setVerPonto} />}
        <div className="ep-topo-dir">
          {organizando
            ? <span className="muted small">Arraste as linhas; a escala de todos segue esta organização.</span>
            : <button className="ghost small" onClick={() => setOrganizando(true)} disabled={!ponto.carregado} title="Mudar a ordem e o setor/casa das pessoas">Organizar linhas</button>}
        </div>
      </div>
      {organizando ? (
        <EscalaSecao ponto={ponto} chavesRH={new Set()} onAbrirPessoa={() => {}} extras={extras} gruposVazios={fixos} apelidos={apelidos}
          organizarFixo onPronto={() => setOrganizando(false)}
          onOrdenarExtras={async (itens: ItemExtra[]) => {
            // Na tela na hora; no banco em seguida
            setContratados((v) => v.map((c) => {
              const it = itens.find((i) => i.id === c.extra_id);
              return it ? { ...c, posicao: it.posicao, ...(it.local !== undefined ? { local: it.local, setor: it.setor ?? "" } : {}) } : c;
            }));
            await supabase.rpc("escala_extras_ordenar", { p_itens: itens });
            lerContratados();
            setRecarga((x) => x + 1);
          }} />
      ) : verPonto ? (
        // O ponto oficial, atualizado a cada minuto, com a situação de agora de cada pessoa (só leitura)
        <EscalaSecao ponto={ponto} chavesRH={new Set()} onAbrirPessoa={() => {}} extras={extras} gruposVazios={fixos} somenteVer apelidos={apelidos} />
      ) : (
        <EscalaPlanejada supabase={supabase} modo="planejada" recarga={recarga} />
      )}
    </>
  );
}

// O líder não vê nada do RHiD (pedido do dono): só a escala editável, sem o ponto oficial
function EscalaDoLider({ supabase }: { supabase: SupabaseClient }) {
  return <EscalaPlanejada supabase={supabase} modo="planejada" />;
}
