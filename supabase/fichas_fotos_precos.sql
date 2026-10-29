-- =====================================================================
-- Fichas técnicas: foto e preço editáveis na página /fichas (migration fichas_fotos_precos)
--  - Foto: o sócio envia a foto (bucket privado fichas-fotos), ela abre pela rota
--    /api/fichas/foto/<arquivo>, que confere notas_pode_ver. fichas_foto_definir troca ou tira
--    a foto da ficha; tirar só desliga (o arquivo fica) e toda troca vai para fichas_fotos_historico.
--  - Preço: insumos_preco_definir grava o preço digitado de um insumo (na unidade do insumo).
--    insumos_precos passa a considerar também esse preço: vale o mais recente entre notas e preço
--    digitado (no mesmo dia, o digitado). insumos_preco_voltar desliga o digitado (volta à nota).
-- Quem pode: notas_pode_ver (os sócios). Nada se apaga.
-- =====================================================================

-- ---------------------------------------------------------------- foto
insert into storage.buckets (id, name, public) values ('fichas-fotos', 'fichas-fotos', false) on conflict (id) do nothing;
drop policy if exists "fichas fotos enviar" on storage.objects;
create policy "fichas fotos enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'fichas-fotos' and public.notas_pode_ver(auth.uid()));
drop policy if exists "fichas fotos ver" on storage.objects;
create policy "fichas fotos ver" on storage.objects for select to authenticated
  using (bucket_id = 'fichas-fotos' and public.notas_pode_ver(auth.uid()));

create table if not exists public.fichas_fotos_historico (
  id bigint generated always as identity primary key,
  ficha_id uuid not null references public.fichas(id),
  foto_antes text,
  foto_depois text,
  feito_por uuid default auth.uid(),
  feito_em timestamptz not null default now()
);
alter table public.fichas_fotos_historico enable row level security;
drop policy if exists "fichas fotos historico ver" on public.fichas_fotos_historico;
create policy "fichas fotos historico ver" on public.fichas_fotos_historico for select to authenticated
  using (public.notas_pode_ver(auth.uid()));

create or replace function public.fichas_foto_definir(p_ficha uuid, p_foto text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if p_foto is not null and p_foto !~ '^/api/fichas/foto/[a-z0-9][a-z0-9_-]{0,100}\.(jpg|png|webp)$' then
    raise exception 'Foto inválida.';
  end if;
  select foto into v_antes from public.fichas where id = p_ficha for update;
  if not found then raise exception 'Ficha não encontrada.'; end if;
  if v_antes is not distinct from p_foto then return; end if;
  update public.fichas set foto = p_foto, atualizado_em = now() where id = p_ficha;
  insert into public.fichas_fotos_historico (ficha_id, foto_antes, foto_depois) values (p_ficha, v_antes, p_foto);
end $$;
revoke execute on function public.fichas_foto_definir(uuid, text) from public, anon;
grant execute on function public.fichas_foto_definir(uuid, text) to authenticated;

-- --------------------------------------------------------------- preço
create table if not exists public.insumos_precos_manuais (
  id bigint generated always as identity primary key,
  insumo_id uuid not null references public.insumos(id),
  preco numeric not null check (preco > 0),
  fornecedor text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  removido boolean not null default false
);
create index if not exists insumos_precos_manuais_insumo on public.insumos_precos_manuais (insumo_id, criado_em desc) where not removido;
alter table public.insumos_precos_manuais enable row level security;
drop policy if exists "insumos precos manuais ver" on public.insumos_precos_manuais;
create policy "insumos precos manuais ver" on public.insumos_precos_manuais for select to authenticated
  using (public.notas_pode_ver(auth.uid()));
grant select on public.insumos_precos_manuais to authenticated;

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
  union all
  select m.insumo_id, (m.criado_em at time zone 'America/Fortaleza')::date, coalesce(m.fornecedor, 'preço digitado'), m.preco, 'manual'
  from public.insumos_precos_manuais m
  where not m.removido
)
select distinct on (insumo_id) insumo_id, data, fornecedor, round(preco, 4) preco, fonte
from compras order by insumo_id, data desc, (fonte = 'manual') desc;

create or replace function public.insumos_preco_definir(p_insumo uuid, p_preco numeric, p_fornecedor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if p_preco is null or p_preco <= 0 then raise exception 'Informe um preço maior que zero.'; end if;
  if not exists (select 1 from public.insumos where id = p_insumo) then raise exception 'Insumo não encontrado.'; end if;
  insert into public.insumos_precos_manuais (insumo_id, preco, fornecedor) values (p_insumo, p_preco, nullif(trim(p_fornecedor), ''));
end $$;
revoke execute on function public.insumos_preco_definir(uuid, numeric, text) from public, anon;
grant execute on function public.insumos_preco_definir(uuid, numeric, text) to authenticated;

-- Volta ao preço das notas: desliga os preços digitados do insumo (ficam guardados)
create or replace function public.insumos_preco_voltar(p_insumo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  update public.insumos_precos_manuais set removido = true where insumo_id = p_insumo and not removido;
end $$;
revoke execute on function public.insumos_preco_voltar(uuid) from public, anon;
grant execute on function public.insumos_preco_voltar(uuid) to authenticated;
