-- TOTVS ao vivo (14/11/2026, pedido do dono: "aumentar a frequência para a cada 1 minuto, pra sempre ficar atualizado").
-- A TOTVS recebe as vendas ao longo do dia (logo depois da meia-noite o Pipa já tinha as 68 vendas do dia 13),
-- então a agenda totvs-ao-vivo puxa o dia de hoje de cada unidade em operação a cada minuto.
--  - Da meia-noite às 6h, os minutos pares puxam ontem: caixa fechado de madrugada conta no dia anterior.
--  - Uma leitura por unidade de cada vez: se a anterior ainda roda (TOTVS lenta), o minuto pula a unidade.
--  - Freio: 3 falhas seguidas ao vivo = a unidade descansa 15 min (não insistir até a TOTVS bloquear).
--  - Proteção: leitura vazia (sem_movimento) nunca substitui um dia que já tinha vendas.
-- As agendas de antes (totvs-diario, 4h30 e meio-dia) continuam: conferem os dias que faltarem na semana.

alter table public.totvs_execucoes drop constraint if exists totvs_execucoes_origem_check;
alter table public.totvs_execucoes add constraint totvs_execucoes_origem_check
  check (origem in ('agenda', 'site', 'claude', 'ao_vivo'));

create or replace function public.totvs_ao_vivo()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  u record; v_dia date;
  v_agora timestamp := now() at time zone 'America/Fortaleza';
begin
  v_dia := v_agora::date;
  if extract(hour from v_agora) < 6 and extract(minute from v_agora)::int % 2 = 0 then v_dia := v_dia - 1; end if;
  for u in select id from public.totvs_unidades where ativa and loja is not null and encerrada_em is null order by ordem loop
    -- Uma leitura por unidade de cada vez
    continue when exists (select 1 from public.totvs_execucoes e where e.unidade_id = u.id
      and e.status in ('na_fila', 'rodando') and e.created_at > now() - interval '5 minutes');
    -- Freio: as 3 últimas leituras ao vivo falharam e a última foi há menos de 15 min
    continue when (select count(*) = 3 and bool_and(x.status = 'falha') and max(x.created_at) > now() - interval '15 minutes'
                   from (select e.status, e.created_at from public.totvs_execucoes e
                         where e.unidade_id = u.id and e.origem = 'ao_vivo' order by e.created_at desc limit 3) x);
    perform public.totvs_pedir(u.id, v_dia, 'ao_vivo', null);
  end loop;
end $$;
revoke execute on function public.totvs_ao_vivo() from public, anon, authenticated;

-- Leitura vazia não apaga dia com vendas (soluço da TOTVS ou caixa que ainda não mandou)
create or replace function public.totvs_dias_sem_apagar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'sem_movimento' and coalesce(old.vendas, 0) > 0 then return old; end if;
  return new;
end $$;
drop trigger if exists totvs_dias_sem_apagar on public.totvs_dias;
create trigger totvs_dias_sem_apagar before update on public.totvs_dias
  for each row execute function public.totvs_dias_sem_apagar();

select cron.unschedule('totvs-ao-vivo') where exists (select 1 from cron.job where jobname = 'totvs-ao-vivo');
select cron.schedule('totvs-ao-vivo', '* * * * *', $job$ select public.totvs_ao_vivo() $job$);
