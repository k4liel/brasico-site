"use client";

import { TelaEntrada } from "@/components/Entrada";

// Login da equipe das casas (solicitantes, compras, câmara fria, escala): só usuário e senha.
// Sócio que tentar entrar aqui é desconectado e mandado para /login (conferirArea em components/Entrada.tsx).
export default function LoginColaboradores() {
  return <TelaEntrada tipo="colaboradores" />;
}
