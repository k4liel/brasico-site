-- Renomear projeto pelo site (e pelo conector), com registro em Mudanças:
-- "Fulano renomeou o projeto Antigo → Novo".

create or replace function public.renomear_projeto(p_projeto uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_antigo text; v_novo text := trim(coalesce(p_nome, ''));
begin
  if not public.is_member(p_projeto) then raise exception 'Você não faz parte deste projeto'; end if;
  if v_novo = '' then raise exception 'Informe o nome'; end if;
  if length(v_novo) > 120 then raise exception 'Nome muito longo (máximo 120 caracteres)'; end if;
  select name into v_antigo from public.workspaces where id = p_projeto for update;
  if v_antigo is not distinct from v_novo then return jsonb_build_object('id', p_projeto, 'projeto', v_novo); end if;
  update public.workspaces set name = v_novo where id = p_projeto;
  insert into public.activity_log (workspace_id, user_id, action, entity, entity_id, details, source)
  values (p_projeto, auth.uid(), 'rename', 'workspaces', p_projeto, v_antigo || ' → ' || v_novo, 'web');
  return jsonb_build_object('id', p_projeto, 'projeto', v_novo);
end $$;
revoke execute on function public.renomear_projeto(uuid, text) from public, anon;
grant execute on function public.renomear_projeto(uuid, text) to authenticated;

create or replace function public.mcp_renomear_projeto(p_token text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_antigo text; v_novo text := trim(coalesce(p_nome, ''));
begin
  select * into a from public.mcp_auth(p_token);
  if v_novo = '' then raise exception 'Informe o nome'; end if;
  select name into v_antigo from public.workspaces where id = a.o_ws for update;
  update public.workspaces set name = v_novo where id = a.o_ws;
  if v_antigo is distinct from v_novo then
    perform public.mcp_log(a.o_ws, a.o_user, 'rename', 'workspaces', a.o_ws, v_antigo || ' → ' || v_novo);
  end if;
  return jsonb_build_object('projeto_id', a.o_ws, 'projeto', v_novo);
end $$;
