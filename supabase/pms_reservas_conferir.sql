-- =====================================================================
-- Robô do PMS: reservas para conferir uma a uma — 08/11/2026.
-- A busca de reservas do PMS (booking/searchv2) devolve no máximo 1500 linhas por status, sem ordem de data, e
-- não filtra por data: os check-outs recentes não vinham. Ela aceita freeCodeSearch=<código da reserva> e
-- checkOutToday=true. A cada rodada o robô lê os check-outs do dia e pede aqui os códigos que precisa conferir:
--  1) reservas que ficaram como Confirmada/Check-in/Pendente com a saída já passada (status velho);
--  2) reservas que aparecem nas transações e não estão em pms_estadias (check-outs que a busca não trouxe),
-- das mais recentes para as mais antigas, até p_limite por rodada (o histórico se completa aos poucos).
-- =====================================================================

create or replace function public.pms_robo_reservas_conferir(p_segredo text, p_hotel text, p_limite int default 80)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; r text[];
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select array_agg(codigo) into r from (
    select codigo from (
      select e.codigo, e.checkout as data, 1 as prioridade
      from public.pms_estadias e
      where e.hotel_id = p_hotel and e.codigo is not null and e.status_id in (1, 2, 4) and e.checkout < v_hoje
      union
      select t.reserva, max(t.partida), 2
      from public.pms_transacoes t
      where t.hotel_id = p_hotel and t.reserva is not null and t.reserva ~ '^[A-Z0-9]+-[0-9]+$'
        and not exists (select 1 from public.pms_estadias e where e.hotel_id = t.hotel_id and e.codigo = t.reserva)
      group by t.reserva
    ) x
    group by codigo
    order by min(prioridade), max(data) desc nulls last
    limit greatest(1, least(coalesce(p_limite, 80), 300))
  ) y;
  return coalesce(r, '{}');
end $$;
revoke execute on function public.pms_robo_reservas_conferir(text, text, int) from public, authenticated;
grant execute on function public.pms_robo_reservas_conferir(text, text, int) to anon;
