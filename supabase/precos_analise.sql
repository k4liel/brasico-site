-- =====================================================================
-- Índice de preços, versão nova (15/11/2026; página /precos, components/IndicePrecos.tsx; prévia A com a B nos produtos).
-- Tudo sobre precos_base, com filtros de período (dias), casa (local), categoria, fornecedor e "só insumos".
--   * precos_analise: resumo, gasto por mês, onde economizar (mesmo produto, fornecedor mais barato) e curva ABC
--     (produtos, fornecedores e categorias), mais as opções dos filtros.
--   * precos_produtos: a lista de produtos da aba Produtos (busca, só os que subiram, ordem).
--   * precos_ficha: a ficha de um produto (compras, fornecedores, casas, consumo e economia).
-- "Só insumos": tira serviço, manutenção, escritório, bonificação, upgrade, frete e item de R$ 1.500 ou mais por
-- unidade (equipamento). Preço fora de 1/3 a 3× do outro fornecedor não conta como economia (unidade diferente).
-- O índice mensal e os alertas continuam em precos_painel (supabase/precos_painel.sql). Quem vê: precos_pode.
-- =====================================================================

create or replace function public.precos__filtrar(p_dias int, p_local text, p_categoria text, p_fornecedor text, p_insumos boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _pa;
  create temp table _pa on commit drop as
    select b.*, (b.data > current_date - least(greatest(coalesce(p_dias, 90), 7), 400)) no_periodo,
      -- o período anterior do mesmo tamanho (os cards comparam com ele)
      (b.data <= current_date - least(greatest(coalesce(p_dias, 90), 7), 400)
        and b.data > current_date - 2 * least(greatest(coalesce(p_dias, 90), 7), 400)) no_anterior
    from public.precos_base b
    where b.data > current_date - greatest(400, 2 * least(greatest(coalesce(p_dias, 90), 7), 400) + 130)
      and (p_local is null or b.local = p_local)
      and (p_categoria is null or b.categoria = p_categoria)
      and (p_fornecedor is null or b.fornecedor = p_fornecedor)
      and (not coalesce(p_insumos, true) or (
        b.categoria not in ('Fora do CMV', 'Servico', 'Manutenção', 'Escritório', 'Bonificação', 'Upgrade')
        and b.produto not like 'FRETE%'
        and not (b.preco >= 1500 and b.unidade in ('UN', 'UND', 'UNID', 'PC', 'PÇ', 'CJ', ''))));
  create index on _pa (produto, unidade, fornecedor, data);
  analyze _pa;
end $$;
revoke all on function public.precos__filtrar(int, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.precos_analise(p_dias int default 90, p_local text default null, p_categoria text default null,
  p_fornecedor text default null, p_insumos boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  perform public.precos__filtrar(p_dias, p_local, p_categoria, p_fornecedor, p_insumos);
  with per as (select * from _pa where no_periodo),
  total as (select coalesce(sum(gasto), 0) g from per),
  -- onde economizar: preço médio de cada fornecedor no período; o mais barato serve de referência
  pf as (select produto, unidade, fornecedor, avg(preco) medio, sum(quantidade) qtd, sum(gasto) gasto from per group by 1, 2, 3),
  melhor as (select distinct on (produto, unidade) produto, unidade, fornecedor melhor, medio melhor_preco from pf order by produto, unidade, medio),
  eco as (
    select f.produto, f.unidade, f.fornecedor, f.medio, f.qtd, f.gasto, m.melhor, m.melhor_preco,
      (f.medio - m.melhor_preco) * f.qtd economia
    from pf f join melhor m using (produto, unidade)
    where f.fornecedor <> m.melhor and m.melhor_preco > 0 and f.medio / m.melhor_preco between 1.01 and 3
  ),
  eco_prod as (
    select distinct on (produto, unidade) produto, unidade, fornecedor, medio, melhor, melhor_preco,
      sum(economia) over (partition by produto, unidade) economia
    from eco order by produto, unidade, economia desc
  ),
  -- curva ABC dos produtos
  prod as (
    select produto, unidade, min(categoria) categoria, sum(gasto) gasto, count(*) compras, count(distinct fornecedor) fornecedores,
      (array_agg(fornecedor order by gasto desc))[1] principal,
      (array_agg(preco order by data desc, preco desc))[1] ultimo, max(data) ultima
    from per group by 1, 2
  ),
  prod_abc as (
    select p.*, round((100 * p.gasto / nullif(t.g, 0))::numeric, 2) pct,
      sum(p.gasto) over (order by p.gasto desc rows unbounded preceding) / nullif(t.g, 0) acum
    from prod p, total t
  ),
  prod_top as (
    select a.*, case when a.acum <= 0.8 then 'A' when a.acum <= 0.95 then 'B' else 'C' end classe,
      (select avg(x.preco) from _pa x where x.produto = a.produto and x.unidade = a.unidade and x.data < a.ultima and x.data >= a.ultima - 120) media_antes,
      (select jsonb_agg(round(y.p, 2) order by y.m) from (select date_trunc('month', x.data) m, sum(x.gasto) / nullif(sum(x.quantidade), 0) p
         from _pa x where x.produto = a.produto and x.unidade = a.unidade group by 1) y) faisca
    from prod_abc a order by a.gasto desc limit 60
  ),
  forn as (
    select fornecedor, sum(gasto) gasto, count(*) compras, count(distinct produto) produtos, max(data) ultima from per group by 1
  ),
  cats as (select categoria, sum(gasto) gasto, count(distinct produto) produtos from per group by 1),
  -- cards: tudo do período contra o período anterior do mesmo tamanho
  ant as (select * from _pa where no_anterior),
  pp as (select produto, unidade, sum(gasto) / nullif(sum(quantidade), 0) p from per group by 1, 2),
  pa as (select produto, unidade, sum(gasto) / nullif(sum(quantidade), 0) p, sum(gasto) g from ant group by 1, 2),
  infl as (
    select sum(a.g * (p.p / a.p)) / nullif(sum(a.g), 0) - 1 r, count(*) n
    from pp p join pa a using (produto, unidade) where a.p > 0 and p.p / a.p between 0.2 and 5
  ),
  pvar as (
    select p.ultimo / nullif((select avg(x.preco) from _pa x where x.produto = p.produto and x.unidade = p.unidade
      and x.data < p.ultima and x.data >= p.ultima - 120), 0) r from prod p
  ),
  top5 as (select sum(gasto) g from (select gasto from forn order by gasto desc limit 5) x),
  dias_compra as (select count(distinct data) n from per)
  select jsonb_build_object(
    'cards', jsonb_build_object(
      'dias', least(greatest(coalesce(p_dias, 90), 7), 400),
      'gasto', (select round(coalesce(sum(gasto), 0), 2) from per), 'gasto_ant', (select round(coalesce(sum(gasto), 0), 2) from ant),
      'produtos', (select count(distinct (produto, unidade)) from per), 'produtos_ant', (select count(distinct (produto, unidade)) from ant),
      'fornecedores', (select count(distinct fornecedor) from per), 'fornecedores_ant', (select count(distinct fornecedor) from ant),
      'compras', (select count(*) from per), 'compras_ant', (select count(*) from ant),
      'inflacao', (select round((r * 100)::numeric, 1) from infl), 'inflacao_itens', (select n from infl),
      'altas', (select count(*) from pvar where r between 1.1 and 5), 'quedas', (select count(*) from pvar where r between 0.2 and 0.9),
      'top5_pct', (select round((100 * t.g / nullif(tt.g, 0))::numeric, 1) from top5 t, total tt),
      'por_dia', (select round(tt.g / nullif(least(greatest(coalesce(p_dias, 90), 7), 400), 0), 2) from total tt),
      'dias_com_compra', (select n from dias_compra)),
    'resumo', (select jsonb_build_object('itens', count(*), 'produtos', count(distinct (produto, unidade)), 'fornecedores', count(distinct fornecedor),
                 'gasto', round(coalesce(sum(gasto), 0), 2), 'de', min(data), 'ate', max(data)) from per),
    'meses', (select jsonb_agg(jsonb_build_object('mes', m, 'gasto', round(g, 2)) order by m) from (
                 select date_trunc('month', data)::date m, sum(gasto) g from _pa group by 1) x where m >= date_trunc('month', current_date) - interval '11 months'),
    'economia_total', (select round(coalesce(sum(economia), 0), 2) from eco),
    'economia', (select jsonb_agg(jsonb_build_object('produto', produto, 'unidade', unidade, 'fornecedor', fornecedor, 'preco', round(medio, 2),
                   'melhor', melhor, 'melhor_preco', round(melhor_preco, 2), 'economia', round(economia, 2)) order by economia desc)
                 from (select * from eco_prod order by economia desc limit 15) e),
    'abc', (select jsonb_agg(jsonb_build_object('produto', produto, 'unidade', unidade, 'categoria', categoria, 'gasto', round(gasto, 2), 'pct', pct,
               'classe', classe, 'compras', compras, 'fornecedores', fornecedores, 'principal', principal, 'ultimo', round(ultimo, 2), 'ultima', ultima,
               'variacao', case when media_antes > 0 and ultimo / media_antes between 0.2 and 5 then round(((ultimo / media_antes - 1) * 100)::numeric, 1) end,
               'faisca', faisca) order by gasto desc) from prod_top),
    'pareto', (select jsonb_build_object('produtos_80', count(*) filter (where acum <= 0.8) + 1, 'total', count(*)) from prod_abc),
    'fornecedores', (select jsonb_agg(jsonb_build_object('fornecedor', fornecedor, 'gasto', round(gasto, 2), 'compras', compras, 'produtos', produtos,
               'ultima', ultima, 'pct', round((100 * gasto / nullif((select g from total), 0))::numeric, 2)) order by gasto desc)
               from (select * from forn order by gasto desc limit 40) f),
    'categorias', (select jsonb_agg(jsonb_build_object('categoria', categoria, 'gasto', round(gasto, 2), 'produtos', produtos,
               'pct', round((100 * gasto / nullif((select g from total), 0))::numeric, 2)) order by gasto desc) from cats),
    'opcoes', jsonb_build_object(
      'locais', (select jsonb_agg(l order by l) from (select distinct local l from public.precos_base where data > current_date - 400 and local is not null) x),
      'categorias', (select jsonb_agg(c order by c) from (select distinct categoria c from public.precos_base where data > current_date - 400) x),
      'fornecedores', (select jsonb_agg(f order by f) from (select fornecedor f from public.precos_base where data > current_date - 400
                         group by 1 order by sum(gasto) desc limit 80) x)),
    'atualizado_em', now()
  ) into v;
  drop table if exists _pa;
  return v;
end $$;
revoke all on function public.precos_analise(int, text, text, text, boolean) from public, anon;
grant execute on function public.precos_analise(int, text, text, text, boolean) to authenticated;

create or replace function public.precos_produtos(p_dias int default 90, p_local text default null, p_categoria text default null,
  p_fornecedor text default null, p_insumos boolean default true, p_busca text default null, p_so_altas boolean default false,
  p_ordem text default 'gasto')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_padrao text[];
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  perform public.precos__filtrar(p_dias, p_local, p_categoria, p_fornecedor, p_insumos);
  v_padrao := array(select '%' || w || '%' from regexp_split_to_table(upper(trim(coalesce(p_busca, ''))), '\s+') w where length(w) >= 2);
  with prod as (
    select produto, unidade, min(categoria) categoria, sum(gasto) gasto, count(*) compras, count(distinct fornecedor) fornecedores,
      (array_agg(preco order by data desc, preco desc))[1] ultimo, max(data) ultima
    from _pa where no_periodo
      and (coalesce(array_length(v_padrao, 1), 0) = 0 or produto like all (v_padrao) or fornecedor like all (v_padrao))
    group by 1, 2
  ),
  com as (
    select p.*, (select avg(x.preco) from _pa x where x.produto = p.produto and x.unidade = p.unidade and x.data < p.ultima and x.data >= p.ultima - 120) media_antes
    from prod p
  ),
  var as (
    select c.*, case when media_antes > 0 and ultimo / media_antes between 0.2 and 5 then round(((ultimo / media_antes - 1) * 100)::numeric, 1) end variacao from com c
  ),
  sel as (
    select * from var where not coalesce(p_so_altas, false) or variacao >= 5
    order by case p_ordem when 'variacao' then -coalesce(variacao, -999) when 'recente' then -extract(epoch from ultima) else -gasto end
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object('produto', produto, 'unidade', unidade, 'categoria', categoria, 'gasto', round(gasto, 2), 'compras', compras,
      'fornecedores', fornecedores, 'ultimo', round(ultimo, 2), 'ultima', ultima, 'variacao', variacao)
      order by case p_ordem when 'variacao' then -coalesce(variacao, -999) when 'recente' then -extract(epoch from ultima) else -gasto end), '[]'::jsonb)
  into v from sel;
  drop table if exists _pa;
  return v;
end $$;
revoke all on function public.precos_produtos(int, text, text, text, boolean, text, boolean, text) from public, anon;
grant execute on function public.precos_produtos(int, text, text, text, boolean, text, boolean, text) to authenticated;

create or replace function public.precos_ficha(p_produto text, p_unidade text, p_dias int default 180)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dias int := least(greatest(coalesce(p_dias, 180), 30), 400);
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  return (with c as (
      select * from public.precos_base where produto = p_produto and unidade = coalesce(p_unidade, '') and data > current_date - v_dias
    ),
    f as (
      select fornecedor, count(*) compras, avg(preco) medio, min(preco) menor, (array_agg(preco order by data desc))[1] ultimo, max(data) ultima,
        sum(quantidade) qtd, sum(gasto) gasto from c group by 1
    ),
    meses as (select greatest(1, (current_date - min(data)) / 30.0) n from c),
    principal as (select * from f order by gasto desc limit 1),
    melhor as (select * from f order by medio limit 1)
    select jsonb_build_object(
      'produto', p_produto, 'unidade', coalesce(p_unidade, ''),
      'categoria', (select categoria from c group by 1 order by count(*) desc limit 1),
      'resumo', (select jsonb_build_object('ultimo', round((array_agg(preco order by data desc))[1], 2), 'ultima', max(data), 'medio', round(avg(preco), 2),
                   'menor', round(min(preco), 2), 'maior', round(max(preco), 2), 'gasto', round(sum(gasto), 2), 'compras', count(*),
                   'consumo_mes', round(sum(quantidade) / (select n from meses), 1)) from c),
      'compras', (select jsonb_agg(jsonb_build_object('data', data, 'fornecedor', fornecedor, 'preco', round(preco, 2), 'quantidade', quantidade,
                   'gasto', round(gasto, 2), 'local', local, 'fonte', fonte) order by data) from c),
      'fornecedores', (select jsonb_agg(jsonb_build_object('fornecedor', fornecedor, 'compras', compras, 'medio', round(medio, 2), 'menor', round(menor, 2),
                   'ultimo', round(ultimo, 2), 'ultima', ultima, 'qtd', round(qtd, 2), 'gasto', round(gasto, 2)) order by medio) from f),
      'locais', (select jsonb_agg(jsonb_build_object('local', local, 'compras', n, 'medio', round(m, 2), 'ultimo', round(u, 2), 'qtd', round(q, 2)) order by m)
                 from (select local, count(*) n, avg(preco) m, (array_agg(preco order by data desc))[1] u, sum(quantidade) q from c group by 1) l),
      'economia', (select case when p.fornecedor <> m.fornecedor and m.medio > 0 and p.medio / m.medio between 1.01 and 3 then
                     jsonb_build_object('de', p.fornecedor, 'preco_de', round(p.medio, 2), 'para', m.fornecedor, 'preco_para', round(m.medio, 2),
                       'por_mes', round((p.medio - m.medio) * p.qtd / (select n from meses), 2)) end
                   from principal p, melhor m)
    ));
end $$;
revoke all on function public.precos_ficha(text, text, int) from public, anon;
grant execute on function public.precos_ficha(text, text, int) to authenticated;
