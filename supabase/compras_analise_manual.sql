-- 04/11/2026: a pedido do dono, a análise automática do grupo COMPRAS (Edge Function compras-analise, API da
-- Anthropic) foi PAUSADA para não ter custo: a agenda compras-continuo ficou desligada (não apagada).
--   select cron.alter_job((select jobid from cron.job where jobname = 'compras-continuo'), active := false);
-- Para religar no futuro: o mesmo comando com active := true.
-- O dono pede ao Claude do chat (conector Brasico) quando todos mandaram o pedido:
-- compras_semana → whatsapp_mensagens → compras_buscar (cada item) → compras_gravar_lista (uma lista por pedido).
-- O corpo completo das funções está no banco; aqui ficam as definições aplicadas na migration compras_analise_manual.

create or replace function public.mcp_compras_buscar(p_token text, p_busca text, p_unidade text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if coalesce(public.operacao_papel(a.o_user), '') <> 'socio' then raise exception 'Sem acesso às compras (só os sócios)' using errcode = '42501'; end if;
  if p_unidade is not null and p_unidade not in ('cicchetti_centro', 'sempre_vivo', 'filha_da_lua') then
    raise exception 'unidade: cicchetti_centro, sempre_vivo ou filha_da_lua';
  end if;
  return public.compras_auto_buscar(p_busca, p_unidade);
end $$;
revoke execute on function public.mcp_compras_buscar(text, text, text) from public, authenticated;
grant execute on function public.mcp_compras_buscar(text, text, text) to anon;

-- mcp_compras_gravar_lista: grava também media_4s, projecao, base, produto_nota e confianca de cada item.
-- mcp_compras_semana: devolve janela_dos_pedidos, mensagens_no_grupo e ultima_mensagem de cada pessoa,
-- se cada lista foi mexida, e o passo a passo da análise manual (como_fazer).
-- (definições completas: select pg_get_functiondef('mcp_compras_gravar_lista'::regproc), idem mcp_compras_semana)

-- 04/11/2026 (depois): a análise automática voltou, agora com o Gemini do Google no plano grátis (sem custo):
-- Edge Function compras-analise, segredo GEMINI_API_KEY; agenda compras-continuo religada.
-- Cada lista guarda só o trecho do pedido que deu origem a ela (compras_auto_gravar lê lst->>'pedido'; migration
-- compras_pedido_por_lista). Corpo completo: select pg_get_functiondef('compras_auto_gravar'::regproc).
