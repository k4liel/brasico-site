-- Compras · etapa 3: a área da Fernanda (setor de compras), 04/11/2026.
-- 1. Pedido por fornecedor na lista única: a pedir → pedido feito → recebido, com a nota fiscal ligada.
-- 2. Conferência da nota com o pedido (quantidade e preço de cada item).
-- 3. Painel da semana (compras_painel).
-- 4. A Fernanda lê as notas e o índice de preços (só leitura; ela não vira sócia em nada).
-- Nada se apaga: cada mudança de situação fica em compras_pedidos_historico.

-- 4. Leitura das notas e dos preços para o setor de compras -------------------------------------------
create or replace function public.notas_pode_ler(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user)
      or exists (select 1 from public.operacao_pessoas where user_id = p_user and ativo and papel = 'compras')
$$;
grant execute on function public.notas_pode_ler(uuid) to authenticated;

drop policy if exists ver on public.notas;
create policy ver on public.notas for select using (public.notas_pode_ler(auth.uid()));
drop policy if exists ver on public.notas_itens;
create policy ver on public.notas_itens for select using (public.notas_pode_ler(auth.uid()));

create or replace function public.precos_pode(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.notas_pode_ler(p_user) or exists (select 1 from public.cicchetti_acesso where user_id = p_user)
$$;

-- 1. Pedido por fornecedor ---------------------------------------------------------------------------
create table if not exists public.compras_pedidos (
  id bigint generated always as identity primary key,
  semana_id uuid not null references public.compras_semanas(id),
  fornecedor text not null,
  status text not null default 'a_pedir' check (status in ('a_pedir', 'pedido', 'recebido')),
  pedido_em timestamptz, pedido_por uuid,
  recebido_em timestamptz, recebido_por uuid,
  nota_chave text references public.notas(chave),
  observacao text,
  atualizado_em timestamptz not null default now(),
  unique (semana_id, fornecedor)
);
create table if not exists public.compras_pedidos_historico (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.compras_pedidos(id),
  status text, nota_chave text, observacao text,
  feito_por uuid, feito_em timestamptz not null default now()
);
alter table public.compras_pedidos enable row level security;
alter table public.compras_pedidos_historico enable row level security;
drop policy if exists ver on public.compras_pedidos;
create policy ver on public.compras_pedidos for select using (public.operacao_papel(auth.uid()) in ('socio', 'compras'));
drop policy if exists ver on public.compras_pedidos_historico;
create policy ver on public.compras_pedidos_historico for select using (public.operacao_papel(auth.uid()) in ('socio', 'compras'));
grant select on public.compras_pedidos, public.compras_pedidos_historico to authenticated;

create or replace function public.compras_pedido_gravar(p_semana uuid, p_fornecedor text, p_status text default null,
  p_nota text default null, p_tirar_nota boolean default false, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.compras_pedidos;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then
    raise exception 'Só o setor de compras marca os pedidos.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('a_pedir', 'pedido', 'recebido') then raise exception 'Situação inválida.'; end if;
  if p_nota is not null and not exists (select 1 from public.notas where chave = p_nota) then raise exception 'Nota não encontrada.'; end if;
  insert into public.compras_pedidos (semana_id, fornecedor) values (p_semana, trim(p_fornecedor))
  on conflict (semana_id, fornecedor) do nothing;
  update public.compras_pedidos set
    status = coalesce(p_status, status),
    pedido_em = case when p_status = 'pedido' then coalesce(pedido_em, now()) when p_status = 'a_pedir' then null else pedido_em end,
    pedido_por = case when p_status = 'pedido' then coalesce(pedido_por, auth.uid()) when p_status = 'a_pedir' then null else pedido_por end,
    recebido_em = case when p_status = 'recebido' then now() when p_status in ('a_pedir', 'pedido') then null else recebido_em end,
    recebido_por = case when p_status = 'recebido' then auth.uid() when p_status in ('a_pedir', 'pedido') then null else recebido_por end,
    nota_chave = case when p_tirar_nota then null else coalesce(p_nota, nota_chave) end,
    observacao = coalesce(p_observacao, observacao),
    atualizado_em = now()
  where semana_id = p_semana and fornecedor = trim(p_fornecedor)
  returning * into v;
  insert into public.compras_pedidos_historico (pedido_id, status, nota_chave, observacao, feito_por)
  values (v.id, v.status, v.nota_chave, v.observacao, auth.uid());
  return to_jsonb(v);
end $$;
grant execute on function public.compras_pedido_gravar(uuid, text, text, text, boolean, text) to authenticated;

-- Notas que podem ser deste pedido: mesmo fornecedor (nome parecido) emitidas de 3 dias antes da semana até 12 dias depois
create or replace function public.compras_notas_do_fornecedor(p_semana uuid, p_fornecedor text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_inicio date;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select inicio into v_inicio from public.compras_semanas where id = p_semana;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('chave', n.chave, 'emissao', n.emissao, 'valor', n.valor, 'emitente', n.emitente_nome,
      'empresa', n.empresa_cnpj, 'completa', n.completa, 'origem', n.origem,
      'semelhanca', round(greatest(similarity(upper(n.emitente_nome), upper(p_fornecedor)),
                                   word_similarity(upper(p_fornecedor), upper(n.emitente_nome)))::numeric, 2)) x
    from public.notas n
    where n.situacao is distinct from 'cancelada'
      and n.emissao >= (v_inicio - 3)::timestamptz and n.emissao < (v_inicio + 12)::timestamptz
      and (similarity(upper(n.emitente_nome), upper(p_fornecedor)) > 0.35
           or word_similarity(upper(p_fornecedor), upper(n.emitente_nome)) > 0.5)
    order by n.emissao desc limit 15) s), '[]'::jsonb);
