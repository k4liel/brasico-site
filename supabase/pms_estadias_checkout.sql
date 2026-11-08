-- =====================================================================
-- PMS dos hotéis: check-outs já feitos no mapa e nas reservas — 08/11/2026.
-- A busca de reservas do PMS (booking/searchv2) devolve no máximo ~1000 linhas por status, das mais antigas
-- para as mais novas: no status 3 (Check-out) os recentes ficavam de fora (o último lido era de 16/10 no
-- Filha da Lua e de 16/08 no Sempre Vivo). As transações (pms_transacoes) trazem cada reserva com UH, chegada,
-- saída e status; a visão pms_estadias_canal passa a completar com os check-outs que só existem nas transações.
-- Esses vêm sem nome do hóspede e sem quantidade de hóspedes (o robô não copia esses dados das transações).
-- item_id negativo = linha montada das transações (não existe no PMS com esse id).
-- =====================================================================

create or replace view public.pms_estadias_canal with (security_invoker = true) as
select e.hotel_id, e.item_id, e.codigo, e.grupo_codigo, e.grupo_nome, e.uh_id, e.uh_numero, e.tipo_id, e.tipo,
       e.checkin, e.checkout, e.noites, e.status_id, e.status, e.hospede, e.adultos, e.criancas, e.hospedes, e.vip,
       e.fora_inventario, e.visto_em, r.canal, r.empresa, r.tarifa, r.valor_diarias, r.criada_em, r.cancelada_em
from public.pms_estadias e
left join public.pms_reservas r on r.hotel_id = e.hotel_id and r.reserva = e.codigo
union all
select t.hotel_id, -abs(hashtextextended(t.hotel_id || '|' || t.reserva, 0)) as item_id, t.reserva, null::text, null::text,
       u.uh_id, t.uh, u.tipo_id, coalesce(t.tipo_uh, u.tipo), t.chegada, t.partida, (t.partida - t.chegada)::int,
       3, 'Check-out', null::text, null::int, null::int, null::int, false, false, t.lido_em,
       r.canal, r.empresa, r.tarifa, r.valor_diarias, r.criada_em, r.cancelada_em
from (
  select distinct on (x.hotel_id, x.reserva) x.hotel_id, x.reserva, x.uh, x.tipo_uh, x.chegada, x.partida, x.lido_em
  from public.pms_transacoes x
  where x.reserva is not null and x.status_reserva = 'Check Out' and x.chegada is not null and x.partida > x.chegada
  order by x.hotel_id, x.reserva, x.lido_em desc, x.dia desc
) t
left join public.pms_uhs u on u.hotel_id = t.hotel_id and u.numero = t.uh
left join public.pms_reservas r on r.hotel_id = t.hotel_id and r.reserva = t.reserva
where not exists (select 1 from public.pms_estadias e where e.hotel_id = t.hotel_id and e.codigo = t.reserva);

grant select on public.pms_estadias_canal to authenticated;
