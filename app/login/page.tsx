"use client";

import { TelaEntrada } from "@/components/Entrada";

// Login dos sócios: só e-mail e senha (o link por e-mail saiu em 04/11/2026, a pedido do dono).
// A equipe das casas entra só por /colaboradores: quem é dela é desconectado aqui (conferirArea em components/Entrada.tsx).
export default function LoginPage() {
  return <TelaEntrada tipo="socios" />;
}
