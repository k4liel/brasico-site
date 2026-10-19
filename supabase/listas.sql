-- Brainstorm em listas com caixinhas (como o Lembretes do iPhone).
-- Listas são da equipe: quem divide algum projeto com quem criou a lista vê e edita.
-- Substitui o quadro de "ideias" (supabase/ideias.sql), que ficou sem uso.

create table if not exists public.listas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 80),
  ordem int not null default 0,
  criado_por uuid not null references auth.users(id) default auth.uid(),
  arquivada_em timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.lista_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas(id),
  texto text not null check (length(trim(texto)) between 1 and 300),
  nota text not null default '',
  feito boolean not null default false,
  feito_em timestamptz,
  responsavel uuid references auth.users(id),
  prazo date,
  ordem double precision not null default extract(epoch from now()),
  criado_por uuid not null references auth.users(id) default auth.uid(),
  origem text not null default 'web',
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lista_itens_lista_idx on public.lista_itens (lista_id, feito, ordem);

create or replace function public.lista_acesso(p_lista uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listas l where l.id = p_lista and public.ideia_acesso(l.criado_por, null, p_user))
$$;
revoke execute on function public.lista_acesso(uuid, uuid) from public, anon;
grant execute on function public.lista_acesso(uuid, uuid) to authenticated;

create or replace function public.lista_itens_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.feito and not coalesce(old.feito, false) then new.feito_em := now(); end if;
  if not new.feito then new.feito_em := null; end if;
  return new;
end $$;
drop trigger if exists lista_itens_tocar on public.lista_itens;
create trigger lista_itens_tocar before update on public.lista_itens for each row execute function public.lista_itens_tocar();

drop trigger if exists listas_sem_exclusao on public.listas;
create trigger listas_sem_exclusao before delete on public.listas for each row execute function public.bloquear_exclusao();
drop trigger if exists lista_itens_sem_exclusao on public.lista_itens;
create trigger lista_itens_sem_exclusao before delete on public.lista_itens for each row execute function public.bloquear_exclusao();

alter table public.listas enable row level security;
alter table public.lista_itens enable row level security;

drop policy if exists "ver listas" on public.listas;
create policy "ver listas" on public.listas for select using (public.ideia_acesso(criado_por, null, auth.uid()));
drop policy if exists "criar listas" on public.listas;
create policy "criar listas" on public.listas for insert with check (criado_por = auth.uid());
drop policy if exists "editar listas" on public.listas;
create policy "editar listas" on public.listas for update using (public.ideia_acesso(criado_por, null, auth.uid()));

drop policy if exists "ver itens" on public.lista_itens;
create policy "ver itens" on public.lista_itens for select using (public.lista_acesso(lista_id, auth.uid()));
drop policy if exists "criar itens" on public.lista_itens;
create policy "criar itens" on public.lista_itens for insert with check (criado_por = auth.uid() and public.lista_acesso(lista_id, auth.uid()));
drop policy if exists "editar itens" on public.lista_itens;
create policy "editar itens" on public.lista_itens for update using (public.lista_acesso(lista_id, auth.uid())) with check (public.lista_acesso(lista_id, auth.uid()));

grant select, insert, update on public.listas, public.lista_itens to authenticated;

do $$ begin alter publication supabase_realtime add table public.listas; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.lista_itens; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Conector
-- ---------------------------------------------------------------------
create or replace function public.mcp_achar_lista(p_lista text, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.id from public.listas l
  where l.arquivada_em is null and public.ideia_acesso(l.criado_por, null, p_user)
    and (l.id::text = trim(p_lista) or lower(l.nome) = lower(trim(p_lista)))
  order by (l.id::text = trim(p_lista)) desc limit 1
$$;
revoke execute on function public.mcp_achar_lista(text, uuid) from public, anon, authenticated;

create or replace function public.mcp_item_json(i public.lista_itens)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'texto', i.texto, 'feito', i.feito, 'nota', nullif(i.nota, ''),
    'lista', (select nome from public.listas where id = i.lista_id),
    'responsavel', (select coalesce(display_name, email) from public.profiles where id = i.responsavel),
    'prazo', i.prazo, 'feito_em', i.feito_em, 'criado_em', i.created_at,
    'criado_por', (select coalesce(display_name, email) from public.profiles where id = i.criado_por))
$$;
revoke execute on function public.mcp_item_json(public.lista_itens) from public, anon, authenticated;

create or replace function public.mcp_listar_listas(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return jsonb_build_object('hoje', current_date, 'listas', coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome,
      'abertos', (select count(*) from public.lista_itens i where i.lista_id = l.id and not i.feito and i.arquivado_em is null),
      'feitos', (select count(*) from public.lista_itens i where i.lista_id = l.id and i.feito and i.arquivado_em is null)) order by l.ordem, l.created_at)
    from public.listas l where l.arquivada_em is null and public.ideia_acesso(l.criado_por, null, a.o_user)), '[]'::jsonb));
end $$;

