-- =====================================================================
-- Compras (Operação · fase 2)
--  - Semana: começa na segunda. Pedidos no grupo COMPRAS até segunda à noite; terça às 6h
--    o Claude analisa (pedido × notas × vendas × semanas anteriores) e grava uma lista
--    sugerida por pessoa (mcp_compras_gravar_lista); cada pessoa revisa e aprova a sua;
--    a Fernanda junta as aprovadas na lista única por fornecedor e gera o PDF.
--  - Pessoas: operacao_pessoas (solicitante, compras = Fernanda). Sócios = notas_acesso.
--    Solicitante e compras só abrem /compras (trava no middleware e aqui, por RLS).
--  - Nada se apaga: item tirado fica com removido = true; toda mudança vai para o histórico.
-- Página: /compras (components/Compras.tsx).
-- =====================================================================

create table if not exists public.operacao_pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text check (unidade in ('cicchetti_centro', 'sempre_vivo', 'filha_da_lua')),
  setor text check (setor in ('bar', 'cozinha', 'salao', 'producao')),
  papel text not null check (papel in ('solicitante', 'compras')),
  email text,
  user_id uuid unique references auth.users(id),
  wa_nome text,                                   -- como o nome aparece no grupo COMPRAS
  ativo boolean not null default true,
  convidado_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists operacao_pessoas_setor on public.operacao_pessoas (unidade, setor, nome);

insert into public.operacao_pessoas (nome, unidade, setor, papel, wa_nome) values
  ('Maicon', 'cicchetti_centro', 'bar', 'solicitante', 'Maicon Alves'),
  ('Geraldo', 'cicchetti_centro', 'cozinha', 'solicitante', 'Geraldinho'),
  ('Francisco', 'cicchetti_centro', 'salao', 'solicitante', 'Francisco'),
  ('Maurício', 'sempre_vivo', 'bar', 'solicitante', 'maurício pereira'),
  ('Patrícia', 'sempre_vivo', 'cozinha', 'solicitante', 'Patrícia Felix'),
  ('Karina', 'sempre_vivo', 'producao', 'solicitante', null),
  ('Mahatma', 'filha_da_lua', 'bar', 'solicitante', 'Mahatma'),
  ('Bruno', 'filha_da_lua', 'cozinha', 'solicitante', 'Bruno Alves'),
  ('Vitor', 'filha_da_lua', 'salao', 'solicitante', null)
on conflict do nothing;
insert into public.operacao_pessoas (nome, papel)
select 'Fernanda', 'compras' where not exists (select 1 from public.operacao_pessoas where papel = 'compras' and nome = 'Fernanda');

