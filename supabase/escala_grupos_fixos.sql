-- Grupos fixos da escala (09/11/2026, pedido do dono): setores que ainda não existem no RHiD, criados à mão
-- (Sempre Vivo · Reservas e Sempre Vivo · Financeiro). Aparecem vazios na grade da página Escala para receber
-- gente (no Organizar, arrastar a pessoa para o grupo) e nunca são arquivados por ficarem sem ninguém.
alter table public.escala_grupos add column if not exists fixo boolean not null default false;

insert into public.escala_grupos (nome, local, setor, fixo)
select v.nome, 'Sempre Vivo', v.setor, true from (values ('Sempre Vivo · Reservas', 'Reservas'), ('Sempre Vivo · Financeiro', 'Financeiro')) v(nome, setor)
where not exists (select 1 from public.escala_grupos g where g.local = 'Sempre Vivo' and g.setor = v.setor);
update public.escala_grupos set fixo = true, arquivado_em = null where local = 'Sempre Vivo' and setor in ('Reservas', 'Financeiro');

create or replace function public.escala_arquivar_vazios()
returns int language sql security definer set search_path = public as $$
  with x as (
    update public.escala_grupos g set arquivado_em = now()
    where g.arquivado_em is null and not g.fixo
      and not exists (select 1 from public.escala_membros m
                      join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id and p.situacao = 1 and p.presente
                      where m.grupo_id = g.id)
      and not exists (select 1 from public.escala_membros m join public.escala_extras e on m.cliente_id = 0 and e.id = m.pessoa_id and e.situacao = 'na_escala'
                      where m.grupo_id = g.id)
      and not exists (select 1 from public.escala_lideres l where l.grupo_id = g.id and l.arquivado_em is null)
    returning 1)
  select count(*)::int from x
$$;
revoke execute on function public.escala_arquivar_vazios() from public, anon, authenticated;

create or replace function public.escala_grupos_fixos()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.rhid_pode_ver(auth.uid()) then
    (select coalesce(jsonb_agg(jsonb_build_object('local', local, 'setor', setor) order by local, setor), '[]') from public.escala_grupos where fixo and arquivado_em is null)
  else '[]'::jsonb end
$$;
revoke execute on function public.escala_grupos_fixos() from public, anon;
grant execute on function public.escala_grupos_fixos() to authenticated;
