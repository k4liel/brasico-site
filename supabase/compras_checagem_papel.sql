-- Correção de segurança (04/11/2026, achada no teste completo das Compras):
-- operacao_papel() devolve null para quem não tem papel na Operação (ou sem login), e
-- "operacao_papel(auth.uid()) not in ('socio', 'compras')" com null não recusa. Troca por coalesce(..., '')
-- em todas as funções que checam o papel assim. Ao escrever uma função nova, use sempre:
--   if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception ...
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p where pronamespace = 'public'::regnamespace
           and prosrc ~ 'operacao_papel\(auth\.uid\(\)\)\s+not\s+in' loop
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, 'public\.operacao_papel\(auth\.uid\(\)\)\s+not\s+in', 'coalesce(public.operacao_papel(auth.uid()), '''') not in', 'g');
    def := regexp_replace(def, '([^.])operacao_papel\(auth\.uid\(\)\)\s+not\s+in', '\1coalesce(public.operacao_papel(auth.uid()), '''') not in', 'g');
    execute def;
  end loop;
end $$;

-- As funções da área da Fernanda só para quem está logado
revoke execute on function public.compras_conferir(uuid, text), public.compras_notas_do_fornecedor(uuid, text),
  public.compras_notas_recentes(int, text), public.compras_painel(uuid),
  public.compras_pedido_gravar(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.compras_conferir(uuid, text), public.compras_notas_do_fornecedor(uuid, text),
  public.compras_notas_recentes(int, text), public.compras_painel(uuid),
  public.compras_pedido_gravar(uuid, text, text, text, boolean, text) to authenticated;
