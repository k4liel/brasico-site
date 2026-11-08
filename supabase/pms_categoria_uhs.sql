-- =====================================================================
-- PMS dos hotéis: quantidade real de UHs por tipo — 08/11/2026.
-- No Filha da Lua existe só uma Casa Grande, mas o PMS tem duas UHs desse tipo (10, ativa, e 10B, desativada,
-- criada em 06/2024), e o relatório "Disponibilidade e KPIs por Categoria e Dia" conta as duas no total e nas
-- disponíveis: ocupação e RevPAR saíam menores. Esta tabela diz quantas UHs o tipo tem de verdade; a visão
-- pms_kpi_dia_ajustado limita o total e as disponíveis a esse número (nunca abaixo das ocupadas do dia).
-- Os dados lidos do PMS (pms_kpi_dia) ficam como vieram. Quem vê: os sócios. Nada se apaga.
-- =====================================================================

create table if not exists public.pms_categoria_uhs (
  hotel_id text not null references public.pms_hoteis(id),
  categoria text not null,
  uhs int not null check (uhs >= 0),
  motivo text,
  criado_em timestamptz not null default now(),
  primary key (hotel_id, categoria)
);
alter table public.pms_categoria_uhs enable row level security;
drop policy if exists "socios veem" on public.pms_categoria_uhs;
create policy "socios veem" on public.pms_categoria_uhs for select using (public.notas_pode_ver(auth.uid()));
grant select on public.pms_categoria_uhs to authenticated;
do $$
begin
  execute 'drop trigger if exists pms_categoria_uhs_sem_exclusao on public.pms_categoria_uhs';
  execute 'create trigger pms_categoria_uhs_sem_exclusao before delete on public.pms_categoria_uhs for each row execute function public.bloquear_exclusao()';
end $$;

insert into public.pms_categoria_uhs (hotel_id, categoria, uhs, motivo)
values ('filha-da-lua', 'Casa Grande', 1, 'Só existe uma Casa Grande; a UH 10B (desativada) é duplicata no PMS')
on conflict (hotel_id, categoria) do update set uhs = excluded.uhs, motivo = excluded.motivo;

create or replace view public.pms_kpi_dia_ajustado with (security_invoker = true) as
select k.hotel_id, k.dia, k.categoria,
       case when c.uhs is null then k.disponiveis else greatest(least(k.disponiveis, c.uhs), k.ocupadas) end as disponiveis,
       case when c.uhs is null then k.bloqueadas else least(k.bloqueadas, c.uhs) end as bloqueadas,
       case when c.uhs is null then k.total else greatest(least(k.total, c.uhs), k.ocupadas) end as total,
       k.ocupadas, k.receita
from public.pms_kpi_dia k
left join public.pms_categoria_uhs c on c.hotel_id = k.hotel_id and c.categoria = k.categoria;
grant select on public.pms_kpi_dia_ajustado to authenticated;

create or replace view public.pms_dia_hotel with (security_invoker = true) as
select hotel_id, dia,
       sum(disponiveis) as disponiveis, sum(bloqueadas) as bloqueadas, sum(total) as total, sum(ocupadas) as ocupadas, sum(receita) as receita,
       round(100.0 * sum(ocupadas)::numeric / nullif(sum(total), 0)::numeric, 2) as ocupacao,
       round(100.0 * sum(ocupadas)::numeric / nullif(sum(disponiveis), 0)::numeric, 2) as ocupacao_disponiveis,
       round(sum(receita) / nullif(sum(ocupadas), 0)::numeric, 2) as diaria_media,
       round(sum(receita) / nullif(sum(disponiveis), 0)::numeric, 2) as revpar
from public.pms_kpi_dia_ajustado
where dia < (now() at time zone 'America/Fortaleza')::date
group by hotel_id, dia;
