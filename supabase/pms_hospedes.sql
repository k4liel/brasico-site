-- =====================================================================
-- PMS dos hotéis: hóspedes, detalhes e histórico das reservas — 08/11/2026, a pedido do dono ("temos que ver tudo").
-- Antes o robô descartava documento, contato e observações. Agora copia, do PMS:
--  · pms_hospedes: cadastro do hóspede (booking/api/guestReservationItem/{id}): nome, e-mail, telefones, nascimento,
--    sexo, documento, endereço, motivo da viagem. Um por hotel e guestId do PMS (o mesmo hóspede em várias estadias).
--  · pms_reserva_hospedes: quem está em cada reserva (principal, criança, idade).
--  · pms_reserva_detalhes: detalhes de cada reserva (booking/api/booking/searchDetails/{id}): observações internas e
--    externas, quem criou/alterou e quando, total, segmento, origem, tarifa, número no canal.
--  · pms_reserva_historico: cada alteração da reserva (dataextractor/api/reservation/{id}), com usuário, data e os
--    campos antes/depois. O IP de quem alterou NÃO se copia.
-- Dados pessoais (LGPD): quem vê são só os sócios (notas_pode_ver); nada vai para o GitHub; nada se apaga.
-- O robô grava por pms_robo_gravar_hospedes e pede a fila por pms_robo_detalhes_fila.
-- =====================================================================

create table if not exists public.pms_hospedes (
  hotel_id text not null references public.pms_hoteis(id),
  guest_id bigint not null,
  person_id text,
  nome text,
  email text,
  telefone text,
  celular text,
  nascimento date,
  sexo text,
  documento_tipo_id int,
  documento text,
  rua text, numero text, complemento text, bairro text, cep text, cidade text, estado text, uf text, pais text,
  motivo_viagem text,
  tipo_hospede text,
  atualizado_em timestamptz not null default now(),
  primary key (hotel_id, guest_id)
);
create index if not exists pms_hospedes_nome_idx on public.pms_hospedes (hotel_id, lower(nome));

create table if not exists public.pms_reserva_hospedes (
  hotel_id text not null references public.pms_hoteis(id),
  guest_item_id bigint not null,
  item_id bigint not null,
  guest_id bigint,
  nome text,
  principal boolean not null default false,
  crianca boolean not null default false,
  idade_crianca int,
  vip boolean not null default false,
  status text,
  atualizado_em timestamptz not null default now(),
  primary key (hotel_id, guest_item_id)
);
create index if not exists pms_reserva_hospedes_item_idx on public.pms_reserva_hospedes (hotel_id, item_id);
create index if not exists pms_reserva_hospedes_guest_idx on public.pms_reserva_hospedes (hotel_id, guest_id);

create table if not exists public.pms_reserva_detalhes (
  hotel_id text not null references public.pms_hoteis(id),
  item_id bigint not null,
  reserva_codigo text,
  codigo text,
  guest_id bigint,
  criada_por text, criada_em timestamptz,
  alterada_por text, alterada_em timestamptz,
  total numeric(14,2), total_arr numeric(14,2),
  segmento text, origem text, tarifa text, grupo text, tipo_hospede text,
  adultos int, criancas int,
  obs_internas text, obs_externas text, obs_item_internas text, obs_item_externas text,
  numero_externo text,
  detalhes_em timestamptz not null default now(),
  historico_em timestamptz,
  primary key (hotel_id, item_id)
);

create table if not exists public.pms_reserva_historico (
  hotel_id text not null references public.pms_hoteis(id),
  evento_id text not null,
  item_id bigint not null,
  quando timestamptz,
  usuario text,
  tipo text,          -- Reservation, ReservationItem, GuestReservationItem, GuestRegistration...
  acao text,          -- Created, Updated...
  campos jsonb not null default '[]',  -- [{campo, nome, antes, depois}]
  primary key (hotel_id, evento_id)
);
create index if not exists pms_reserva_historico_item_idx on public.pms_reserva_historico (hotel_id, item_id, quando);

do $$
declare t text;
begin
  foreach t in array array['pms_hospedes', 'pms_reserva_hospedes', 'pms_reserva_detalhes', 'pms_reserva_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "socios veem" on public.%I', t);
    execute format('create policy "socios veem" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
  end loop;
end $$;

-- Fila de reservas para o robô ler os detalhes (até p_limite por rodada e hotel):
--  1) hospedadas, chegando ou saindo hoje/amanhã, se a última leitura tem mais de 2 h;
--  2) nunca lidas (as mais recentes primeiro);
--  3) confirmadas/pendentes futuras lidas há mais de 3 dias.
create or replace function public.pms_robo_detalhes_fila(p_segredo text, p_hotel text, p_limite int default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; r jsonb;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'codigo', codigo, 'status_id', status_id)), '[]') into r from (
    select item_id, codigo, status_id from (
      select e.item_id, e.codigo, e.status_id,
             case when d.item_id is not null and (e.status_id = 2 or e.checkin between v_hoje and v_hoje + 1 or e.checkout between v_hoje - 1 and v_hoje + 1)
                       and d.detalhes_em < now() - interval '2 hours' then 1
                  when d.item_id is null then 2
                  when e.status_id in (1, 4) and e.checkout >= v_hoje and d.detalhes_em < now() - interval '3 days' then 3
             end as prioridade,
             e.checkin
      from public.pms_estadias e
      left join public.pms_reserva_detalhes d on d.hotel_id = e.hotel_id and d.item_id = e.item_id
      where e.hotel_id = p_hotel and e.item_id > 0
    ) x
    where prioridade is not null
    order by prioridade, checkin desc nulls last
    limit greatest(1, least(coalesce(p_limite, 60), 200))
  ) y;
  return r;
