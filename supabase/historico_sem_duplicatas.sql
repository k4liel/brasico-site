-- Histórico (painel Mudanças) sem linhas duplicadas.
--
-- Antes, cada mudança feita pelo conector gerava duas linhas em activity_log:
-- uma do gatilho log_activity (user_id nulo, source 'web') e outra de
-- mcp_log (usuário certo, source 'claude').
--
-- Agora o gatilho não registra nada quando a mudança vem do conector
-- (mcp_auth marca brasico.usuario na transação); todas as funções mcp_* que
-- mexem em notes/tasks/metrics/files já chamam mcp_log. Quando vem do site,
-- registra com auth.uid() e source 'web', como antes.
--
-- As duplicadas antigas não são apagadas: o site esconde as linhas 'web' sem
-- usuário que têm uma linha 'claude' do mesmo entity_id no mesmo created_at.

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  j jsonb;
begin
  -- Mudança feita pelo conector: quem registra é mcp_log.
  if nullif(current_setting('brasico.usuario', true), '') is not null then
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
end $function$;
