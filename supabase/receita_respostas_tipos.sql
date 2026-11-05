-- =====================================================================
-- receita_respostas: aceita resposta que não é objeto (05/11/2026)
--  - Alguns serviços do lote respondem com texto vazio ("" em RELPSN, PERTSN e PARCSN-ESP, quando a empresa
--    não tem pedido) ou com lista (DEFIS). O "dados - 'PDFByteArrayBase64'" dava erro "cannot delete from scalar"
--    e derrubava a view inteira: desde o lote de 31/10 a página não lia as declarações e a rotina de
--    declarações (receita_lote_declaracoes) parava com erro.
--  - Agora só tira o PDF/XML quando a resposta é um objeto; o resto passa como veio.
-- =====================================================================
create or replace view public.receita_respostas with (security_invoker = true) as
select distinct on (x.empresa_id, r.v->>'servico', coalesce(r.v->>'dados_pedido', ''))
  x.empresa_id, r.v->>'servico' as servico, r.v->'dados_pedido' as pedido,
  case when jsonb_typeof(r.v->'dados') = 'object' then (r.v->'dados') - 'PDFByteArrayBase64' - 'XMLStringBase64' else r.v->'dados' end as dados,
  coalesce(jsonb_typeof(r.v->'dados') = 'object' and r.v->'dados' ? 'PDFByteArrayBase64', false) as tem_pdf,
  x.id as execucao_id, r.i as indice, x.created_at
from public.receita_execucoes x
cross join lateral jsonb_array_elements(x.resultado->'respostas') with ordinality as r(v, i)
where x.tipo = 'servico' and x.ambiente = 'producao' and (r.v->>'ok')::boolean
order by x.empresa_id, r.v->>'servico', coalesce(r.v->>'dados_pedido', ''), x.created_at desc;
