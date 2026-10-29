-- =====================================================================
-- Fichas técnicas e cadastro único de insumos (Operação · fase 3)
--  - insumos: cada produto uma vez só, com unidade base (kg, L ou un).
--  - insumos_apelidos: os nomes do mesmo produto na ficha, na nota e no grupo apontam
--    para o mesmo insumo. Sugestões automáticas (pg_trgm) ficam com confirmado = false
--    até alguém conferir.
--  - fichas / fichas_itens: copiadas do projeto Fichas técnicas (cópia: o projeto continua
--    como está). quantidade numérica na unidade da ficha; "q.b." fica em quantidade_texto.
--  - fichas_totvs: liga cada prato vendido na TOTVS à sua ficha.
--  - Custo: último preço pago do insumo (notas da SEFAZ, avulsas e Cicchetti Management),
--    convertido entre g/kg, ml/L; outras unidades só quando batem.
-- Quem vê: notas_acesso (os sócios). Página: /fichas.
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null default 'kg' check (unidade in ('kg', 'L', 'un')),
  categoria text,
  fornecedor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists insumos_nome on public.insumos (lower(nome));

create table if not exists public.insumos_apelidos (
  id bigint generated always as identity primary key,
  insumo_id uuid not null references public.insumos(id),
  apelido text not null,
  origem text not null check (origem in ('ficha', 'nota', 'grupo', 'manual')),
  unidade_compra text,                            -- unidade do apelido na nota (kg, un, cx…)
  fator numeric,                                  -- quanto da unidade do insumo cabe em 1 unidade de compra (ex.: cx de 10 kg = 10)
  confirmado boolean not null default false,
  semelhanca numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists insumos_apelidos_unico on public.insumos_apelidos (lower(apelido), origem, coalesce(unidade_compra, ''));
create index if not exists insumos_apelidos_trgm on public.insumos_apelidos using gin (lower(apelido) extensions.gin_trgm_ops);

create table if not exists public.fichas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade_negocio text not null,                 -- midway, cicchetti_centro, filha_da_lua, producao
  grupo text,                                     -- grelhados, massas, drinks…
  tipo text not null default 'prato' check (tipo in ('prato', 'preparo', 'drink')),
  rendimento numeric,
  rendimento_unidade text,
  porcoes numeric,
  preparo text,
  observacoes text,
  foto text,
  origem_nota_id uuid,                            -- aba do projeto Fichas técnicas de onde veio
  conferida boolean not null default false,
  conferida_por uuid references auth.users(id),
  conferida_em timestamptz,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists fichas_unica on public.fichas (unidade_negocio, lower(nome));

create table if not exists public.fichas_itens (
  id bigint generated always as identity primary key,
  ficha_id uuid not null references public.fichas(id),
  ordem int not null default 0,
  ingrediente text not null,                      -- como está escrito na ficha
  insumo_id uuid references public.insumos(id),
  sub_ficha_id uuid references public.fichas(id), -- quando o ingrediente é outro preparo
  quantidade numeric,
  quantidade_texto text,                          -- q.b., a gosto…
  unidade text,
  removido boolean not null default false
);
create index if not exists fichas_itens_ficha on public.fichas_itens (ficha_id, ordem);

create table if not exists public.fichas_totvs (
  ficha_id uuid not null references public.fichas(id),
  unidade_totvs text not null,
  produto text not null,                          -- nome do produto na TOTVS
  porcoes_por_venda numeric not null default 1,
  primary key (unidade_totvs, produto)
);

do $$ declare t text; begin
  foreach t in array array['insumos', 'insumos_apelidos', 'fichas', 'fichas_itens', 'fichas_totvs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;

-- Texto para comparar nomes: minúsculas, sem acento, sem números e medidas
create or replace function public.insumos_normalizar(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select trim(regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))),
    '\m(\d+[.,]?\d*\s*(kg|g|gr|ml|l|lt|un|und|cx|pct|c/))\M|\d+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Unidade de compra → unidade base e fator (g→kg 0,001; ml→L 0,001)
create or replace function public.insumos_converter(p_qtd numeric, p_de text, p_para text)
returns numeric language sql immutable as $$
  select case
    when p_qtd is null then null
    when lower(p_de) = lower(p_para) then p_qtd
    when lower(p_de) in ('g', 'gr') and p_para = 'kg' then p_qtd / 1000
    when lower(p_de) = 'kg' and p_para = 'kg' then p_qtd
    when lower(p_de) = 'ml' and p_para = 'L' then p_qtd / 1000
    when lower(p_de) in ('l', 'lt') and p_para = 'L' then p_qtd
    when lower(p_de) in ('un', 'und', 'unid', 'uni') and p_para = 'un' then p_qtd
    else null end
$$;

-- Último preço pago por insumo, na unidade do insumo (só apelidos de nota confirmados)
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

-- Custo de cada ficha: soma dos ingredientes com preço; conta quantos ficaram sem preço
create or replace view public.fichas_custo with (security_invoker = true) as
select f.id ficha_id,
  round(sum(public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) * p.preco), 2) custo,
  count(*) filter (where not fi.removido) ingredientes,
  count(*) filter (where not fi.removido and (p.preco is null or public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) is null)
                   and fi.quantidade is not null) sem_preco
