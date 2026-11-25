-- Banco mais leve no disco (25/11/2026).
-- O banco (plano Micro do Supabase) travava todo dia das 4h às ~8h27 de Fortaleza: o disco ficava
-- estrangulado (cota diária de leitura/gravação esgotada) e as rotinas de cada minuto se acumulavam;
-- o site e o link público dos menus caíam junto. Os maiores gastos de disco eram:
--   1. integracoes_agendas_atualizar (a cada 5 min): ordenava 35 dias de cron.job_run_details
--      (228 mil linhas) com work_mem de 2 MB = ~11 GB lidos e ~3 GB de arquivos temporários em 2 dias;
--   2. refresh de totvs_produtos_vendas e nfce_produtos_mes: ordenação no disco (~7 GB temporários).
-- Mudanças: o painel lê só as ~15 mil rodadas mais recentes pelo índice (runid cresce com o tempo) e
-- guarda a última rodada das rotinas raras do cache anterior; os refresh rodam com memória suficiente
-- para ordenar sem disco e menos vezes.

create or replace function public.integracoes_agendas_atualizar()
returns void
language plpgsql
security definer
set search_path to 'public', 'cron'
as $function$
declare
  v_max bigint;
  v_antes jsonb;
begin
  set local work_mem = '32MB';
  select max(runid) into v_max from cron.job_run_details;
  select dados into v_antes from public.integracoes_agendas_cache where id = 1;

  insert into public.integracoes_agendas_cache (id, dados, montado_em)
  select 1, (
    with recentes as (
      -- ~10 mil rodadas por dia: 15 mil cobrem as últimas 24 h com folga, sem varrer o histórico
      select jobid, start_time, status, return_message
      from cron.job_run_details where runid > coalesce(v_max, 0) - 15000
    ),
    ultima as (
      select distinct on (jobid) jobid, start_time, status, return_message
      from recentes order by jobid, start_time desc nulls last
    ),
    conta as (
      select jobid, count(*) n, count(*) filter (where status = 'failed') f
      from recentes where start_time > now() - interval '24 hours' group by jobid
    ),
    anterior as (
      select e->>'nome' nome, e from jsonb_array_elements(coalesce(v_antes, '[]'::jsonb)) e
    )
    select coalesce(jsonb_agg(jsonb_build_object('nome', j.jobname, 'horario', j.schedule, 'ativa', j.active,
        'ultima', coalesce(to_jsonb(u.start_time), a.e->'ultima'),
        'ultima_status', coalesce(to_jsonb(u.status), a.e->'ultima_status'),
        'ultima_msg', coalesce(to_jsonb(left(u.return_message, 200)), case when u.jobid is null then a.e->'ultima_msg' end),
        'rodadas_24h', coalesce(c.n, 0), 'falhas_24h', coalesce(c.f, 0)) order by j.jobname), '[]'::jsonb)
    from cron.job j
    left join ultima u on u.jobid = j.jobid
    left join conta c on c.jobid = j.jobid
    left join anterior a on a.nome = j.jobname
  ), now()
  on conflict (id) do update set dados = excluded.dados, montado_em = excluded.montado_em;
end $function$;

-- Refresh das visões materializadas com memória para ordenar sem disco, e menos vezes
-- (antes: totvs_produtos_vendas a cada hora; nfce_produtos_mes 2 vezes por hora).
select cron.alter_job((select jobid from cron.job where jobname = 'totvs-produtos-vendas'),
  schedule := '15 */3 * * *',
  command := $$set work_mem = '64MB'; refresh materialized view concurrently public.totvs_produtos_vendas$$);
select cron.alter_job((select jobid from cron.job where jobname = 'nfce-produtos-mes'),
  schedule := '37 * * * *',
  command := $$set work_mem = '64MB'; refresh materialized view concurrently public.nfce_produtos_mes$$);

-- totvs_ao_vivo (a cada minuto), totvs_destravar e nfce_historico_passo procuravam as execuções "na fila /
-- rodando" e as 3 últimas do ao vivo varrendo totvs_execucoes inteira (38 mil linhas, ~0,4 s e ~15 mil
-- páginas por minuto). Índices pequenos para as duas buscas:
create index if not exists totvs_execucoes_andamento on public.totvs_execucoes (unidade_id, created_at)
  where status in ('na_fila', 'rodando');
create index if not exists totvs_execucoes_origem on public.totvs_execucoes (unidade_id, origem, created_at desc);

-- totvs-historico rodava a cada 30 s (2.777 vezes por dia) sem fazer nada: todas as lojas estão com
-- totvs_historico.parado desde 22/10 e 20/11/2026 (e a TOTVS só entrega os últimos ~16 dias). Desligada;
-- para religar: select cron.alter_job((select jobid from cron.job where jobname = 'totvs-historico'), active := true);
select cron.alter_job((select jobid from cron.job where jobname = 'totvs-historico'), active := false);

