-- =====================================================================
-- Brasico — equipe única e edição pelo Claude (já aplicado no banco)
-- - Projeto novo já nasce com toda a equipe de quem criou
-- - convidar_equipe(email): convida para todos os projetos de uma vez
-- - minha_equipe(): pessoas e convites pendentes
-- - Capítulos removidos ficam guardados (notes.archived_at)
-- - Ferramentas do Claude: remover/restaurar capítulo, renomear projeto
-- =====================================================================

alter table public.notes add column if not exists archived_at timestamptz;

-- Projeto novo já nasce com a equipe de quem criou (e com os convites pendentes)
create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner') on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  select distinct new.id, m2.user_id, 'member'
  from public.workspace_members m1
  join public.workspace_members m2 on m2.workspace_id = m1.workspace_id
  where m1.user_id = new.created_by and m2.user_id <> new.created_by and m1.workspace_id <> new.id
  on conflict do nothing;

  insert into public.workspace_invites (workspace_id, email, invited_by)
  select distinct new.id, lower(i.email), new.created_by
  from public.workspace_invites i
  join public.workspace_members m on m.workspace_id = i.workspace_id and m.user_id = new.created_by
  where i.accepted_at is null and i.workspace_id <> new.id
  on conflict do nothing;
  return new;
end $$;

-- Convida alguém para a equipe: entra em todos os projetos de quem convidou
create or replace function public.convidar_equipe(p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_email text := lower(trim(p_email));
begin
  if auth.uid() is null then raise exception 'Entre primeiro'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  insert into public.workspace_invites (workspace_id, email, invited_by)
  select m.workspace_id, v_email, auth.uid()
  from public.workspace_members m
  where m.user_id = auth.uid()
    and not exists (select 1 from public.workspace_members x join public.profiles p on p.id = x.user_id
                    where x.workspace_id = m.workspace_id and lower(p.email) = v_email)
  on conflict (workspace_id, email) do update set accepted_at = null
    where public.workspace_invites.accepted_at is not null
      and not exists (select 1 from public.workspace_members x join public.profiles p on p.id = x.user_id
                      where x.workspace_id = public.workspace_invites.workspace_id and lower(p.email) = v_email);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.convidar_equipe(text) from public, anon;
grant execute on function public.convidar_equipe(text) to authenticated;

-- Equipe: todas as pessoas que dividem algum projeto comigo, e convites pendentes
create or replace function public.minha_equipe()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'pessoas', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'email', p.email, 'nome', p.display_name))
      from public.workspace_members m1
      join public.workspace_members m2 on m2.workspace_id = m1.workspace_id
      join public.profiles p on p.id = m2.user_id
      where m1.user_id = auth.uid()), '[]'::jsonb),
    'convites', coalesce((select jsonb_agg(distinct lower(i.email))
      from public.workspace_invites i
      join public.workspace_members m on m.workspace_id = i.workspace_id and m.user_id = auth.uid()
      where i.accepted_at is null), '[]'::jsonb));
$$;
revoke execute on function public.minha_equipe() from public, anon;
grant execute on function public.minha_equipe() to authenticated;

create or replace function public.mcp_listar_notas(p_token text, p_busca text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select id, title, created_by, updated_at
    from public.notes
    where workspace_id = a.o_ws and archived_at is null
      and (p_busca is null or title ilike '%' || p_busca || '%' or content ilike '%' || p_busca || '%')
    order by title) x), '[]'::jsonb);
end $$;

create or replace function public.mcp_documento(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return (
    select jsonb_build_object(
      'projeto_id', w.id, 'projeto', w.name, 'rodape', w.doc_rodape,
      'capitulos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'conteudo', n.content) order by n.title)
        from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb),
      'capitulos_removidos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'removido_em', n.archived_at) order by n.archived_at desc)
        from public.notes n where n.workspace_id = w.id and n.archived_at is not null), '[]'::jsonb))
    from public.workspaces w where w.id = a.o_ws);
end $$;

create or replace function public.mcp_listar_projetos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'nome', w.name, 'ativo', w.id = a.o_ws,
      'capitulos', (select count(*) from public.notes n where n.workspace_id = w.id and n.archived_at is null)) order by w.created_at)
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id and m.user_id = a.o_user), '[]'::jsonb);
end $$;

create or replace function public.mcp_arquivar_capitulo(p_token text, p_id uuid, p_remover boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  update public.notes set archived_at = case when p_remover then now() else null end
  where id = p_id and workspace_id = a.o_ws
  returning * into r;
  if r.id is null then raise exception 'Capítulo não encontrado neste projeto'; end if;
  perform public.mcp_log(a.o_ws, a.o_user, case when p_remover then 'archive' else 'restore' end, 'notes', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title, 'removido', p_remover);
end $$;

create or replace function public.mcp_renomear_projeto(p_token text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome'; end if;
  update public.workspaces set name = trim(p_nome) where id = a.o_ws;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'workspaces', a.o_ws, trim(p_nome));
  return jsonb_build_object('projeto_id', a.o_ws, 'projeto', trim(p_nome));
end $$;

revoke execute on function public.mcp_arquivar_capitulo(text, uuid, boolean) from public, authenticated;
revoke execute on function public.mcp_renomear_projeto(text, text) from public, authenticated;
grant execute on function public.mcp_arquivar_capitulo(text, uuid, boolean) to anon;
grant execute on function public.mcp_renomear_projeto(text, text) to anon;

alter publication supabase_realtime add table public.workspaces;

create or replace function public.mcp_resumo(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return jsonb_build_object(
    'projeto', (select name from public.workspaces where id = a.o_ws),
    'equipe', public.mcp_membros(p_token),
    'pendencias', (select jsonb_build_object(
                  'todo',  count(*) filter (where status = 'todo'),
                  'doing', count(*) filter (where status = 'doing'),
                  'done',  count(*) filter (where status = 'done'))
                from public.tasks where workspace_id = a.o_ws),
    'capitulos', (select count(*) from public.notes where workspace_id = a.o_ws and archived_at is null),
    'indicadores', (select coalesce(jsonb_agg(distinct name), '[]'::jsonb) from public.metrics where workspace_id = a.o_ws),
    'mudancas_recentes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select created_at, user_id, action, entity, details, source
        from public.activity_log where workspace_id = a.o_ws
        order by created_at desc limit 10) x)
  );
end $$;
