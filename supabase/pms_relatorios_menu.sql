-- =====================================================================
-- PMS dos hotéis: catálogo dos relatórios do PMS (ebs/report/api/MenuReports) — 08/11/2026.
-- O robô grava a lista a cada rodada (pms_robo_gravar_menu), para escolhermos o que trazer. Só leitura.
-- `usado` = relatório que o robô já lê (7408 KPIs, 364 Produção por Channel, 9 Resumo Financeiro, 4 Lançamentos).
-- =====================================================================

create table if not exists public.pms_relatorios_menu (
  hotel_id text not null references public.pms_hoteis(id),
  chave int not null,          -- metabaseKey
  nome text,
  grupo text,
  bruto jsonb,
  usado boolean not null default false,
  visto_em timestamptz not null default now(),
  primary key (hotel_id, chave)
);
alter table public.pms_relatorios_menu enable row level security;
drop policy if exists "socios veem" on public.pms_relatorios_menu;
create policy "socios veem" on public.pms_relatorios_menu for select using (public.notas_pode_ver(auth.uid()));
grant select on public.pms_relatorios_menu to authenticated;

create or replace function public.pms_robo_gravar_menu(p_segredo text, p_hotel text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.pms_relatorios_menu (hotel_id, chave, nome, grupo, bruto, usado, visto_em)
  select distinct on ((x->>'metabaseKey')::int) p_hotel, (x->>'metabaseKey')::int,
         coalesce(x->>'name', x->>'menuName', x->>'reportName', x->>'description', x->>'title'),
         coalesce(x->>'groupName', x->>'menuGroupName', x->>'category', x->>'parentName'),
         x, (x->>'metabaseKey')::int in (7408, 364, 9, 4), now()
  from jsonb_array_elements(coalesce(p_itens, '[]')) x where x->>'metabaseKey' is not null
  order by (x->>'metabaseKey')::int
  on conflict (hotel_id, chave) do update set nome = excluded.nome, grupo = excluded.grupo, bruto = excluded.bruto, usado = excluded.usado, visto_em = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.pms_robo_gravar_menu(text, text, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar_menu(text, text, jsonb) to anon;
