-- =====================================================================
-- PMS dos hotéis: robô com navegador na VPS (08/11/2026).
-- A cada hora o robô (robos/pms-navegador, Docker na VPS da Hostinger) abre um
-- Chromium novo, entra no PMS com o usuário do Vault, escolhe cada hotel e lê o
-- painel e a disponibilidade. Ele não guarda senha: pede ao banco a cada rodada
-- (pms_robo_credenciais) com o segredo pms_robo_segredo, e grava por pms_robo_gravar.
-- Autorizado pelo dono e pela TOTVS (08/11/2026).
-- =====================================================================

-- Leituras de hora em hora (o painel do dia continua em pms_dias, a última leitura do dia)
create table if not exists public.pms_horas (
  hotel_id text not null references public.pms_hoteis(id),
  lido_em timestamptz not null,
  ocupacao numeric(6,2),
  ocupacao_prevista numeric(6,2),
  ocupadas int,
  livres int,
  bloqueadas int,
  checkins int,
  checkouts int,
  checkins_previstos int,
  checkouts_previstos int,
  execucao_id uuid references public.pms_execucoes(id),
  primary key (hotel_id, lido_em)
);
create index if not exists pms_horas_idx on public.pms_horas (lido_em desc);

do $$
begin
  execute 'drop trigger if exists pms_horas_sem_exclusao on public.pms_horas';
  execute 'create trigger pms_horas_sem_exclusao before delete on public.pms_horas for each row execute function public.bloquear_exclusao()';
  execute 'drop trigger if exists pms_horas_sem_truncate on public.pms_horas';
  execute 'create trigger pms_horas_sem_truncate before truncate on public.pms_horas for each statement execute function public.bloquear_exclusao()';
end $$;
alter table public.pms_horas enable row level security;
drop policy if exists "socios veem" on public.pms_horas;
create policy "socios veem" on public.pms_horas for select using (public.notas_pode_ver(auth.uid()));
grant select on public.pms_horas to authenticated;

-- Execuções do robô
alter table public.pms_execucoes drop constraint if exists pms_execucoes_origem_check;
alter table public.pms_execucoes add constraint pms_execucoes_origem_check check (origem in ('agenda', 'site', 'claude', 'robo'));

-- Segredo do robô (gerado ao acaso; vai só no .env da VPS)
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'pms_robo_segredo')
where not exists (select 1 from vault.secrets where name = 'pms_robo_segredo');

create or replace function public.pms_robo_ok(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'pms_robo_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.pms_robo_ok(text) from public, anon, authenticated;

-- Usuário e senha do PMS para o robô (a cada rodada; nada fica salvo na VPS)
create or replace function public.pms_robo_credenciais(p_segredo text)
returns table (usuario text, senha text, hoteis jsonb)
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select
    (select decrypted_secret from vault.decrypted_secrets where name = 'pms_usuario'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'pms_senha'),
    (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'cnpj', h.cnpj, 'propriedade', h.property_id) order by h.ordem), '[]')
       from public.pms_hoteis h where h.ativa);
end $$;
revoke execute on function public.pms_robo_credenciais(text) from public, authenticated;
grant execute on function public.pms_robo_credenciais(text) to anon;