end $$;
revoke execute on function public.pms_robo_detalhes_fila(text, text, int) from public, authenticated;
grant execute on function public.pms_robo_detalhes_fila(text, text, int) to anon;

-- Gravação (upsert; nada se apaga)
create or replace function public.pms_robo_gravar_hospedes(p_segredo text, p_hotel text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nh int := 0; nr int := 0; nd int := 0; ne int := 0;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.pms_hoteis where id = p_hotel) then raise exception 'hotel desconhecido'; end if;

  insert into public.pms_hospedes (hotel_id, guest_id, person_id, nome, email, telefone, celular, nascimento, sexo, documento_tipo_id, documento,
    rua, numero, complemento, bairro, cep, cidade, estado, uf, pais, motivo_viagem, tipo_hospede, atualizado_em)
  select distinct on ((x->>'guest_id')::bigint) p_hotel, (x->>'guest_id')::bigint, x->>'person_id', x->>'nome', x->>'email', x->>'telefone', x->>'celular',
         nullif(x->>'nascimento', '')::date, x->>'sexo', nullif(x->>'documento_tipo_id', '')::int, x->>'documento',
         x->>'rua', x->>'numero', x->>'complemento', x->>'bairro', x->>'cep', x->>'cidade', x->>'estado', x->>'uf', x->>'pais',
         x->>'motivo_viagem', x->>'tipo_hospede', now()
  from jsonb_array_elements(coalesce(p_dados->'hospedes', '[]')) x where x->>'guest_id' is not null
  order by (x->>'guest_id')::bigint
  on conflict (hotel_id, guest_id) do update set person_id = coalesce(excluded.person_id, pms_hospedes.person_id),
    nome = coalesce(excluded.nome, pms_hospedes.nome), email = coalesce(excluded.email, pms_hospedes.email),
    telefone = coalesce(excluded.telefone, pms_hospedes.telefone), celular = coalesce(excluded.celular, pms_hospedes.celular),
    nascimento = coalesce(excluded.nascimento, pms_hospedes.nascimento), sexo = coalesce(excluded.sexo, pms_hospedes.sexo),
    documento_tipo_id = coalesce(excluded.documento_tipo_id, pms_hospedes.documento_tipo_id), documento = coalesce(excluded.documento, pms_hospedes.documento),
    rua = coalesce(excluded.rua, pms_hospedes.rua), numero = coalesce(excluded.numero, pms_hospedes.numero),
    complemento = coalesce(excluded.complemento, pms_hospedes.complemento), bairro = coalesce(excluded.bairro, pms_hospedes.bairro),
    cep = coalesce(excluded.cep, pms_hospedes.cep), cidade = coalesce(excluded.cidade, pms_hospedes.cidade),
    estado = coalesce(excluded.estado, pms_hospedes.estado), uf = coalesce(excluded.uf, pms_hospedes.uf), pais = coalesce(excluded.pais, pms_hospedes.pais),
    motivo_viagem = coalesce(excluded.motivo_viagem, pms_hospedes.motivo_viagem), tipo_hospede = coalesce(excluded.tipo_hospede, pms_hospedes.tipo_hospede),
    atualizado_em = now();
  get diagnostics nh = row_count;

  insert into public.pms_reserva_hospedes (hotel_id, guest_item_id, item_id, guest_id, nome, principal, crianca, idade_crianca, vip, status, atualizado_em)
  select distinct on ((x->>'guest_item_id')::bigint) p_hotel, (x->>'guest_item_id')::bigint, (x->>'item_id')::bigint, nullif(x->>'guest_id', '')::bigint, x->>'nome',
         coalesce((x->>'principal')::boolean, false), coalesce((x->>'crianca')::boolean, false), nullif(x->>'idade_crianca', '')::int,
         coalesce((x->>'vip')::boolean, false), x->>'status', now()
  from jsonb_array_elements(coalesce(p_dados->'reserva_hospedes', '[]')) x where x->>'guest_item_id' is not null and x->>'item_id' is not null
  order by (x->>'guest_item_id')::bigint
  on conflict (hotel_id, guest_item_id) do update set item_id = excluded.item_id, guest_id = coalesce(excluded.guest_id, pms_reserva_hospedes.guest_id),
    nome = excluded.nome, principal = excluded.principal, crianca = excluded.crianca, idade_crianca = excluded.idade_crianca,
    vip = excluded.vip, status = excluded.status, atualizado_em = now();
  get diagnostics nr = row_count;

  insert into public.pms_reserva_detalhes (hotel_id, item_id, reserva_codigo, codigo, guest_id, criada_por, criada_em, alterada_por, alterada_em,
    total, total_arr, segmento, origem, tarifa, grupo, tipo_hospede, adultos, criancas, obs_internas, obs_externas, obs_item_internas,
    obs_item_externas, numero_externo, detalhes_em, historico_em)
  select distinct on ((x->>'item_id')::bigint) p_hotel, (x->>'item_id')::bigint, x->>'reserva_codigo', x->>'codigo', nullif(x->>'guest_id', '')::bigint,
         x->>'criada_por', nullif(x->>'criada_em', '')::timestamptz, x->>'alterada_por', nullif(x->>'alterada_em', '')::timestamptz,
         nullif(x->>'total', '')::numeric, nullif(x->>'total_arr', '')::numeric, x->>'segmento', x->>'origem', x->>'tarifa', x->>'grupo',
         x->>'tipo_hospede', nullif(x->>'adultos', '')::int, nullif(x->>'criancas', '')::int,
         x->>'obs_internas', x->>'obs_externas', x->>'obs_item_internas', x->>'obs_item_externas', x->>'numero_externo', now(),
         case when coalesce((x->>'com_historico')::boolean, false) then now() end
  from jsonb_array_elements(coalesce(p_dados->'detalhes', '[]')) x where x->>'item_id' is not null
  order by (x->>'item_id')::bigint
  on conflict (hotel_id, item_id) do update set reserva_codigo = excluded.reserva_codigo, codigo = excluded.codigo,
    guest_id = coalesce(excluded.guest_id, pms_reserva_detalhes.guest_id), criada_por = excluded.criada_por, criada_em = excluded.criada_em,
    alterada_por = excluded.alterada_por, alterada_em = excluded.alterada_em, total = excluded.total, total_arr = excluded.total_arr,
    segmento = excluded.segmento, origem = excluded.origem, tarifa = excluded.tarifa, grupo = excluded.grupo, tipo_hospede = excluded.tipo_hospede,
    adultos = excluded.adultos, criancas = excluded.criancas, obs_internas = excluded.obs_internas, obs_externas = excluded.obs_externas,
    obs_item_internas = excluded.obs_item_internas, obs_item_externas = excluded.obs_item_externas, numero_externo = excluded.numero_externo,
    detalhes_em = now(), historico_em = coalesce(excluded.historico_em, pms_reserva_detalhes.historico_em);
  get diagnostics nd = row_count;

  insert into public.pms_reserva_historico (hotel_id, evento_id, item_id, quando, usuario, tipo, acao, campos)
  select distinct on (x->>'evento_id') p_hotel, x->>'evento_id', (x->>'item_id')::bigint, nullif(x->>'quando', '')::timestamptz, x->>'usuario', x->>'tipo', x->>'acao',
         coalesce(x->'campos', '[]')
  from jsonb_array_elements(coalesce(p_dados->'historico', '[]')) x where x->>'evento_id' is not null and x->>'item_id' is not null
  order by x->>'evento_id'
  on conflict (hotel_id, evento_id) do update set item_id = excluded.item_id, quando = excluded.quando, usuario = excluded.usuario,
    tipo = excluded.tipo, acao = excluded.acao, campos = excluded.campos;
  get diagnostics ne = row_count;

  return jsonb_build_object('hospedes', nh, 'reserva_hospedes', nr, 'detalhes', nd, 'historico', ne);
