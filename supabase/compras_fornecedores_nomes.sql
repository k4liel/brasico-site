-- Nomes dos fornecedores ativos, para sugerir na troca de fornecedor de um item da lista (09/11/2026).
-- Quem pede compras não lê o cadastro (contatos, pagamento); aqui vai só o nome e a razão social.
create or replace function public.compras_fornecedores_nomes()
returns table (nome text, razao_social text)
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras', 'solicitante') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  return query
    select f.nome, f.razao_social from public.compras_fornecedores f
    where f.ativo and f.mesclado_em is null
    order by f.nome;
end $$;
revoke all on function public.compras_fornecedores_nomes() from public, anon;
grant execute on function public.compras_fornecedores_nomes() to authenticated;
