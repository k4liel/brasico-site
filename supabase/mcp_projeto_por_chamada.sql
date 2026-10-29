-- Conector: cada chamada diz em qual projeto age (29/10/2026).
-- O "projeto ativo" fica em mcp_tokens, e o mesmo link do conector é usado por
-- várias conversas ao mesmo tempo: uma conversa trocava o projeto da outra no
-- meio do trabalho. Agora o site manda o token como "<token>|<id do projeto>"
-- nas ferramentas de projeto, e mcp_auth usa esse projeto só naquela chamada,
-- sem mexer no projeto ativo guardado.
create or replace function public.mcp_auth(p_token text, out o_user uuid, out o_ws uuid)
 returns record
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_id uuid;
  v_token text := coalesce(p_token, '');
  v_proj uuid;
  v_removido timestamptz;
begin
  if v_token ~ '\|[0-9a-fA-F-]{36}$' then
    v_proj := right(v_token, 36)::uuid;
    v_token := left(v_token, length(v_token) - 37);
  end if;

  select t.id, t.user_id, t.workspace_id into v_id, o_user, o_ws
  from public.mcp_tokens t
  where t.token_hash = encode(digest(v_token, 'sha256'), 'hex')
    and t.revoked_at is null;

  if v_id is null then
    raise exception 'Token inválido ou revogado' using errcode = '28000';
  end if;

  if v_proj is not null then
    select removido_em into v_removido from public.workspaces where id = v_proj;
    if not found then
      raise exception 'Projeto % não existe (veja listar_projetos)', v_proj using errcode = '42501';
    end if;
    if v_removido is not null then
      raise exception 'Esse projeto está na Lixeira. Para usar, restaure com restaurar_projeto.' using errcode = '42501';
    end if;
    o_ws := v_proj;
  end if;

  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = o_ws and m.user_id = o_user) then
    raise exception 'Sem acesso a este espaço' using errcode = '42501';
  end if;

  update public.mcp_tokens set last_used_at = now() where id = v_id;
  perform set_config('brasico.usuario', o_user::text, true);
end $function$;
