-- =====================================================================
-- Notas fiscais: consulta pelo conector (ferramenta notas_consultar)
--  - Sem busca: as notas do período (mais recentes primeiro) e a situação de cada empresa.
--  - Com busca: os itens das notas cuja descrição tem todas as palavras, com o preço efetivo.
-- Só para quem está em notas_acesso.
-- =====================================================================
create or replace function public.mcp_notas(p_token text, p_busca text default null, p_fornecedor text default null,
  p_empresa text default null, p_de date default null, p_ate date default null, p_limite int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_lim int := least(greatest(coalesce(p_limite, 60), 1), 300); v_res jsonb;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.notas_pode_ver(a.o_user) then
    raise exception 'Sem acesso às notas fiscais (só os sócios)' using errcode = '42501';
  end if;

  with n as (
    select n.*, e.nome empresa from public.notas n left join public.notas_empresas e on e.cnpj = n.empresa_cnpj
    where (p_empresa is null or n.empresa_cnpj = p_empresa or e.nome ilike '%' || p_empresa || '%')
      and (p_fornecedor is null or n.emitente_nome ilike '%' || p_fornecedor || '%' or n.emitente_cnpj = p_fornecedor)
      and (p_de is null or n.emissao >= p_de) and (p_ate is null or n.emissao < p_ate + 1)
  ), i as (
    select n.empresa, n.emitente_nome fornecedor, n.emissao, n.origem, n.situacao, it.*
    from n join public.notas_itens it on it.chave = n.chave
    where coalesce(trim(p_busca), '') <> '' and n.situacao <> 'cancelada'
      and not exists (select 1 from regexp_split_to_table(lower(trim(p_busca)), '\s+') w where lower(it.descricao) not like '%' || w || '%')
  )
  select jsonb_build_object(
    'empresas', (select jsonb_agg(jsonb_build_object('cnpj', cnpj, 'nome', nome, 'na_rotina', ativa, 'ciencia', ciencia,
        'ultima_consulta', ultima_consulta, 'ultimo_status', ultimo_status) order by nome) from public.notas_empresas),
    'notas', case when coalesce(trim(p_busca), '') = '' then coalesce((select jsonb_agg(jsonb_build_object(
        'chave', chave, 'empresa', empresa, 'fornecedor', emitente_nome, 'fornecedor_cnpj', emitente_cnpj, 'data', emissao::date,
        'valor', valor, 'situacao', situacao, 'completa', completa, 'origem', origem) order by emissao desc)
      from (select * from n order by emissao desc limit v_lim) x), '[]') end,
    'itens', case when coalesce(trim(p_busca), '') <> '' then coalesce((select jsonb_agg(jsonb_build_object(
        'data', emissao::date, 'empresa', empresa, 'fornecedor', fornecedor, 'descricao', descricao, 'unidade', unidade,
        'quantidade', quantidade, 'valor_total', valor_total, 'preco_efetivo', round(preco_efetivo, 2), 'origem', origem, 'chave', chave)
        order by emissao desc) from (select * from i order by emissao desc limit v_lim) y), '[]') end,
    'total_periodo', (select jsonb_build_object('notas', count(*), 'valor', round(sum(valor) filter (where situacao <> 'cancelada'), 2),
        'so_resumo', count(*) filter (where not completa)) from n),
    'observacao', 'Notas recebidas pela SEFAZ (últimos 90 dias a cada consulta) e notas avulsas. preco_efetivo = (total - desconto + frete) / quantidade, na unidade da nota. Nota só em resumo ainda não tem itens.'
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.mcp_notas(text, text, text, text, date, date, int) from public, authenticated;
grant execute on function public.mcp_notas(text, text, text, text, date, date, int) to anon;
