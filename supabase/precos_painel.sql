-- =====================================================================
-- Índice de preços na página /notas (aba Índice de preços, components/IndicePrecos.tsx)
--  - precos_base: uma base só de compras: Cicchetti Management (precos_historico) + itens das notas da SEFAZ
--    que não estão lá (mesmo dia, preço e quantidade = a mesma compra). Categoria da SEFAZ = a do mesmo produto no Cicchetti.
--  - precos_painel: índice mensal encadeado (geral e por categoria; cada mês compara os itens comprados nele e no
--    anterior, com peso pelo gasto do mês anterior; variação acima de 5× ou abaixo de 1/5 fica de fora), gasto por mês
--    e por categoria, e os alertas: a última compra de cada item por fornecedor contra a média das compras anteriores
--    (120 dias, ao menos 2), um por item e fornecedor; frete, serviço e manutenção não entram.
--  - precos_serie: todas as compras de um produto em 12 meses, por fornecedor (o gráfico que abre no alerta).
--  - precos_procurar: busca de produto com último preço e variação em 90 dias.
-- Quem vê: notas_acesso ou cicchetti_acesso (precos_pode).
-- =====================================================================

create or replace view public.precos_base with (security_invoker = true) as
with cic as (
  select 'cicchetti'::text fonte, h.data_emissao::date data, upper(trim(h.fornecedor)) fornecedor, h.produto,
    upper(trim(coalesce(h.unidade_compra, ''))) unidade, h.quantidade, h.preco_efetivo preco, h.quantidade * h.preco_efetivo gasto,
    coalesce(h.categoria, 'Sem categoria') categoria, h.unidade local
  from public.precos_historico h
  where h.preco_efetivo > 0 and h.quantidade > 0 and coalesce(h.categoria, '') <> 'Devolução'
), cat as (
  select distinct on (produto) produto, categoria from cic group by produto, categoria order by produto, count(*) desc
), sef as (
  select 'sefaz'::text fonte, n.emissao::date data, upper(trim(n.emitente_nome)) fornecedor,
    upper(regexp_replace(trim(i.descricao), '\s+', ' ', 'g')) produto, upper(trim(coalesce(i.unidade, ''))) unidade,
    i.quantidade, i.preco_efetivo preco, i.quantidade * i.preco_efetivo gasto, n.empresa_cnpj local
  from public.notas_itens i join public.notas n on n.chave = i.chave
  where n.situacao <> 'cancelada' and i.preco_efetivo > 0 and i.quantidade > 0
)
select * from cic
union all
select s.fonte, s.data, s.fornecedor, s.produto, s.unidade, s.quantidade, s.preco, s.gasto, coalesce(c.categoria, 'Sem categoria'), s.local
from sef s left join cat c on c.produto = s.produto
where not exists (select 1 from cic x where x.data = s.data and round(x.preco, 2) = round(s.preco, 2) and round(x.quantidade, 3) = round(s.quantidade, 3));

create or replace function public.precos_pode(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.cicchetti_acesso where user_id = p_user)
$$;
revoke execute on function public.precos_pode(uuid) from public, anon;
grant execute on function public.precos_pode(uuid) to authenticated;

