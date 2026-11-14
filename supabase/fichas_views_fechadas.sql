-- Fichas: fecha as views menus_produtos e fichas_venda (13/11/2026).
--
-- As duas nasceram com security_invoker, mas foram recriadas sem ele em
-- midway_encerrado.sql e ficaram com permissão para quem não tem login:
-- as vendas por produto podiam ser lidas pela API sem entrar no site.
--
-- Correção: só lê quem pode ver as Fichas (fichas_pode), e quem não tem
-- login perde toda permissão nas views. Elas continuam rodando como dono
-- porque quem tem a Operação completa vê as Fichas sem ter acesso à TOTVS.

create or replace view public.menus_produtos as
select unidade_id, grupo, subgrupo, categoria, produto, vendidos_60d, preco_medio, ultima_venda,
       (select ft.ficha_id
          from public.fichas_totvs ft
         where ft.unidade_totvs = v.unidade_id and ft.produto = v.produto and ft.porcoes_por_venda > 0
         limit 1) as ficha_id
  from (select d.unidade_id,
               p.value ->> 'grupo' as grupo,
               p.value ->> 'subgrupo' as subgrupo,
               p.value ->> 'categoria' as categoria,
               p.value ->> 'nome' as produto,
               sum((p.value ->> 'quantidade')::numeric) as vendidos_60d,
               round(sum((p.value ->> 'valor')::numeric) / nullif(sum((p.value ->> 'quantidade')::numeric), 0), 2) as preco_medio,
               max(d.dia) as ultima_venda
          from public.totvs_dias d
          left join public.totvs_unidades u on u.id = d.unidade_id
         cross join lateral jsonb_array_elements(d.produtos) p(value)
         where d.dia > (coalesce(u.encerrada_em + 1, current_date) - 60)
           and d.dia <= coalesce(u.encerrada_em, current_date)
           and (select coalesce(public.fichas_pode(auth.uid()), false))
         group by d.unidade_id, p.value ->> 'grupo', p.value ->> 'subgrupo', p.value ->> 'categoria', p.value ->> 'nome') v;

create or replace view public.fichas_venda as
select ft.ficha_id, ft.unidade_totvs, ft.produto,
       sum((p.value ->> 'quantidade')::numeric) as vendidos_30d,
       round(sum((p.value ->> 'valor')::numeric) / nullif(sum((p.value ->> 'quantidade')::numeric), 0), 2) as preco_medio
  from public.fichas_totvs ft
  left join public.totvs_unidades u on u.id = ft.unidade_totvs
  join public.totvs_dias d on d.unidade_id = ft.unidade_totvs
   and d.dia > (coalesce(u.encerrada_em + 1, current_date) - 30)
   and d.dia <= coalesce(u.encerrada_em, current_date)
 cross join lateral jsonb_array_elements(d.produtos) p(value)
 where ft.porcoes_por_venda > 0
   and p.value ->> 'nome' = ft.produto
   and (select coalesce(public.fichas_pode(auth.uid()), false))
 group by ft.ficha_id, ft.unidade_totvs, ft.produto;

revoke all on public.menus_produtos from anon, public, authenticated;
revoke all on public.fichas_venda from anon, public, authenticated;
grant select on public.menus_produtos to authenticated;
grant select on public.fichas_venda to authenticated;
