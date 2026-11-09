-- Acesso à Operação completa para quem não é sócio (09/11/2026; primeiro caso: a Karina).
-- A pessoa fica com o papel 'compras' (gestora das Compras, como a Fernanda) e, com
-- operacao_completa ligada, também abre Fichas técnicas, Câmara fria e Produção.
-- O projeto "Produção Sempre Vivo" é liberado à parte, como membro do projeto (workspace_members).

alter table public.operacao_pessoas add column if not exists operacao_completa boolean not null default false;

create or replace function public.operacao_completa(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.operacao_pessoas where user_id = p_user and ativo and operacao_completa)
$$;
revoke all on function public.operacao_completa(uuid) from public;
grant execute on function public.operacao_completa(uuid) to authenticated;

-- Quem pode ver e editar as fichas técnicas: sócios e quem tem a Operação completa
create or replace function public.fichas_pode(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.notas_pode_ver(p_user) or public.operacao_completa(p_user)
$$;
revoke all on function public.fichas_pode(uuid) from public;
grant execute on function public.fichas_pode(uuid) to authenticated;

-- Câmara fria e Produção (estoque_pode é a regra das duas)
create or replace function public.estoque_pode(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.operacao_pessoas
    where user_id = p_user and ativo and (registra_estoque or papel = 'estoque' or operacao_completa))
$$;

-- Funções das fichas: trocar a checagem de sócio pela de fichas
do $$
declare r record; v text;
begin
  for r in select p.oid, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname ~ '^(fichas|insumos|menus)' and p.proname <> 'fichas_pode'
             and p.prosrc like '%notas_pode_ver(auth.uid())%' loop
    v := replace(r.d, 'public.notas_pode_ver(auth.uid())', 'public.fichas_pode(auth.uid())');
    execute v;
  end loop;
end $$;

-- Leitura das tabelas das fichas
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
           and tablename ~ '^(fichas|insumos|menus)' and cmd = 'SELECT' and qual = 'notas_pode_ver(auth.uid())' loop
    execute format('alter policy %I on public.%I using (public.fichas_pode(auth.uid()))', r.policyname, r.tablename);
  end loop;
end $$;

-- Fotos das fichas (bucket privado fichas-fotos)
alter policy "fichas fotos ver" on storage.objects using (bucket_id = 'fichas-fotos' and public.fichas_pode(auth.uid()));
alter policy "fichas fotos enviar" on storage.objects with check (bucket_id = 'fichas-fotos' and public.fichas_pode(auth.uid()));

-- A Karina: gestora das Compras, Operação completa e o projeto Produção Sempre Vivo
update public.operacao_pessoas set papel = 'compras', operacao_completa = true, registra_estoque = true
  where id = '81c13b9a-5e08-4141-b35e-2651817239dd';
insert into public.workspace_members (workspace_id, user_id, role)
  select 'fe1c924f-37c0-45fa-a800-8785ad7dc1e5', user_id, 'member' from public.operacao_pessoas
  where id = '81c13b9a-5e08-4141-b35e-2651817239dd' and user_id is not null
  on conflict do nothing;
