-- =====================================================================
-- Fichas técnicas: custo de cada ingrediente digitado na página /fichas (migration fichas_custo_manual)
--  - fichas_itens.custo_manual: o custo em R$ daquele ingrediente na ficha, digitado pelo sócio.
--    Quando existe, vale no lugar da conta (quantidade × último preço do insumo).
--  - fichas_item_custo(p_item, p_custo): grava o custo; p_custo = null volta para a conta.
--    Cada mudança vai para fichas_itens_custo_historico (nada se apaga).
--  - A edição de preço do insumo (supabase/fichas_fotos_precos.sql) foi tirada a pedido do dono em
--    29/10/2026: insumos_precos volta a usar só as notas e as funções de preço ficam sem acesso.
-- Quem pode: notas_pode_ver (os sócios).
-- =====================================================================

alter table public.fichas_itens add column if not exists custo_manual numeric check (custo_manual >= 0);

create table if not exists public.fichas_itens_custo_historico (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.fichas_itens(id),
  custo_antes numeric,
  custo_depois numeric,
  feito_por uuid default auth.uid(),
  feito_em timestamptz not null default now()
);
alter table public.fichas_itens_custo_historico enable row level security;
drop policy if exists "fichas custo historico ver" on public.fichas_itens_custo_historico;
create policy "fichas custo historico ver" on public.fichas_itens_custo_historico for select to authenticated
  using (public.notas_pode_ver(auth.uid()));

create or replace function public.fichas_item_custo(p_item bigint, p_custo numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if p_custo is not null and p_custo < 0 then raise exception 'O custo não pode ser negativo.'; end if;
  select custo_manual into v_antes from public.fichas_itens where id = p_item for update;
  if not found then raise exception 'Ingrediente não encontrado.'; end if;
  if v_antes is not distinct from p_custo then return; end if;
  update public.fichas_itens set custo_manual = p_custo where id = p_item;
  update public.fichas set atualizado_em = now() where id = (select ficha_id from public.fichas_itens where id = p_item);
  insert into public.fichas_itens_custo_historico (item_id, custo_antes, custo_depois) values (p_item, v_antes, p_custo);
end $$;
revoke execute on function public.fichas_item_custo(bigint, numeric) from public, anon;
grant execute on function public.fichas_item_custo(bigint, numeric) to authenticated;

-- Custo de cada ingrediente: o digitado, senão a conta; "manual" diz qual valeu
create or replace view public.fichas_itens_custo with (security_invoker = true) as
select fi.id item_id, fi.ficha_id,
  coalesce(fi.custo_manual, round(public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) * p.preco, 2)) custo,
  fi.custo_manual is not null manual
from public.fichas_itens fi
left join public.insumos i on i.id = fi.insumo_id
left join public.insumos_precos p on p.insumo_id = fi.insumo_id
where not fi.removido;
grant select on public.fichas_itens_custo to authenticated;

-- Custo da ficha: soma dos ingredientes com custo (digitado ou pela conta)
create or replace view public.fichas_custo with (security_invoker = true) as
select f.id ficha_id,
  round(sum(coalesce(fi.custo_manual, public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) * p.preco)), 2) custo,
  count(*) filter (where not fi.removido) ingredientes,
  count(*) filter (where not fi.removido and fi.custo_manual is null
                   and (p.preco is null or public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) is null)
                   and fi.quantidade is not null) sem_preco
from public.fichas f
join public.fichas_itens fi on fi.ficha_id = f.id and not fi.removido
left join public.insumos i on i.id = fi.insumo_id
left join public.insumos_precos p on p.insumo_id = fi.insumo_id
group by f.id;
grant select on public.fichas_custo to authenticated;

-- Tira a edição de preço do insumo: o preço digitado de teste fica guardado, mas desligado
update public.insumos_precos_manuais set removido = true where not removido;
create or replace view public.insumos_precos with (security_invoker = true) as
with compras as (
  select ap.insumo_id, n.emissao::date data, n.emitente_nome fornecedor,
    it.preco_efetivo / coalesce(nullif(ap.fator, 0), 1) preco, 'nota' fonte
  from public.insumos_apelidos ap
  join public.notas_itens it on lower(it.descricao) = lower(ap.apelido) and coalesce(lower(it.unidade), '') = coalesce(lower(ap.unidade_compra), coalesce(lower(it.unidade), ''))
  join public.notas n on n.chave = it.chave and n.situacao <> 'cancelada'
  where ap.origem = 'nota' and ap.confirmado and it.preco_efetivo is not null
  union all
  select ap.insumo_id, h.data_emissao, h.fornecedor, h.preco_efetivo / coalesce(nullif(ap.fator, 0), 1), 'cicchetti'
  from public.insumos_apelidos ap
  join public.precos_historico h on lower(h.descricao) = lower(ap.apelido) and coalesce(lower(h.unidade_compra), '') = coalesce(lower(ap.unidade_compra), coalesce(lower(h.unidade_compra), ''))
  where ap.origem = 'nota' and ap.confirmado and h.preco_efetivo is not null
)
select distinct on (insumo_id) insumo_id, data, fornecedor, round(preco, 4) preco, fonte
from compras order by insumo_id, data desc;
revoke execute on function public.insumos_preco_definir(uuid, numeric, text) from authenticated;
revoke execute on function public.insumos_preco_voltar(uuid) from authenticated;
