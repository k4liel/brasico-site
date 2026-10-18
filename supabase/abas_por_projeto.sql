-- Abas por projeto: cada projeto escolhe se o modo Página mostra
-- um capítulo por vez (abas) ou o documento inteiro corrido.
alter table public.workspaces add column if not exists doc_abas boolean not null default false;

create or replace function public.mcp_definir_abas(p_token text, p_ativar boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  update public.workspaces set doc_abas = coalesce(p_ativar, false) where id = a.o_ws;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'workspaces', a.o_ws,
    case when coalesce(p_ativar, false) then 'capítulos em abas' else 'capítulos corridos' end);
  return jsonb_build_object('ok', true, 'abas', coalesce(p_ativar, false));
end $function$;

revoke all on function public.mcp_definir_abas(text, boolean) from public;
grant execute on function public.mcp_definir_abas(text, boolean) to anon, service_role;
