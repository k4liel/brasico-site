"use client";

// Página do Índice de preços (Operação). Sócios usam o menu do Brasico; a Fernanda (papel compras) usa o topo simples,
// com Compras e Notas fiscais. Quem vê: precos_pode (supabase/precos_painel.sql).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";
import { TopoSimples } from "./Compras";
import IndicePrecos from "./IndicePrecos";

export default function PaginaPrecos({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [papel, setPapel] = useState<string | null | undefined>(undefined);
  const [nome, setNome] = useState("");
  useEffect(() => {
    const sb = createClient();
    sb.rpc("operacao_papel", { p_user: userId }).then(({ data }) => setPapel((data as string | null) ?? null));
    sb.from("operacao_pessoas").select("nome").eq("user_id", userId).maybeSingle().then(({ data }) => setNome((data?.nome as string) ?? ""));
  }, [userId]);
  const equipe = papel === "compras";

  return (
    <div className="pagina">
      {papel === undefined ? null : equipe
        ? <TopoSimples email={userEmail} nome={nome} area="Índice de preços" outra={[{ href: "/compras", nome: "Compras" }, { href: "/notas", nome: "Notas fiscais" }]} />
        : <Topo email={userEmail} ativo="precos" />}
      <main className="miolo tv es nf nf-larga">
        <IndicePrecos />
      </main>
    </div>
  );
}
