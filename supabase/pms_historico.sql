-- =====================================================================
-- PMS dos hotéis: histórico completo para o relatório gerencial (08/11/2026).
-- O robô da VPS (robos/pms-navegador/robo.mjs) lê três relatórios do PMS (Metabase da TOTVS),
-- mês a mês, desde o início de cada hotel até 12 meses à frente, e grava aqui por pms_robo_gravar_mes:
--   7408 "Disponibilidade e KPIs por Categoria e Dia" -> pms_kpi_dia (dia x tipo de UH)
--    364 "Produção por Channel"                         -> pms_reservas (uma linha por reserva, SEM nome do hóspede)
--      9 "Resumo Financeiro (Sintético)"               -> pms_recebimentos (dia x forma de pagamento)
-- Cada mês lido fica em pms_hist_meses. Reler um mês atualiza as linhas (upsert); nada se apaga.
-- Quem vê: os sócios (notas_pode_ver).
-- =====================================================================

create table if not exists public.pms_kpi_dia (
  hotel_id text not null references public.pms_hoteis(id),
  dia date not null,
  categoria text not null,
  disponiveis int,          -- UHs disponíveis (a)
  bloqueadas int,           -- UHs bloqueadas (b)
  total int,                -- a + b
  ocupadas int,             -- UHs ocupadas (room nights do dia)
  receita numeric(14,2),    -- receita de hospedagem do dia (pode ser negativa por estorno)
  lido_em timestamptz not null default now(),
  primary key (hotel_id, dia, categoria)
);
create index if not exists pms_kpi_dia_idx on public.pms_kpi_dia (hotel_id, dia);

create table if not exists public.pms_reservas (
  hotel_id text not null references public.pms_hoteis(id),
  reserva text not null,
  canal text,
  localizador_canal text,
  criada_em timestamptz,        -- data de integração/criação no PMS
  empresa text,                 -- agência, OTA ou empresa (nunca o hóspede)
  tarifa text,
  uh text,
  checkin date,
  checkout date,
  noites int generated always as (case when checkin is not null and checkout is not null then checkout - checkin end) stored,
  valor_diarias numeric(14,2),
  status text,
  cancelada_em timestamptz,
  mes_ref date not null,        -- mês do relatório de onde veio (para refazer o mês)
  lido_em timestamptz not null default now(),
  primary key (hotel_id, reserva)
);
create index if not exists pms_reservas_checkin_idx on public.pms_reservas (hotel_id, checkin);
create index if not exists pms_reservas_mes_idx on public.pms_reservas (hotel_id, mes_ref);

create table if not exists public.pms_recebimentos (
  hotel_id text not null references public.pms_hoteis(id),
  dia date not null,
  grupo text not null,          -- forma de pagamento (cartão de crédito, débito, PIX, depósito...)
  tipo text not null,           -- recebimento, devolução...
  valor numeric(14,2),
  lido_em timestamptz not null default now(),
  primary key (hotel_id, dia, grupo, tipo)
);

create table if not exists public.pms_hist_meses (
  hotel_id text not null references public.pms_hoteis(id),
  relatorio text not null check (relatorio in ('kpi', 'reservas', 'recebimentos')),
  mes date not null,
  linhas int not null default 0,
  lido_em timestamptz not null default now(),
  primary key (hotel_id, relatorio, mes)
);

do $$
declare t text;
begin
  foreach t in array array['pms_kpi_dia', 'pms_reservas', 'pms_recebimentos', 'pms_hist_meses'] loop
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

-- Meses que o robô ainda precisa ler (ou reler). p_hotel/p_relatorio: o que pedir.
-- Regra: meses do passado já lidos depois do fim do mês + 7 dias ficam; o mês atual, o anterior e os futuros são relidos.
create or replace function public.pms_robo_meses_lidos(p_segredo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('hotel', hotel_id, 'relatorio', relatorio, 'mes', mes, 'linhas', linhas, 'lido_em', lido_em))
                   from public.pms_hist_meses), '[]');
