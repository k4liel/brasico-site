-- Restaurante do Sempre Vivo pelo PDV do hotel (13/11/2026, "preciso dos dados detalhados do Sempre Vivo").
-- O PMS recebe do PDV só o que vai para a conta do quarto ("MENU CICCHETTI"); quem come e paga direto no restaurante
-- (e eventos como o do grupo Riachuelo) só aparece no PDV. Em outubro/2026: PDV R$ 50.432 × contas R$ 23.095.
-- Fonte: relatório Metabase 11850 "Receitas Produtos por Usuário x Mês" (Mês, Usuário, Item, Valor com os 10%),
-- lido por mês (24 meses) e também dia a dia (diario_dias = 400) pelo robô (pms_relatorio_dados, ini = fim no dia a dia).
-- 305 "Pensão por Tipo e Data" = refeições incluídas por dia (cafés da manhã), pagantes e cortesias.
-- Testados e desligados no mesmo dia: 6710, 6751, 1, 0 (erro), 3740 (vazios ou só serviços) e 7167, 11651 (nomes e e-mails).

alter table public.pms_relatorios_config add column if not exists diario_dias integer not null default 0;

create or replace function public.pms_robo_relatorios_fila(p_segredo text, p_hotel text, p_limite integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v_mes date := date_trunc('month', v_hoje)::date; r jsonb;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with alvo as (
    select c.chave, c.ordem, 1 as prioridade, v_hoje as ini, v_hoje as fim, c.intervalo_min
    from public.pms_relatorios_config c where c.ativo and c.modo = 'foto'
    union all
    select c.chave, c.ordem, case when g.n = 0 then 2 when g.n = 1 then 3 else 4 end, (v_mes - make_interval(months => g.n))::date,
           ((v_mes - make_interval(months => g.n - 1))::date - 1), c.intervalo_min
    from public.pms_relatorios_config c cross join lateral generate_series(0, c.meses_historico) g(n)
    where c.ativo and c.modo = 'mensal'
    union all
    -- Dia a dia (13/11/2026): hoje e ontem a cada intervalo, a última semana uma vez por dia, o resto uma vez só
    select c.chave, c.ordem, case when g.n <= 1 then 2 when g.n <= 7 then 3 else 4 end, v_hoje - g.n, v_hoje - g.n, c.intervalo_min
    from public.pms_relatorios_config c cross join lateral generate_series(0, c.diario_dias) g(n)
    where c.ativo and c.diario_dias > 0
  ), devidos as (
    select a.*, d.lido_em, d.erro from alvo a
    left join public.pms_relatorio_dados d on d.hotel_id = p_hotel and d.chave = a.chave and d.ini = a.ini and d.fim = a.fim
    where d.lido_em is null
       or (a.prioridade in (1, 2) and d.lido_em < now() - make_interval(mins => a.intervalo_min))
       or (a.prioridade = 3 and d.lido_em < now() - interval '24 hours')
       or (a.prioridade = 4 and d.erro is not null and d.lido_em < now() - interval '24 hours')
  )
  select coalesce(jsonb_agg(jsonb_build_object('chave', chave, 'ini', ini, 'fim', fim) order by prioridade, ini desc, ordem), '[]') into r
  from (select * from devidos order by prioridade, ini desc, ordem limit greatest(1, least(coalesce(p_limite, 30), 100))) x;
  return r;
end $function$;

insert into public.pms_relatorios_config (chave, nome, area, modo, intervalo_min, meses_historico, descricao, ativo, ordem, diario_dias) values
 (11850, 'Receitas Produtos por Usuário x Mês', 'consumo', 'mensal', 120, 24, 'Itens vendidos no PDV do hotel (restaurante, bar, frigobar), por mês e dia a dia', true, 53, 400),
 (305, 'Pensão por Tipo e Data', 'consumo', 'mensal', 360, 24, 'Refeições incluídas por dia (café da manhã), pagantes e cortesias', true, 56, 0)
on conflict (chave) do update set meses_historico = excluded.meses_historico, intervalo_min = excluded.intervalo_min,
  descricao = excluded.descricao, diario_dias = excluded.diario_dias, ativo = true;
update public.pms_relatorios_config set ativo = false where chave in (6710, 6751, 1, 0, 3740, 7167, 11651);

-- Total do PDV por hotel e dia (só leituras de um dia, sem erro)
create or replace function public.vendas_hoteis_pdv_dia(p_de date, p_ate date)
returns table (hotel_id text, dia date, total numeric, itens integer)
language sql stable security invoker set search_path = public as $$
  select d.hotel_id, d.ini, coalesce(sum((x->>3)::numeric), 0), count(x)::int
  from public.pms_relatorio_dados d left join lateral jsonb_array_elements(d.linhas) x on true
  where d.chave = 11850 and d.ini = d.fim and d.erro is null and d.linhas is not null and d.ini between p_de and p_ate
  group by d.hotel_id, d.ini
$$;

-- vendas_hoteis_dia com o PDV: dia com leitura do PDV = total do PDV (já inclui a conta do quarto e o frigobar)
-- + consumo lançado no PMS fora do PDV; sem leitura, o que foi lançado nas contas.
drop function if exists public.vendas_hoteis_dia(date, date);
create or replace function public.vendas_hoteis_dia(p_de date, p_ate date)
returns table (hotel_id text, dia date, hospedagem numeric, restaurante_pms numeric, restaurante_totvs numeric,
               restaurante_migrado numeric, spa numeric, outros numeric, taxas numeric, iss numeric, frigobar numeric,
               restaurante_lancamentos integer, restaurante_contas numeric, restaurante_pdv boolean)
language sql stable security invoker set search_path = public as $$
  with h as (
    select ph.id as hotel_id, ph.totvs_unidade,
           (select min(d.dia) from public.totvs_dias d where d.unidade_id = ph.totvs_unidade and d.total > 0) as totvs_desde
    from public.pms_hoteis ph
    where ph.ativa
  ),
  l as (
    select t.hotel_id, t.dia, -t.valor as valor, t.descricao, lower(coalesce(t.item_tipo, '')) like 'point of sale%' as pos,
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
           coalesce(sum(valor) filter (where cat = 'restaurante' and not migrado and not pos), 0) as restaurante_fora_pos,
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
  ),
  pdv as (
    select v.hotel_id, v.dia, v.total from public.vendas_hoteis_pdv_dia(p_de, p_ate) v join h on h.hotel_id = v.hotel_id
  ),
  dias as (
    select hotel_id, dia from p union select hotel_id, dia from tv union select hotel_id, dia from pdv
  )
  select d.hotel_id, d.dia,
         coalesce(p.hospedagem, 0),
         case when pdv.dia is not null then pdv.total + coalesce(p.restaurante_fora_pos, 0) else coalesce(p.restaurante_pms, 0) end,
         coalesce(tv.restaurante_totvs, 0), coalesce(p.restaurante_migrado, 0), coalesce(p.spa, 0), coalesce(p.outros, 0),
         coalesce(p.taxas, 0), coalesce(p.iss, 0),
         case when pdv.dia is not null then 0 else coalesce(p.frigobar, 0) end,
         coalesce(p.restaurante_lancamentos, 0), coalesce(p.restaurante_pms, 0), pdv.dia is not null
  from dias d
  left join p on p.hotel_id = d.hotel_id and p.dia = d.dia
  left join tv on tv.hotel_id = d.hotel_id and tv.dia = d.dia
  left join pdv on pdv.hotel_id = d.hotel_id and pdv.dia = d.dia
  order by 1, 2
$$;

-- Produtos vendidos no PDV no período: soma das leituras de um dia; sem nenhuma, a leitura do mês inteiro
create or replace function public.vendas_hoteis_produtos(p_hotel text, p_de date, p_ate date)
returns table (item text, valor numeric, fonte text)
language sql stable security invoker set search_path = public as $$
  with diario as (
    select d.* from public.pms_relatorio_dados d
    where d.hotel_id = p_hotel and d.chave = 11850 and d.ini = d.fim and d.erro is null and d.ini between p_de and p_ate
  ), mensal as (
    select d.* from public.pms_relatorio_dados d
    where d.hotel_id = p_hotel and d.chave = 11850 and d.ini = p_de and d.fim = p_ate and d.erro is null
      and not exists (select 1 from diario)
  ), linhas as (
    select x, 'dia' as fonte from diario, jsonb_array_elements(diario.linhas) x
    union all select x, 'mes' from mensal, jsonb_array_elements(mensal.linhas) x
  )
  select trim(x->>2), sum((x->>3)::numeric), min(fonte) from linhas group by trim(x->>2) order by 2 desc
$$;

-- Refeições incluídas (pensão) por dia, até hoje
create or replace function public.vendas_hoteis_pensao(p_hotel text, p_de date, p_ate date)
returns table (dia date, pensao text, pagantes numeric, gratuidades numeric, total numeric)
language sql stable security invoker set search_path = public as $$
  select distinct on ((x->>2)::date, x->>1) (x->>2)::date, x->>1, (x->>11)::numeric, (x->>12)::numeric, (x->>13)::numeric
  from public.pms_relatorio_dados d, jsonb_array_elements(d.linhas) x
  where d.hotel_id = p_hotel and d.chave = 305 and d.erro is null
    and (x->>2)::date between p_de and least(p_ate, (now() at time zone 'America/Fortaleza')::date)
  order by (x->>2)::date, x->>1, d.lido_em desc
$$;

revoke execute on function public.vendas_hoteis_dia(date, date), public.vendas_hoteis_pdv_dia(date, date),
  public.vendas_hoteis_produtos(text, date, date), public.vendas_hoteis_pensao(text, date, date) from public, anon;
grant execute on function public.vendas_hoteis_dia(date, date), public.vendas_hoteis_pdv_dia(date, date),
  public.vendas_hoteis_produtos(text, date, date), public.vendas_hoteis_pensao(text, date, date) to authenticated;
