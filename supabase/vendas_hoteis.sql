-- Faturamento dos hotéis na página de vendas (/vendas), 12/11/2026, pedido do dono.
-- Fonte: pms_transacoes (relatório "Lançamentos por Período (Analítico)" do PMS), tudo o que foi lançado
-- nas contas, com os estornos (a soma das diárias assim bate com a receita do PMS, conferido ago–nov/2026).
-- Separação: hospedagem (diárias, diferença de diária, early/late), restaurante (consumo, POS, frigobar),
-- spa, outros serviços (lavanderia, terceirizados…) e taxas (taxa de serviço e ISS).
--
-- Restaurante com caixa próprio na TOTVS (pms_hoteis.totvs_unidade): o Filha da Lua vende no Chef Web
-- (unidade filha_da_lua) e o que vai para a conta do quarto ("assinadas") entra no PMS no dia seguinte
-- como "RESTAURANTE". A partir do primeiro dia com venda na TOTVS, esse lançamento do PMS fica de fora
-- (coluna restaurante_migrado, só informativa) e o restaurante do hotel = total do dia na TOTVS
-- (restaurante_totvs). Antes disso vale o que está no PMS. Assim nada é contado duas vezes.

alter table public.pms_hoteis add column if not exists totvs_unidade text;
update public.pms_hoteis set totvs_unidade = 'filha_da_lua' where id = 'filha-da-lua';

create or replace function public.vendas_hotel_categoria(p_grupo text, p_item_tipo text, p_descricao text)
returns text language sql immutable as $$
  with x as (
    select lower(translate(coalesce(p_descricao, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                     'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) d,
           lower(coalesce(p_item_tipo, '')) it
  )
  select case
    when p_grupo = 'Pagamento' or it like 'type of devolution%' then null
    when d ~ '(taxa de servico|(^|[^a-z])iss([^a-z]|$)|taxa de turismo|taxa municipal)' then 'taxas'
    when d ~ '(^ *diaria|^ *hospedagem|diferenca de diaria|check-?out|check-?in)' then 'hospedagem'
    when it like 'point of sale%' or d ~ '(restaurante|(^|[^a-z])bar([^a-z]|$)|a&b|aliment|bebida|frigobar|(^|[^a-z])menu([^a-z]|$)|room service)' then 'restaurante'
    when d ~ '(massagem|sueca|tratamento|(^|[^a-z])spa([^a-z]|$)|facial|ayurveda|detox|shiatsu|reflexolog|drenagem|escalda)' then 'spa'
    when p_grupo = 'Diária' then 'hospedagem'
    when p_grupo = 'Consumo' then 'restaurante'
    when p_grupo = 'Spa' then 'spa'
    when p_grupo = 'Taxa' then 'taxas'
    else 'outros'
  end from x
$$;

-- Função (e não visão): a visão classificava todo o histórico a cada leitura (16 s); assim lê só o período.
create or replace function public.vendas_hoteis_dia(p_de date, p_ate date)
returns table (hotel_id text, dia date, hospedagem numeric, restaurante_pms numeric, restaurante_totvs numeric,
               restaurante_migrado numeric, spa numeric, outros numeric, taxas numeric)
language sql stable security invoker set search_path = public as $$
  with h as (
    select ph.id as hotel_id, ph.totvs_unidade,
           (select min(d.dia) from public.totvs_dias d where d.unidade_id = ph.totvs_unidade and d.total > 0) as totvs_desde
    from public.pms_hoteis ph
    where ph.ativa
  ),
  l as (
    select t.hotel_id, t.dia, -t.valor as valor,
           public.vendas_hotel_categoria(t.grupo, t.item_tipo, t.descricao) as cat,
           (h.totvs_desde is not null and t.dia >= h.totvs_desde and lower(coalesce(t.item_tipo, '')) not like 'point of sale%'
            and t.descricao ilike '%restaurante%') as migrado
    from public.pms_transacoes t join h on h.hotel_id = t.hotel_id
    where t.dia between p_de and p_ate
  ),
  p as (
    select l.hotel_id, l.dia,
           coalesce(sum(valor) filter (where cat = 'hospedagem'), 0) as hospedagem,
           coalesce(sum(valor) filter (where cat = 'restaurante' and not migrado), 0) as restaurante_pms,
           coalesce(sum(valor) filter (where cat = 'restaurante' and migrado), 0) as restaurante_migrado,
           coalesce(sum(valor) filter (where cat = 'spa'), 0) as spa,
           coalesce(sum(valor) filter (where cat = 'outros'), 0) as outros,
           coalesce(sum(valor) filter (where cat = 'taxas'), 0) as taxas
    from l where cat is not null
    group by l.hotel_id, l.dia
  ),
  tv as (
    select h.hotel_id, d.dia, d.total as restaurante_totvs
    from h join public.totvs_dias d on d.unidade_id = h.totvs_unidade and d.dia >= h.totvs_desde
    where d.dia between p_de and p_ate
  )
  select coalesce(p.hotel_id, tv.hotel_id), coalesce(p.dia, tv.dia),
         coalesce(p.hospedagem, 0), coalesce(p.restaurante_pms, 0), coalesce(tv.restaurante_totvs, 0),
         coalesce(p.restaurante_migrado, 0), coalesce(p.spa, 0), coalesce(p.outros, 0), coalesce(p.taxas, 0)
  from p full join tv on tv.hotel_id = p.hotel_id and tv.dia = p.dia
  order by 1, 2
$$;

revoke execute on function public.vendas_hoteis_dia(date, date) from public, anon;
grant execute on function public.vendas_hoteis_dia(date, date) to authenticated;

-- Nome da unidade na página de vendas (pedido do dono, 12/11/2026)
update public.totvs_unidades set nome = 'Cicchetti Pipa' where id = 'pipa_centro';
