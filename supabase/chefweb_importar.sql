-- Importação do cadastro de produtos do Chef Web feita do navegador do sócio (22/11/2026; ver supabase/totvs_cadastro_conferencia.sql).
-- Chave temporária: só o hash fica no banco; vale 3 horas. Criar:
--   with c as (select encode(extensions.gen_random_bytes(24), 'hex') chave)
--   insert into public.chefweb_importacao_chaves (chave_hash, expira_em)
--   select encode(extensions.digest(chave, 'sha256'), 'hex'), now() + interval '3 hours' from c returning (select chave from c);
-- Vencer no fim: update public.chefweb_importacao_chaves set expira_em = now() where expira_em > now();
create table if not exists public.chefweb_importacao_chaves (
  chave_hash text primary key,
  expira_em timestamptz not null,
  criada_em timestamptz not null default now()
);
alter table public.chefweb_importacao_chaves enable row level security;
revoke all on public.chefweb_importacao_chaves from public, anon, authenticated;

-- chefweb_importar_produtos(p_chave, p_loja_codigo, p_loja_nome, p_produtos jsonb) → int: confere a chave (hash e validade) e
-- grava cada produto em totvs_produtos_cadastro (mesmos campos de chefweb_robo_gravar, tipo 'produtos'). Execute só para anon.
-- (corpo aplicado no banco pela migração chefweb_importar)
