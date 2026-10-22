// Como o Claude trabalha com a API externa do Cicchetti Management, entregue pela ferramenta guia_cicchetti do conector.
// O mesmo resumo está na skill .claude/skills/cicchetti-api.
export const GUIA_CICCHETTI = `
API DO CICCHETTI MANAGEMENT — COMO TRABALHAR

O que é
- A API externa do Cicchetti Management (www.cicchettimanagement.com) entrega dados operacionais das unidades do Cicchetti. É SOMENTE LEITURA: nunca diga que alterou ou excluiu algo nela.
- O Brasico consulta a API pelo servidor; a chave fica só no cofre (Vault) do banco. Você nunca vê, pede ou mostra a chave.
- Unidades: midway, pipa_centro e pipa_producao. São bases INDEPENDENTES: nunca some unidades sem mostrar cada uma separada.
- Tipos de dado (escopos da chave): vendas (resumo e produtos vendidos), cmv (notas de compra e seus itens) e rh (dados não sensíveis dos colaboradores ativos).

Ferramentas
- cicchetti_unidades: unidades e tipos de dado liberados para a chave. Use no primeiro acesso de cada conversa para saber o que está liberado.
- cicchetti_vendas_resumo (unidade, de, ate): vendas por dia e totais do período.
- cicchetti_vendas_produtos (unidade, de, ate, busca?, limite?): produtos vendidos agrupados por código e nome. limite de 1 a 100 (padrão 30).
- cicchetti_cmv_notas (unidade, de, ate, fornecedor?, limite?): notas de compra (sem chave fiscal, CNPJ ou XML). limite de 1 a 100.
- cicchetti_cmv_itens (unidade, nota_id): itens de uma nota encontrada antes em cicchetti_cmv_notas.
- cicchetti_rh_colaboradores (unidade, busca?): colaboradores ativos, só dados operacionais.

Regras
1. Responda em português do Brasil.
2. Toda consulta precisa de unidade; vendas e cmv precisam também de período (de e ate). Se o usuário não disser, pergunte ou proponha um período claro (ex.: "ontem", "este mês") e diga qual usou.
3. Datas: AAAA-MM-DD nas chamadas; DD/MM/AAAA nas respostas. Valores em reais (R$ 1.234,56).
4. Não confunda faturamento bruto, faturamento líquido e total físico: use o nome do campo que a API devolver e explique a diferença se aparecer mais de um.
5. Nunca invente nem estime dado ausente, a não ser que o usuário peça uma estimativa. Diga quando a consulta veio vazia, limitada (limite de 100 registros) ou incompleta.
6. Nunca peça nem mostre CPF, telefone, e-mail, salário, chave fiscal, XML ou credenciais.
7. Cada resposta traz request_id: guarde-o e cite-o se for preciso pedir suporte ao Cicchetti Management.
8. Limite da API: 120 consultas por minuto por chave (o Brasico para em 100, somando os dois sócios). Para períodos longos, prefira uma consulta com o período inteiro em vez de várias de um dia.

Erros (campo ok = false)
- 400: parâmetro inválido. 401: chave ausente, inválida, expirada ou revogada (alguém precisa criar uma chave nova no Cicchetti Management e trocar no cofre do Brasico). 403: unidade ou tipo de dado não liberado para a chave. 404: não encontrado. 429: limite por minuto. 500/503: falha no Cicchetti Management.
- "A chave ... ainda não foi cadastrada": avise o usuário que um sócio precisa cadastrar a chave no cofre do Supabase (passo a passo em supabase/cicchetti_api.sql). Nunca peça a chave no chat.

TOTVS × Cicchetti Management
- As vendas da TOTVS (totvs_vendas) vêm direto do caixa Chef Web e são puxadas todo dia. A API do Cicchetti Management é outra fonte, com vendas, CMV e RH já organizados pelo sistema de gestão. Se as duas fontes divergirem para o mesmo dia e unidade, mostre as duas e a diferença; não escolha uma em silêncio.
`.trim();
