-- =====================================================================
-- PMS dos hotéis: todas as transações (lançamentos) — 08/11/2026.
-- Fonte: relatório Metabase 4 "Lançamentos por Período (Analítico)" do PMS, lido mês a mês pelo robô
-- (robos/pms-navegador/robo.mjs, relatório "transacoes"): cada diária, serviço, consumo, pagamento e estorno.
-- NÃO se copiam: nome, CPF/CNPJ, e-mail e telefone de hóspede ou contato (o relatório traz; o robô descarta).
-- Sem id no PMS: a chave é um resumo (hash) dos campos do lançamento + a ordem quando há lançamentos iguais.
-- Quem vê: os sócios (notas_pode_ver). Nada se apaga.
-- =====================================================================

alter table public.pms_hist_meses drop constraint if exists pms_hist_meses_relatorio_check;
alter table public.pms_hist_meses add constraint pms_hist_meses_relatorio_check
  check (relatorio in ('kpi', 'reservas', 'recebimentos', 'transacoes'));

create table if not exists public.pms_transacoes (
  hotel_id text not null references public.pms_hoteis(id),
  chave text not null,
  dia date not null,                 -- data do lançamento
  reserva text,                      -- código da reserva no PMS (liga com pms_estadias.codigo)
  uh text,
  tipo_uh text,
  status_reserva text,
  origem text,                       -- origem da reserva (Particular, Booking...)
  segmento text,
  tarifa text,
  pernoites int,
  chegada date,
  partida date,
  conta_tipo text,                   -- Guest, Company...
  item_tipo text,                    -- Daily (diária), Service, Type Of Payment, Tax...
  grupo text,                        -- classificação do Brasico: Diária, Serviço, Pagamento, Taxa, Outros
  codigo text,                       -- código reduzido do lançamento
  descricao text,
  valor numeric(14,2) not null,
  estornado boolean not null default false,
  observacao text,
  mes_ref date not null,
  lido_em timestamptz not null default now(),
  primary key (hotel_id, chave)
);
create index if not exists pms_transacoes_dia_idx on public.pms_transacoes (hotel_id, dia);
create index if not exists pms_transacoes_reserva_idx on public.pms_transacoes (hotel_id, reserva);

do $$
begin
  execute 'drop trigger if exists pms_transacoes_sem_exclusao on public.pms_transacoes';
  execute 'create trigger pms_transacoes_sem_exclusao before delete on public.pms_transacoes for each row execute function public.bloquear_exclusao()';
  execute 'drop trigger if exists pms_transacoes_sem_truncate on public.pms_transacoes';
  execute 'create trigger pms_transacoes_sem_truncate before truncate on public.pms_transacoes for each statement execute function public.bloquear_exclusao()';
end $$;
alter table public.pms_transacoes enable row level security;
drop policy if exists "socios veem" on public.pms_transacoes;
create policy "socios veem" on public.pms_transacoes for select using (public.notas_pode_ver(auth.uid()));
grant select on public.pms_transacoes to authenticated;

create or replace function public.pms_robo_gravar_transacoes(p_segredo text, p_hotel text, p_mes date, p_linhas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; v_ini date := date_trunc('month', p_mes)::date;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.pms_hoteis where id = p_hotel) then raise exception 'hotel desconhecido'; end if;
  insert into public.pms_transacoes (hotel_id, chave, dia, reserva, uh, tipo_uh, status_reserva, origem, segmento, tarifa, pernoites,
    chegada, partida, conta_tipo, item_tipo, grupo, codigo, descricao, valor, estornado, observacao, mes_ref, lido_em)
  select p_hotel, x->>'chave', (x->>'dia')::date, x->>'reserva', x->>'uh', x->>'tipo_uh', x->>'status_reserva', x->>'origem', x->>'segmento',
         x->>'tarifa', (x->>'pernoites')::int, (x->>'chegada')::date, (x->>'partida')::date, x->>'conta_tipo', x->>'item_tipo', x->>'grupo',
         x->>'codigo', x->>'descricao', (x->>'valor')::numeric, coalesce((x->>'estornado')::boolean, false), left(x->>'observacao', 160), v_ini, now()
  from jsonb_array_elements(p_linhas) x
  where x->>'chave' is not null and x->>'dia' is not null and x->>'valor' is not null
  on conflict (hotel_id, chave) do update set reserva = excluded.reserva, uh = excluded.uh, tipo_uh = excluded.tipo_uh,
    status_reserva = excluded.status_reserva, origem = excluded.origem, segmento = excluded.segmento, tarifa = excluded.tarifa,
    pernoites = excluded.pernoites, chegada = excluded.chegada, partida = excluded.partida, conta_tipo = excluded.conta_tipo,
    item_tipo = excluded.item_tipo, grupo = excluded.grupo, codigo = excluded.codigo, descricao = excluded.descricao,
    estornado = excluded.estornado, observacao = excluded.observacao, lido_em = now();
  get diagnostics n = row_count;
  insert into public.pms_hist_meses (hotel_id, relatorio, mes, linhas, lido_em) values (p_hotel, 'transacoes', v_ini, n, now())
  on conflict (hotel_id, relatorio, mes) do update set linhas = excluded.linhas, lido_em = now();
  return n;
end $$;
revoke execute on function public.pms_robo_gravar_transacoes(text, text, date, jsonb) from public, authenticated;
grant execute on function public.pms_robo_gravar_transacoes(text, text, date, jsonb) to anon;

-- Resumo por dia e grupo (valor na visão do hotel: cobrança e pagamento positivos, estorno negativo)
create or replace view public.pms_transacoes_dia with (security_invoker = true) as
select hotel_id, dia, grupo,
       sum(case when grupo = 'Pagamento' then valor else -valor end) valor,
       count(*) lancamentos
from public.pms_transacoes
group by hotel_id, dia, grupo;
grant select on public.pms_transacoes_dia to authenticated;