end $$;
revoke execute on function public.pms_robo_meses_lidos(text) from public, authenticated;
grant execute on function public.pms_robo_meses_lidos(text) to anon;

-- Grava um mês de um relatório (atualiza linha a linha, sem apagar). p_linhas já vem normalizado pelo robô.
create or replace function public.pms_robo_gravar_mes(p_segredo text, p_hotel text, p_relatorio text, p_mes date, p_linhas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date; n int := 0;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.pms_hoteis where id = p_hotel) then raise exception 'hotel desconhecido'; end if;

  if p_relatorio = 'kpi' then
    insert into public.pms_kpi_dia (hotel_id, dia, categoria, disponiveis, bloqueadas, total, ocupadas, receita)
    select p_hotel, (x->>'dia')::date, coalesce(nullif(x->>'categoria', ''), '(sem categoria)'), (x->>'disponiveis')::int, (x->>'bloqueadas')::int,
           (x->>'total')::int, (x->>'ocupadas')::int, (x->>'receita')::numeric
    from jsonb_array_elements(p_linhas) x
    where (x->>'dia')::date >= v_ini and (x->>'dia')::date < v_fim
    on conflict (hotel_id, dia, categoria) do update set disponiveis = excluded.disponiveis, bloqueadas = excluded.bloqueadas,
      total = excluded.total, ocupadas = excluded.ocupadas, receita = excluded.receita, lido_em = now();
    get diagnostics n = row_count;

  elsif p_relatorio = 'reservas' then
    insert into public.pms_reservas (hotel_id, reserva, canal, localizador_canal, criada_em, empresa, tarifa, uh, checkin, checkout,
      valor_diarias, status, cancelada_em, mes_ref)
    select distinct on (x->>'reserva') p_hotel, x->>'reserva', x->>'canal', x->>'localizador_canal', (x->>'criada_em')::timestamptz, x->>'empresa',
           x->>'tarifa', x->>'uh', (x->>'checkin')::date, (x->>'checkout')::date, (x->>'valor_diarias')::numeric, x->>'status',
           (x->>'cancelada_em')::timestamptz, v_ini
    from jsonb_array_elements(p_linhas) x
    where coalesce(x->>'reserva', '') <> ''
    on conflict (hotel_id, reserva) do update set canal = excluded.canal, localizador_canal = excluded.localizador_canal,
      criada_em = excluded.criada_em, empresa = excluded.empresa, tarifa = excluded.tarifa, uh = excluded.uh,
      checkin = excluded.checkin, checkout = excluded.checkout, valor_diarias = excluded.valor_diarias, status = excluded.status,
      cancelada_em = excluded.cancelada_em, mes_ref = excluded.mes_ref, lido_em = now();
    get diagnostics n = row_count;

  elsif p_relatorio = 'recebimentos' then
    insert into public.pms_recebimentos (hotel_id, dia, grupo, tipo, valor)
    select p_hotel, (x->>'dia')::date, coalesce(nullif(x->>'grupo', ''), '(sem grupo)'), coalesce(nullif(x->>'tipo', ''), '(sem tipo)'),
           sum((x->>'valor')::numeric)
    from jsonb_array_elements(p_linhas) x
    where (x->>'dia')::date >= v_ini and (x->>'dia')::date < v_fim
    group by 1, 2, 3, 4
    on conflict (hotel_id, dia, grupo, tipo) do update set valor = excluded.valor, lido_em = now();
    get diagnostics n = row_count;
  else
    raise exception 'relatório desconhecido: %', p_relatorio;
  end if;

  insert into public.pms_hist_meses (hotel_id, relatorio, mes, linhas, lido_em) values (p_hotel, p_relatorio, v_ini, n, now())
  on conflict (hotel_id, relatorio, mes) do update set linhas = excluded.linhas, lido_em = now();
  return n;
