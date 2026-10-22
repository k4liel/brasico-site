-- =====================================================================
-- Agenda diária da TOTVS: todo dia às 4h30 (Fortaleza) puxa os últimos fechamentos.
-- Substitui a agenda das 6h de totvs.sql.
-- A agenda totvs-diario roda a cada 10 min entre 4h30 e 6h30. Em cada passo, para cada
-- unidade, pede o dia mais recente da última semana (ontem incluído) que ainda não está
-- no banco. Só um dia por unidade de cada vez (vários juntos fazem a TOTVS estourar o tempo),
-- e no máximo 3 tentativas por dia em cada manhã.
-- =====================================================================
create or replace function public.totvs_agenda()
returns void language plpgsql security definer set search_path = public as $$
declare
  u record; v_dia date;
  v_agora timestamp := now() at time zone 'America/Fortaleza';
  v_ontem date := v_agora::date - 1;
begin
  if v_agora::time < time '04:30' or v_agora::time > time '06:35' then return; end if;
  for u in select id from public.totvs_unidades where ativa and loja is not null order by ordem loop
    -- ainda trabalhando no pedido anterior desta unidade
    continue when exists (select 1 from public.totvs_execucoes e where e.unidade_id = u.id
      and e.status in ('na_fila', 'rodando') and e.created_at > now() - interval '5 minutes');
    select g.d::date into v_dia
    from generate_series(v_ontem, v_ontem - 7, interval '-1 day') g(d)
    where not exists (select 1 from public.totvs_dias t where t.unidade_id = u.id and t.dia = g.d::date)
      and (select count(*) from public.totvs_execucoes e where e.unidade_id = u.id and e.dia = g.d::date
           and e.created_at > now() - interval '3 hours') < 3
    order by g.d desc limit 1;
    if v_dia is not null then perform public.totvs_pedir(u.id, v_dia, 'agenda', null); end if;
  end loop;
end $$;
revoke execute on function public.totvs_agenda() from public, anon, authenticated;

-- 4h30 a 6h30 em Fortaleza (UTC-3) = 7h30 a 9h30 UTC; a função ignora os horários fora da janela
select cron.unschedule('totvs-diario') where exists (select 1 from cron.job where jobname = 'totvs-diario');
select cron.schedule('totvs-diario', '*/10 7-9 * * *', $job$ select public.totvs_agenda() $job$);
