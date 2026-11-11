-- =====================================================================
-- Ocupação oficial nos painéis dos hotéis — 10/11/2026, a pedido do dono ("o painel tem que bater 100%").
--
-- Problema: o relatório 7408 "Disponibilidade e KPIs por Categoria e Dia" conta como ocupada toda UH que teve
-- hóspede no dia, INCLUSIVE no dia da saída (ex.: Sempre Vivo 02/11/2026: 14 "ocupadas", ninguém dormiu).
-- Ele inflava a ocupação em 25% a 50%. A receita dele está certa (= diárias lançadas, igual ao PMS).
--
-- Fonte oficial: relatório 2491 "Análise de Ocupação e Receita Prevista e Real" (coluna "Ocupação Real" = UHs
-- ocupadas na noite, como o painel do PMS; conta day-use). O robô já o lê (pms_relatorios_config / pms_relatorio_dados).
--
-- Como fica:
--  * pms_ocupacao_oficial = ocupação real de cada hotel e dia (última leitura do 2491).
--  * pms_kpi_dia.ocupadas_noite = o total oficial do dia dividido pelos tipos de UH conforme as noites das reservas
--    daquele dia (maiores restos; a soma dos tipos dá sempre o oficial). Sem reserva no dia, divide pelo 7408.
--    Dia sem 2491 lido ainda: as noites das reservas (o robô busca o histórico do 2491 em poucas rodadas).
--  * pms_kpi_dia_ajustado (base de pms_dia_hotel, pms_mes_hotel e da Visão geral) usa ocupadas_noite.
--  * Sempre Vivo: 8 dos 16 Pool Apartments estão desativados; o painel do PMS conta 26 UHs.
--  * pg_cron pms-ocupacao-oficial recalcula a cada 15 min (e o 2491 é relido a cada 2 h no mês atual).
-- =====================================================================

create or replace view public.pms_ocupacao_oficial as
select distinct on (d.hotel_id, left(x->>0, 10)::date)
  d.hotel_id, left(x->>0, 10)::date as dia,
  (x->>6)::int as ocupadas, (x->>2)::numeric as receita, (x->>5)::numeric as ocupadas_previstas, d.lido_em
from public.pms_relatorio_dados d
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.linhas) = 'array' then d.linhas else '[]'::jsonb end) x
where d.chave = 2491 and d.erro is null and x->>0 is not null and x->>6 is not null
order by d.hotel_id, left(x->>0, 10)::date, d.lido_em desc;

alter view public.pms_ocupacao_oficial set (security_invoker = true);
grant select on public.pms_ocupacao_oficial to authenticated;

alter table public.pms_kpi_dia add column if not exists ocupadas_noite int;
alter table public.pms_kpi_dia add column if not exists ocupadas_fonte text;  -- oficial | reservas

create or replace function public.pms_corrigir_ocupacao()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with
  cats as (select distinct hotel_id, categoria from pms_kpi_dia),
  noites as (
    select e.hotel_id,
      coalesce((select c.categoria from cats c where c.hotel_id = e.hotel_id and c.categoria = e.tipo),
               case e.tipo when 'Superior' then 'Bangalô Deluxe Superior' when 'Térreo' then 'Bangalô Deluxe Terreo'
                           when 'VM' then 'Bangalô Deluxe Vista Mar' when 'Apartment' then 'Pool Apartment' end) as categoria,
      g::date as dia
    from pms_estadias_canal e
    cross join lateral generate_series(e.checkin, greatest(e.checkout - 1, e.checkin), interval '1 day') g
    where e.status_id not in (5, 6) and e.checkin is not null and e.checkout is not null),
  w as (select hotel_id, dia, categoria, count(*) as n from noites where categoria is not null group by 1, 2, 3),
  base as (
    select k.hotel_id, k.dia, k.categoria, k.ocupadas as kpi, coalesce(w.n, 0) as res,
           sum(coalesce(w.n, 0)) over (partition by k.hotel_id, k.dia) as res_dia,
           sum(k.ocupadas) over (partition by k.hotel_id, k.dia) as kpi_dia,
           o.ocupadas as oficial
    from pms_kpi_dia k
    left join w on w.hotel_id = k.hotel_id and w.dia = k.dia and w.categoria = k.categoria
    left join pms_ocupacao_oficial o on o.hotel_id = k.hotel_id and o.dia = k.dia),
  pesos as (
    select *, case when res_dia > 0 then res::numeric / res_dia
                   when kpi_dia > 0 then kpi::numeric / kpi_dia
                   else 0 end as peso
    from base),
  q as (
    select *, coalesce(oficial, res_dia)::numeric * peso as alvo from pesos),
  r as (
    select *, floor(alvo)::int as piso,
           coalesce(oficial, res_dia) - sum(floor(alvo)::int) over (partition by hotel_id, dia) as sobra,
           row_number() over (partition by hotel_id, dia order by alvo - floor(alvo) desc, peso desc, categoria) as ordem
    from q),
  f as (
    select hotel_id, dia, categoria,
           case when oficial is null and res_dia = 0 then null
                else piso + case when peso > 0 and ordem <= sobra then 1 else 0 end end as valor,
           case when oficial is not null then 'oficial' when res_dia > 0 then 'reservas' end as fonte
    from r)
  update pms_kpi_dia k
     set ocupadas_noite = f.valor, ocupadas_fonte = f.fonte
    from f
   where k.hotel_id = f.hotel_id and k.dia = f.dia and k.categoria = f.categoria
     and (k.ocupadas_noite is distinct from f.valor or k.ocupadas_fonte is distinct from f.fonte);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.pms_corrigir_ocupacao() from public, anon, authenticated;

create or replace view public.pms_kpi_dia_ajustado as
select k.hotel_id, k.dia, k.categoria,
  case when c.uhs is null then k.disponiveis else greatest(least(k.disponiveis, c.uhs), coalesce(k.ocupadas_noite, k.ocupadas)) end as disponiveis,
  case when c.uhs is null then k.bloqueadas else least(k.bloqueadas, c.uhs) end as bloqueadas,
  case when c.uhs is null then k.total else greatest(least(k.total, c.uhs), coalesce(k.ocupadas_noite, k.ocupadas)) end as total,
  coalesce(k.ocupadas_noite, k.ocupadas) as ocupadas,
  k.receita
from public.pms_kpi_dia k
left join public.pms_categoria_uhs c on c.hotel_id = k.hotel_id and c.categoria = k.categoria;

alter view public.pms_kpi_dia_ajustado set (security_invoker = true);

-- Sempre Vivo: o painel do PMS conta 26 UHs (8 dos 16 Pool Apartments estão desativados)
insert into public.pms_categoria_uhs (hotel_id, categoria, uhs, motivo)
values ('sempre-vivo', 'Pool Apartment', 8, '8 dos 16 Pool Apartments estão desativados no PMS; o painel do PMS conta 26 UHs no hotel')
on conflict (hotel_id, categoria) do update set uhs = excluded.uhs, motivo = excluded.motivo;

-- O robô busca o 2491 desde o começo do hotel e relê o mês atual a cada 2 h
update public.pms_relatorios_config set meses_historico = 50, intervalo_min = 120 where chave = 2491;

select public.pms_corrigir_ocupacao();

select cron.schedule('pms-ocupacao-oficial', '*/15 * * * *', $$select public.pms_corrigir_ocupacao()$$);