create or replace function public.precos_painel()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  create temp table if not exists _pb on commit drop as select * from public.precos_base where data > current_date - 400;
  create index if not exists _pb_g on _pb (produto, unidade, fornecedor, data);
  analyze _pb;
  with m as (
    select date_trunc('month', data)::date mes, produto, unidade, categoria, sum(gasto) gasto, sum(gasto) / nullif(sum(quantidade), 0) preco
    from _pb group by 1, 2, 3, 4
  ),
  meses as (select distinct mes from m),
  par as (
    select a.mes, a.categoria, a.preco / p.preco r, p.gasto w
    from m a join m p on p.produto = a.produto and p.unidade = a.unidade and p.mes = (a.mes - interval '1 month')::date
    where p.preco > 0 and a.preco / p.preco between 0.2 and 5
  ),
  rel as (
    select mes, coalesce(categoria, 'Geral') serie, sum(w * r) / nullif(sum(w), 0) rel, count(*) n
    from par group by grouping sets ((mes), (mes, categoria))
  ),
  series as (select s.serie from (values ('Geral'), ('Comida'), ('Bebida'), ('Descartáveis'), ('Limpeza')) s(serie)),
  grade as (
    select s.serie, me.mes, coalesce(r.rel, 1) rel, coalesce(r.n, 0) n, r.rel is not null tem
    from series s cross join meses me left join rel r on r.serie = s.serie and r.mes = me.mes
  ),
  indice as (
    select serie, mes, n, tem, round((100 * exp(sum(ln(rel)) over (partition by serie order by mes)))::numeric, 1) valor,
      round(((rel - 1) * 100)::numeric, 1) variacao
    from grade
  ),
  gasto as (select date_trunc('month', data)::date mes, round(sum(gasto), 2) gasto, count(distinct produto) produtos from _pb group by 1),
  ult as (
    select distinct on (produto, unidade, fornecedor) produto, unidade, fornecedor, categoria, data, preco
    from _pb where data > current_date - 30 and produto not like 'FRETE%'
      and categoria not in ('Servico', 'Fora do CMV', 'Bonificação', 'Upgrade', 'Manutenção', 'Escritório')
    order by produto, unidade, fornecedor, data desc, preco desc
  ),
  hist as (
    select u.produto, u.unidade, u.fornecedor, avg(x.preco) media, count(*) compras
    from ult u join _pb x on x.produto = u.produto and x.unidade = u.unidade and x.fornecedor = u.fornecedor
      and x.data < u.data and x.data >= u.data - 120
    group by 1, 2, 3
  ),
  -- variação acima de 5× ou abaixo de 1/5 fica de fora (provável erro de digitação ou de unidade)
  sinal as (
    select u.*, h.media, h.compras, round(((u.preco / h.media - 1) * 100)::numeric, 1) pct
    from ult u join hist h using (produto, unidade, fornecedor)
    where h.compras >= 2 and h.media > 0 and u.preco / h.media between 0.2 and 5
  ),
  altas as (select * from sinal where pct >= 10 order by pct desc limit 40),
  quedas as (select * from sinal where pct <= -10 order by pct limit 20),
  com_faisca as (
    select s.*, (select jsonb_agg(round(y.preco, 2) order by y.data) from (select x.data, x.preco from _pb x
        where x.produto = s.produto and x.unidade = s.unidade and x.fornecedor = s.fornecedor and x.data <= s.data order by x.data desc limit 12) y) faisca,
      s.pct >= 0 alta
    from (select * from altas union all select * from quedas) s
  )
  select jsonb_build_object(
    'indice', (select jsonb_agg(jsonb_build_object('serie', serie, 'mes', mes, 'valor', valor, 'variacao', variacao, 'itens', n, 'tem', tem) order by serie, mes)
               from indice where mes >= (select max(mes) from meses) - interval '11 months'),
    'gasto', (select jsonb_agg(jsonb_build_object('mes', mes, 'gasto', gasto, 'produtos', produtos) order by mes) from gasto
              where mes >= (select max(mes) from meses) - interval '11 months'),
    'categorias', (select jsonb_agg(jsonb_build_object('categoria', categoria, 'gasto', g) order by g desc) from (
              select categoria, round(sum(gasto), 2) g from _pb where data >= date_trunc('month', current_date) group by 1) c),
    'altas', (select jsonb_agg(to_jsonb(c) - 'alta' order by c.pct desc) from com_faisca c where c.alta),
    'quedas', (select jsonb_agg(to_jsonb(c) - 'alta' order by c.pct) from com_faisca c where not c.alta),
    'produtos', (select count(distinct (produto, unidade)) from _pb where data > current_date - 90),
    'fornecedores', (select count(distinct fornecedor) from _pb where data > current_date - 90),
    'atualizado_em', now()
  ) into v;
  drop table if exists _pb;
  return v;
end $$;
revoke execute on function public.precos_painel() from public, anon;
grant execute on function public.precos_painel() to authenticated;

create or replace function public.precos_serie(p_produto text, p_unidade text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  return jsonb_build_object(
    'compras', (select jsonb_agg(jsonb_build_object('data', data, 'preco', round(preco, 2), 'fornecedor', fornecedor, 'quantidade', quantidade, 'fonte', fonte, 'local', local) order by data)
                from public.precos_base where produto = p_produto and unidade = coalesce(p_unidade, '') and data > current_date - 365),
    'fornecedores', (select jsonb_agg(jsonb_build_object('fornecedor', fornecedor, 'compras', n, 'medio', medio, 'menor', menor, 'ultimo', ultimo, 'ultima', ultima) order by medio)
                from (select fornecedor, count(*) n, round(avg(preco), 2) medio, round(min(preco), 2) menor,
                        round((array_agg(preco order by data desc))[1], 2) ultimo, max(data) ultima
                      from public.precos_base where produto = p_produto and unidade = coalesce(p_unidade, '') and data > current_date - 365 group by 1) f));
end $$;
revoke execute on function public.precos_serie(text, text) from public, anon;
grant execute on function public.precos_serie(text, text) to authenticated;

create or replace function public.precos_procurar(p_busca text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_padrao text[];
begin
  if not public.precos_pode(auth.uid()) then raise exception 'Sem acesso ao índice de preços' using errcode = '42501'; end if;
  v_padrao := array(select '%' || w || '%' from regexp_split_to_table(upper(trim(coalesce(p_busca, ''))), '\s+') w where length(w) >= 2);
  if coalesce(array_length(v_padrao, 1), 0) = 0 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x->>'ultima' desc) from (
    select jsonb_build_object('produto', produto, 'unidade', unidade, 'categoria', min(categoria), 'compras', count(*),
      'fornecedores', count(distinct fornecedor), 'ultimo', round((array_agg(preco order by data desc))[1], 2), 'ultima', max(data),
      'primeiro_90', round((array_agg(preco order by data) filter (where data > current_date - 90))[1], 2)) x
    from public.precos_base where data > current_date - 365 and produto like all (v_padrao)
    group by produto, unidade order by max(data) desc limit 40) s), '[]'::jsonb);
end $$;
revoke execute on function public.precos_procurar(text) from public, anon;
grant execute on function public.precos_procurar(text) to authenticated;
