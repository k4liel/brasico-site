-- =====================================================================
-- Compras · leitura contínua do grupo COMPRAS (03/11/2026)
-- Antes: uma análise só, na terça às 6h (agenda compras-terca, que não chegou a rodar).
-- Agora: a cada 15 min, das 6h à meia-noite de Fortaleza, quem mandou mensagem nova no grupo
-- tem a lista da semana montada de novo pela Edge Function compras-analise.
-- Regra da semana: pedido feito até terça à noite entra na compra da semana; de quarta às 6h
-- em diante vai para a semana seguinte (janela = quarta 6h anterior até quarta 6h).
-- Lista que a pessoa já começou a revisar ou aprovou não é trocada (fica "pulada").
-- =====================================================================

-- Semana de compra de uma mensagem: segunda-feira da semana que contém (hora de Fortaleza − 30 h + 6 dias)
create or replace function public.compras_semana_alvo(p_quando timestamptz)
returns date language sql immutable as $$
  select (date_trunc('week', (p_quando at time zone 'America/Fortaleza') - interval '30 hours' + interval '6 days'))::date
$$;

-- Janela de mensagens de uma semana (segunda p_inicio): quarta anterior 6h até quarta 6h (Fortaleza)
create or replace function public.compras_janela(p_inicio date, out de timestamptz, out ate timestamptz)
language sql immutable as $$
  select ((p_inicio - 5)::timestamp + interval '6 hours') at time zone 'America/Fortaleza',
         ((p_inicio + 2)::timestamp + interval '6 hours') at time zone 'America/Fortaleza'
$$;

create or replace function public.compras_nome(p text)
returns text language sql stable as $$ select lower(extensions.unaccent(trim(coalesce(p, '')))) $$;

-- Próxima pessoa a analisar: tem mensagem no grupo, dentro da janela da semana, mais nova que a última
-- análise dela; lista não aprovada; no máximo 2 falhas desde a última mensagem.
-- Já registra a análise ("analisando") dentro de um bloqueio, para duas chamadas não pegarem a mesma pessoa.
drop function if exists public.compras_auto_proxima(uuid);
create or replace function public.compras_auto_proxima(p_semana uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inicio date; v_de timestamptz; v_ate timestamptz; p record; v_analise bigint;
  c_grupo constant text := '120363040261291910@g.us';
begin
  perform pg_advisory_xact_lock(hashtext('compras_auto_proxima'));
  select inicio into v_inicio from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_inicio is null then return null; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_janela(v_inicio) j;
  -- análise presa há mais de 15 min conta como falha
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and status = 'analisando' and inicio < now() - interval '15 minutes';

  select o.*, u.ultima into p
  from public.operacao_pessoas o
  join lateral (select max(m.enviada_em) ultima from public.wa_mensagens m
    where m.grupo_id = c_grupo and not m.de_nos and m.enviada_em >= v_de and m.enviada_em < v_ate
      and public.compras_nome(m.autor_nome) = public.compras_nome(o.wa_nome)) u on u.ultima is not null
  where o.ativo and o.papel = 'solicitante' and coalesce(trim(o.wa_nome), '') <> ''
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
      and (a.status = 'analisando' or (a.status <> 'falha' and a.inicio > u.ultima)))
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
      and a.status = 'falha' and a.inicio > u.ultima) < 2
    and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status = 'aprovada')
  order by u.ultima limit 1;
  if p.id is null then return null; end if;

  insert into public.compras_analises (semana_id, pessoa_id, status) values (p_semana, p.id, 'analisando') returning id into v_analise;
  return jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'wa_nome', p.wa_nome,
    'analise', v_analise, 'de', v_de, 'ate', v_ate);
end $$;
revoke execute on function public.compras_auto_proxima(uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_proxima(uuid) to service_role;

-- Semanas com fila: a da mensagem mais nova e, no dia seguinte ao fechamento (quarta 6h), a anterior
create or replace function public.compras_auto_semanas()
returns setof uuid language plpgsql security definer set search_path = public as $$
declare v_alvo date := public.compras_semana_alvo(now());
begin
  perform public.compras_semana_de(v_alvo);
  return query select s.id from public.compras_semanas s
    where s.status = 'aberta'
      and (s.inicio = v_alvo or (s.inicio = v_alvo - 7 and (select j.ate from public.compras_janela(s.inicio) j) > now() - interval '1 day'))
    order by s.inicio;
end $$;
revoke execute on function public.compras_auto_semanas() from public, anon, authenticated;
grant execute on function public.compras_auto_semanas() to service_role;

-- Pessoas que pedem no grupo e ainda não estavam cadastradas (03/11/2026)
insert into public.operacao_pessoas (nome, unidade, setor, papel, wa_nome)
select v.nome, v.unidade, v.setor, 'solicitante', v.wa_nome
from (values ('Alcides', 'filha_da_lua', 'cozinha', 'Alcides'),
             ('Lucas Miguel', 'filha_da_lua', 'salao', 'Lucas Miguel'),
             ('Juan', 'filha_da_lua', 'salao', 'Juan')) v(nome, unidade, setor, wa_nome)
where not exists (select 1 from public.operacao_pessoas o where public.compras_nome(o.wa_nome) = public.compras_nome(v.wa_nome));

-- Agenda: a antiga de terça sai; a contínua roda a cada 15 min das 6h à meia-noite (9h–2h45 UTC)
select cron.unschedule('compras-terca') where exists (select 1 from cron.job where jobname = 'compras-terca');
select cron.unschedule('compras-continuo') where exists (select 1 from cron.job where jobname = 'compras-continuo');
select cron.schedule('compras-continuo', '*/15 0-2,9-23 * * *', $job$
  select net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/compras-analise',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'compras_segredo')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$job$);
