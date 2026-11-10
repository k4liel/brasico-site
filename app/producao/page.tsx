import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// A página Produção saiu de uso em 10/11/2026, a pedido do dono: a produção se organiza
// no projeto Produção Sempre Vivo. O endereço antigo leva até ele (components/Producao.tsx ficou guardado).
export default function ProducaoPage() {
  redirect("/projeto/fe1c924f-37c0-45fa-a800-8785ad7dc1e5");
}