-- rhid_destravar (a cada 15 min, ~8 s) percorria o índice de data inteiro de rhid_execucoes (25 mil linhas).
create index if not exists rhid_execucoes_andamento on public.rhid_execucoes (created_at) where status in ('na_fila', 'rodando');

-- pms_corrigir_ocupacao (a cada 15 min, ~21 s) recalculava a ocupação de todos os dias desde o começo dos
-- hotéis. Cada dia é calculado sozinho (as contas são por hotel e dia), então dá para recalcular só um
-- trecho: a rodada de 15 min faz dos últimos 60 dias em diante e uma rodada por dia (3h20 de Fortaleza)
-- faz tudo, para pegar meses antigos relidos do PMS.
create or replace function public.pms_corrigir_ocupacao_desde(p_desde date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  set local work_mem = '32MB';
  with
  cats as (select distinct hotel_id, categoria from pms_kpi_dia),
  noites as (
    select e.hotel_id,
      coalesce((select c.categoria from cats c where c.hotel_id = e.hotel_id and c.categoria = e.tipo),
               case e.tipo when 'Superior' then 'Bangalô Deluxe Superior' when 'Térreo' then 'Bangalô Deluxe Terreo'
                           when 'VM' then 'Bangalô Deluxe Vista Mar' when 'Apartment' then 'Pool Apartment' end) as categoria,
      g::date as dia
    from pms_estadias_canal e
    cross join lateral generate_series(e.checkin, greatest(e.checkout - 1, e.checkin), interval '1 day') g
    where e.status_id not in (5, 6) and e.checkin is not null and e.checkout is not null
      and (p_desde is null or e.checkout >= p_desde or e.checkin >= p_desde)),
  w as (select hotel_id, dia, categoria, count(*) as n from noites where categoria is not null
        and (p_desde is null or dia >= p_desde) group by 1, 2, 3),
  base as (
    select k.hotel_id, k.dia, k.categoria, k.ocupadas as kpi, coalesce(w.n, 0) as res,
           sum(coalesce(w.n, 0)) over (partition by k.hotel_id, k.dia) as res_dia,
           sum(k.ocupadas) over (partition by k.hotel_id, k.dia) as kpi_dia,
           o.ocupadas as oficial
    from pms_kpi_dia k
    left join w on w.hotel_id = k.hotel_id and w.dia = k.dia and w.categoria = k.categoria
    left join pms_ocupacao_oficial o on o.hotel_id = k.hotel_id and o.dia = k.dia
    where p_desde is null or k.dia >= p_desde),
  pesos as (
    select *, case when res_dia > 0 then res::numeric / res_dia
                   when kpi_dia > 0 then kpi::numeric / kpi_dia
                   else 0 end as peso
    from base),
  q as (
    select *, coalesce(oficial, res_dia)::numeric * peso as alvo from pesos),
  r as (
    select *, floor(alvo)::int as piso,
           coalesce(oficial, res_dia) - sum(floor(alvo)::int) over (partition by hotel_id, dia) as sobra,
           row_number() over (partition by hotel_id, dia order by alvo - floor(alvo) desc, peso desc, categoria) as ordem
    from q),
  f as (
    select hotel_id, dia, categoria,
           case when oficial is null and res_dia = 0 then null
                else piso + case when peso > 0 and ordem <= sobra then 1 else 0 end end as valor,
           case when oficial is not null then 'oficial' when res_dia > 0 then 'reservas' end as fonte
    from r)
  update pms_kpi_dia k
     set ocupadas_noite = f.valor, ocupadas_fonte = f.fonte
    from f
   where k.hotel_id = f.hotel_id and k.dia = f.dia and k.categoria = f.categoria
     and (k.ocupadas_noite is distinct from f.valor or k.ocupadas_fonte is distinct from f.fonte);
  get diagnostics n = row_count;
  return n;
end $function$;

-- a função antiga (sem parâmetro) continua existindo e faz tudo
create or replace function public.pms_corrigir_ocupacao()
returns integer
language sql
security definer
set search_path to 'public'
as $function$ select public.pms_corrigir_ocupacao_desde(null) $function$;

select cron.alter_job((select jobid from cron.job where jobname = 'pms-ocupacao-oficial'),
  command := $$select public.pms_corrigir_ocupacao_desde(((now() at time zone 'America/Fortaleza')::date - 60))$$);
select cron.schedule('pms-ocupacao-oficial-completa', '20 6 * * *', $$select public.pms_corrigir_ocupacao()$$);

-- compras_auto_buscar (análise das compras) ordenava no disco (~1,7 GB temporários em 2 dias).
alter function public.compras_auto_buscar(text, text) set work_mem = '32MB';
