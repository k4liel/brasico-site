-- =====================================================================
-- PMS dos hotéis: hóspedes, detalhes e histórico das reservas sempre atualizados — 08/11/2026 (pedido do dono).
-- pms_estadias.alterado_em marca quando a busca do PMS trouxe mudança na reserva (datas, UH, status, hóspede,
-- quantidade de pessoas). A fila do robô (pms_robo_detalhes_fila, 80 por hotel a cada rodada de ~30 min) relê:
--  1) reserva que mudou no PMS depois da última leitura; hospedadas e com chegada/saída de ontem a amanhã
--     (a cada rodada); ativas nunca lidas;
--  2) as demais nunca lidas (as mais recentes primeiro);
--  3) futuras dos próximos 30 dias, a cada 6 h;
--  4) futuras mais distantes e saídas dos últimos 7 dias, a cada 24 h.
-- =====================================================================

alter table public.pms_estadias add column if not exists alterado_em timestamptz;

create or replace function public.pms_estadias_historia() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.checkin_original := least(coalesce(old.checkin_original, old.checkin), coalesce(new.checkin_original, new.checkin), new.checkin);
    new.teve_noshow := old.teve_noshow or new.teve_noshow or coalesce(new.status_id = 5, false);
    if (new.checkin, new.checkout, new.status_id, new.uh_id, new.hospede, new.adultos, new.criancas, new.tipo)
       is distinct from (old.checkin, old.checkout, old.status_id, old.uh_id, old.hospede, old.adultos, old.criancas, old.tipo) then
      new.alterado_em := now();
    else
      new.alterado_em := old.alterado_em;
    end if;
  else
    new.checkin_original := coalesce(new.checkin_original, new.checkin);
    new.teve_noshow := new.teve_noshow or coalesce(new.status_id = 5, false);
    new.alterado_em := now();
  end if;
  return new;
end $$;

create or replace function public.pms_robo_detalhes_fila(p_segredo text, p_hotel text, p_limite int default 80)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; r jsonb;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'codigo', codigo, 'status_id', status_id)), '[]') into r from (
    select item_id, codigo, status_id from (
      select e.item_id, e.codigo, e.status_id, e.checkin,
             case
               when d.item_id is not null and e.alterado_em > d.detalhes_em then 1
               when (e.status_id = 2 or e.checkin between v_hoje - 1 and v_hoje + 1 or e.checkout between v_hoje - 1 and v_hoje + 1)
                    and e.status_id <> 6 and (d.item_id is null or d.detalhes_em < now() - interval '25 minutes') then 1
               when d.item_id is null then 2
               when e.status_id in (1, 4) and e.checkin <= v_hoje + 30 and e.checkout >= v_hoje and d.detalhes_em < now() - interval '6 hours' then 3
               when e.status_id in (1, 4) and e.checkout >= v_hoje and d.detalhes_em < now() - interval '24 hours' then 4
               when e.status_id = 3 and e.checkout >= v_hoje - 7 and d.detalhes_em < now() - interval '24 hours' then 4
             end as prioridade
      from public.pms_estadias e
      left join public.pms_reserva_detalhes d on d.hotel_id = e.hotel_id and d.item_id = e.item_id
      where e.hotel_id = p_hotel and e.item_id > 0
    ) x
    where prioridade is not null
    order by prioridade, case when prioridade = 2 then null else checkin end asc nulls last, checkin desc
    limit greatest(1, least(coalesce(p_limite, 80), 200))
  ) y;
  return r;
end $$;