end $$;
revoke execute on function public.pms_robo_gravar_hospedes(text, text, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar_hospedes(text, text, jsonb) to anon;

-- Lista de hóspedes para a aba Hóspedes: cada hóspede com as estadias (pela ligação reserva ↔ hóspede)
create or replace view public.pms_hospedes_resumo with (security_invoker = true) as
select h.hotel_id, h.guest_id, h.nome, h.email, coalesce(h.celular, h.telefone) as contato, h.documento, h.documento_tipo_id,
       h.nascimento, h.cidade, h.uf, h.pais,
       count(distinct rh.item_id) filter (where e.status_id not in (5, 6)) as estadias,
       sum(e.noites) filter (where e.status_id in (2, 3) and rh.principal) as noites,
       max(e.checkin) filter (where e.status_id not in (5, 6)) as ultima_chegada,
       min(e.checkin) filter (where e.status_id not in (5, 6)) as primeira_chegada,
       sum(d.total) filter (where e.status_id in (2, 3) and rh.principal) as total_gasto,
       bool_or(rh.vip) as vip,
       bool_or(e.status_id = 2) as hospedado_agora,
       bool_or(e.status_id in (1, 4) and e.checkin >= (now() at time zone 'America/Fortaleza')::date) as tem_futura
from public.pms_hospedes h
left join public.pms_reserva_hospedes rh on rh.hotel_id = h.hotel_id and rh.guest_id = h.guest_id
left join public.pms_estadias e on e.hotel_id = rh.hotel_id and e.item_id = rh.item_id
left join public.pms_reserva_detalhes d on d.hotel_id = rh.hotel_id and d.item_id = rh.item_id
group by h.hotel_id, h.guest_id;
grant select on public.pms_hospedes_resumo to authenticated;
