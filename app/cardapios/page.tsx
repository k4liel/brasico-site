import { redirect } from "next/navigation";
import { CASA_INICIAL } from "@/lib/restaurantes";

// Menu → Menus: abre na primeira casa que já tem menus (a aba escolhida fica no endereço)
export default function MenusPage() {
  redirect(`/cardapios/${CASA_INICIAL}`);
}
