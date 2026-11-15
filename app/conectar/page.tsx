import { redirect } from "next/navigation";

// "Claude e equipe" foi juntada à página Usuários (15/11/2026): o Claude de cada um fica lá.
export default function ConectarPage() {
  redirect("/usuarios");
}
