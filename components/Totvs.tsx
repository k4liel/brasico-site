"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Página da TOTVS: só o desenho de como a integração funciona e quais unidades ela puxa.
// Os números de vendas ficam no banco e são lidos pelos Claudes pelo conector.
type Unidade = { id: string; nome: string; loja: number | null; ativa: boolean; ordem: number };

function Seta() {
  return (
    <div className="tt-seta" aria-hidden="true">
      <svg width="16" height="26" viewBox="0 0 16 26"><path d="M8 0v22M2 16l6 7 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}

export default function Totvs({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("totvs_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      const { data: u } = await supabase.from("totvs_unidades").select("id,nome,loja,ativa,ordem").order("ordem");
      setUnidades((u ?? []) as Unidade[]);
    })();
  }, [supabase, userId]);

  if (acesso === false)
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="vendas" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso à integração com a TOTVS.</p></main>
      </div>
    );

  const puxa = (u: Unidade) => u.ativa && u.loja != null;
  const ativas = unidades.filter(puxa);

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="vendas" />
      <main className="miolo tt">
        <h1>TOTVS</h1>

        <section className="tt-fluxo" aria-label="Como funciona a integração">
          <div className="tt-caixa tt-origem">
            <span className="tt-passo">1</span>
            <b>TOTVS Chef Web</b>
            <span className="muted">O sistema de caixa das lojas</span>
            <div className="tt-chips">
              {acesso === null ? <span className="muted">…</span> : ativas.length ? ativas.map((u) => <span key={u.id} className="tt-chip">{u.nome}</span>) : <span className="muted">Nenhuma unidade ligada</span>}
            </div>
          </div>
          <Seta />
          <div className="tt-linha">
            <div className="tt-caixa">
              <span className="tt-passo">2</span>
              <b>Agenda diária</b>
              <span className="muted">Todo dia às 6h busca o dia anterior de cada unidade e repete os dias que falharam</span>
            </div>
            <div className="tt-ou" aria-hidden="true">ou</div>
            <div className="tt-caixa">
              <span className="tt-passo">2</span>
              <b>Pedido do Claude</b>
              <span className="muted">Pelo conector Brasico, para qualquer dia</span>
            </div>
          </div>
          <Seta />
          <div className="tt-caixa">
            <span className="tt-passo">3</span>
            <b>Chef Web API</b>
            <span className="muted">Busca as vendas, as sangrias e os fechamentos de caixa do dia, só para leitura: nada é alterado na TOTVS</span>
          </div>
          <Seta />
          <div className="tt-caixa">
            <span className="tt-passo">4</span>
            <b>Conferência</b>
            <span className="muted">Os números são conferidos; o dia que não bate fica marcado para revisar</span>
          </div>
          <Seta />
          <div className="tt-caixa tt-destino">
            <span className="tt-passo">5</span>
            <b>Banco do Brasico</b>
            <span className="muted">Um resumo por unidade e dia, que só os sócios veem. Os Claudes leem daqui para os relatórios e os projetos</span>
          </div>
        </section>

        <section className="tt-unidades" aria-label="Unidades">
          <h2>Unidades</h2>
          <ul>
            {unidades.map((u) => (
              <li key={u.id}>
                <span className={puxa(u) ? "tt-ponto on" : "tt-ponto"} aria-hidden="true" />
                <b>{u.nome}</b>
                <span className="muted">{puxa(u) ? "puxada todo dia" : u.loja == null ? "sem loja na TOTVS, não é puxada" : "desligada"}</span>
              </li>
            ))}
          </ul>
          <p className="muted tt-nota">Usuário, senha e números de série das lojas ficam guardados no cofre do banco, nunca no site nem no GitHub.</p>
        </section>
      </main>
    </div>
  );
}
