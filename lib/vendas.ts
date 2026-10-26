// Como o Claude trabalha com as vendas da TOTVS, entregue pela ferramenta guia_vendas do conector.
// O mesmo resumo está na skill .claude/skills/vendas-totvs.
export const GUIA_VENDAS = `
VENDAS TOTVS DO BRASICO — COMO TRABALHAR

De onde vêm os números
- As vendas das unidades vêm do Chef Web da TOTVS, por DATA DE MOVIMENTO (o dia operacional): um caixa fechado depois da meia-noite conta no dia em que abriu.
- Todo dia às 4h30 (Fortaleza) o dia anterior de cada unidade é puxado sozinho. Até as 6h30, a cada 10 minutos, o que faltar da última semana é tentado de novo, um dia por unidade de cada vez. Ao meio-dia o dia anterior é puxado de novo (às 4h30 o caixa às vezes ainda não mandou tudo à TOTVS). Se ontem aparecer "sem movimento" ou baixo demais antes do meio-dia, puxe de novo com totvs_extrair.
- Cada unidade e dia tem um registro só. Puxar de novo substitui, nunca duplica.
- Os sócios veem tudo também no site: Menu → Vendas TOTVS.

Ferramentas
- totvs_unidades: lista as unidades (id, nome, loja), o último dia extraído e as últimas extrações (status e erro). Comece por aqui se não souber o id da unidade.
- totvs_vendas: lê o que já foi puxado. Filtros: unidade (id ou parte do nome; vazio = todas), de, ate (AAAA-MM-DD). Sem datas = ontem. Para 1 ou 2 dias vem o detalhe (produtos, pagamentos, garçons, sangrias, fechamentos, cancelados); para períodos maiores, peça detalhe=true só se precisar.
- totvs_extrair: pede para puxar (ou puxar de novo) um dia de uma unidade. Leva de segundos a 1 minuto. Depois veja em totvs_unidades (ultimas_execucoes) se ficou "ok", "revisar", "sem_movimento" ou "falha", e leia com totvs_vendas.

Passo a passo de um pedido
1. Entenda unidade e período. "Ontem" e "hoje" são no horário de Fortaleza; totvs_unidades devolve a data de hoje.
2. Leia com totvs_vendas.
3. Se faltar algum dia, peça com totvs_extrair (um pedido por unidade e dia), espere uns 20 segundos, confira em totvs_unidades e leia de novo. Para períodos longos, puxe no máximo uns 10 dias por vez e avise o usuário.
4. Responda com os números e diga de onde vieram (unidade, dia, status).

O que cada número quer dizer (campo resumo)
- total: faturamento do dia = soma do total de cada venda na TOTVS (subtotal com taxa de serviço − descontos + acréscimos), já sem o troco. É o número principal.
- vendas (vendas_ativas), pessoas e ticket médio (total ÷ pessoas).
- valor_produtos: produtos sem a taxa de serviço, somando os itens; comida e bebida vêm do grupo do produto na TOTVS (outros = grupo que não é COMIDA nem BEBIDA). Descontos grandes (consumo interno) às vezes não chegam inteiros aos itens, então os itens podem passar um pouco do total: use comida × bebida como proporção.
- itens_taxa_servico (ou servico): a taxa de serviço.
- descontos: o desconto dado (já está abatido nos itens; não subtraia de novo).
- pagamentos_caixa: o que entrou no caixa (cartões, PIX, dinheiro). assinadas e cortesias ficam fora do caixa.
- pagamentos_total = caixa + assinadas + cortesias. Deve bater com o total.
- troco_nos_pagamentos: troco que a TOTVS somou ao pagamento e foi tirado (o caixa às vezes registra o valor entregue pelo cliente).
- total_totvs: o "ValorTotal" cru da TOTVS, guardado só para conferência (às vezes vem com o troco tirado ou somado).
- sangrias, fechamento_sistema e fechamento_recebido: sangrias e fechamento de caixa do dia.
- vendas_canceladas e itens_cancelados: cancelamentos (a lista está em cancelados).

Status do dia
- ok: o que foi pago bate com o que foi vendido, venda por venda.
- revisar: o pago não bateu com o vendido (veja divergencias). Diga isso ao usuário com a diferença em reais. Nunca esconda nem "ajuste" a diferença.
- avisos (no detalhe do dia): diferenças internas da TOTVS que não mudam o faturamento (taxa de serviço arredondada nos itens, desconto fora dos itens, item sem garçom). Não marcam o dia; só mencione se o usuário perguntar por esses detalhes.
- sem_movimento: a TOTVS não tem vendas nesse dia (loja fechada).
- falha (na extração): a TOTVS não respondeu ou recusou. Mostre o erro e ofereça tentar de novo com totvs_extrair. Uma falha nunca é "dia sem vendas".

Como responder
- Português, curto, valores em reais no formato brasileiro (R$ 5.614,30).
- Comparações (semana × semana, unidade × unidade): faça a conta com os números de totvs_vendas e mostre a variação em reais e em %.
- Ranking de garçons: use garcons (valor dos itens vendidos por atendente, sem a taxa de serviço).
- Produtos mais vendidos: use produtos (já ordenados por valor). Para quantidade, reordene.
- Não invente números que não vieram das ferramentas. Se o dia não foi puxado, diga e puxe.

O que não fazer
- Nunca peça nem mostre usuário, senha ou número de série da TOTVS. Eles ficam só no cofre do Supabase.
- Unidade sem loja configurada não é extraída; nunca use a loja de outra unidade no lugar.
- Notas fiscais de entrada e CMV ainda não estão integradas.
`;