end $$;
grant execute on function public.compras_notas_do_fornecedor(uuid, text) to authenticated;

-- 2. Conferência: cada item pedido ao fornecedor contra o item mais parecido da nota ligada
create or replace function public.compras_conferir(p_semana uuid, p_fornecedor text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_chave text; v_itens jsonb; v_extras jsonb;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select nota_chave into v_chave from public.compras_pedidos where semana_id = p_semana and fornecedor = trim(p_fornecedor);
  if v_chave is null then return jsonb_build_object('nota', null); end if;
  with pedido as (
    select f.id, f.nome, f.unidade, f.qtd, f.preco from public.compras_final f
    where f.semana_id = p_semana and f.fornecedor = trim(p_fornecedor) and not f.removido
  ), nota as (
    select i.n_item, i.descricao, i.unidade, i.quantidade, coalesce(i.preco_efetivo, i.valor_unitario) preco, i.valor_total
    from public.notas_itens i where i.chave = v_chave
  ), pares as (
    select p.id, n.n_item, greatest(similarity(upper(p.nome), upper(n.descricao)), word_similarity(upper(p.nome), upper(n.descricao))) s
    from pedido p cross join nota n
  ), escolha as (
    -- o par mais parecido de cada item pedido (acima de 0,3)
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
grant execute on function public.compras_conferir(uuid, text) to authenticated;

-- 3. Painel da semana para a Fernanda ------------------------------------------------------------------
create or replace function public.compras_painel(p_semana uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
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
    'fornecedores', (select coalesce(jsonb_agg(jsonb_build_object('fornecedor', f.fornecedor, 'itens', f.itens, 'valor', f.valor,
          'status', coalesce(p.status, 'a_pedir'), 'pedido_em', p.pedido_em, 'recebido_em', p.recebido_em, 'nota', p.nota_chave)
        order by f.valor desc), '[]'::jsonb)
      from (select fornecedor, count(*) itens, sum(coalesce(qtd, 0) * coalesce(preco, 0)) valor
            from public.compras_final where semana_id = p_semana and not removido group by fornecedor) f
      left join public.compras_pedidos p on p.semana_id = p_semana and p.fornecedor = f.fornecedor),
    'alertas_preco', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (select to_jsonb(x) a from public.precos_alertas x limit 8) s)
  );
end $$;
grant execute on function public.compras_painel(uuid) to authenticated;

-- Notas de compra recentes para a Fernanda (aba Notas das Compras): por fornecedor, com a casa que comprou
create or replace function public.compras_notas_recentes(p_dias int default 21, p_busca text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'emissao' desc) from (
    select jsonb_build_object('chave', n.chave, 'emissao', n.emissao, 'valor', n.valor, 'emitente', n.emitente_nome,
      'casa', public.compras_casa_cnpj(n.empresa_cnpj), 'completa', n.completa, 'origem', n.origem,
      'itens', (select count(*) from public.notas_itens i where i.chave = n.chave),
      'pedido', (select jsonb_build_object('fornecedor', p.fornecedor, 'status', p.status) from public.compras_pedidos p where p.nota_chave = n.chave limit 1)) x
    from public.notas n
    where n.situacao is distinct from 'cancelada'
      and n.emissao > now() - make_interval(days => least(greatest(coalesce(p_dias, 21), 1), 120))
      and (coalesce(trim(p_busca), '') = '' or n.emitente_nome ilike '%' || trim(p_busca) || '%'
           or exists (select 1 from public.notas_itens i where i.chave = n.chave and i.descricao ilike '%' || trim(p_busca) || '%'))
    order by n.emissao desc limit 300) s), '[]'::jsonb);
end $$;
grant execute on function public.compras_notas_recentes(int, text) to authenticated;

-- 04/11/2026: a Fernanda abre a página Notas (só NF-e, índice de preços e nota avulsa; sem NFS-e e sem Leituras).
-- Para isso ela lê os nomes das empresas (notas_empresas).
create policy ler_operacao on public.notas_empresas for select to authenticated using (public.notas_pode_ler(auth.uid()));
