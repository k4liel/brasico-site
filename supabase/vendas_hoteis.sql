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
-- 13/11/2026: + iss, frigobar e restaurante_lancamentos (detalhe do hotel na página de vendas).
drop function if exists public.vendas_hoteis_dia(date, date);
create or replace function public.vendas_hoteis_dia(p_de date, p_ate date)
returns table (hotel_id text, dia date, hospedagem numeric, restaurante_pms numeric, restaurante_totvs numeric,
               restaurante_migrado numeric, spa numeric, outros numeric, taxas numeric, iss numeric, frigobar numeric,
               restaurante_lancamentos integer)
language sql stable security invoker set search_path = public as $$
  with h as (
    select ph.id as hotel_id, ph.totvs_unidade,
           (select min(d.dia) from public.totvs_dias d where d.unidade_id = ph.totvs_unidade and d.total > 0) as totvs_desde
    from public.pms_hoteis ph
    where ph.ativa
  ),
  l as (
    select t.hotel_id, t.dia, -t.valor as valor, t.descricao,
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
           coalesce(sum(valor) filter (where cat = 'taxas'), 0) as taxas,
           coalesce(sum(valor) filter (where cat = 'taxas' and descricao ~* '(^|[^a-z])iss([^a-z]|$)'), 0) as iss,
           coalesce(sum(valor) filter (where cat = 'restaurante' and not migrado and descricao ~* 'frigobar'), 0) as frigobar,
           (count(*) filter (where cat = 'restaurante' and not migrado and descricao !~* 'frigobar' and valor > 0))::int as restaurante_lancamentos
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
         coalesce(p.restaurante_migrado, 0), coalesce(p.spa, 0), coalesce(p.outros, 0), coalesce(p.taxas, 0),
         coalesce(p.iss, 0), coalesce(p.frigobar, 0), coalesce(p.restaurante_lancamentos, 0)
  from p full join tv on tv.hotel_id = p.hotel_id and tv.dia = p.dia
  order by 1, 2
$$;

revoke execute on function public.vendas_hoteis_dia(date, date) from public, anon;
grant execute on function public.vendas_hoteis_dia(date, date) to authenticated;

-- Nome da unidade na página de vendas (pedido do dono, 12/11/2026)
update public.totvs_unidades set nome = 'Cicchetti Pipa' where id = 'pipa_centro';

-- Teste (13/11/2026): relatórios do PMS que podem trazer os itens do PDV do restaurante do Sempre Vivo.
-- (304 "POS Itens por Ponto de Venda e Data" vem vazio e 212 "Lançamentos de POS" dá erro.) Resultado em pms_relatorio_dados.
insert into public.pms_relatorios_config (chave, nome, area, modo, intervalo_min, meses_historico, descricao, ativo, ordem) values
 (6710, 'Lançamentos de PDV de Serviços Analítico', 'consumo', 'mensal', 180, 1, 'Teste (13/11/2026): itens do PDV do restaurante', true, 52),
 (11850, 'Receitas Produtos por Usuário x Mês', 'consumo', 'mensal', 360, 1, 'Teste (13/11/2026): receita de produtos', true, 53),
 (11651, 'Receitas Extras por Usuário x Mês', 'consumo', 'mensal', 360, 1, 'Teste (13/11/2026): receitas extras', true, 54),
 (6751, 'Analítico de Lançamentos de Serviços por Nota', 'consumo', 'mensal', 360, 1, 'Teste (13/11/2026): serviços por nota', true, 55),
 (305, 'Pensão por Tipo e Data', 'consumo', 'mensal', 360, 1, 'Teste (13/11/2026): pensão (café, meia, completa)', true, 56),
 (1, 'Diferença de Data entre PMS X POS', 'consumo', 'mensal', 360, 1, 'Teste (13/11/2026): lançamentos do POS no PMS', true, 57),
 (7167, 'Relatório de Serviços e Receitas - Conferência', 'contas', 'mensal', 360, 1, 'Teste (13/11/2026): serviços e receitas', true, 15),
 (0, 'Fechamento de Caixa', 'contas', 'mensal', 360, 1, 'Teste (13/11/2026): fechamento de caixa', true, 16),
 (3740, 'Brasico Produção por Hotel', 'producao', 'mensal', 360, 1, 'Teste (13/11/2026): relatório Brasico do PMS', true, 61)
on conflict (chave) do nothing;
