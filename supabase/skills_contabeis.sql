-- Skills contábeis (25/11/2026, pedido do dono): a Biblioteca PRO "Skills IA para Contadores", comprada pelo Kaliel,
-- copiada para o Brasico (2.078 skills em 27 áreas). Página própria /skills, fora de Hotels & Restaurants.
-- O conteúdo fica só no banco: nunca no GitHub (repositório público).
-- Leitura só para os sócios (notas_pode_ver). Ninguém grava pelo site.

create table if not exists public.skills_contabeis (
  area_slug text not null,
  area_nome text not null,
  numero integer not null,
  titulo text not null,
  descricao text,
  prompt text not null,
  quando_usar text,
  dicas text,
  importado_em timestamptz not null default now(),
  primary key (area_slug, numero)
);
alter table public.skills_contabeis enable row level security;
create index if not exists skills_contabeis_busca on public.skills_contabeis
  using gin (to_tsvector('portuguese', titulo || ' ' || coalesce(descricao, '')));

drop policy if exists "socios leem skills" on public.skills_contabeis;
create policy "socios leem skills" on public.skills_contabeis
  for select to authenticated using (public.notas_pode_ver(auth.uid()));

-- Lista leve (sem os prompts) numa chamada só: o Supabase devolve no máximo 1.000 linhas por consulta.
create or replace function public.skills_lista()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'a', area_slug, 'an', area_nome, 'n', numero, 't', titulo, 'd', descricao
  ) order by area_nome, numero), '[]'::jsonb)
  from public.skills_contabeis
$$;
revoke execute on function public.skills_lista() from public, anon;
grant execute on function public.skills_lista() to authenticated;

-- A primeira versão ficou na Operação do Filha da Lua (visão op_filha_da_lua.skills_contabeis, funções api_skills_*
-- e a tela "skills-contabeis"); saiu no mesmo dia, quando a página própria entrou.
drop view if exists op_filha_da_lua.skills_contabeis;
