-- Compras: leitura do grupo sem buracos (10/11/2026, pedido do dono: "toda lista que cair no grupo já tem que puxar").
-- 1. A agenda compras-continuo roda 24 h (antes parava da meia-noite às 6h de Fortaleza) e faz duas chamadas por minuto:
--    uma termina análises em andamento e a outra começa pedidos novos (corpo {"novas": true}).
-- 2. Mensagem mandada por quem não pede compras (Fernanda, sócio...) em nome de outra pessoa:
--    a) automática: se o texto ou o nome do arquivo cita o nome de exatamente um solicitante, conta para ele;
--    b) à mão: o Painel das Compras mostra "Mensagens do grupo sem dono" para escolher de quem é (ou ignorar).
-- 3. A pessoa só trava depois de 4 falhas seguidas (antes 2).

alter table public.compras_mensagens_pessoa alter column pessoa_id drop not null;
alter table public.compras_mensagens_pessoa add column if not exists ignorada boolean not null default false;

-- Mensagens que contam para cada pessoa na janela (autor = wa_nome, ou ligadas a ela; as ligadas a outra ou ignoradas não contam)
create or replace function public.compras_mensagens_da_pessoa(p_pessoa uuid, p_de timestamptz, p_ate timestamptz)
returns table (id text, enviada_em timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.enviada_em from public.wa_mensagens m
  join public.operacao_pessoas o on o.id = p_pessoa
  left join public.compras_mensagens_pessoa x on x.mensagem_id = m.id and x.removido_em is null
  where m.grupo_id = '120363040261291910@g.us' and not m.de_nos and m.enviada_em >= p_de and m.enviada_em < p_ate
    and (case when x.mensagem_id is not null then x.pessoa_id = p_pessoa and not x.ignorada
              else public.compras_nome(m.autor_nome) = public.compras_nome(o.wa_nome) end)
$$;
revoke all on function public.compras_mensagens_da_pessoa(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.compras_auto_proxima(p_semana uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_inicio date; v_de timestamptz; v_ate timestamptz; p record; v_analise bigint;
begin
  perform pg_advisory_xact_lock(hashtext('compras_auto_proxima'));
  select inicio into v_inicio from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_inicio is null then return null; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_janela(v_inicio) j;
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and ((status = 'analisando' and inicio < now() - interval '15 minutes')
                               or (status = 'no_lote' and inicio < now() - interval '6 hours'));

  select o.*, u.ultima, ult.inicio ultima_analise into p
  from public.operacao_pessoas o
  join lateral (select max(m.enviada_em) ultima from public.compras_mensagens_da_pessoa(o.id, v_de, v_ate) m) u on u.ultima is not null
  left join lateral (select max(a.inicio) inicio from public.compras_analises a
    where a.semana_id = p_semana and a.pessoa_id = o.id and a.status <> 'falha') ult on true
  where o.ativo and o.papel = 'solicitante'
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id and a.status in ('analisando', 'no_lote'))
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.inicio > greatest(u.ultima, now() - interval '20 hours')) < 4
    -- depois de uma falha, espera 3 min antes de tentar de novo (o Gemini costuma voltar logo)
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.fim > now() - interval '3 minutes')
    and (
      ult.inicio is null or ult.inicio < u.ultima
      or (ult.inicio < now() - interval '20 hours' and now() < v_ate
          and exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status in ('aguardando', 'em_revisao'))
          and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id
                          and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)))
    )
  order by (ult.inicio is null or ult.inicio < u.ultima) desc, u.ultima limit 1;
  if p.id is null then return null; end if;

  insert into public.compras_analises (semana_id, pessoa_id, status) values (p_semana, p.id, 'analisando') returning id into v_analise;
  return jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'wa_nome', p.wa_nome,
    'analise', v_analise, 'de', v_de, 'ate', v_ate);
end $function$;

