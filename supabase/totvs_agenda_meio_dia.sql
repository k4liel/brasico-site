-- Agenda TOTVS com conferência do dia anterior (26/10/2026).
-- A puxada das 4h30 às vezes chega antes de o caixa da loja mandar o dia para a TOTVS: o dia vinha
-- "sem movimento" (Pipa Centro 25/10, Filha da Lua 22/10) ou pela metade, e nunca era conferido de novo.
-- Agora:
--  - 4h30 às 6h35: além dos dias que faltam na última semana, tenta de novo ontem se veio sem movimento;
--  - 12h às 12h55: puxa de novo o dia de ontem de cada unidade, uma vez (pega dia vazio ou incompleto).
-- Um dia por unidade de cada vez, como sempre (vários juntos fazem a TOTVS estourar o tempo).
create or replace function public.totvs_agenda()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  u record; v_dia date;
  v_agora timestamp := now() at time zone 'America/Fortaleza';
  v_ontem date := v_agora::date - 1;
  v_manha boolean := v_agora::time between time '04:30' and time '06:35';
  v_meio_dia boolean := v_agora::time between time '12:00' and time '12:55';
begin
  if not v_manha and not v_meio_dia then return; end if;
  for u in select id from public.totvs_unidades where ativa and loja is not null order by ordem loop
    continue when exists (select 1 from public.totvs_execucoes e where e.unidade_id = u.id
      and e.status in ('na_fila', 'rodando') and e.created_at > now() - interval '5 minutes');
    v_dia := null;
    if v_manha then
      select g.d::date into v_dia
      from generate_series(v_ontem, v_ontem - 7, interval '-1 day') g(d)
      where (not exists (select 1 from public.totvs_dias t where t.unidade_id = u.id and t.dia = g.d::date)
             or (g.d::date = v_ontem and exists (select 1 from public.totvs_dias t where t.unidade_id = u.id
                 and t.dia = g.d::date and t.status = 'sem_movimento')))
        and (select count(*) from public.totvs_execucoes e where e.unidade_id = u.id and e.dia = g.d::date
             and e.created_at > now() - interval '3 hours') < 3
      order by g.d desc limit 1;
    else
      -- Meio-dia: ontem de novo, uma vez só (se ainda não foi puxado depois das 12h de hoje)
      if not exists (select 1 from public.totvs_execucoes e where e.unidade_id = u.id and e.dia = v_ontem
          and e.created_at >= (v_agora::date + time '12:00') at time zone 'America/Fortaleza') then
        v_dia := v_ontem;
      end if;
    end if;
    if v_dia is not null then perform public.totvs_pedir(u.id, v_dia, 'agenda', null); end if;
  end loop;
end $$;

-- Roda a cada 10 min das 4h às 6h50 e das 12h às 12h50 de Fortaleza (7-9h e 15h UTC);
-- a função só age nas janelas acima.
select cron.alter_job((select jobid from cron.job where jobname = 'totvs-diario'), schedule := '*/10 7-9,15 * * *');