end $$;
revoke execute on function public.pms_robo_gravar_mes(text, text, text, date, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar_mes(text, text, text, date, jsonb) to anon;

-- ---------------------------------------------------------------------
-- Visões do relatório gerencial (as contas ficam aqui, iguais para o site e o conector)
-- ---------------------------------------------------------------------
-- Dia do hotel (somando os tipos de UH)
create or replace view public.pms_dia_hotel with (security_invoker = true) as
select hotel_id, dia,
       sum(disponiveis) disponiveis, sum(bloqueadas) bloqueadas, sum(total) total, sum(ocupadas) ocupadas, sum(receita) receita,
       round(100.0 * sum(ocupadas) / nullif(sum(total), 0), 2) ocupacao,                       -- sobre o total de UHs
       round(100.0 * sum(ocupadas) / nullif(sum(disponiveis), 0), 2) ocupacao_disponiveis,     -- sobre as UHs vendáveis
       round(sum(receita) / nullif(sum(ocupadas), 0), 2) diaria_media,
       round(sum(receita) / nullif(sum(disponiveis), 0), 2) revpar
from public.pms_kpi_dia group by hotel_id, dia;

-- Mês do hotel
create or replace view public.pms_mes_hotel with (security_invoker = true) as
select hotel_id, date_trunc('month', dia)::date mes, count(*) dias,
       sum(disponiveis) uh_disponiveis, sum(total) uh_total, sum(ocupadas) diarias_vendidas, sum(receita) receita,
       round(100.0 * sum(ocupadas) / nullif(sum(total), 0), 2) ocupacao,
       round(sum(receita) / nullif(sum(ocupadas), 0), 2) diaria_media,
       round(sum(receita) / nullif(sum(disponiveis), 0), 2) revpar
from public.pms_dia_hotel group by hotel_id, date_trunc('month', dia);

grant select on public.pms_dia_hotel, public.pms_mes_hotel to authenticated;

-- Até onde o histórico já foi buscado: o robô marca quando passa do começo do hotel (6 meses seguidos sem movimento)
alter table public.pms_hoteis add column if not exists historico_completo jsonb not null default '{}';

create or replace function public.pms_robo_historico_completo(p_segredo text, p_hotel text, p_relatorio text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.pms_hoteis set historico_completo = historico_completo || jsonb_build_object(p_relatorio, now()) where id = p_hotel;
end $$;
revoke execute on function public.pms_robo_historico_completo(text, text, text) from public, authenticated;
grant execute on function public.pms_robo_historico_completo(text, text, text) to anon;

-- As credenciais passam a levar também até onde o histórico foi buscado
create or replace function public.pms_robo_credenciais(p_segredo text)
returns table (usuario text, senha text, hoteis jsonb)
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select
    (select decrypted_secret from vault.decrypted_secrets where name = 'pms_usuario'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'pms_senha'),
    (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'cnpj', h.cnpj, 'propriedade', h.property_id,
              'historico_completo', h.historico_completo) order by h.ordem), '[]')
       from public.pms_hoteis h where h.ativa);
end $$;
revoke execute on function public.pms_robo_credenciais(text) from public, authenticated;
grant execute on function public.pms_robo_credenciais(text) to anon;

-- As visões contam só os dias que já passaram (o relatório do PMS traz o futuro zerado; sem isso o mês atual
-- aparecia com a ocupação dividida pelos 30 dias)
create or replace view public.pms_dia_hotel with (security_invoker = true) as
select hotel_id, dia,
       sum(disponiveis) disponiveis, sum(bloqueadas) bloqueadas, sum(total) total, sum(ocupadas) ocupadas, sum(receita) receita,
       round(100.0 * sum(ocupadas) / nullif(sum(total), 0), 2) ocupacao,
       round(100.0 * sum(ocupadas) / nullif(sum(disponiveis), 0), 2) ocupacao_disponiveis,
       round(sum(receita) / nullif(sum(ocupadas), 0), 2) diaria_media,
       round(sum(receita) / nullif(sum(disponiveis), 0), 2) revpar
from public.pms_kpi_dia
where dia < (now() at time zone 'America/Fortaleza')::date
group by hotel_id, dia;
