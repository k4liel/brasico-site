-- =====================================================================
-- Robô do PMS: intervalo entre as rodadas guardado no banco — 08/11/2026.
-- O robô (robos/pms-navegador/robo.mjs) pergunta o intervalo a cada rodada; para mudar, basta atualizar
-- pms_robo_ajustes (sem reiniciar o robô). Rodadas variam de 75% a 125% do valor (30 min = entre 22 e 38 min).
-- =====================================================================

create table if not exists public.pms_robo_ajustes (
  id int primary key default 1 check (id = 1),
  intervalo_min int not null default 30 check (intervalo_min between 10 and 240),
  atualizado_em timestamptz not null default now()
);
alter table public.pms_robo_ajustes enable row level security;
drop policy if exists "socios veem" on public.pms_robo_ajustes;
create policy "socios veem" on public.pms_robo_ajustes for select using (public.notas_pode_ver(auth.uid()));
grant select on public.pms_robo_ajustes to authenticated;
insert into public.pms_robo_ajustes (id, intervalo_min) values (1, 30)
on conflict (id) do update set intervalo_min = excluded.intervalo_min, atualizado_em = now();

create or replace function public.pms_robo_intervalo(p_segredo text)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (select intervalo_min from public.pms_robo_ajustes where id = 1);
end $$;
revoke execute on function public.pms_robo_intervalo(text) from public, authenticated;
grant execute on function public.pms_robo_intervalo(text) to anon;
