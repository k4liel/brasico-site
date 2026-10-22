---
name: cicchetti-api
description: Consulta a API do Cicchetti Management pelo conector Brasico — vendas por dia, produtos vendidos, notas de compra (CMV) e seus itens e colaboradores ativos das unidades midway, pipa_centro e pipa_producao. Use quando o usuário pedir dados do Cicchetti Management (cicchettimanagement), CMV, compras, fornecedores, colaboradores ou vendas do sistema de gestão.
---

# API do Cicchetti Management no Brasico

O guia completo está em `lib/cicchetti.ts`. É o mesmo texto que o conector entrega pela ferramenta `guia_cicchetti`. Resumo:

1. **Ferramentas do conector Brasico:**
   - `cicchetti_unidades`: o que a chave libera. Use no primeiro acesso.
   - `cicchetti_vendas_resumo` e `cicchetti_vendas_produtos`: vendas por dia e produtos vendidos (unidade + período).
   - `cicchetti_cmv_notas` e `cicchetti_cmv_itens`: notas de compra e os itens de cada nota.
   - `cicchetti_rh_colaboradores`: colaboradores ativos, só dados operacionais.
2. **Unidades independentes:** midway, pipa_centro e pipa_producao. Nunca some sem mostrar cada uma.
3. **Sempre unidade e período explícitos.** AAAA-MM-DD nas chamadas, DD/MM/AAAA e R$ nas respostas.
4. **Só leitura.** Nada é alterado no Cicchetti Management.
5. **Nunca peça nem mostre** a chave da API, CPF, telefone, e-mail, salário, chave fiscal ou XML. A chave fica só no cofre (Vault) do Supabase, com o nome `cicchetti_api_chave`.
6. Guarde o `request_id` de cada resposta usada; ele serve para suporte.

A chave é criada no Cicchetti Management (Sistema > API externa) e cadastrada por um sócio direto no SQL Editor do Supabase. Veja supabase/cicchetti_api.sql.
