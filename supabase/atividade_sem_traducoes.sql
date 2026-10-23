-- ver_atividade (conector) sem as gravações de tradução (23/10/2026).
-- Traduzir um capítulo ("06 · Orçamento (alemão)") é feito sempre no fim e não é mudança de conteúdo;
-- o painel Mudanças do site também esconde essas linhas (lib/historico.ts, ehTraducao).
create or replace function public.mcp_ver_atividade(p_token text, p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select created_at, user_id, action, entity, details, source
    from public.activity_log where workspace_id = a.o_ws
      and coalesce(details, '') !~ '\((inglês|polonês|francês|alemão)\)$'
    order by created_at desc
    limit least(greatest(coalesce(p_limite, 50), 1), 300)) x), '[]'::jsonb);
end $$;
