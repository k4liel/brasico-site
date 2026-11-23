-- Painel de integrações: resumo das agendas guardado (23/11/2026)
-- O histórico do pg_cron (cron.job_run_details) passou de 210 mil linhas (69 MB, sem índice por data, e a tabela é da
-- Supabase: não aceita índice nosso). integracoes_painel() lia tudo duas vezes a cada 30 s em cada aba aberta e foi
-- de ~0,4 s para ~2 s. Agora o resumo das agendas é montado a cada 5 min por integracoes_agendas_atualizar()
-- (pg_cron 'integracoes-agendas') e o painel só lê a linha guardada (campo agendas_em = quando foi montado).

create table if not exists public.integracoes_agendas_cache (
  id int primary key default 1 check (id = 1),
  dados jsonb not null default '[]'::jsonb,
  montado_em timestamptz not null default now()
);
alter table public.integracoes_agendas_cache enable row level security; -- só as funções (security definer) leem
drop trigger if exists acesso_guarda on public.integracoes_agendas_cache;
create trigger acesso_guarda before insert or update or delete on public.integracoes_agendas_cache
  for each row execute function public.acesso_guarda('integracoes');

create or replace function public.integracoes_agendas_atualizar()
returns void
language plpgsql
security definer
set search_path to 'public', 'cron'
as $$
begin
  insert into public.integracoes_agendas_cache (id, dados, montado_em)
  select 1, (select coalesce(jsonb_agg(jsonb_build_object('nome', j.jobname, 'horario', j.schedule, 'ativa', j.active,
        'ultima', u.start_time, 'ultima_status', u.status, 'ultima_msg', left(u.return_message, 200),
        'rodadas_24h', coalesce(c.n, 0), 'falhas_24h', coalesce(c.f, 0)) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join (select distinct on (jobid) jobid, start_time, status, return_message from cron.job_run_details
        where start_time > now() - interval '35 days' order by jobid, start_time desc) u on u.jobid = j.jobid
      left join (select jobid, count(*) n, count(*) filter (where status = 'failed') f from cron.job_run_details
        where start_time > now() - interval '24 hours' group by jobid) c on c.jobid = j.jobid), now()
  on conflict (id) do update set dados = excluded.dados, montado_em = excluded.montado_em;
end $$;
revoke all on function public.integracoes_agendas_atualizar() from public, anon, authenticated;

select public.integracoes_agendas_atualizar();

select cron.unschedule(jobid) from cron.job where jobname = 'integracoes-agendas';
select cron.schedule('integracoes-agendas', '*/5 * * * *',
  $$set statement_timeout = '30s'; select public.integracoes_agendas_atualizar()$$);

-- O painel passa a ler o resumo guardado no lugar das duas leituras do histórico
do $$
declare
  d text := pg_get_functiondef('public.integracoes_painel()'::regprocedure);
  ini int := position('''agendas'', (select coalesce(jsonb_agg(' in d);
  fim int := position('''eventos'',' in d);
  trecho text;
begin
  if position('integracoes_agendas_cache' in d) > 0 then return; end if;
  if ini = 0 or fim = 0 or fim < ini then raise exception 'integracoes_painel mudou: confira o bloco das agendas'; end if;
  trecho := substr(d, ini, fim - ini);
  trecho := regexp_replace(trecho, ',\s*$', '');
  if position('cron.job_run_details' in trecho) = 0 then raise exception 'trecho das agendas não encontrado'; end if;
  d := replace(d, trecho, '''agendas'', coalesce((select dados from public.integracoes_agendas_cache where id = 1), ''[]''::jsonb),
    ''agendas_em'', (select montado_em from public.integracoes_agendas_cache where id = 1)');
  execute d;
end $$;