-- Papel de quem está logado: socio, compras, solicitante ou nulo
create or replace function public.operacao_papel(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when public.notas_pode_ver(p_user) then 'socio'
    else (select papel from public.operacao_pessoas where user_id = p_user and ativo limit 1) end
$$;
revoke execute on function public.operacao_papel(uuid) from public, anon;
grant execute on function public.operacao_papel(uuid) to authenticated;

create or replace function public.operacao_eu()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('papel', public.operacao_papel(auth.uid()),
    'pessoa', (select to_jsonb(p) - 'email' from public.operacao_pessoas p where p.user_id = auth.uid() and p.ativo limit 1))
$$;
revoke execute on function public.operacao_eu() from public, anon;
grant execute on function public.operacao_eu() to authenticated;

create table if not exists public.compras_semanas (
  id uuid primary key default gen_random_uuid(),
  inicio date not null unique check (extract(isodow from inicio) = 1),   -- segunda-feira
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  fechada_em timestamptz,
  fechada_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.compras_listas (
  id uuid primary key default gen_random_uuid(),
  semana_id uuid not null references public.compras_semanas(id),
  pessoa_id uuid not null references public.operacao_pessoas(id),
  status text not null default 'aguardando' check (status in ('aguardando', 'em_revisao', 'aprovada')),
  pedido_texto text,                              -- o pedido como veio no grupo
  pedido_em timestamptz,
  analisada_em timestamptz,
  aprovada_em timestamptz,
  aprovada_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (semana_id, pessoa_id)
);

create table if not exists public.compras_itens (
  id bigint generated always as identity primary key,
  lista_id uuid not null references public.compras_listas(id),
  ordem int not null default 0,
  nome text not null,
  fornecedor text,
  unidade text,
  qtd_pedida numeric,                             -- o que veio no grupo
  qtd_sugerida numeric,                           -- o que a análise sugeriu
  motivo text,                                    -- por que a sugestão difere do pedido
  qtd numeric,                                    -- a quantidade final da pessoa
  preco numeric,                                  -- último preço pago (por unidade)
  removido boolean not null default false,
  incluido_na_revisao boolean not null default false,
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now()
);
create index if not exists compras_itens_lista on public.compras_itens (lista_id, ordem);

create table if not exists public.compras_itens_historico (
  id bigint generated always as identity primary key,
  item_id bigint not null,
  antes jsonb,
  depois jsonb,
  por uuid,
  quando timestamptz not null default now()
);

-- Lista única da semana, por fornecedor (a Fernanda edita; editado = a junção não sobrescreve)
create table if not exists public.compras_final (
  id bigint generated always as identity primary key,
  semana_id uuid not null references public.compras_semanas(id),
  fornecedor text not null default 'Sem fornecedor',
  nome text not null,
  unidade text not null default '',
  qtd numeric,
  preco numeric,
  origem jsonb not null default '[]',             -- [{pessoa, unidade, setor, qtd}]
  removido boolean not null default false,
  editado boolean not null default false,
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  unique (semana_id, fornecedor, nome, unidade)
);

-- Histórico de toda mudança de item (da pessoa ou da Fernanda)
create or replace function public.compras_registrar_mudanca()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_jsonb(old) - 'atualizado_em' - 'atualizado_por' is distinct from to_jsonb(new) - 'atualizado_em' - 'atualizado_por' then
    insert into public.compras_itens_historico (item_id, antes, depois, por)
    values (new.id, to_jsonb(old), to_jsonb(new), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists compras_itens_historico on public.compras_itens;
create trigger compras_itens_historico after update on public.compras_itens for each row execute function public.compras_registrar_mudanca();

-- Acesso: leitura por papel; escrita só pelas funções abaixo
alter table public.operacao_pessoas enable row level security;
alter table public.compras_semanas enable row level security;
alter table public.compras_listas enable row level security;
alter table public.compras_itens enable row level security;
alter table public.compras_itens_historico enable row level security;
alter table public.compras_final enable row level security;

drop policy if exists "ver" on public.operacao_pessoas;
create policy "ver" on public.operacao_pessoas for select using (
  user_id = auth.uid() or public.operacao_papel(auth.uid()) in ('socio', 'compras'));
drop policy if exists "ver" on public.compras_semanas;
create policy "ver" on public.compras_semanas for select using (public.operacao_papel(auth.uid()) is not null);
drop policy if exists "ver" on public.compras_listas;
create policy "ver" on public.compras_listas for select using (
  public.operacao_papel(auth.uid()) in ('socio', 'compras')
  or pessoa_id in (select id from public.operacao_pessoas where user_id = auth.uid()));
drop policy if exists "ver" on public.compras_itens;
create policy "ver" on public.compras_itens for select using (
  public.operacao_papel(auth.uid()) in ('socio', 'compras')
  or lista_id in (select l.id from public.compras_listas l join public.operacao_pessoas p on p.id = l.pessoa_id where p.user_id = auth.uid()));
drop policy if exists "ver" on public.compras_itens_historico;
create policy "ver" on public.compras_itens_historico for select using (public.operacao_papel(auth.uid()) in ('socio', 'compras'));
drop policy if exists "ver" on public.compras_final;
create policy "ver" on public.compras_final for select using (public.operacao_papel(auth.uid()) in ('socio', 'compras'));

do $$ declare t text; begin
  foreach t in array array['operacao_pessoas', 'compras_semanas', 'compras_listas', 'compras_itens', 'compras_itens_historico', 'compras_final'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table public.compras_listas; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.compras_itens; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Semana: a segunda-feira da data (Fortaleza); cria se não existir
-- ---------------------------------------------------------------------
create or replace function public.compras_semana_de(p_data date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ini date; v_id uuid;
begin
  v_ini := coalesce(p_data, (now() at time zone 'America/Fortaleza')::date);
  v_ini := v_ini - (extract(isodow from v_ini)::int - 1);
  insert into public.compras_semanas (inicio) values (v_ini) on conflict (inicio) do nothing;
  select id into v_id from public.compras_semanas where inicio = v_ini;
  return v_id;
end $$;
revoke execute on function public.compras_semana_de(date) from public, anon, authenticated;

-- Pode mexer na lista? A dona (enquanto não aprovou) ou compras/sócio (sempre, até fechar a semana)
create or replace function public.compras_pode_editar(p_lista uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.compras_listas l join public.compras_semanas s on s.id = l.semana_id
    join public.operacao_pessoas p on p.id = l.pessoa_id
    where l.id = p_lista and s.status = 'aberta'
      and (public.operacao_papel(auth.uid()) in ('socio', 'compras') or (p.user_id = auth.uid() and l.status <> 'aprovada')))
$$;
revoke execute on function public.compras_pode_editar(uuid) from public, anon, authenticated;

create or replace function public.compras_item_salvar(p_item bigint, p_nome text, p_fornecedor text, p_unidade text,
  p_qtd numeric, p_preco numeric, p_removido boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lista uuid;
begin
  select lista_id into v_lista from public.compras_itens where id = p_item;
  if v_lista is null or not public.compras_pode_editar(v_lista) then
    raise exception 'Esta lista não pode mais ser mudada.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O item precisa de um nome.'; end if;
  if p_qtd < 0 or p_preco < 0 then raise exception 'Quantidade e preço não podem ser negativos.'; end if;
  update public.compras_itens set nome = trim(p_nome), fornecedor = nullif(trim(p_fornecedor), ''), unidade = nullif(trim(p_unidade), ''),
    qtd = p_qtd, preco = p_preco, removido = coalesce(p_removido, removido), atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_item;
  update public.compras_listas set status = 'em_revisao' where id = v_lista and status = 'aguardando';
end $$;
revoke execute on function public.compras_item_salvar(bigint, text, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.compras_item_salvar(bigint, text, text, text, numeric, numeric, boolean) to authenticated;

create or replace function public.compras_item_incluir(p_lista uuid, p_nome text, p_fornecedor text, p_unidade text,
  p_qtd numeric, p_preco numeric)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.compras_pode_editar(p_lista) then raise exception 'Esta lista não pode mais ser mudada.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O item precisa de um nome.'; end if;
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Informe a quantidade.'; end if;
  insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd, preco, incluido_na_revisao, atualizado_por)
  values (p_lista, coalesce((select max(ordem) + 1 from public.compras_itens where lista_id = p_lista), 0), trim(p_nome),
    nullif(trim(p_fornecedor), ''), nullif(trim(p_unidade), ''), p_qtd, p_preco, true, auth.uid())
  returning id into v_id;
  update public.compras_listas set status = 'em_revisao' where id = p_lista and status = 'aguardando';
  return v_id;
end $$;
revoke execute on function public.compras_item_incluir(uuid, text, text, text, numeric, numeric) from public, anon;
grant execute on function public.compras_item_incluir(uuid, text, text, text, numeric, numeric) to authenticated;

create or replace function public.compras_lista_aprovar(p_lista uuid, p_aprovar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_aprovar then
    if not public.compras_pode_editar(p_lista) then raise exception 'Esta lista não pode ser aprovada agora.' using errcode = '42501'; end if;
    update public.compras_listas set status = 'aprovada', aprovada_em = now(), aprovada_por = auth.uid() where id = p_lista;
  else
    -- Reabrir para a pessoa mexer de novo: só compras ou sócio
    if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras reabre uma lista.' using errcode = '42501'; end if;
    update public.compras_listas set status = 'em_revisao', aprovada_em = null, aprovada_por = null where id = p_lista;
  end if;
end $$;
revoke execute on function public.compras_lista_aprovar(uuid, boolean) from public, anon;
grant execute on function public.compras_lista_aprovar(uuid, boolean) to authenticated;

-- Junta as listas aprovadas na lista única, somando o mesmo item do mesmo fornecedor e unidade.
-- Linhas já editadas pela Fernanda ficam como ela deixou.
create or replace function public.compras_consolidar(p_semana uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras junta a lista.' using errcode = '42501'; end if;
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  with soma as (
    select coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') fornecedor, trim(i.nome) nome, coalesce(lower(trim(i.unidade)), '') unidade,
      sum(i.qtd) qtd, max(i.preco) preco,
      jsonb_agg(jsonb_build_object('pessoa', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'qtd', i.qtd) order by p.unidade, p.setor) origem
    from public.compras_itens i join public.compras_listas l on l.id = i.lista_id join public.operacao_pessoas p on p.id = l.pessoa_id
    where l.semana_id = p_semana and l.status = 'aprovada' and not i.removido and coalesce(i.qtd, 0) > 0
    group by 1, 2, 3
  )
  insert into public.compras_final as f (semana_id, fornecedor, nome, unidade, qtd, preco, origem, atualizado_por)
  select p_semana, fornecedor, nome, unidade, qtd, preco, origem, auth.uid() from soma
  on conflict (semana_id, fornecedor, nome, unidade) do update set
    qtd = case when f.editado then f.qtd else excluded.qtd end,
    preco = case when f.editado then f.preco else excluded.preco end,
    origem = excluded.origem, atualizado_em = now();
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.compras_consolidar(uuid) from public, anon;
grant execute on function public.compras_consolidar(uuid) to authenticated;

create or replace function public.compras_final_salvar(p_id bigint, p_fornecedor text, p_nome text, p_unidade text,
  p_qtd numeric, p_preco numeric, p_removido boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras edita a lista única.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O item precisa de um nome.'; end if;
  update public.compras_final set fornecedor = coalesce(nullif(trim(p_fornecedor), ''), 'Sem fornecedor'), nome = trim(p_nome),
    unidade = coalesce(lower(trim(p_unidade)), ''), qtd = p_qtd, preco = p_preco, removido = coalesce(p_removido, removido),
    editado = true, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_id and semana_id in (select id from public.compras_semanas where status = 'aberta');
end $$;
revoke execute on function public.compras_final_salvar(bigint, text, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.compras_final_salvar(bigint, text, text, text, numeric, numeric, boolean) to authenticated;

create or replace function public.compras_final_incluir(p_semana uuid, p_fornecedor text, p_nome text, p_unidade text,
  p_qtd numeric, p_preco numeric)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras edita a lista única.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(p_qtd, 0) <= 0 then raise exception 'Informe o nome e a quantidade.'; end if;
  insert into public.compras_final (semana_id, fornecedor, nome, unidade, qtd, preco, editado, atualizado_por)
  values (p_semana, coalesce(nullif(trim(p_fornecedor), ''), 'Sem fornecedor'), trim(p_nome), coalesce(lower(trim(p_unidade)), ''), p_qtd, p_preco, true, auth.uid())
  on conflict (semana_id, fornecedor, nome, unidade) do update set qtd = excluded.qtd, preco = excluded.preco, removido = false, editado = true
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.compras_final_incluir(uuid, text, text, text, numeric, numeric) from public, anon;
grant execute on function public.compras_final_incluir(uuid, text, text, text, numeric, numeric) to authenticated;

create or replace function public.compras_semana_fechar(p_semana uuid, p_fechar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras fecha a semana.' using errcode = '42501'; end if;
  update public.compras_semanas set status = case when p_fechar then 'fechada' else 'aberta' end,
    fechada_em = case when p_fechar then now() end, fechada_por = case when p_fechar then auth.uid() end
  where id = p_semana;
end $$;
revoke execute on function public.compras_semana_fechar(uuid, boolean) from public, anon;
grant execute on function public.compras_semana_fechar(uuid, boolean) to authenticated;

-- A semana atual (cria na primeira abertura da página por compras/sócio)
create or replace function public.compras_semana_atual()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) is null then raise exception 'Sem acesso às compras' using errcode = '42501'; end if;
  return public.compras_semana_de(null);
end $$;
revoke execute on function public.compras_semana_atual() from public, anon;
grant execute on function public.compras_semana_atual() to authenticated;

-- ---------------------------------------------------------------------
-- Pessoas: sócios cadastram o e-mail; o convite sai pela Edge Function operacao-convidar
-- ---------------------------------------------------------------------
create or replace function public.operacao_pessoa_salvar(p_id uuid, p_nome text, p_unidade text, p_setor text, p_papel text,
  p_email text, p_wa_nome text, p_ativo boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.operacao_papel(auth.uid()) <> 'socio' then raise exception 'Só os sócios cadastram pessoas.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome.'; end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if p_id is null then
    insert into public.operacao_pessoas (nome, unidade, setor, papel, email, wa_nome, ativo)
    values (trim(p_nome), nullif(p_unidade, ''), nullif(p_setor, ''), coalesce(p_papel, 'solicitante'), nullif(lower(trim(p_email)), ''),
      nullif(trim(p_wa_nome), ''), coalesce(p_ativo, true)) returning id into v_id;
  else
    update public.operacao_pessoas set nome = trim(p_nome), unidade = nullif(p_unidade, ''), setor = nullif(p_setor, ''),
      papel = coalesce(p_papel, papel), email = nullif(lower(trim(p_email)), ''), wa_nome = nullif(trim(p_wa_nome), ''),
      ativo = coalesce(p_ativo, ativo)
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.operacao_pessoa_salvar(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.operacao_pessoa_salvar(uuid, text, text, text, text, text, text, boolean) to authenticated;

-- Chamada pela Edge Function depois de criar o convite (service role)
create or replace function public.operacao_pessoa_convidada(p_pessoa uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.operacao_pessoas set user_id = p_user, convidado_em = now() where id = p_pessoa
$$;
revoke execute on function public.operacao_pessoa_convidada(uuid, uuid) from public, anon, authenticated;
grant execute on function public.operacao_pessoa_convidada(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Nota avulsa também pelos solicitantes e pela Fernanda (área de Compras)
-- ---------------------------------------------------------------------
create or replace function public.notas_pode_lancar(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.operacao_pessoas where user_id = p_user and ativo)
$$;
revoke execute on function public.notas_pode_lancar(uuid) from public, anon;
grant execute on function public.notas_pode_lancar(uuid) to authenticated;

drop policy if exists "notas avulsas enviar" on storage.objects;
create policy "notas avulsas enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'notas-avulsas' and public.notas_pode_lancar(auth.uid()));

create or replace function public.notas_lancar_avulsa(p_empresa text, p_loja text, p_data date, p_valor numeric,
  p_itens jsonb, p_foto text, p_observacao text)
returns text language plpgsql security definer set search_path = public as $$
declare v_chave text := 'AVULSA-' || gen_random_uuid(); i jsonb; k int := 0;
begin
  if not public.notas_pode_lancar(auth.uid()) then raise exception 'Sem acesso para lançar notas' using errcode = '42501'; end if;
  if coalesce(trim(p_loja), '') = '' then raise exception 'Informe onde foi a compra.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor total da compra.'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Inclua pelo menos um item.'; end if;
  insert into public.notas (chave, empresa_cnpj, origem, emitente_nome, emissao, valor, completa, resumo, foto, observacao, lancada_por)
  values (v_chave, coalesce(nullif(p_empresa, ''), '-'), 'avulsa', trim(p_loja), coalesce(p_data, current_date)::timestamptz,
    p_valor, true, '{}', nullif(p_foto, ''), nullif(trim(p_observacao), ''), auth.uid());
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    if coalesce(trim(i->>'descricao'), '') = '' then raise exception 'O item % está sem nome.', k; end if;
    insert into public.notas_itens (chave, n_item, descricao, unidade, quantidade, valor_total, valor_unitario)
    values (v_chave, k, trim(i->>'descricao'), nullif(trim(i->>'unidade'), ''), (i->>'quantidade')::numeric,
      (i->>'valor_total')::numeric,
      case when coalesce((i->>'quantidade')::numeric, 0) > 0 then (i->>'valor_total')::numeric / (i->>'quantidade')::numeric end);
  end loop;
  return v_chave;
end $$;
revoke execute on function public.notas_lancar_avulsa(text, text, date, numeric, jsonb, text, text) from public, anon;
grant execute on function public.notas_lancar_avulsa(text, text, date, numeric, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Conector: o Claude lê a semana e grava a lista sugerida de cada pessoa
-- ---------------------------------------------------------------------
create or replace function public.mcp_compras_semana(p_token text, p_data date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_sem uuid;
begin
  select * into a from public.mcp_auth(p_token);
  if public.operacao_papel(a.o_user) <> 'socio' then raise exception 'Sem acesso às compras (só os sócios)' using errcode = '42501'; end if;
  v_sem := public.compras_semana_de(p_data);
  return jsonb_build_object(
    'semana', (select to_jsonb(s) from public.compras_semanas s where s.id = v_sem),
    'pessoas', (select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'papel', p.papel,
        'nome_no_whatsapp', p.wa_nome, 'tem_login', p.user_id is not null,
        'lista', (select jsonb_build_object('id', l.id, 'status', l.status, 'itens', (select count(*) from public.compras_itens i where i.lista_id = l.id and not i.removido))
                  from public.compras_listas l where l.semana_id = v_sem and l.pessoa_id = p.id))
        order by p.unidade, p.setor) from public.operacao_pessoas p where p.ativo),
    'final', (select count(*) from public.compras_final f where f.semana_id = v_sem and not f.removido),
    'como_fazer', 'Pedidos do grupo COMPRAS de segunda (whatsapp_mensagens, grupo COMPRAS, autor = nome_no_whatsapp). Para cada pessoa: compare o pedido com as notas (notas_consultar, precos_consultar), as vendas da TOTVS e as semanas anteriores; grave com compras_gravar_lista: qtd_pedida = o que veio no grupo, qtd_sugerida e motivo quando discordar, preco = último preço pago. Ignore pedidos de outras unidades e de material de limpeza que não forem da pessoa.');
end $$;
revoke execute on function public.mcp_compras_semana(text, date) from public, authenticated;
grant execute on function public.mcp_compras_semana(text, date) to anon;

-- p_itens: [{nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, preco}]
-- Lista já com itens: só substitui com p_substituir (os antigos ficam como removidos).
create or replace function public.mcp_compras_gravar_lista(p_token text, p_pessoa uuid, p_itens jsonb, p_pedido_texto text default null,
  p_data date default null, p_substituir boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_sem uuid; v_lista uuid; v_status text; i jsonb; k int := 0;
begin
  select * into a from public.mcp_auth(p_token);
  if public.operacao_papel(a.o_user) <> 'socio' then raise exception 'Sem acesso às compras (só os sócios)' using errcode = '42501'; end if;
  if not exists (select 1 from public.operacao_pessoas where id = p_pessoa and ativo) then raise exception 'Pessoa não encontrada.'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'A lista precisa de pelo menos um item.'; end if;
  v_sem := public.compras_semana_de(p_data);
  if (select status from public.compras_semanas where id = v_sem) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  insert into public.compras_listas (semana_id, pessoa_id) values (v_sem, p_pessoa) on conflict (semana_id, pessoa_id) do nothing;
  select id, status into v_lista, v_status from public.compras_listas where semana_id = v_sem and pessoa_id = p_pessoa;
  if v_status = 'aprovada' then raise exception 'Esta lista já foi aprovada pela pessoa.'; end if;
  if exists (select 1 from public.compras_itens where lista_id = v_lista and not removido) then
    if not p_substituir then raise exception 'A lista já tem itens. Use substituir para trocar a sugestão.'; end if;
    update public.compras_itens set removido = true, atualizado_por = a.o_user, atualizado_em = now() where lista_id = v_lista and not removido;
  end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco, atualizado_por)
    values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
      (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
      coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric, a.o_user);
  end loop;
  update public.compras_listas set status = 'em_revisao', analisada_em = now(),
    pedido_texto = coalesce(nullif(p_pedido_texto, ''), pedido_texto) where id = v_lista;
  return jsonb_build_object('lista', v_lista, 'itens', k);
end $$;
revoke execute on function public.mcp_compras_gravar_lista(text, uuid, jsonb, text, date, boolean) from public, authenticated;
grant execute on function public.mcp_compras_gravar_lista(text, uuid, jsonb, text, date, boolean) to anon;