create or replace function public.mcp_ver_lista(p_token text, p_lista text default null, p_incluir_feitos boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_lista uuid;
begin
  select * into a from public.mcp_auth(p_token);
  if p_lista is not null then
    v_lista := public.mcp_achar_lista(p_lista, a.o_user);
    if v_lista is null then raise exception 'Lista "%" não encontrada. Veja os nomes em listar_listas.', p_lista; end if;
  end if;
  return jsonb_build_object('hoje', current_date, 'itens', coalesce((
    select jsonb_agg(public.mcp_item_json(i) order by l.ordem, l.created_at, i.feito, i.ordem)
    from public.lista_itens i join public.listas l on l.id = i.lista_id
    where i.arquivado_em is null and l.arquivada_em is null
      and public.ideia_acesso(l.criado_por, null, a.o_user)
      and (v_lista is null or i.lista_id = v_lista)
      and (p_incluir_feitos or not i.feito)), '[]'::jsonb));
end $$;

create or replace function public.mcp_criar_lista(p_token text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; l public.listas;
begin
  select * into a from public.mcp_auth(p_token);
  if public.mcp_achar_lista(p_nome, a.o_user) is not null then raise exception 'Já existe uma lista "%"', p_nome; end if;
  insert into public.listas (nome, criado_por, ordem)
  values (trim(p_nome), a.o_user, coalesce((select max(ordem) + 1 from public.listas), 0)) returning * into l;
  return jsonb_build_object('id', l.id, 'nome', l.nome);
end $$;

create or replace function public.mcp_adicionar_item(p_token text, p_lista text, p_texto text,
  p_responsavel text default null, p_prazo date default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_lista uuid; v_resp uuid; i public.lista_itens;
begin
  select * into a from public.mcp_auth(p_token);
  v_lista := public.mcp_achar_lista(p_lista, a.o_user);
  if v_lista is null then raise exception 'Lista "%" não encontrada. Veja os nomes em listar_listas ou crie com criar_lista.', p_lista; end if;
  if nullif(trim(p_responsavel), '') is not null then
    v_resp := public.mcp_usuario_por_nome(p_responsavel, a.o_user);
    if v_resp is null then raise exception 'Não achei "%" na equipe.', p_responsavel; end if;
  end if;
  insert into public.lista_itens (lista_id, texto, responsavel, prazo, nota, criado_por, origem)
  values (v_lista, trim(p_texto), v_resp, p_prazo, coalesce(p_nota, ''), a.o_user, 'claude') returning * into i;
  return public.mcp_item_json(i);
end $$;

create or replace function public.mcp_atualizar_item(p_token text, p_id uuid, p_texto text default null, p_feito boolean default null,
  p_responsavel text default null, p_prazo date default null, p_sem_prazo boolean default false, p_nota text default null,
  p_lista text default null, p_arquivar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; i public.lista_itens; v_lista uuid; v_resp uuid;
begin
  select * into a from public.mcp_auth(p_token);
  select * into i from public.lista_itens where id = p_id for update;
  if i.id is null or not exists (select 1 from public.listas l where l.id = i.lista_id and public.ideia_acesso(l.criado_por, null, a.o_user)) then
    raise exception 'Item não encontrado';
  end if;
  if p_lista is not null then
    v_lista := public.mcp_achar_lista(p_lista, a.o_user);
    if v_lista is null then raise exception 'Lista "%" não encontrada.', p_lista; end if;
  end if;
  if nullif(trim(p_responsavel), '') is not null then
    v_resp := public.mcp_usuario_por_nome(p_responsavel, a.o_user);
    if v_resp is null then raise exception 'Não achei "%" na equipe.', p_responsavel; end if;
  end if;
  update public.lista_itens set
    texto = coalesce(nullif(trim(p_texto), ''), texto),
    feito = coalesce(p_feito, feito),
    responsavel = case when p_responsavel is null then responsavel when trim(p_responsavel) = '' then null else v_resp end,
    prazo = case when p_sem_prazo then null else coalesce(p_prazo, prazo) end,
    nota = coalesce(p_nota, nota),
    lista_id = coalesce(v_lista, lista_id),
    arquivado_em = case when p_arquivar then now() else arquivado_em end
  where id = i.id returning * into i;
  return public.mcp_item_json(i);
end $$;

revoke execute on function public.mcp_listar_listas(text) from public, authenticated;
revoke execute on function public.mcp_ver_lista(text, text, boolean) from public, authenticated;
revoke execute on function public.mcp_criar_lista(text, text) from public, authenticated;
revoke execute on function public.mcp_adicionar_item(text, text, text, text, date, text) from public, authenticated;
revoke execute on function public.mcp_atualizar_item(text, uuid, text, boolean, text, date, boolean, text, text, boolean) from public, authenticated;
grant execute on function public.mcp_listar_listas(text) to anon, service_role;
grant execute on function public.mcp_ver_lista(text, text, boolean) to anon, service_role;
grant execute on function public.mcp_criar_lista(text, text) to anon, service_role;
grant execute on function public.mcp_adicionar_item(text, text, text, text, date, text) to anon, service_role;
grant execute on function public.mcp_atualizar_item(text, uuid, text, boolean, text, date, boolean, text, text, boolean) to anon, service_role;
