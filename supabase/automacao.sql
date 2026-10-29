-- =====================================================================
-- Operação · fase 6: automação
--  1. Análise de terça às 6h (Fortaleza): a Edge Function compras-analise lê o pedido de cada pessoa
--     no grupo COMPRAS (de terça passada às 6h até agora), consulta as compras anteriores
--     (notas da SEFAZ e Cicchetti Management) e grava a lista sugerida (em_revisao) para a pessoa
--     revisar e aprovar no site. Uma pessoa por chamada, a cada 10 min das 6h às 7h50 de terça.
--     Usa a API da Anthropic (ANTHROPIC_API_KEY nas Edge Functions). Cada análise fica em compras_analises.
--  2. Alertas de preço (precos_alertas): item de nota dos últimos 14 dias que custou 15% ou mais
--     acima da média das compras anteriores (mesma descrição, unidade e fornecedor, 120 dias).
--  3. Pendências da semana (compras_pendencias): quem ainda não pediu, não revisou ou não aprovou.
-- =====================================================================

create table if not exists public.compras_analises (
  id bigint generated always as identity primary key,
  semana_id uuid not null references public.compras_semanas(id),
  pessoa_id uuid not null references public.operacao_pessoas(id),
  status text not null check (status in ('analisando', 'ok', 'sem_pedido', 'pulada', 'falha')),
  mensagens int,
  itens int,
  erro text,
  uso jsonb,
  inicio timestamptz not null default now(),
  fim timestamptz
);
create index if not exists compras_analises_semana on public.compras_analises (semana_id, pessoa_id);
alter table public.compras_analises enable row level security;
drop policy if exists "ver" on public.compras_analises;
create policy "ver" on public.compras_analises for select using (public.operacao_papel(auth.uid()) in ('socio', 'compras'));
revoke all on public.compras_analises from public, anon, authenticated;
grant select on public.compras_analises to authenticated;
drop trigger if exists compras_analises_sem_exclusao on public.compras_analises;
create trigger compras_analises_sem_exclusao before delete on public.compras_analises for each row execute function public.bloquear_exclusao();

-- Segredo da chamada (pg_cron → Edge Function), só no Vault
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'compras_segredo') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'compras_segredo');
  end if;
end $$;

create or replace function public.compras_conferir_segredo(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'compras_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.compras_conferir_segredo(text) from public, anon, authenticated;
grant execute on function public.compras_conferir_segredo(text) to service_role;

-- Próxima pessoa a analisar na semana (com nome no WhatsApp, sem análise feita, lista não aprovada)
create or replace function public.compras_auto_proxima(p_semana uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  -- análise presa há mais de 15 min conta como falha (tenta de novo, no máximo 2 falhas por pessoa)
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and status = 'analisando' and inicio < now() - interval '15 minutes';
  select o.* into p from public.operacao_pessoas o
  where o.ativo and o.papel = 'solicitante' and coalesce(trim(o.wa_nome), '') <> ''
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
      and a.status in ('analisando', 'ok', 'sem_pedido', 'pulada'))
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id and a.status = 'falha') < 2
    and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status = 'aprovada')
  order by o.unidade, o.setor, o.nome limit 1;
  if p.id is null then return null; end if;
  return to_jsonb(p) - 'email';
end $$;
revoke execute on function public.compras_auto_proxima(uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_proxima(uuid) to service_role;

-- Ferramenta do modelo: compras anteriores parecidas (notas da SEFAZ e Cicchetti Management, 120 dias)
create or replace function public.compras_auto_buscar(p_busca text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_padrao text[];
begin
  v_padrao := array(select '%' || w || '%' from regexp_split_to_table(lower(trim(coalesce(p_busca, ''))), '\s+') w where length(w) >= 3);
  if coalesce(array_length(v_padrao, 1), 0) = 0 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x->>'data' desc) from (
    (select jsonb_build_object('data', n.emissao::date, 'fonte', 'nota', 'fornecedor', n.emitente_nome, 'descricao', i.descricao,
        'unidade', i.unidade, 'quantidade', i.quantidade, 'preco', round(i.preco_efetivo, 2)) x
      from public.notas_itens i join public.notas n on n.chave = i.chave
      where n.emissao > now() - interval '120 days' and lower(i.descricao) like all (v_padrao)
      order by n.emissao desc limit 15)
    union all
    (select jsonb_build_object('data', h.data_emissao::date, 'fonte', 'cicchetti_' || h.unidade, 'fornecedor', h.fornecedor,
        'descricao', h.descricao, 'unidade', h.unidade_compra, 'quantidade', h.quantidade, 'preco', round(h.preco_efetivo, 2)) x
      from public.precos_historico h
      where h.data_emissao > now() - interval '120 days' and lower(h.descricao) like all (v_padrao)
      order by h.data_emissao desc limit 15)) s), '[]'::jsonb);
end $$;
revoke execute on function public.compras_auto_buscar(text) from public, anon, authenticated;
grant execute on function public.compras_auto_buscar(text) to service_role;

