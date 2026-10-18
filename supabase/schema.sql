-- =====================================================================
-- Brasico — esquema do banco (Supabase / Postgres)
-- Estado aplicado no projeto Brasico (doajznzouxxqbqkvsclv) em 16/10/2026.
--
-- Ordem para recriar do zero (SQL Editor > New query > Run):
--   1. supabase/schema.sql          (este arquivo)
--   2. supabase/mcp_functions.sql   (funções do conector do Claude)
--   3. supabase/opcional_exclusoes.sql  (opcional: permissões de exclusão)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  invited_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  assignee uuid references auth.users(id),
  due_date date,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  content text not null default '',
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  size bigint,
  mime_type text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  value numeric not null,
  unit text,
  note text,
  recorded_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id)
);

-- Quem fez o quê (pela web ou pelo Claude)
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details text,
  source text not null default 'web' check (source in ('web', 'claude')),
  created_at timestamptz not null default now()
);

-- Links do Claude: só o hash SHA-256; revogar = preencher revoked_at
create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null default 'Meu Claude',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists tasks_ws_idx on public.tasks(workspace_id);
create index if not exists notes_ws_idx on public.notes(workspace_id);
create index if not exists files_ws_idx on public.files(workspace_id);
create index if not exists metrics_ws_idx on public.metrics(workspace_id, name, recorded_at desc);
create index if not exists activity_ws_idx on public.activity_log(workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end $$;

-- Ao entrar, aceita os convites pendentes do e-mail do usuário
create or replace function public.accept_invites()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  my_email text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or my_email is null then return 0; end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select workspace_id, auth.uid(), 'member'
  from public.workspace_invites
  where lower(email) = my_email and accepted_at is null
  on conflict do nothing;
  get diagnostics n = row_count;

  update public.workspace_invites set accepted_at = now()
  where lower(email) = my_email and accepted_at is null;
  return n;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Registra o que é feito pela web (o conector do Claude registra o dele)
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec record;
  j jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then rec := new; else rec := old; end if;
  j := to_jsonb(rec);
  insert into public.activity_log (workspace_id, user_id, action, entity, entity_id, details, source)
  values (
    (j ->> 'workspace_id')::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (j ->> 'id')::uuid,
    coalesce(j ->> 'title', j ->> 'name'),
    'web'
  );
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.add_creator_as_owner();

create or replace trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create or replace trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

create or replace trigger tasks_log_iu after insert or update on public.tasks
  for each row execute function public.log_activity();
create or replace trigger notes_log_iu after insert or update on public.notes
  for each row execute function public.log_activity();
create or replace trigger files_log_iu after insert or update on public.files
  for each row execute function public.log_activity();
create or replace trigger metrics_log_iu after insert or update on public.metrics
  for each row execute function public.log_activity();

-- Perfis de quem já tinha conta antes deste arquivo
insert into public.profiles (id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Segurança: Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.tasks             enable row level security;
alter table public.notes             enable row level security;
alter table public.files             enable row level security;
alter table public.metrics           enable row level security;
alter table public.activity_log      enable row level security;
alter table public.mcp_tokens        enable row level security;

create policy "ver perfis" on public.profiles for select
  using (id = auth.uid() or public.shares_workspace(id));
create policy "editar meu perfil" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "ver workspaces" on public.workspaces for select
  using (public.is_member(id) or created_by = auth.uid());
create policy "criar workspace" on public.workspaces for insert
  with check (created_by = auth.uid());
create policy "renomear workspace" on public.workspaces for update
  using (public.is_member(id)) with check (public.is_member(id));

create policy "ver membros" on public.workspace_members for select
  using (public.is_member(workspace_id));

create policy "gerenciar convites" on public.workspace_invites for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy "membros acessam" on public.tasks for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "membros acessam" on public.notes for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "membros acessam" on public.files for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "membros acessam" on public.metrics for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy "ver atividade" on public.activity_log for select
  using (public.is_member(workspace_id));

create policy "meus tokens" on public.mcp_tokens for select
  using (user_id = auth.uid());
create policy "criar token" on public.mcp_tokens for insert
  with check (user_id = auth.uid() and public.is_member(workspace_id));
create policy "revogar token" on public.mcp_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Funções internas não podem ser chamadas pela API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.add_creator_as_owner() from public, anon, authenticated;
revoke execute on function public.log_activity() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.accept_invites() from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.shares_workspace(uuid) from public, anon;
grant execute on function public.accept_invites() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Arquivos (bucket privado; caminho: <workspace_id>/<pasta>/<arquivo>)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('workspace-files', 'workspace-files', false)
on conflict (id) do nothing;

create policy "membros leem arquivos" on storage.objects for select
  using (bucket_id = 'workspace-files'
         and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "membros enviam arquivos" on storage.objects for insert
  with check (bucket_id = 'workspace-files'
              and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- Tempo real
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.tasks, public.notes, public.files, public.metrics, public.activity_log;
