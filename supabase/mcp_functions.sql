-- =====================================================================
-- Brasico — funções do conector do Claude (MCP)
-- O servidor /api/mcp chama estas funções com a chave PÚBLICA (anon).
-- Cada função valida o link do Claude (hash SHA-256 em mcp_tokens),
-- confere se a pessoa ainda é membro e só então lê/grava, sempre
-- restrito ao espaço daquele link. Nenhuma chave secreta é necessária.
-- =====================================================================

create or replace function public.mcp_auth(p_token text, out o_user uuid, out o_ws uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  select t.id, t.user_id, t.workspace_id into v_id, o_user, o_ws
  from public.mcp_tokens t
  where t.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and t.revoked_at is null;

  if v_id is null then
    raise exception 'Token inválido ou revogado' using errcode = '28000';
  end if;

  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = o_ws and m.user_id = o_user) then
    raise exception 'Sem acesso a este espaço' using errcode = '42501';
  end if;

  update public.mcp_tokens set last_used_at = now() where id = v_id;
end $$;

create or replace function public.mcp_log(p_ws uuid, p_user uuid, p_action text, p_entity text, p_id uuid, p_details text)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log (workspace_id, user_id, action, entity, entity_id, details, source)
  values (p_ws, p_user, p_action, p_entity, p_id, p_details, 'claude');
$$;

create or replace function public.mcp_membros(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role,
                                        'email', p.email, 'nome', p.display_name))
    from public.workspace_members m
    left join public.profiles p on p.id = m.user_id
    where m.workspace_id = a.o_ws), '[]'::jsonb);
end $$;

create or replace function public.mcp_resumo(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return jsonb_build_object(
    'espaco', (select name from public.workspaces where id = a.o_ws),
    'membros', public.mcp_membros(p_token),
    'tarefas', (select jsonb_build_object(
                  'todo',  count(*) filter (where status = 'todo'),
                  'doing', count(*) filter (where status = 'doing'),
                  'done',  count(*) filter (where status = 'done'))
                from public.tasks where workspace_id = a.o_ws),
    'notas', (select count(*) from public.notes where workspace_id = a.o_ws),
    'arquivos', (select count(*) from public.files where workspace_id = a.o_ws),
    'metricas', (select coalesce(jsonb_agg(distinct name), '[]'::jsonb) from public.metrics where workspace_id = a.o_ws),
    'atividade_recente', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select created_at, user_id, action, entity, details, source
        from public.activity_log where workspace_id = a.o_ws
        order by created_at desc limit 10) x)
  );
end $$;

-- ---------- Tarefas ----------
create or replace function public.mcp_listar_tarefas(p_token text, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select id, title, description, status, assignee, due_date, created_by, updated_at
    from public.tasks
    where workspace_id = a.o_ws and (p_status is null or status = p_status)
    order by created_at) x), '[]'::jsonb);
end $$;

create or replace function public.mcp_criar_tarefa(p_token text, p_title text, p_description text default null,
                                                   p_due_date date default null, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.tasks;
begin
  select * into a from public.mcp_auth(p_token);
  if p_assignee is not null and not exists (select 1 from public.workspace_members
       where workspace_id = a.o_ws and user_id = p_assignee) then
    raise exception 'Responsável não é membro deste espaço';
  end if;
  insert into public.tasks (workspace_id, title, description, due_date, assignee, created_by)
  values (a.o_ws, p_title, p_description, p_due_date, p_assignee, a.o_user)
  returning * into r;
  perform public.mcp_log(a.o_ws, a.o_user, 'insert', 'tasks', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status);
end $$;

create or replace function public.mcp_atualizar_tarefa(p_token text, p_id uuid, p_title text default null,
                                                       p_description text default null, p_status text default null,
                                                       p_due_date date default null, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.tasks;
begin
  select * into a from public.mcp_auth(p_token);
  if p_assignee is not null and not exists (select 1 from public.workspace_members
       where workspace_id = a.o_ws and user_id = p_assignee) then
    raise exception 'Responsável não é membro deste espaço';
  end if;
  update public.tasks set
    title       = coalesce(p_title, title),
    description = coalesce(p_description, description),
    status      = coalesce(p_status, status),
    due_date    = coalesce(p_due_date, due_date),
    assignee    = coalesce(p_assignee, assignee)
  where id = p_id and workspace_id = a.o_ws
  returning * into r;
  if r.id is null then raise exception 'Tarefa não encontrada neste espaço'; end if;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'tasks', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status);
end $$;

-- ---------- Notas ----------
create or replace function public.mcp_listar_notas(p_token text, p_busca text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select id, title, created_by, updated_at
    from public.notes
    where workspace_id = a.o_ws
      and (p_busca is null or title ilike '%' || p_busca || '%' or content ilike '%' || p_busca || '%')
    order by title) x), '[]'::jsonb);
