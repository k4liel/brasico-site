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