-- Ligação automática: mensagem de quem não pede compras que cita o nome de um só solicitante
create or replace function public.compras_mensagem_dono_auto() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_texto text; v_pessoa uuid; v_n int;
begin
  if new.grupo_id <> '120363040261291910@g.us' or new.de_nos then return new; end if;
  if exists (select 1 from public.operacao_pessoas o where o.ativo and o.papel = 'solicitante'
             and public.compras_nome(o.wa_nome) = public.compras_nome(new.autor_nome)) then return new; end if;
  v_texto := ' ' || regexp_replace(upper(unaccent(coalesce(new.texto, '') || ' ' || coalesce(new.midia_nome, ''))), '[^A-Z]+', ' ', 'g') || ' ';
  select min(o.id::text)::uuid, count(*) into v_pessoa, v_n from public.operacao_pessoas o
  where o.ativo and o.papel = 'solicitante'
    and v_texto like '% ' || regexp_replace(upper(unaccent(split_part(o.nome, ' ', 1))), '[^A-Z]+', '', 'g') || ' %';
  if v_n = 1 then
    insert into public.compras_mensagens_pessoa (mensagem_id, pessoa_id, motivo, criado_por)
    values (new.id, v_pessoa, 'automático: o nome da pessoa está na mensagem ou no arquivo', null)
    on conflict (mensagem_id) do nothing;
  end if;
  return new;
exception when others then
  return new; -- nunca atrapalha a gravação da mensagem do WhatsApp
end $$;
drop trigger if exists compras_mensagem_dono_auto on public.wa_mensagens;
create trigger compras_mensagem_dono_auto after insert on public.wa_mensagens
  for each row execute function public.compras_mensagem_dono_auto();

-- Mensagens da semana que não contam para ninguém (autor que não pede compras, sem ligação)
create or replace function public.compras_mensagens_sem_dono(p_semana uuid)
returns table (id text, enviada_em timestamptz, autor text, tipo text, texto text, arquivo text)
language plpgsql stable security definer set search_path = public as $$
declare v_de timestamptz; v_ate timestamptz;
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  select j.de, j.ate into v_de, v_ate from public.compras_semanas s, public.compras_janela(s.inicio) j where s.id = p_semana;
  return query
    select m.id, m.enviada_em, m.autor_nome, m.tipo, left(m.texto, 600), nullif(m.midia_nome, '')
    from public.wa_mensagens m
    where m.grupo_id = '120363040261291910@g.us' and not m.de_nos and m.enviada_em >= v_de and m.enviada_em < v_ate
      and not exists (select 1 from public.operacao_pessoas o where o.ativo and o.papel = 'solicitante'
                      and public.compras_nome(o.wa_nome) = public.compras_nome(m.autor_nome))
      and not exists (select 1 from public.compras_mensagens_pessoa x where x.mensagem_id = m.id and x.removido_em is null)
      and (length(coalesce(m.texto, '')) > 40 or coalesce(m.midia_nome, '') <> '')
    order by m.enviada_em desc;
end $$;
revoke all on function public.compras_mensagens_sem_dono(uuid) from public, anon;
grant execute on function public.compras_mensagens_sem_dono(uuid) to authenticated;

-- Escolher de quem é a mensagem (p_pessoa) ou ignorá-la (p_pessoa null)
create or replace function public.compras_mensagem_atribuir(p_mensagem text, p_pessoa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  insert into public.compras_mensagens_pessoa (mensagem_id, pessoa_id, ignorada, motivo)
  values (p_mensagem, p_pessoa, p_pessoa is null, case when p_pessoa is null then 'ignorada no Painel' else 'escolhida no Painel' end)
  on conflict (mensagem_id) do update set pessoa_id = excluded.pessoa_id, ignorada = excluded.ignorada, motivo = excluded.motivo,
    criado_por = auth.uid(), criado_em = now(), removido_em = null;
end $$;
revoke all on function public.compras_mensagem_atribuir(text, uuid) from public, anon;
grant execute on function public.compras_mensagem_atribuir(text, uuid) to authenticated;

-- Agenda: 24 h, duas chamadas por minuto
select cron.unschedule('compras-continuo');
select cron.schedule('compras-continuo', '* * * * *', $cron$
  select net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/compras-analise',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'compras_segredo')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
  select net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/compras-analise',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'compras_segredo')),
    body := '{"novas": true}'::jsonb, timeout_milliseconds := 150000);
$cron$);