-- Contexto: as listas aprovadas da pessoa nas 4 semanas anteriores
create or replace function public.compras_auto_historico(p_pessoa uuid, p_semana uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('semana', s.inicio, 'status', l.status, 'itens',
    (select jsonb_agg(jsonb_build_object('nome', i.nome, 'fornecedor', i.fornecedor, 'unidade', i.unidade, 'qtd', i.qtd, 'preco', i.preco) order by i.ordem)
     from public.compras_itens i where i.lista_id = l.id and not i.removido)) order by s.inicio desc), '[]'::jsonb)
  from public.compras_listas l join public.compras_semanas s on s.id = l.semana_id
  where l.pessoa_id = p_pessoa and s.inicio < (select inicio from public.compras_semanas where id = p_semana)
    and s.inicio >= (select inicio from public.compras_semanas where id = p_semana) - 28
$$;
revoke execute on function public.compras_auto_historico(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_historico(uuid, uuid) to service_role;

-- Grava a lista sugerida (como compras_gravar_lista do conector). Lista já revisada pela pessoa não é trocada.
create or replace function public.compras_auto_gravar(p_pessoa uuid, p_semana uuid, p_itens jsonb, p_pedido_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lista uuid; v_status text; i jsonb; k int := 0;
begin
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'A lista precisa de pelo menos um item.'; end if;
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  insert into public.compras_listas (semana_id, pessoa_id) values (p_semana, p_pessoa) on conflict (semana_id, pessoa_id) do nothing;
  select id, status into v_lista, v_status from public.compras_listas where semana_id = p_semana and pessoa_id = p_pessoa;
  if v_status = 'aprovada' then raise exception 'Esta lista já foi aprovada pela pessoa.'; end if;
  if exists (select 1 from public.compras_itens where lista_id = v_lista and not removido and atualizado_por is not null
      and atualizado_em > (select coalesce(analisada_em, '-infinity') from public.compras_listas where id = v_lista)) then
    raise exception 'A pessoa já começou a revisar esta lista.';
  end if;
  update public.compras_itens set removido = true, atualizado_em = now() where lista_id = v_lista and not removido;
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco)
    values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
      (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
      coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric);
  end loop;
  update public.compras_listas set status = 'em_revisao', analisada_em = now(), pedido_em = coalesce(pedido_em, now()),
    pedido_texto = coalesce(nullif(p_pedido_texto, ''), pedido_texto) where id = v_lista;
  return jsonb_build_object('lista', v_lista, 'itens', k);
end $$;
revoke execute on function public.compras_auto_gravar(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.compras_auto_gravar(uuid, uuid, jsonb, text) to service_role;

-- Terça, das 6h às 7h50 de Fortaleza (9h–10h50 UTC), a cada 10 min: uma pessoa por chamada
select cron.unschedule('compras-terca') where exists (select 1 from cron.job where jobname = 'compras-terca');
select cron.schedule('compras-terca', '*/10 9-10 * * 2', $job$
  select net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/compras-analise',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'compras_segredo')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

-- ---------------------------------------------------------------------
-- Alertas de preço: compra recente 15% ou mais acima da média anterior do mesmo item
-- ---------------------------------------------------------------------
create or replace view public.precos_alertas with (security_invoker = true) as
with base as (
  select n.chave, n.emissao, n.emitente_nome fornecedor, n.empresa_cnpj, i.descricao, lower(trim(i.descricao)) d, upper(trim(i.unidade)) u,
    i.quantidade, i.preco_efetivo preco
  from public.notas_itens i join public.notas n on n.chave = i.chave
  where n.emissao > now() - interval '134 days' and i.preco_efetivo > 0 and i.quantidade > 0
)
select r.chave, r.emissao, r.fornecedor, r.empresa_cnpj, r.descricao, r.u unidade, r.quantidade, round(r.preco, 2) preco,
  round(a.media, 2) media_anterior, a.compras compras_anteriores, round((r.preco / a.media - 1) * 100, 1) alta_pct
from base r
join lateral (select avg(b.preco) media, count(*) compras from base b
  where b.d = r.d and b.u = r.u and b.fornecedor is not distinct from r.fornecedor
    and b.emissao < r.emissao and b.emissao >= r.emissao - interval '120 days') a on a.compras >= 2
where r.emissao > now() - interval '14 days' and r.preco >= a.media * 1.15;
grant select on public.precos_alertas to authenticated;

-- ---------------------------------------------------------------------
-- Pendências da semana: quem ainda não pediu, não revisou ou não aprovou
-- ---------------------------------------------------------------------
create or replace view public.compras_pendencias with (security_invoker = true) as
select s.id semana_id, s.inicio, p.id pessoa_id, p.nome, p.unidade, p.setor, coalesce(l.status, 'sem_lista') status,
  (select a.status from public.compras_analises a where a.semana_id = s.id and a.pessoa_id = p.id order by a.inicio desc limit 1) analise
from public.compras_semanas s
cross join public.operacao_pessoas p
left join public.compras_listas l on l.semana_id = s.id and l.pessoa_id = p.id
where p.ativo and p.papel = 'solicitante' and s.status = 'aberta' and coalesce(l.status, 'sem_lista') <> 'aprovada';
grant select on public.compras_pendencias to authenticated;
