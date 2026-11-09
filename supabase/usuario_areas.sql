-- Áreas por usuário (09/11/2026, pedido do dono): quem tem uma linha aqui só vê no menu e só abre
-- as áreas da lista; quem não tem linha (os sócios) vê tudo, como antes.
-- Áreas: projetos, brainstorm, whatsapp, totvs, rh (RH · eSocial e Escala), receita, certificados,
-- usuarios, conectar, hoteis, operacao (Notas, Compras, Fichas, Câmara fria, Produção).
-- O acesso aos dados de cada área continua nas tabelas *_acesso (totvs_acesso, esocial_acesso...).

create table if not exists public.usuario_areas (
  user_id uuid primary key references auth.users(id),
  areas text[] not null default '{}',
  criado_em timestamptz not null default now()
);
alter table public.usuario_areas enable row level security;
drop policy if exists "ver as proprias areas" on public.usuario_areas;
create policy "ver as proprias areas" on public.usuario_areas for select using (user_id = auth.uid());

-- null = sem restrição (vê tudo)
create or replace function public.minhas_areas()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select areas from public.usuario_areas where user_id = auth.uid()
$$;
revoke execute on function public.minhas_areas() from public, anon;
grant execute on function public.minhas_areas() to authenticated;

create or replace function public.area_restrita(p_user uuid, p_area text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuario_areas where user_id = p_user and not (p_area = any(areas)))
$$;

-- A página Usuários (criar logins, trocar senhas, líderes) fica fechada para quem não tem a área "usuarios",
-- mesmo sendo sócio pelo notas_acesso.
do $$
declare f text; d text;
begin
  foreach f in array array['usuarios_lista', 'usuarios_salvar', 'usuarios_escala_grupos'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f;
    if d not like '%area_restrita%' then
      d := replace(d, 'if coalesce(public.operacao_papel(auth.uid()), '''') <> ''socio'' then',
        'if public.area_restrita(auth.uid(), ''usuarios'') or coalesce(public.operacao_papel(auth.uid()), '''') <> ''socio'' then');
      execute d;
    end if;
  end loop;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'operacao_definir_login';
  if d not like '%area_restrita%' then
    d := replace(d, 'if auth.uid() is not null and not exists (select 1 from public.notas_acesso where user_id = auth.uid()) then',
      'if auth.uid() is not null and (public.area_restrita(auth.uid(), ''usuarios'') or not exists (select 1 from public.notas_acesso where user_id = auth.uid())) then');
    execute d;
  end if;
end $$;

-- Para restringir alguém (no SQL Editor):
-- insert into public.usuario_areas (user_id, areas) values ('<id do usuário>', array['totvs', 'rh'])
--   on conflict (user_id) do update set areas = excluded.areas;
