-- Cicchetti Ponta Negra na TOTVS (20/11/2026)
-- O dono contou que a loja 20 da TOTVS (o antigo Cicchetti Midway, encerrado em 31/10/2026) foi renomeada para Ponta Negra.
-- Ponta Negra entra como unidade nova; o Midway continua só como arquivo até 31/10/2026 (nada muda nele).
-- As agendas (totvs-ao-vivo, totvs-diario) leem sozinhas toda unidade ativa com loja e sem encerrada_em.

insert into public.totvs_unidades (id, nome, loja, chave, ativa, ordem)
select 'ponta_negra', 'Cicchetti Ponta Negra', 20, chave, true, 5
from public.totvs_unidades where id = 'midway'
on conflict (id) do nothing;

-- mesmo número de série da loja 20 (copiado dentro do Vault, sem sair do banco)
select vault.create_secret(
  (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_serial_midway'),
  'totvs_serial_ponta_negra',
  'Serial TOTVS da loja 20 (Ponta Negra; antes Midway)')
where not exists (select 1 from vault.secrets where name = 'totvs_serial_ponta_negra');

-- histórico parado: antes de novembro a loja 20 era o Midway (não copiar as vendas dele para Ponta Negra)
insert into public.totvs_historico (unidade_id, cursor, parado, motivo)
values ('ponta_negra', date '2026-10-31', true, 'Antes de 01/11/2026 a loja 20 era o Cicchetti Midway (arquivo).')
on conflict (unidade_id) do nothing;

-- Enquanto o caixa de Ponta Negra não manda as vendas para o Chef Web (20/11/2026: o painel do Chef Web mostrava
-- a loja 20 com R$ 0,00 em novembro e a fila de mensagens vazia), relê sozinho os dias de novembro que ficaram
-- sem movimento: um dia por vez, cada dia no máximo a cada 6 h; para em 31/12/2026.
create or replace function public.totvs_ponta_negra_reler()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_dia date; v_ontem date := (now() at time zone 'America/Fortaleza')::date - 1;
begin
  if v_ontem > date '2026-12-31' then return; end if;
  if exists (select 1 from public.totvs_execucoes e where e.unidade_id = 'ponta_negra'
             and e.status in ('na_fila', 'rodando') and e.created_at > now() - interval '5 minutes') then return; end if;
  select g.d::date into v_dia
  from generate_series(date '2026-11-01', v_ontem, interval '1 day') g(d)
  left join public.totvs_dias t on t.unidade_id = 'ponta_negra' and t.dia = g.d::date
  where (t.dia is null or t.status = 'sem_movimento')
    and not exists (select 1 from public.totvs_execucoes e where e.unidade_id = 'ponta_negra' and e.dia = g.d::date
                    and e.created_at > now() - interval '6 hours')
  order by g.d desc limit 1;
  if v_dia is not null then perform public.totvs_pedir('ponta_negra', v_dia, 'agenda', null); end if;
end $$;
revoke all on function public.totvs_ponta_negra_reler() from public, anon, authenticated;

select cron.schedule('totvs-ponta-negra-reler', '*/15 * * * *', $$ select public.totvs_ponta_negra_reler() $$);
