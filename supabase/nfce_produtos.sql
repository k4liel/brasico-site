-- =====================================================================
-- Cadastro fiscal dos produtos da TOTVS, montado das vendas (22/11/2026, pedido do dono: "entre na API da TOTVS de
-- todas as unidades e vá em produtos... mostre o que tá errado e como resolver, tem que ser tudo sincronizado")
-- A lista de produtos da API (produto/listarProdutos), as regras fiscais (RegraFiscal/ConsultarRegras), o estoque,
-- os clientes e a conferência de vendas respondem "código 20: Object reference not set to an instance of an object"
-- para o usuário do Brasico em todas as formas de chamada (testado em 22/11/2026, components da sondagem em
-- supabase/functions/totvs-produtos): parecem não liberados para a integração; pedir à TOTVS.
-- Enquanto isso, o cadastro vem de cada item vendido (a CapaVenda traz o produto com código, nome, grupo, unidade e
-- NCM e a tributação aplicada: CFOP, CST, alíquota de ICMS, PIS/Cofins e IBS/CBS): é exatamente o que sai na nota,
-- e se atualiza sozinho a cada venda (a leitura ao vivo é de minuto a minuto).
-- =====================================================================

create or replace function public.nfce_produtos(p_unidade text default null, p_dias int default 120)
returns jsonb language sql stable set search_path = public as $$
  with it as (
    select n.unidade_id, n.dia, i
    from public.nfce_notas n, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and n.dia >= (now() at time zone 'America/Fortaleza')::date - p_dias
      and (p_unidade is null or n.unidade_id = p_unidade)
      and not coalesce((i->>'cancelado')::boolean, false)
  ),
  cls as (
    select unidade_id, coalesce(i->>'codigo', i->>'nome') cod,
      jsonb_build_object('ncm', i->>'ncm', 'cfop', i->>'cfop', 'cst', coalesce(i->>'cst', i->>'csosn'),
        'aliquota', (i->'icms'->>'aliquota')::numeric, 'pis', i->'pis'->>'cst', 'cofins', i->'cofins'->>'cst',
        'ibscbs', i->'ibscbs'->>'cst', 'cclasstrib', i->'ibscbs'->>'cclasstrib', 'unidade', i->>'unidade', 'cest', i->>'cest') c,
      max(dia) ultima, count(*) itens, sum((i->>'valor_total')::numeric) valor
    from it group by 1, 2, 3
  ),
  prod as (
    select unidade_id, coalesce(i->>'codigo', i->>'nome') cod, (array_agg(i->>'nome' order by dia desc))[1] nome,
      (array_agg(i->>'grupo' order by dia desc))[1] grupo, max(dia) ultima, count(*) itens,
      round(sum((i->>'valor_total')::numeric), 2) valor, round(sum(coalesce((i->'icms'->>'valor')::numeric, 0)), 2) icms
    from it group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'unidade_id', p.unidade_id, 'cod', p.cod, 'nome', p.nome, 'grupo', p.grupo, 'ultima', p.ultima, 'itens', p.itens,
      'valor', p.valor, 'icms', p.icms,
      'atual', (select c.c from cls c where c.unidade_id = p.unidade_id and c.cod = p.cod order by c.ultima desc, c.itens desc limit 1),
      'variacoes', (select jsonb_agg(c.c || jsonb_build_object('itens', c.itens, 'ultima', c.ultima) order by c.ultima desc)
                    from cls c where c.unidade_id = p.unidade_id and c.cod = p.cod)
    ) order by p.unidade_id, p.valor desc), '[]')
  from prod p
$$;
revoke execute on function public.nfce_produtos(text, int) from public, anon;
grant execute on function public.nfce_produtos(text, int) to authenticated;
