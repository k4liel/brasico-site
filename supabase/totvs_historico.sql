-- =====================================================================
-- Histórico completo da TOTVS: puxa, de ontem para trás, todos os dias de cada unidade.
-- Um dia por unidade de cada vez (vários juntos fazem a TOTVS estourar o tempo).
-- Agenda totvs-historico (pg_cron, a cada 30 s) chama totvs_historico_passo().
-- Cada unidade para sozinha quando a TOTVS recusa o dia (HTTP 403), quando passa de
-- 120 dias seguidos sem movimento (a loja ainda não existia) ou ao chegar em 2010.
-- Para recomeçar uma unidade: update totvs_historico set cursor = <dia>, parado = false, sem_movimento_seguidos = 0 where unidade_id = '...';
-- =====================================================================

-- Sem o limite de 400 dias: a TOTVS passou a liberar todo o histórico
create or replace function public.totvs_pedir(p_unidade text, p_dia date, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare u public.totvs_unidades; v_id uuid; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  select * into u from public.totvs_unidades where id = p_unidade;
  if u.id is null then raise exception 'Unidade "%" não encontrada.', p_unidade; end if;
  if not u.ativa or u.loja is null then
    raise exception 'A unidade % não tem loja TOTVS configurada; não dá para extrair.', u.nome;
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'Escolha um dia até hoje.'; end if;
  if p_dia < date '2010-01-01' then raise exception 'Dia antigo demais (antes de 2010).'; end if;

  select id into v_id from public.totvs_execucoes
  where unidade_id = u.id and dia = p_dia and status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.totvs_execucoes (unidade_id, dia, origem, pedido_por)
  values (u.id, p_dia, p_origem, p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/totvs-extrair',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.totvs_pedir(text, date, text, uuid) from public, anon, authenticated;

create table if not exists public.totvs_historico (
  unidade_id text primary key references public.totvs_unidades(id),
  cursor date not null,                       -- próximo dia a buscar (anda para trás)
  execucao uuid,                              -- pedido em andamento
  tentativas int not null default 0,          -- falhas seguidas no dia do cursor
  sem_movimento_seguidos int not null default 0,
  parado boolean not null default false,
  motivo text not null default '',
  atualizado_em timestamptz not null default now()
);

do $$
begin
  execute 'drop trigger if exists totvs_historico_sem_exclusao on public.totvs_historico';
  execute 'create trigger totvs_historico_sem_exclusao before delete on public.totvs_historico for each row execute function public.bloquear_exclusao()';
  execute 'drop trigger if exists totvs_historico_sem_truncate on public.totvs_historico';
  execute 'create trigger totvs_historico_sem_truncate before truncate on public.totvs_historico for each statement execute function public.bloquear_exclusao()';
end $$;

alter table public.totvs_historico enable row level security;
drop policy if exists "ver historico" on public.totvs_historico;
create policy "ver historico" on public.totvs_historico for select using (public.totvs_pode_ver(auth.uid()));
revoke all on public.totvs_historico from anon;
grant select on public.totvs_historico to authenticated;

-- Começa de ontem em cada unidade ativa com loja
insert into public.totvs_historico (unidade_id, cursor)
select id, (now() at time zone 'America/Fortaleza')::date - 1 from public.totvs_unidades
where ativa and loja is not null
on conflict do nothing;

create or replace function public.totvs_historico_passo()
returns void language plpgsql security definer set search_path = public as $$
declare h public.totvs_historico; e public.totvs_execucoes;
begin
  for h in select * from public.totvs_historico where not parado order by unidade_id for update skip locked loop
    -- a unidade já tem um pedido andando (deste histórico, da agenda da manhã ou do site): espera
    continue when exists (select 1 from public.totvs_execucoes x where x.unidade_id = h.unidade_id
      and x.status in ('na_fila', 'rodando') and x.created_at > now() - interval '3 minutes');
    -- 1) Resultado do pedido anterior
    if h.execucao is not null then
      select * into e from public.totvs_execucoes where id = h.execucao;
      if e.status in ('na_fila', 'rodando') and e.created_at > now() - interval '3 minutes' then
        continue;                                   -- ainda trabalhando
      elsif e.status = 'falha' and e.erro like '%HTTP 403%' then
        update public.totvs_historico set parado = true, execucao = null, atualizado_em = now(),
          motivo = 'A TOTVS recusou ' || to_char(h.cursor, 'DD/MM/YYYY') || ' (HTTP 403): fim do que ela libera.'
        where unidade_id = h.unidade_id;
        continue;
      elsif e.status in ('ok', 'revisar', 'sem_movimento') then
        h.sem_movimento_seguidos := case when e.status = 'sem_movimento' then h.sem_movimento_seguidos + 1 else 0 end;
        h.cursor := h.cursor - 1; h.tentativas := 0;
      else                                          -- falha comum ou pedido perdido: tenta de novo até 3 vezes
        h.tentativas := h.tentativas + 1;
        if h.tentativas >= 3 then h.cursor := h.cursor - 1; h.tentativas := 0; end if;
      end if;
    end if;

    -- 2) Pula dias que já estão no banco
    while exists (select 1 from public.totvs_dias t where t.unidade_id = h.unidade_id and t.dia = h.cursor) loop
      h.sem_movimento_seguidos := case when (select status from public.totvs_dias t where t.unidade_id = h.unidade_id and t.dia = h.cursor) = 'sem_movimento'
                                       then h.sem_movimento_seguidos + 1 else 0 end;
      h.cursor := h.cursor - 1;
    end loop;

    -- 3) Para ou pede o próximo dia
    if h.sem_movimento_seguidos >= 120 then
      update public.totvs_historico set parado = true, execucao = null, cursor = h.cursor, sem_movimento_seguidos = h.sem_movimento_seguidos,
        motivo = '120 dias seguidos sem movimento antes de ' || to_char(h.cursor + 121, 'DD/MM/YYYY') || ': início do histórico.', atualizado_em = now()
      where unidade_id = h.unidade_id;
    elsif h.cursor < date '2010-01-01' then
      update public.totvs_historico set parado = true, execucao = null, motivo = 'Chegou a 2010.', atualizado_em = now()
      where unidade_id = h.unidade_id;
    else
      update public.totvs_historico set cursor = h.cursor, tentativas = h.tentativas, sem_movimento_seguidos = h.sem_movimento_seguidos,
        execucao = public.totvs_pedir(h.unidade_id, h.cursor, 'agenda', null), atualizado_em = now()
      where unidade_id = h.unidade_id;
    end if;
  end loop;
end $$;
revoke execute on function public.totvs_historico_passo() from public, anon, authenticated;

select cron.unschedule('totvs-historico') where exists (select 1 from cron.job where jobname = 'totvs-historico');
select cron.schedule('totvs-historico', '30 seconds', $job$ select public.totvs_historico_passo() $job$);
