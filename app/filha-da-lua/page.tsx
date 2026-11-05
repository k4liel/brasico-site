import { redirect } from "next/navigation";

// Endereço antigo: a página agora fica no grupo Hotéis
export default function FilhaDaLuaAntiga() {
  redirect("/hoteis/filha-da-lua");
}
