---
name: vendas-totvs
description: Consulta e puxa as vendas das unidades na TOTVS (Chef Web) pelo conector Brasico — faturamento, produtos, comida × bebida, pagamentos, assinadas, cortesias, garçons, sangrias, fechamentos e cancelamentos por unidade e dia. Use quando o usuário perguntar quanto uma loja vendeu, pedir um relatório, comparar dias, semanas ou unidades, ou pedir para puxar um dia da TOTVS.
---

# Vendas TOTVS do Brasico

O guia completo está em `lib/vendas.ts`. É o mesmo texto que o conector entrega pela ferramenta `guia_vendas`. Leia esse guia antes de um relatório ou comparação. Resumo:

1. **Ferramentas do conector Brasico:**
   - `totvs_unidades`: lista as unidades e o estado das extrações.
   - `totvs_vendas`: lê o que já foi puxado. Sem datas, traz ontem.
   - `totvs_extrair`: puxa de novo um dia de uma unidade. Leva de segundos a 1 minuto.
2. **Dia operacional = data de movimento**, no horário de Fortaleza. Todo dia às 4h30 o dia anterior é puxado sozinho (e o que faltar da semana é tentado de novo até as 6h30).
3. **Faturamento = `total`** (itens já com desconto + taxa de serviço). Assinadas e cortesias ficam fora do caixa.
4. **Status "revisar"** quer dizer que alguma conferência não bateu: mostre a diferença ao usuário e nunca ajuste os números. **"falha"** nunca quer dizer "dia sem vendas".
5. **Se faltar um dia**, puxe com `totvs_extrair`, espere ~20 s, confira em `totvs_unidades` e leia de novo.

Nunca peça nem mostre usuário, senha ou número de série da TOTVS: eles ficam só no cofre (Vault) do Supabase.
