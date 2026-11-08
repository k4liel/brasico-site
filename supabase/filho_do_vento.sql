-- =====================================================================
-- Hotel Filho do Vento Kite Lodge (CNPJ 39.988.182/0001-96) — 08/11/2026, a pedido do dono.
-- Página /hoteis/filho-do-vento (grupo Hotéis do menu) e leitura do PMS pelo robô (propriedade 1490).
-- O documento da página começa vazio (as abas Visão geral, Reservas, Mapa, Hóspedes e Transações vêm do PMS).
-- =====================================================================

insert into public.hoteis (id, nome, ordem, css)
values ('filho-do-vento', 'Filho do Vento', 3, '')
on conflict (id) do nothing;

insert into public.pms_hoteis (id, cnpj, nome, ativa, ordem, tenant_id, property_id)
values ('filho-do-vento', '39988182000196', 'Filho do Vento Kite Lodge', true, 3, '734a6d31-f23c-4242-8689-8f797f085f9d', 1490)
on conflict (id) do update set cnpj = excluded.cnpj, nome = excluded.nome, ativa = true, tenant_id = excluded.tenant_id, property_id = excluded.property_id;