-- Grava uma rodada do robô. p_leitura:
-- {inicio, fim, erro, hoteis:[{hotel, ok, erro, nome_no_pms, propriedade, painel:{...}, disponibilidade:{uhs, dias:[...]}}]}
create or replace function public.pms_robo_gravar(p_segredo text, p_leitura jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ex uuid; h jsonb; p jsonb; d jsonb; v_ok int := 0; v_total int := 0;
  v_agora timestamptz := now();
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  n numeric;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;

  insert into public.pms_execucoes (origem, status, inicio, fim, erro, resultado)
  values ('robo', 'rodando', coalesce((p_leitura->>'inicio')::timestamptz, v_agora), coalesce((p_leitura->>'fim')::timestamptz, v_agora),
          left(coalesce(p_leitura->>'erro', ''), 500),
          jsonb_build_object('hoteis', (select coalesce(jsonb_agg(x - 'disponibilidade'), '[]') from jsonb_array_elements(coalesce(p_leitura->'hoteis', '[]')) x)))
  returning id into v_ex;

  for h in select * from jsonb_array_elements(coalesce(p_leitura->'hoteis', '[]')) loop
    v_total := v_total + 1;
    continue when coalesce((h->>'ok')::boolean, false) is false
      or not exists (select 1 from public.pms_hoteis where id = h->>'hotel');
    v_ok := v_ok + 1;
    p := coalesce(h->'painel', '{}');

    insert into public.pms_horas (hotel_id, lido_em, ocupacao, ocupacao_prevista, ocupadas, livres, bloqueadas,
      checkins, checkouts, checkins_previstos, checkouts_previstos, execucao_id)
    values (h->>'hotel', v_agora, (p->>'ocupacao')::numeric, (p->>'ocupacao_prevista')::numeric, (p->>'ocupadas')::int,
      (p->>'livres')::int, (p->>'bloqueadas')::int, (p->>'checkins')::int, (p->>'checkouts')::int,
      (p->>'checkins_previstos')::int, (p->>'checkouts_previstos')::int, v_ex)
    on conflict (hotel_id, lido_em) do nothing;

    insert into public.pms_dias (hotel_id, dia, uhs, ocupadas, livres, bloqueadas, ocupacao, ocupacao_prevista,
      checkins, checkouts, checkins_previstos, checkouts_previstos, walk_in, day_use, painel, lido_em, execucao_id)
    values (h->>'hotel', v_hoje, (h->'disponibilidade'->>'uhs')::int, (p->>'ocupadas')::int, (p->>'livres')::int,
      (p->>'bloqueadas')::int, (p->>'ocupacao')::numeric, (p->>'ocupacao_prevista')::numeric, (p->>'checkins')::int,
      (p->>'checkouts')::int, (p->>'checkins_previstos')::int, (p->>'checkouts_previstos')::int, (p->>'walk_in')::int,
      (p->>'day_use')::int, p, v_agora, v_ex)
    on conflict (hotel_id, dia) do update set uhs = coalesce(excluded.uhs, pms_dias.uhs), ocupadas = excluded.ocupadas,
      livres = excluded.livres, bloqueadas = excluded.bloqueadas, ocupacao = excluded.ocupacao,
      ocupacao_prevista = excluded.ocupacao_prevista, checkins = excluded.checkins, checkouts = excluded.checkouts,
      checkins_previstos = excluded.checkins_previstos, checkouts_previstos = excluded.checkouts_previstos,
      walk_in = excluded.walk_in, day_use = excluded.day_use, painel = excluded.painel, lido_em = excluded.lido_em,
      execucao_id = excluded.execucao_id;

    for d in select * from jsonb_array_elements(coalesce(h->'disponibilidade'->'dias', '[]')) loop
      continue when (d->>'dia') is null or (d->>'dia')::date < v_hoje;
      insert into public.pms_previsao (hotel_id, dia, lido_dia, uhs, ocupadas, disponiveis, bloqueadas, ocupacao,
        individuais, grupo, confirmadas, a_confirmar, tentativas, por_tipo, lido_em, execucao_id)
      values (h->>'hotel', (d->>'dia')::date, v_hoje, (h->'disponibilidade'->>'uhs')::int, (d->>'ocupadas')::int,
        (d->>'disponiveis')::int, (d->>'bloqueadas')::int, (d->>'ocupacao')::numeric, (d->>'individuais')::int,
        (d->>'grupo')::int, (d->>'confirmadas')::int, (d->>'a_confirmar')::int, (d->>'tentativas')::int,
        coalesce(d->'por_tipo', '[]'), v_agora, v_ex)
      on conflict (hotel_id, dia, lido_dia) do update set uhs = excluded.uhs, ocupadas = excluded.ocupadas,
        disponiveis = excluded.disponiveis, bloqueadas = excluded.bloqueadas, ocupacao = excluded.ocupacao,
        individuais = excluded.individuais, grupo = excluded.grupo, confirmadas = excluded.confirmadas,
        a_confirmar = excluded.a_confirmar, tentativas = excluded.tentativas, por_tipo = excluded.por_tipo,
        lido_em = excluded.lido_em, execucao_id = excluded.execucao_id;
    end loop;
  end loop;

  update public.pms_execucoes set status = case when v_total > 0 and v_ok = v_total then 'ok' when v_ok > 0 then 'parcial' else 'falha' end
  where id = v_ex;
  return jsonb_build_object('execucao', v_ex, 'hoteis_ok', v_ok, 'hoteis', v_total);
end $$;
revoke execute on function public.pms_robo_gravar(text, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar(text, jsonb) to anon;
