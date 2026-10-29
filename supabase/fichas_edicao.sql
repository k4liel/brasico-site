-- =====================================================================
-- Fichas técnicas: edição da ficha inteira na página /fichas e aba Menus (migration fichas_edicao_e_menus)
--  - fichas_salvar: nome, grupo, rendimento, preparo (um passo por linha) e observações
--  - fichas_item_atualizar / fichas_item_incluir: ingrediente, quantidade, unidade e insumo;
--    tirar um ingrediente marca removido (nada se apaga)
--  - menus_produtos: o cardápio de cada casa = o que a TOTVS vendeu nos últimos 60 dias,
--    por grupo e subgrupo, com o preço médio e a ficha ligada (fichas_totvs; ligar com fichas_totvs_ligar)
-- Quem pode: notas_pode_ver (os sócios). O projeto Fichas técnicas continua como está.
-- =====================================================================

create or replace function public.fichas_salvar(p_ficha uuid, p_nome text, p_grupo text, p_rendimento numeric, p_rendimento_unidade text,
  p_preparo text, p_observacoes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome da ficha.'; end if;
  update public.fichas set nome = trim(p_nome), grupo = nullif(trim(p_grupo), ''), rendimento = p_rendimento,
    rendimento_unidade = nullif(trim(p_rendimento_unidade), ''), preparo = nullif(trim(p_preparo), ''),
    observacoes = nullif(trim(p_observacoes), ''), atualizado_em = now()
  where id = p_ficha;
end $$;
revoke execute on function public.fichas_salvar(uuid, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.fichas_salvar(uuid, text, text, numeric, text, text, text) to authenticated;

create or replace function public.fichas_item_atualizar(p_item bigint, p_ingrediente text, p_quantidade numeric, p_unidade text, p_insumo uuid, p_removido boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  update public.fichas_itens set ingrediente = coalesce(nullif(trim(p_ingrediente), ''), ingrediente), quantidade = p_quantidade,
    quantidade_texto = case when p_quantidade is null then quantidade_texto else null end,
    unidade = nullif(trim(p_unidade), ''), insumo_id = p_insumo, removido = coalesce(p_removido, removido)
  where id = p_item;
  update public.fichas set atualizado_em = now() where id = (select ficha_id from public.fichas_itens where id = p_item);
end $$;
revoke execute on function public.fichas_item_atualizar(bigint, text, numeric, text, uuid, boolean) from public, anon;
grant execute on function public.fichas_item_atualizar(bigint, text, numeric, text, uuid, boolean) to authenticated;

create or replace function public.fichas_item_incluir(p_ficha uuid, p_ingrediente text, p_quantidade numeric, p_unidade text, p_insumo uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if coalesce(trim(p_ingrediente), '') = '' then raise exception 'Informe o ingrediente.'; end if;
  insert into public.fichas_itens (ficha_id, ordem, ingrediente, quantidade, unidade, insumo_id)
  values (p_ficha, coalesce((select max(ordem) from public.fichas_itens where ficha_id = p_ficha), 0) + 1, trim(p_ingrediente),
    p_quantidade, nullif(trim(p_unidade), ''), p_insumo)
  returning id into v_id;
  update public.fichas set atualizado_em = now() where id = p_ficha;
  return v_id;
end $$;
revoke execute on function public.fichas_item_incluir(uuid, text, numeric, text, uuid) from public, anon;
grant execute on function public.fichas_item_incluir(uuid, text, numeric, text, uuid) to authenticated;

create or replace view public.menus_produtos with (security_invoker = true) as
select v.*, (select ft.ficha_id from public.fichas_totvs ft where ft.unidade_totvs = v.unidade_id and ft.produto = v.produto
    and ft.porcoes_por_venda > 0 limit 1) ficha_id
from (
  select d.unidade_id, p->>'grupo' grupo, p->>'subgrupo' subgrupo, p->>'categoria' categoria, p->>'nome' produto,
    sum((p->>'quantidade')::numeric) vendidos_60d,
    round(sum((p->>'valor')::numeric) / nullif(sum((p->>'quantidade')::numeric), 0), 2) preco_medio,
    max(d.dia) ultima_venda
  from public.totvs_dias d cross join lateral jsonb_array_elements(d.produtos) p
  where d.dia > current_date - 60
  group by d.unidade_id, p->>'grupo', p->>'subgrupo', p->>'categoria', p->>'nome'
) v;
grant select on public.menus_produtos to authenticated;