end $$;

create or replace function public.mcp_ler_nota(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  select * into r from public.notes where id = p_id and workspace_id = a.o_ws;
  if r.id is null then raise exception 'Nota não encontrada neste espaço'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.mcp_criar_nota(p_token text, p_title text, p_content text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  insert into public.notes (workspace_id, title, content, created_by)
  values (a.o_ws, p_title, coalesce(p_content, ''), a.o_user)
  returning * into r;
  perform public.mcp_log(a.o_ws, a.o_user, 'insert', 'notes', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title);
end $$;

create or replace function public.mcp_atualizar_nota(p_token text, p_id uuid, p_title text default null, p_content text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  update public.notes set
    title   = coalesce(p_title, title),
    content = coalesce(p_content, content)
  where id = p_id and workspace_id = a.o_ws
  returning * into r;
  if r.id is null then raise exception 'Nota não encontrada neste espaço'; end if;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title);
end $$;

-- ---------- Arquivos ----------
create or replace function public.mcp_listar_arquivos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select id, name, size, mime_type, created_by, created_at
    from public.files where workspace_id = a.o_ws
    order by created_at desc) x), '[]'::jsonb);
end $$;

-- ---------- Métricas ----------
create or replace function public.mcp_registrar_metrica(p_token text, p_name text, p_value numeric,
                                                        p_unit text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.metrics;
begin
  select * into a from public.mcp_auth(p_token);
  insert into public.metrics (workspace_id, name, value, unit, note, created_by)
  values (a.o_ws, p_name, p_value, p_unit, p_note, a.o_user)
  returning * into r;
  perform public.mcp_log(a.o_ws, a.o_user, 'insert', 'metrics', r.id, r.name);
  return jsonb_build_object('id', r.id, 'name', r.name, 'value', r.value, 'unit', r.unit, 'recorded_at', r.recorded_at);
end $$;

create or replace function public.mcp_listar_metricas(p_token text, p_name text default null, p_limite int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select name, value, unit, note, recorded_at, created_by
    from public.metrics
    where workspace_id = a.o_ws and (p_name is null or name = p_name)
    order by recorded_at desc
    limit least(greatest(coalesce(p_limite, 100), 1), 500)) x), '[]'::jsonb);
end $$;

-- ---------- Atividade ----------
create or replace function public.mcp_ver_atividade(p_token text, p_limite int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select created_at, user_id, action, entity, details, source
    from public.activity_log where workspace_id = a.o_ws
    order by created_at desc
    limit least(greatest(coalesce(p_limite, 50), 1), 300)) x), '[]'::jsonb);
end $$;

-- ---------- Permissões ----------
-- Helpers internos: ninguém chama direto pela API.
revoke execute on function public.mcp_auth(text) from public, anon, authenticated;
revoke execute on function public.mcp_log(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;

-- Funções do conector: chamadas pelo servidor com a chave pública.
do $$
declare f text;
begin
  foreach f in array array[
    'mcp_membros(text)', 'mcp_resumo(text)',
    'mcp_listar_tarefas(text, text)', 'mcp_criar_tarefa(text, text, text, date, uuid)',
    'mcp_atualizar_tarefa(text, uuid, text, text, text, date, uuid)',
    'mcp_listar_notas(text, text)', 'mcp_ler_nota(text, uuid)',
    'mcp_criar_nota(text, text, text)', 'mcp_atualizar_nota(text, uuid, text, text)',
    'mcp_listar_arquivos(text)',
    'mcp_registrar_metrica(text, text, numeric, text, text)', 'mcp_listar_metricas(text, text, int)',
    'mcp_ver_atividade(text, int)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
