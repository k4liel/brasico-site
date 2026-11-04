-- Lista única separada por EMPRESA (CNPJ que compra) e itens que se movem de empresa e de fornecedor (04/11/2026, pedido do dono).
--
-- Cada item da lista única nasce na empresa que compra para a casa de quem pediu (compras_empresa_padrao):
--   Cicchetti Centro        -> Brasico77 filial 0002 (24021962000276)
--   Filha da Lua            -> Brasico77 matriz 0001 (24021962000195)
--   Sempre Vivo, Produção   -> Brasico77 filial 0002 (a produção compra pela 0002)
--   Sempre Vivo (bar, cozinha, salão) -> LAIF (50639716000101) — "depende": a Fernanda move quando for outra
-- A Fernanda pode mover qualquer item para outra empresa e/ou outro fornecedor (arrastando ou pelo botão Mover).
--
-- `chave` guarda de onde o item veio (fornecedor|empresa|nome|unidade das listas aprovadas). A consolidação casa por ela,
-- então mover ou renomear um item não o faz voltar em dobro. Itens incluídos à mão têm chave 'manual:<uuid>'.
-- O pedido de cada fornecedor (compras_pedidos) passa a ser por empresa + fornecedor.

create or replace function public.compras_empresa_padrao(p_unidade text, p_setor text)
returns text language sql immutable as $$
  select case
    when p_unidade = 'filha_da_lua' then '24021962000195'
    when p_unidade = 'sempre_vivo' and p_setor <> 'producao' then '50639716000101'
    else '24021962000276' end
$$;

alter table public.compras_final add column if not exists empresa text not null default '';
alter table public.compras_final add column if not exists chave text;
alter table public.compras_final add column if not exists movido boolean not null default false;

-- linhas de antes (sem empresa): saem e a consolidação refaz já separado por empresa (nada se apaga)
update public.compras_final set chave = 'antigo:' || id, removido = true, atualizado_em = now() where chave is null;
alter table public.compras_final alter column chave set not null;
alter table public.compras_final drop constraint if exists compras_final_semana_id_fornecedor_nome_unidade_key;
create unique index if not exists compras_final_semana_chave on public.compras_final (semana_id, chave);

alter table public.compras_pedidos add column if not exists empresa text not null default '';
alter table public.compras_pedidos drop constraint if exists compras_pedidos_semana_id_fornecedor_key;
create unique index if not exists compras_pedidos_semana_forn_empresa on public.compras_pedidos (semana_id, fornecedor, empresa);

