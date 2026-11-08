-- =====================================================================
-- PMS dos hotéis: no-show que depois virou estadia — 08/11/2026.
-- Caso real (Sempre Vivo, AP30, reserva 22MXT62N1-00001): reservada de 07/11 a 08/11, dada como no-show, e o
-- hóspede chegou no dia 08 (check-in e check-out no mesmo dia). O PMS troca a chegada para 08/11 e a reserva
-- fica com zero noites: o mapa escondia tudo. Agora:
--  · pms_estadias guarda a chegada original (checkin_original, a mais cedo já vista) e se a reserva já passou
--    por no-show (teve_noshow), por gatilho, sem mexer na função do robô;
--  · a visão pms_estadias_canal usa o status mais novo entre a busca de reservas e as transações (a busca do PMS
--    não traz os check-outs recentes: uma reserva que já saiu continuava "Check-In");
--  · o mapa mostra o no-show (noite original) e a estadia depois dele, inclusive a de zero noites.
-- =====================================================================

alter table public.pms_estadias add column if not exists checkin_original date;
alter table public.pms_estadias add column if not exists teve_noshow boolean not null default false;

create or replace function public.pms_estadias_historia() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.checkin_original := least(coalesce(old.checkin_original, old.checkin), coalesce(new.checkin_original, new.checkin), new.checkin);
    new.teve_noshow := old.teve_noshow or new.teve_noshow or coalesce(new.status_id = 5, false);
  else
    new.checkin_original := coalesce(new.checkin_original, new.checkin);
    new.teve_noshow := new.teve_noshow or coalesce(new.status_id = 5, false);
  end if;
  return new;
end $$;
drop trigger if exists pms_estadias_historia on public.pms_estadias;
create trigger pms_estadias_historia before insert or update on public.pms_estadias for each row execute function public.pms_estadias_historia();

-- Preencher o que já existe
update public.pms_estadias set checkin_original = checkin, teve_noshow = (status_id = 5) where checkin_original is null;
-- Reservas que chegaram depois da data original e ficaram com zero noites = no-show seguido de check-in (pelas transações)
update public.pms_estadias e set checkin_original = t.c0, teve_noshow = true
from (select hotel_id, reserva, min(chegada) c0 from public.pms_transacoes where reserva is not null group by 1, 2) t
where t.hotel_id = e.hotel_id and t.reserva = e.codigo and t.c0 < e.checkin and e.checkout = e.checkin and e.status_id in (2, 3);

drop view if exists public.pms_estadias_canal;
create view public.pms_estadias_canal with (security_invoker = true) as
select e.hotel_id, e.item_id, e.codigo, e.grupo_codigo, e.grupo_nome, e.uh_id, e.uh_numero, e.tipo_id, e.tipo,
       e.checkin, e.checkout, e.noites,
       case when tx.saiu then 3 else e.status_id end as status_id,
       case when tx.saiu then 'Check-out' else e.status end as status,
       e.hospede, e.adultos, e.criancas, e.hospedes, e.vip, e.fora_inventario, greatest(e.visto_em, tx.lido_em) as visto_em,
       r.canal, r.empresa, r.tarifa, r.valor_diarias, r.criada_em, r.cancelada_em,
       e.checkin_original, e.teve_noshow
from public.pms_estadias e
left join public.pms_reservas r on r.hotel_id = e.hotel_id and r.reserva = e.codigo
left join lateral (
  select x.lido_em, (x.status_reserva = 'Check Out' and x.lido_em > e.visto_em and e.status_id in (1, 2, 4)) as saiu
  from public.pms_transacoes x where x.hotel_id = e.hotel_id and x.reserva = e.codigo
  order by x.lido_em desc limit 1
) tx on true
union all
select t.hotel_id, -abs(hashtextextended(t.hotel_id || '|' || t.reserva, 0)) as item_id, t.reserva, null::text, null::text,
       u.uh_id, t.uh, u.tipo_id, coalesce(t.tipo_uh, u.tipo), t.chegada, t.partida, (t.partida - t.chegada)::int,
       3, 'Check-out', null::text, null::int, null::int, null::int, false, false, t.lido_em,
       r.canal, r.empresa, r.tarifa, r.valor_diarias, r.criada_em, r.cancelada_em,
       t.c0, (t.c0 < t.chegada and t.partida = t.chegada)
from (
  select distinct on (x.hotel_id, x.reserva) x.hotel_id, x.reserva, x.uh, x.tipo_uh, x.chegada, x.partida, x.lido_em,
         min(x.chegada) over (partition by x.hotel_id, x.reserva) as c0
  from public.pms_transacoes x
  where x.reserva is not null and x.status_reserva = 'Check Out' and x.chegada is not null and x.partida >= x.chegada
  order by x.hotel_id, x.reserva, x.lido_em desc, x.dia desc
) t
left join public.pms_uhs u on u.hotel_id = t.hotel_id and u.numero = t.uh
left join public.pms_reservas r on r.hotel_id = t.hotel_id and r.reserva = t.reserva
where not exists (select 1 from public.pms_estadias e where e.hotel_id = t.hotel_id and e.codigo = t.reserva);

grant select on public.pms_estadias_canal to authenticated;