from public.fichas f
join public.fichas_itens fi on fi.ficha_id = f.id and not fi.removido
left join public.insumos i on i.id = fi.insumo_id
left join public.insumos_precos p on p.insumo_id = fi.insumo_id
group by f.id;
grant select on public.insumos_precos, public.fichas_custo to authenticated;

-- ---------------------------------------------------------------------
-- Ações da página (sócios)
-- ---------------------------------------------------------------------
create or replace function public.fichas_conferir(p_ficha uuid, p_conferida boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  update public.fichas set conferida = p_conferida, conferida_por = case when p_conferida then auth.uid() end,
    conferida_em = case when p_conferida then now() end, atualizado_em = now() where id = p_ficha;
end $$;
revoke execute on function public.fichas_conferir(uuid, boolean) from public, anon;
grant execute on function public.fichas_conferir(uuid, boolean) to authenticated;

create or replace function public.fichas_item_salvar(p_item bigint, p_quantidade numeric, p_unidade text, p_insumo uuid, p_removido boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  update public.fichas_itens set quantidade = p_quantidade, unidade = nullif(trim(p_unidade), ''),
    insumo_id = p_insumo, removido = coalesce(p_removido, removido) where id = p_item;
  update public.fichas set atualizado_em = now() where id = (select ficha_id from public.fichas_itens where id = p_item);
end $$;
revoke execute on function public.fichas_item_salvar(bigint, numeric, text, uuid, boolean) from public, anon;
grant execute on function public.fichas_item_salvar(bigint, numeric, text, uuid, boolean) to authenticated;

-- Confirmar (ou recusar) que um nome de nota é aquele insumo
create or replace function public.insumos_apelido_confirmar(p_apelido bigint, p_confirmado boolean, p_fator numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if p_confirmado then
    update public.insumos_apelidos set confirmado = true, fator = coalesce(p_fator, fator) where id = p_apelido;
  else
    -- Recusado: o apelido some das sugestões (não se apaga, vira de um insumo "recusado")
    update public.insumos_apelidos set confirmado = false, semelhanca = -1 where id = p_apelido;
  end if;
end $$;
revoke execute on function public.insumos_apelido_confirmar(bigint, boolean, numeric) from public, anon;
grant execute on function public.insumos_apelido_confirmar(bigint, boolean, numeric) to authenticated;

-- Sugestões: para cada nome de nota, o insumo mais parecido (sem repetir os já ligados).
-- Os nomes são normalizados uma vez só em tabelas temporárias com índice de trigramas:
-- comparar ~3.400 nomes de nota com ~450 insumos direto estourava o tempo do banco.
create or replace function public.insumos_sugerir(p_minimo numeric default 0.45)
returns int language plpgsql security definer set search_path = public, extensions set statement_timeout = '120s' as $$
declare v int;
begin
  create temp table if not exists _nomes (descricao text, unidade text, norm text) on commit drop;
  create temp table if not exists _ins (id uuid, norm text) on commit drop;
  truncate _nomes; truncate _ins;
  insert into _nomes
  select descricao, unidade, public.insumos_normalizar(descricao) from (
    select distinct on (lower(descricao), coalesce(lower(unidade), '')) descricao, unidade from public.notas_itens
    union
    select distinct on (lower(descricao), coalesce(lower(unidade_compra), '')) descricao, unidade_compra from public.precos_historico) x;
  insert into _ins select id, public.insumos_normalizar(nome) from public.insumos where ativo;
  create index if not exists _nomes_trgm on _nomes using gin (norm extensions.gin_trgm_ops);
  analyze _nomes;
  perform set_config('pg_trgm.similarity_threshold', p_minimo::text, true);
  with cand as (
    select distinct on (lower(nm.descricao), coalesce(lower(nm.unidade), '')) i.id insumo_id, nm.descricao, nm.unidade,
      extensions.similarity(nm.norm, i.norm) s
    from _ins i join _nomes nm on nm.norm operator(extensions.%) i.norm
    order by lower(nm.descricao), coalesce(lower(nm.unidade), ''), s desc
  )
  insert into public.insumos_apelidos (insumo_id, apelido, origem, unidade_compra, semelhanca)
  select insumo_id, descricao, 'nota', unidade, round(s::numeric, 2) from cand
  on conflict do nothing;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.insumos_sugerir(numeric) from public, anon, authenticated;

-- Tamanho da embalagem pelo nome da nota (500g, 1kg, 998ml, 5l): quanto do insumo vem em 1 unidade de compra
create or replace function public.insumos_fator(p_desc text, p_unidade_compra text, p_unidade_insumo text)
returns numeric language plpgsql immutable as $$
declare u text := lower(coalesce(p_unidade_compra, '')); m text[];
begin
  if (p_unidade_insumo = 'kg' and u in ('kg', 'kgs')) or (p_unidade_insumo = 'L' and u in ('l', 'lt', 'litro'))
     or (p_unidade_insumo = 'un' and u ~ '^(un|und|unid|uni|un1)') then return 1; end if;
  m := regexp_match(lower(p_desc), '(\d+[.,]?\d*)\s*(kg|g|gr|ml|l|lt)\M');
  if m is null then return null; end if;
  if p_unidade_insumo = 'kg' and m[2] in ('g', 'gr') then return replace(m[1], ',', '.')::numeric / 1000; end if;
  if p_unidade_insumo = 'kg' and m[2] = 'kg' then return replace(m[1], ',', '.')::numeric; end if;
  if p_unidade_insumo = 'L' and m[2] = 'ml' then return replace(m[1], ',', '.')::numeric / 1000; end if;
  if p_unidade_insumo = 'L' and m[2] in ('l', 'lt') then return replace(m[1], ',', '.')::numeric; end if;
  return null;
end $$;
-- Primeira carga (28/10/2026): fator calculado para as sugestões e confirmadas sozinhas só as
-- muito parecidas (semelhança ≥ 0,8) com fator conhecido; o resto fica para revisão na página.

-- Pratos e drinks vendidos na TOTVS → ficha da mesma unidade (semelhança ≥ p_minimo)
create or replace function public.fichas_totvs_sugerir(p_minimo numeric default 0.65)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v int;
begin
  perform set_config('pg_trgm.similarity_threshold', p_minimo::text, true);
  with prod as (
    select distinct d.unidade_id, p->>'nome' nome from public.totvs_dias d, jsonb_array_elements(d.produtos) p
    where d.unidade_id in ('midway', 'pipa_centro', 'filha_da_lua') and d.dia > current_date - 60
  ), f as (
    select id, case unidade_negocio when 'midway' then 'midway' when 'cicchetti_centro' then 'pipa_centro' when 'filha_da_lua' then 'filha_da_lua' end u,
      public.insumos_normalizar(regexp_replace(nome, '\s*(Cicchetti|—.*)$', '', 'i')) norm
    from public.fichas where unidade_negocio <> 'producao' and ativa
  ), cand as (
    select distinct on (p.unidade_id, p.nome) f.id ficha_id, p.unidade_id, p.nome, extensions.similarity(public.insumos_normalizar(p.nome), f.norm) s
    from prod p join f on f.u = p.unidade_id and public.insumos_normalizar(p.nome) operator(extensions.%) f.norm
    order by p.unidade_id, p.nome, s desc
  )
  insert into public.fichas_totvs (ficha_id, unidade_totvs, produto) select ficha_id, unidade_id, nome from cand on conflict do nothing;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.fichas_totvs_sugerir(numeric) from public, anon, authenticated;

-- Ligar/desligar à mão um produto da TOTVS a uma ficha (página)
create or replace function public.fichas_totvs_ligar(p_ficha uuid, p_unidade text, p_produto text, p_ligar boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  if p_ligar then
    insert into public.fichas_totvs (ficha_id, unidade_totvs, produto) values (p_ficha, p_unidade, p_produto)
    on conflict (unidade_totvs, produto) do update set ficha_id = excluded.ficha_id;
  else
    -- Sem exclusão: aponta o produto para "nenhuma ficha" trocando o vínculo por um marcador
    update public.fichas_totvs set porcoes_por_venda = 0 where unidade_totvs = p_unidade and produto = p_produto and ficha_id = p_ficha;
  end if;
end $$;
revoke execute on function public.fichas_totvs_ligar(uuid, text, text, boolean) from public, anon;
grant execute on function public.fichas_totvs_ligar(uuid, text, text, boolean) to authenticated;

-- Venda dos últimos 30 dias de cada ficha ligada a um produto da TOTVS (preço médio = valor ÷ quantidade)
create or replace view public.fichas_venda with (security_invoker = true) as
select ft.ficha_id, ft.unidade_totvs, ft.produto,
  sum((p->>'quantidade')::numeric) vendidos_30d,
  round(sum((p->>'valor')::numeric) / nullif(sum((p->>'quantidade')::numeric), 0), 2) preco_medio
from public.fichas_totvs ft
join public.totvs_dias d on d.unidade_id = ft.unidade_totvs and d.dia > current_date - 30
cross join lateral jsonb_array_elements(d.produtos) p
where ft.porcoes_por_venda > 0 and p->>'nome' = ft.produto
group by ft.ficha_id, ft.unidade_totvs, ft.produto;
grant select on public.fichas_venda to authenticated;

-- ---------------------------------------------------------------------
-- Página /fichas no visual do projeto Fichas técnicas (migration fichas_visual_do_projeto):
-- o CSS do projeto e o cabeçalho de cada capítulo (etiqueta, título, abertura), lidos sem alterar o projeto.
-- ---------------------------------------------------------------------
create or replace function public.fichas_capitulos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às fichas' using errcode = '42501'; end if;
  select n.workspace_id into v_proj from public.fichas f join public.notes n on n.id = f.origem_nota_id where f.ativa limit 1;
  return jsonb_build_object(
    'css', (select doc_css from public.workspaces where id = v_proj),
    'capitulos', (select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title,
        'rotulo', substring(n.content from '^\*\*([^*\n]+)\*\*'),
        'h1', substring(n.content from '\n# ([^\n]+)'),
        'abertura', substring(n.content from '\n\*([^*\n][^\n]*[^*\n])\*\s*\n')) order by n.title)
      from public.notes n where n.workspace_id = v_proj and n.archived_at is null
        and exists (select 1 from public.fichas f where f.origem_nota_id = n.id and f.ativa)));
end $$;
revoke execute on function public.fichas_capitulos() from public, anon;
grant execute on function public.fichas_capitulos() to authenticated;

-- Custo de cada ingrediente (mesma conta de fichas_custo)
create or replace view public.fichas_itens_custo with (security_invoker = true) as
select fi.id item_id, fi.ficha_id, round(public.insumos_converter(fi.quantidade, fi.unidade, i.unidade) * p.preco, 2) custo
from public.fichas_itens fi
left join public.insumos i on i.id = fi.insumo_id
left join public.insumos_precos p on p.insumo_id = fi.insumo_id
where not fi.removido;
grant select on public.fichas_itens_custo to authenticated;
