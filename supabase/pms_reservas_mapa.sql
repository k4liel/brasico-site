-- =====================================================================
-- PMS dos hotéis: UHs, estadias (reservas por quarto) e bloqueios, para a página de Reservas e o
-- Mapa de reservas (08/11/2026). O robô da VPS lê do PMS a cada rodada:
--   pms/api/properties/{id}/rooms                      -> pms_uhs
--   booking/api/booking/searchv2 (todos os status)     -> pms_estadias (uma linha por quarto reservado)
--   availability/api/Availability/{id}/roomtypes        -> pms_bloqueios (roomsBlocked, com o motivo)
-- Guarda só o nome do hóspede principal, adultos e crianças (sem documento, contato nem observações).
-- Quem vê: os sócios (notas_pode_ver). Nada se apaga: estadia que some do PMS fica com visto_em antigo.
-- =====================================================================

create table if not exists public.pms_uhs (
  hotel_id text not null references public.pms_hoteis(id),
  uh_id bigint not null,
  numero text not null,
  tipo_id bigint,
  tipo text,
  andar text,
  ativa boolean not null default true,
  fora_inventario boolean not null default false,
  visto_em timestamptz not null default now(),
  primary key (hotel_id, uh_id)
);

create table if not exists public.pms_estadias (
  hotel_id text not null references public.pms_hoteis(id),
  item_id bigint not null,               -- reservationItemId (um quarto de uma reserva)
  codigo text,                           -- reservationItemCode, ex. 22M772JFH-00001 (liga com pms_reservas.reserva)
  grupo_codigo text,                     -- reservationGroupCode
  grupo_nome text,
  uh_id bigint,
  uh_numero text,
  tipo_id bigint,
  tipo text,
  checkin date,
  checkout date,
  noites int generated always as (case when checkin is not null and checkout is not null then checkout - checkin end) stored,
  status_id int,                         -- 1 Confirmada, 2 Check-In, 3 Check-Out, 4 Pendente, 5 No-Show, 6 Cancelada
  status text,
  hospede text,                          -- só o hóspede principal
  adultos int,
  criancas int,
  hospedes int,
  vip boolean not null default false,
  fora_inventario boolean not null default false,
  visto_em timestamptz not null default now(),
  primary key (hotel_id, item_id)
);
create index if not exists pms_estadias_datas_idx on public.pms_estadias (hotel_id, checkin, checkout);
create index if not exists pms_estadias_codigo_idx on public.pms_estadias (hotel_id, codigo);

create table if not exists public.pms_bloqueios (
  hotel_id text not null references public.pms_hoteis(id),
  bloqueio_id text not null,
  uh_id bigint,
  inicio date,
  fim date,                              -- último dia bloqueado (inclusive)
  motivo text,
  comentario text,
  visto_em timestamptz not null default now(),
  primary key (hotel_id, bloqueio_id)
);
create index if not exists pms_bloqueios_datas_idx on public.pms_bloqueios (hotel_id, inicio, fim);

do $$
declare t text;
begin
  foreach t in array array['pms_uhs', 'pms_estadias', 'pms_bloqueios'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "socios veem" on public.%I', t);
    execute format('create policy "socios veem" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Grava a leitura de reservas de um hotel. p_dados = {uhs:[...], estadias:[...], bloqueios:[...]} já normalizados pelo robô.
create or replace function public.pms_robo_gravar_reservas(p_segredo text, p_hotel text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nu int := 0; ne int := 0; nb int := 0;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.pms_hoteis where id = p_hotel) then raise exception 'hotel desconhecido'; end if;

  insert into public.pms_uhs (hotel_id, uh_id, numero, tipo_id, tipo, andar, ativa, fora_inventario, visto_em)
  select p_hotel, (x->>'uh_id')::bigint, x->>'numero', (x->>'tipo_id')::bigint, x->>'tipo', x->>'andar',
         coalesce((x->>'ativa')::boolean, true), coalesce((x->>'fora_inventario')::boolean, false), now()
  from jsonb_array_elements(coalesce(p_dados->'uhs', '[]')) x where x->>'uh_id' is not null
  on conflict (hotel_id, uh_id) do update set numero = excluded.numero, tipo_id = excluded.tipo_id, tipo = excluded.tipo,
    andar = excluded.andar, ativa = excluded.ativa, fora_inventario = excluded.fora_inventario, visto_em = now();
  get diagnostics nu = row_count;

  insert into public.pms_estadias (hotel_id, item_id, codigo, grupo_codigo, grupo_nome, uh_id, uh_numero, tipo_id, tipo, checkin, checkout,
    status_id, status, hospede, adultos, criancas, hospedes, vip, fora_inventario, visto_em)
  select p_hotel, (x->>'item_id')::bigint, x->>'codigo', x->>'grupo_codigo', x->>'grupo_nome', nullif(x->>'uh_id', '')::bigint, x->>'uh_numero',
         nullif(x->>'tipo_id', '')::bigint, x->>'tipo', (x->>'checkin')::date, (x->>'checkout')::date, (x->>'status_id')::int, x->>'status',
         x->>'hospede', (x->>'adultos')::int, (x->>'criancas')::int, (x->>'hospedes')::int,
         coalesce((x->>'vip')::boolean, false), coalesce((x->>'fora_inventario')::boolean, false), now()
  from jsonb_array_elements(coalesce(p_dados->'estadias', '[]')) x where x->>'item_id' is not null
  on conflict (hotel_id, item_id) do update set codigo = excluded.codigo, grupo_codigo = excluded.grupo_codigo, grupo_nome = excluded.grupo_nome,
    uh_id = excluded.uh_id, uh_numero = excluded.uh_numero, tipo_id = excluded.tipo_id, tipo = excluded.tipo, checkin = excluded.checkin,
    checkout = excluded.checkout, status_id = excluded.status_id, status = excluded.status, hospede = excluded.hospede,
    adultos = excluded.adultos, criancas = excluded.criancas, hospedes = excluded.hospedes, vip = excluded.vip,
    fora_inventario = excluded.fora_inventario, visto_em = now();
  get diagnostics ne = row_count;

  insert into public.pms_bloqueios (hotel_id, bloqueio_id, uh_id, inicio, fim, motivo, comentario, visto_em)
  select p_hotel, x->>'bloqueio_id', nullif(x->>'uh_id', '')::bigint, (x->>'inicio')::date, (x->>'fim')::date, x->>'motivo', x->>'comentario', now()
  from jsonb_array_elements(coalesce(p_dados->'bloqueios', '[]')) x where x->>'bloqueio_id' is not null
  on conflict (hotel_id, bloqueio_id) do update set uh_id = excluded.uh_id, inicio = excluded.inicio, fim = excluded.fim,
    motivo = excluded.motivo, comentario = excluded.comentario, visto_em = now();
  get diagnostics nb = row_count;

  return jsonb_build_object('uhs', nu, 'estadias', ne, 'bloqueios', nb);
end $$;
revoke execute on function public.pms_robo_gravar_reservas(text, text, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar_reservas(text, text, jsonb) to anon;

-- Estadias com o canal e o valor (de pms_reservas, quando a reserva veio por um canal integrado)
create or replace view public.pms_estadias_canal with (security_invoker = true) as
select e.*, r.canal, r.empresa, r.tarifa, r.valor_diarias, r.criada_em, r.cancelada_em
from public.pms_estadias e
left join public.pms_reservas r on r.hotel_id = e.hotel_id and r.reserva = e.codigo;
grant select on public.pms_estadias_canal to authenticated;
