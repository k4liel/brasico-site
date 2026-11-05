-- Listas de compras (05/11/2026, pedido do dono):
-- (1) total de todas as listas da pessoa; (2) mandar uma lista para a semana anterior ou a seguinte;
-- (3) deixar claro o que já foi comprado: cada item da lista é ligado ao item da lista única (mesma chave da
--     consolidação) e ao pedido daquele fornecedor + empresa (compras_pedidos: pedido feito / recebido).

alter table public.compras_listas
  add column if not exists movida_de uuid references public.compras_semanas(id),
  add column if not exists movida_em timestamptz,
  add column if not exists movida_por uuid;

-- lista mudada de semana conta como "mexida": a leitura do grupo nunca a troca na semana nova
create or replace function public.compras_lista_tocada(p_lista uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.compras_listas l where l.id = p_lista and (l.status = 'aprovada' or l.movida_em is not null))
      or exists (select 1 from public.compras_itens i join public.compras_listas l on l.id = i.lista_id
                 where i.lista_id = p_lista and i.atualizado_por is not null
                   and i.atualizado_em > coalesce(l.analisada_em, '-infinity'))
$$;

-- na semana de onde a lista saiu, a próxima leitura só acrescenta as mensagens novas (não refaz a lista que saiu)
create or replace function public.compras_auto_contexto(p_pessoa uuid, p_semana uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'modo', case when exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa
                               and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id))
                   or exists (select 1 from public.compras_listas l where l.movida_de = p_semana and l.pessoa_id = p_pessoa)
                 then 'adicionar' else 'substituir' end,
    'desde', (select max(a.inicio) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = p_pessoa and a.status = 'ok'),
    'aumento_pct', (select aumento_pct from public.compras_semanas where id = p_semana),
    'listas', coalesce((select jsonb_agg(jsonb_build_object('titulo', l.titulo, 'status', l.status, 'mexida', public.compras_lista_tocada(l.id)))
               from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa and public.compras_lista_ativa(l.status)), '[]'))
$$;
revoke execute on function public.compras_auto_contexto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_contexto(uuid, uuid) to service_role;

-- Situação de cada lista da semana: itens, total e quantos itens já estão em pedido feito / recebido.
-- Sócio e compras veem todas; o solicitante, só as dele.
create or replace function public.compras_listas_situacao(p_semana uuid)
returns table (lista_id uuid, pessoa_id uuid, itens int, total numeric, pedidos int, recebidos int,
               pedido_em timestamptz, recebido_em timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_papel text := coalesce(public.operacao_papel(auth.uid()), '');
begin
  if v_papel = '' then raise exception 'Sem acesso às compras' using errcode = '42501'; end if;
  return query
  with it as (
    select l.id lista, l.pessoa_id pessoa, l.status, i.qtd, i.preco,
           coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') || '|' || public.compras_empresa_padrao(p.unidade, p.setor) || '|'
             || lower(trim(i.nome)) || '|' || coalesce(lower(trim(i.unidade)), '') chave
    from public.compras_listas l
    join public.operacao_pessoas p on p.id = l.pessoa_id
    join public.compras_itens i on i.lista_id = l.id and not i.removido
    where l.semana_id = p_semana and public.compras_lista_ativa(l.status)
      and (v_papel in ('socio', 'compras') or p.user_id = auth.uid())
  ), ped as (
    select it.*, pd.status ped_status, pd.pedido_em, pd.recebido_em
    from it
    left join public.compras_final f on f.semana_id = p_semana and f.chave = it.chave and not f.removido and it.status = 'aprovada'
    left join public.compras_pedidos pd on pd.semana_id = p_semana and pd.fornecedor = f.fornecedor and pd.empresa = f.empresa
  )
  select lista, pessoa, count(*)::int, round(sum(coalesce(qtd, 0) * coalesce(preco, 0)), 2),
         count(*) filter (where ped_status in ('pedido', 'recebido'))::int,
         count(*) filter (where ped_status = 'recebido')::int,
         max(ped.pedido_em), max(ped.recebido_em)
  from ped group by lista, pessoa;
end $$;
revoke execute on function public.compras_listas_situacao(uuid) from public, anon;
grant execute on function public.compras_listas_situacao(uuid) to authenticated;

-- Manda a lista para a semana anterior (-1) ou a seguinte (+1). Sócio e compras movem qualquer uma;
-- a pessoa move a própria lista enquanto não estiver aprovada. Lista com item já pedido ao fornecedor não muda de semana.
create or replace function public.compras_lista_mover_semana(p_lista uuid, p_direcao int)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_papel text := coalesce(public.operacao_papel(auth.uid()), ''); l record; v_ini date; v_dest uuid; v_ped int;
begin
  if p_direcao not in (-1, 1) then raise exception 'Direção inválida.'; end if;
  select cl.*, s.inicio, s.status semana_status, p.user_id dono into l
  from public.compras_listas cl join public.compras_semanas s on s.id = cl.semana_id join public.operacao_pessoas p on p.id = cl.pessoa_id
  where cl.id = p_lista;
  if l.id is null then raise exception 'Lista não encontrada.'; end if;
  if v_papel not in ('socio', 'compras') and not (l.dono = auth.uid() and l.status <> 'aprovada') then
    raise exception 'Só o setor de compras muda esta lista de semana.' using errcode = '42501';
  end if;
  if not public.compras_lista_ativa(l.status) then raise exception 'Esta lista não está ativa.'; end if;
  select coalesce(sum(pedidos), 0) into v_ped from public.compras_listas_situacao(l.semana_id) x where x.lista_id = p_lista;
  if v_ped > 0 then raise exception 'Esta lista já tem item pedido ao fornecedor; não dá para mudar de semana.'; end if;
  v_ini := l.inicio + 7 * p_direcao;
  v_dest := public.compras_semana_de(v_ini);
  if (select status from public.compras_semanas where id = v_dest) <> 'aberta' then raise exception 'A semana de destino já foi fechada.'; end if;
  update public.compras_listas set semana_id = v_dest, movida_de = l.semana_id, movida_em = now(), movida_por = auth.uid() where id = p_lista;
  -- lista aprovada: a lista única das duas semanas se refaz
  if l.status = 'aprovada' then
    perform public.compras_consolidar_semana(l.semana_id);
    perform public.compras_consolidar_semana(v_dest);
  end if;
  return v_dest;
end $$;
revoke execute on function public.compras_lista_mover_semana(uuid, int) from public, anon;
grant execute on function public.compras_lista_mover_semana(uuid, int) to authenticated;