create or replace function public.compras_consolidar_semana(p_semana uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then return 0; end if;
  with base as (
    select coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') fornecedor, public.compras_empresa_padrao(p.unidade, p.setor) empresa,
           trim(i.nome) nome, coalesce(lower(trim(i.unidade)), '') unidade, i.qtd, i.preco, p.nome pessoa, p.unidade casa, p.setor, l.titulo
    from public.compras_itens i
    join public.compras_listas l on l.id = i.lista_id
    join public.operacao_pessoas p on p.id = l.pessoa_id
    where l.semana_id = p_semana and l.status = 'aprovada' and not i.removido and coalesce(i.qtd, 0) > 0
  ), soma as (
    select fornecedor, empresa, nome, unidade, fornecedor || '|' || empresa || '|' || lower(nome) || '|' || unidade chave,
           sum(qtd) qtd, max(preco) preco,
           jsonb_agg(jsonb_build_object('pessoa', pessoa, 'unidade', casa, 'setor', setor, 'lista', titulo, 'qtd', qtd) order by casa, setor) origem
    from base group by 1, 2, 3, 4
  ), ins as (
    insert into public.compras_final as f (semana_id, chave, fornecedor, empresa, nome, unidade, qtd, preco, origem)
    select p_semana, chave, fornecedor, empresa, nome, unidade, qtd, preco, origem from soma
    on conflict (semana_id, chave) do update set
      qtd = case when f.editado then f.qtd else excluded.qtd end,
      preco = case when f.editado then f.preco else excluded.preco end,
      origem = excluded.origem,
      removido = case when f.editado then f.removido else false end,
      atualizado_em = now()
    returning f.id
  )
  select count(*) into v from ins;
  -- o que veio de lista e não está mais em nenhuma aprovada (e ninguém editou) sai da lista única
  update public.compras_final f set removido = true, atualizado_em = now()
  where f.semana_id = p_semana and not f.removido and not f.editado and f.chave not like 'manual:%' and f.chave not like 'antigo:%'
    and not exists (
      select 1 from public.compras_itens i
      join public.compras_listas l on l.id = i.lista_id
      join public.operacao_pessoas p on p.id = l.pessoa_id
      where l.semana_id = p_semana and l.status = 'aprovada' and not i.removido and coalesce(i.qtd, 0) > 0
        and coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') || '|' || public.compras_empresa_padrao(p.unidade, p.setor) || '|'
            || lower(trim(i.nome)) || '|' || coalesce(lower(trim(i.unidade)), '') = f.chave);
  return v;
end $$;
revoke all on function public.compras_consolidar_semana(uuid) from public, anon, authenticated;

-- Editar um item (mudar empresa ou fornecedor = mover)
drop function if exists public.compras_final_salvar(bigint, text, text, text, numeric, numeric, boolean);
create or replace function public.compras_final_salvar(p_id bigint, p_fornecedor text, p_nome text, p_unidade text, p_qtd numeric, p_preco numeric,
  p_removido boolean, p_empresa text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception 'Só o setor de compras edita a lista única.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O item precisa de um nome.'; end if;
  if p_empresa is not null and not exists (select 1 from public.notas_empresas where cnpj = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  update public.compras_final set
    movido = movido or coalesce(nullif(trim(p_fornecedor), ''), 'Sem fornecedor') <> fornecedor or coalesce(p_empresa, empresa) <> empresa,
    fornecedor = coalesce(nullif(trim(p_fornecedor), ''), 'Sem fornecedor'), empresa = coalesce(p_empresa, empresa), nome = trim(p_nome),
    unidade = coalesce(lower(trim(p_unidade)), ''), qtd = p_qtd, preco = p_preco, removido = coalesce(p_removido, removido),
    editado = true, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_id and semana_id in (select id from public.compras_semanas where status = 'aberta');
end $$;
revoke all on function public.compras_final_salvar(bigint, text, text, text, numeric, numeric, boolean, text) from public, anon;
grant execute on function public.compras_final_salvar(bigint, text, text, text, numeric, numeric, boolean, text) to authenticated;

drop function if exists public.compras_final_incluir(uuid, text, text, text, numeric, numeric);
create or replace function public.compras_final_incluir(p_semana uuid, p_fornecedor text, p_nome text, p_unidade text, p_qtd numeric, p_preco numeric,
  p_empresa text default '24021962000276')
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception 'Só o setor de compras edita a lista única.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(p_qtd, 0) <= 0 then raise exception 'Informe o nome e a quantidade.'; end if;
  if not exists (select 1 from public.notas_empresas where cnpj = p_empresa) then raise exception 'Empresa não encontrada.'; end if;
  insert into public.compras_final (semana_id, chave, fornecedor, empresa, nome, unidade, qtd, preco, editado, atualizado_por)
  values (p_semana, 'manual:' || gen_random_uuid(), coalesce(nullif(trim(p_fornecedor), ''), 'Sem fornecedor'), p_empresa, trim(p_nome),
          coalesce(lower(trim(p_unidade)), ''), p_qtd, p_preco, true, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.compras_final_incluir(uuid, text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.compras_final_incluir(uuid, text, text, text, numeric, numeric, text) to authenticated;

-- Pedido por empresa + fornecedor
drop function if exists public.compras_pedido_gravar(uuid, text, text, text, boolean, text);
create or replace function public.compras_pedido_gravar(p_semana uuid, p_fornecedor text, p_status text default null, p_nota text default null,
  p_tirar_nota boolean default false, p_observacao text default null, p_empresa text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v public.compras_pedidos;
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then
    raise exception 'Só o setor de compras marca os pedidos.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('a_pedir', 'pedido', 'recebido') then raise exception 'Situação inválida.'; end if;
  if p_nota is not null and not exists (select 1 from public.notas where chave = p_nota) then raise exception 'Nota não encontrada.'; end if;
  insert into public.compras_pedidos (semana_id, fornecedor, empresa) values (p_semana, trim(p_fornecedor), coalesce(p_empresa, ''))
  on conflict (semana_id, fornecedor, empresa) do nothing;
  update public.compras_pedidos set
    status = coalesce(p_status, status),
    pedido_em = case when p_status = 'pedido' then coalesce(pedido_em, now()) when p_status = 'a_pedir' then null else pedido_em end,
    pedido_por = case when p_status = 'pedido' then coalesce(pedido_por, auth.uid()) when p_status = 'a_pedir' then null else pedido_por end,
    recebido_em = case when p_status = 'recebido' then now() when p_status in ('a_pedir', 'pedido') then null else recebido_em end,
    recebido_por = case when p_status = 'recebido' then auth.uid() when p_status in ('a_pedir', 'pedido') then null else recebido_por end,
    nota_chave = case when p_tirar_nota then null else coalesce(p_nota, nota_chave) end,
    observacao = coalesce(p_observacao, observacao),
    atualizado_em = now()
  where semana_id = p_semana and fornecedor = trim(p_fornecedor) and empresa = coalesce(p_empresa, '')
  returning * into v;
  insert into public.compras_pedidos_historico (pedido_id, status, nota_chave, observacao, feito_por)
  values (v.id, v.status, v.nota_chave, v.observacao, auth.uid());
  return to_jsonb(v);
end $$;
revoke all on function public.compras_pedido_gravar(uuid, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.compras_pedido_gravar(uuid, text, text, text, boolean, text, text) to authenticated;

-- Conferência da nota: só os itens daquela empresa com aquele fornecedor
drop function if exists public.compras_conferir(uuid, text);
create or replace function public.compras_conferir(p_semana uuid, p_fornecedor text, p_empresa text default '')
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare v_chave text; v_itens jsonb; v_extras jsonb;
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select nota_chave into v_chave from public.compras_pedidos where semana_id = p_semana and fornecedor = trim(p_fornecedor) and empresa = coalesce(p_empresa, '');
  if v_chave is null then return jsonb_build_object('nota', null); end if;
  with pedido as (
    select f.id, f.nome, f.unidade, f.qtd, f.preco from public.compras_final f
    where f.semana_id = p_semana and f.fornecedor = trim(p_fornecedor) and f.empresa = coalesce(p_empresa, '') and not f.removido
  ), nota as (
    select i.n_item, i.descricao, i.unidade, i.quantidade, coalesce(i.preco_efetivo, i.valor_unitario) preco, i.valor_total
    from public.notas_itens i where i.chave = v_chave
  ), pares as (
    select p.id, n.n_item, greatest(similarity(upper(p.nome), upper(n.descricao)), word_similarity(upper(p.nome), upper(n.descricao))) s
    from pedido p cross join nota n
  ), escolha as (
    select distinct on (id) id, n_item, s from pares where s >= 0.3 order by id, s desc
  )
  select jsonb_agg(jsonb_build_object(
      'item', p.nome, 'unidade', p.unidade, 'qtd_pedida', p.qtd, 'preco_pedido', p.preco,
      'na_nota', n.descricao, 'unidade_nota', n.unidade, 'qtd_nota', n.quantidade, 'preco_nota', round(n.preco, 4),
      'semelhanca', round(e.s::numeric, 2),
      'situacao', case when n.n_item is null then 'faltou'
                       when p.qtd is not null and abs(n.quantidade - p.qtd) > greatest(0.05 * p.qtd, 0.01) then 'quantidade'
                       when p.preco is not null and n.preco > p.preco * 1.03 then 'preco'
                       else 'ok' end) order by p.nome),
    (select jsonb_agg(jsonb_build_object('descricao', x.descricao, 'unidade', x.unidade, 'quantidade', x.quantidade, 'preco', round(x.preco, 4)))
       from nota x where x.n_item not in (select n_item from escolha))
  into v_itens, v_extras
  from pedido p left join escolha e on e.id = p.id left join nota n on n.n_item = e.n_item;
  return jsonb_build_object(
    'nota', (select jsonb_build_object('chave', chave, 'emissao', emissao, 'valor', valor, 'emitente', emitente_nome, 'completa', completa)
             from public.notas where chave = v_chave),
    'itens', coalesce(v_itens, '[]'::jsonb), 'fora_do_pedido', coalesce(v_extras, '[]'::jsonb));
end $$;
revoke all on function public.compras_conferir(uuid, text, text) from public, anon;
grant execute on function public.compras_conferir(uuid, text, text) to authenticated;

-- Painel: um cartão por empresa + fornecedor
create or replace function public.compras_painel(p_semana uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'listas', (select jsonb_build_object(
        'pessoas', count(distinct o.id),
        'com_lista', count(distinct l.pessoa_id),
        'aprovadas', count(*) filter (where l.status = 'aprovada'),
        'em_revisao', count(*) filter (where l.status = 'em_revisao'),
        'aguardando', count(*) filter (where l.status = 'aguardando'),
        'pessoas_tudo_aprovado', (select count(*) from (select pessoa_id from public.compras_listas
            where semana_id = p_semana and public.compras_lista_ativa(status) group by pessoa_id
            having bool_and(status = 'aprovada')) a))
      from public.operacao_pessoas o
      left join public.compras_listas l on l.pessoa_id = o.id and l.semana_id = p_semana and public.compras_lista_ativa(l.status)
      where o.ativo and o.papel = 'solicitante'),
    'pendentes', (select coalesce(jsonb_agg(jsonb_build_object('pessoa', o.nome, 'unidade', o.unidade, 'setor', o.setor,
          'listas', (select count(*) from public.compras_listas l where l.pessoa_id = o.id and l.semana_id = p_semana and public.compras_lista_ativa(l.status)),
          'aprovadas', (select count(*) from public.compras_listas l where l.pessoa_id = o.id and l.semana_id = p_semana and l.status = 'aprovada'))
        order by o.unidade, o.nome), '[]'::jsonb)
      from public.operacao_pessoas o
      where o.ativo and o.papel = 'solicitante'
        and exists (select 1 from public.compras_listas l where l.pessoa_id = o.id and l.semana_id = p_semana and l.status in ('aguardando', 'em_revisao'))),
    'itens', (select jsonb_build_object(
        'total', count(*),
        'baixa', count(*) filter (where i.confianca = 'baixa'),
        'valor_aprovado', coalesce(sum(coalesce(i.qtd, 0) * coalesce(i.preco, 0)) filter (where l.status = 'aprovada'), 0),
        'valor_todas', coalesce(sum(coalesce(i.qtd, i.qtd_sugerida, 0) * coalesce(i.preco, 0)), 0))
      from public.compras_itens i join public.compras_listas l on l.id = i.lista_id
      where l.semana_id = p_semana and public.compras_lista_ativa(l.status) and not i.removido),
    'fornecedores', (select coalesce(jsonb_agg(jsonb_build_object('fornecedor', f.fornecedor, 'empresa', f.empresa, 'itens', f.itens, 'valor', f.valor,
          'status', coalesce(p.status, 'a_pedir'), 'pedido_em', p.pedido_em, 'recebido_em', p.recebido_em, 'nota', p.nota_chave)
        order by f.valor desc), '[]'::jsonb)
      from (select fornecedor, empresa, count(*) itens, sum(coalesce(qtd, 0) * coalesce(preco, 0)) valor
            from public.compras_final where semana_id = p_semana and not removido group by fornecedor, empresa) f
      left join public.compras_pedidos p on p.semana_id = p_semana and p.fornecedor = f.fornecedor and p.empresa = f.empresa),
    'alertas_preco', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (select to_jsonb(x) a from public.precos_alertas x limit 8) s)
  );
end $$;

-- refaz a lista única das semanas abertas já separada por empresa
select public.compras_consolidar_semana(id) from public.compras_semanas where status = 'aberta';
