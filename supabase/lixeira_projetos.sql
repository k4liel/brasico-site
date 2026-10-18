-- =====================================================================
-- Brasico — Lixeira de projetos. Aplicado em 18/10/2026.
--
-- • Excluir um projeto (no site ou pelo Claude) manda para a Lixeira:
--   ele some da lista, mas fica guardado e pode voltar.
-- • Só pelo site, e só a partir da Lixeira, dá para "Excluir para sempre",
--   digitando o nome do projeto. O Claude nunca apaga um projeto de vez.
-- • Excluir para sempre apaga o projeto, os capítulos, as versões e o
--   histórico. Os arquivos do bucket ficam (o Supabase protege) e o
--   backup semanal ainda tem tudo até a última segunda-feira.
-- =====================================================================

alter table public.workspaces
  add column if not exists removido_em  timestamptz,
  add column if not exists removido_por uuid;

-- Núcleo: manda para a Lixeira ou devolve. Quem chama já validou o acesso.
create or replace function public.brasico_lixeira(p_ws uuid, p_user uuid, p_remover boolean, p_origem text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  update public.workspaces set
    removido_em  = case when p_remover then now() else null end,
    removido_por = case when p_remover then p_user else null end
  where id = p_ws
    and (case when p_remover then removido_em is null else removido_em is not null end)
  returning * into w;
  if w.id is null then
    raise exception '%', case when p_remover then 'Esse projeto já está na Lixeira' else 'Esse projeto não está na Lixeira' end;
  end if;
  insert into public.activity_log (workspace_id, user_id, action, entity, entity_id, details, source)
  values (p_ws, p_user, case when p_remover then 'trash' else 'untrash' end, 'workspaces', p_ws, w.name, p_origem);
  return jsonb_build_object('id', w.id, 'projeto', w.name, 'na_lixeira', p_remover);
end $$;
revoke execute on function public.brasico_lixeira(uuid, uuid, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Site (logado)
-- ---------------------------------------------------------------------
create or replace function public.remover_projeto(p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_projeto) then raise exception 'Você não faz parte deste projeto'; end if;
  return public.brasico_lixeira(p_projeto, auth.uid(), true, 'web');
end $$;

create or replace function public.restaurar_projeto(p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_projeto) then raise exception 'Você não faz parte deste projeto'; end if;
  return public.brasico_lixeira(p_projeto, auth.uid(), false, 'web');
end $$;

create or replace function public.excluir_projeto_para_sempre(p_projeto uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.workspaces; t record; v_outro uuid;
begin
  if not public.is_member(p_projeto) then raise exception 'Você não faz parte deste projeto'; end if;
  select * into w from public.workspaces where id = p_projeto for update;
  if w.removido_em is null then raise exception 'Mande o projeto para a Lixeira antes de excluir para sempre'; end if;
  if trim(coalesce(p_nome, '')) <> trim(w.name) then raise exception 'O nome digitado não confere'; end if;

  -- Links do Claude com este projeto ativo passam para outro projeto da pessoa
  -- (senão o banco apagaria o link junto).
  for t in select id, user_id from public.mcp_tokens where workspace_id = p_projeto loop
    select m.workspace_id into v_outro
    from public.workspace_members m join public.workspaces x on x.id = m.workspace_id
    where m.user_id = t.user_id and m.workspace_id <> p_projeto
    order by (x.removido_em is null) desc, x.created_at
    limit 1;
    if v_outro is null then
      raise exception 'Este é o único projeto de um membro da equipe; crie outro projeto antes de excluir este';
    end if;
    update public.mcp_tokens set workspace_id = v_outro where id = t.id;
  end loop;

  perform set_config('brasico.permitir_exclusao', 'sim', true);
  delete from public.workspaces where id = p_projeto;
  return jsonb_build_object('ok', true, 'excluido', w.name);
end $$;

revoke execute on function public.remover_projeto(uuid) from public, anon;
revoke execute on function public.restaurar_projeto(uuid) from public, anon;
revoke execute on function public.excluir_projeto_para_sempre(uuid, text) from public, anon;
grant execute on function public.remover_projeto(uuid) to authenticated;
grant execute on function public.restaurar_projeto(uuid) to authenticated;
grant execute on function public.excluir_projeto_para_sempre(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Conector do Claude (só Lixeira; nunca exclui de vez)
-- ---------------------------------------------------------------------
create or replace function public.mcp_remover_projeto(p_token text, p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not exists (select 1 from public.workspace_members where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  return public.brasico_lixeira(p_projeto, a.o_user, true, 'claude');
end $$;

create or replace function public.mcp_restaurar_projeto(p_token text, p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not exists (select 1 from public.workspace_members where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  return public.brasico_lixeira(p_projeto, a.o_user, false, 'claude');
end $$;

-- listar_projetos separa os ativos da Lixeira
create or replace function public.mcp_listar_projetos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return jsonb_build_object(
    'projetos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'nome', w.name, 'ativo', w.id = a.o_ws,
        'capitulos', (select count(*) from public.notes n where n.workspace_id = w.id and n.archived_at is null)) order by w.created_at)
      from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id and m.user_id = a.o_user
      where w.removido_em is null), '[]'::jsonb),
    'lixeira', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'nome', w.name, 'removido_em', w.removido_em) order by w.removido_em desc)
      from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id and m.user_id = a.o_user
      where w.removido_em is not null), '[]'::jsonb));
end $$;

-- usar_projeto recusa projetos na Lixeira
create or replace function public.mcp_usar_projeto(p_token text, p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_nome text; v_removido timestamptz;
begin
  select * into a from public.mcp_auth(p_token);
  if not exists (select 1 from public.workspace_members
                 where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  select name, removido_em into v_nome, v_removido from public.workspaces where id = p_projeto;
  if v_removido is not null then
    raise exception 'O projeto "%" está na Lixeira. Para usar, restaure com restaurar_projeto.', v_nome;
  end if;
  update public.mcp_tokens set workspace_id = p_projeto
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  return jsonb_build_object('projeto_id', p_projeto, 'projeto', v_nome, 'ativo', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['mcp_remover_projeto(text, uuid)', 'mcp_restaurar_projeto(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
