-- Aumento da semana (feriado, evento) recalcula as listas na hora (pedido do dono, 05/11/2026).
-- Antes o % só valia para as próximas análises do grupo. Agora, ao salvar, cada item das listas ativas da semana é refeito
-- a partir da sua BASE (guardada no item, para ir e voltar sem acumular arredondamento):
--   base_tipo 'media'  = a sugestão vem da média de 4 semanas (pedido sem quantidade ou muito fora da média):
--                        sugestão = média × (1 + %), para cima (kg/L/g/ml de meio em meio; o resto inteiro), como na análise;
--   base_tipo 'pedido' = a sugestão é o que a pessoa pediu: sugestão = pedido × (1 + %), arredondada para o mais perto
--                        (com 0% fica exatamente o pedido).
--   projeção = média × (1 + %), sempre.
--   Pedir = a nova sugestão, só se a pessoa ainda não mudou o Pedir (igual à sugestão antiga). O que ela digitou fica.
-- Lista com item já pedido ao fornecedor não muda. Lista aprovada atualiza a lista única pelos gatilhos
-- (o que a Fernanda editou à mão lá fica). Não marca a lista como "mexida" (atualizado_por fica como estava).
-- A leitura do grupo (compras_auto_gravar) também chama o recálculo, para as listas novas já saírem com o % da semana.

alter table public.compras_itens add column if not exists base_tipo text check (base_tipo in ('media', 'pedido'));

create or replace function public.compras_arred(p_v numeric, p_unidade text, p_cima boolean default true)
returns numeric language sql immutable as $$
  select case when p_v is null then null
              when upper(coalesce(p_unidade, '')) in ('KG', 'L', 'LT', 'G', 'ML') then
                case when p_cima then ceil(p_v * 2) / 2 else round(p_v * 2) / 2 end
              else case when p_cima then ceil(p_v) else round(p_v) end end
$$;
drop function if exists public.compras_arred(numeric, text);

-- listas da semana com algum item já pedido ao fornecedor (mesma ligação de compras_listas_situacao, sem conferir quem chama)
create or replace function public.compras_listas_com_pedido(p_semana uuid)
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select distinct l.id
  from public.compras_listas l
  join public.operacao_pessoas p on p.id = l.pessoa_id
  join public.compras_itens i on i.lista_id = l.id and not i.removido
  join public.compras_final f on f.semana_id = p_semana and not f.removido
    and f.chave = coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') || '|' || public.compras_empresa_padrao(p.unidade, p.setor) || '|'
                  || lower(trim(i.nome)) || '|' || coalesce(lower(trim(i.unidade)), '')
  join public.compras_pedidos pd on pd.semana_id = p_semana and pd.fornecedor = f.fornecedor and pd.empresa = f.empresa
  where l.semana_id = p_semana and l.status = 'aprovada' and pd.status in ('pedido', 'recebido')
$$;
revoke all on function public.compras_listas_com_pedido(uuid) from public, anon, authenticated;

create or replace function public.compras_recalcular_semana(p_semana uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pct numeric; v_fator numeric; v_n int; v_listas int; v_antes numeric; v_depois numeric;
begin
  select coalesce(aumento_pct, 0) into v_pct from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_pct is null then raise exception 'A semana já foi fechada.'; end if;
  v_fator := 1 + v_pct / 100;

  -- primeira vez: guarda de onde vem a sugestão de cada item (média ou pedido)
  update public.compras_itens i set base_tipo =
    case when i.media_4s is not null and (i.qtd_pedida is null or (i.qtd_sugerida = i.projecao and i.qtd_sugerida is distinct from i.qtd_pedida))
         then 'media' else 'pedido' end
  from public.compras_listas l
  where l.id = i.lista_id and l.semana_id = p_semana and i.base_tipo is null;

  drop table if exists _rec;
  create temp table _rec on commit drop as
  select i.id, i.lista_id, i.qtd, i.preco, i.qtd_sugerida antiga, i.projecao proj_antiga,
         public.compras_arred(i.media_4s * v_fator, i.unidade) nova_proj,
         case when i.base_tipo = 'media' and i.media_4s is not null then public.compras_arred(i.media_4s * v_fator, i.unidade)
              when i.qtd_pedida is null then i.qtd_sugerida
              when v_pct = 0 then i.qtd_pedida
              else public.compras_arred(i.qtd_pedida * v_fator, i.unidade, false) end sug
  from public.compras_itens i
  join public.compras_listas l on l.id = i.lista_id
  where l.semana_id = p_semana and public.compras_lista_ativa(l.status) and not i.removido
    and l.id not in (select public.compras_listas_com_pedido(p_semana));

  select coalesce(sum(coalesce(qtd, 0) * coalesce(preco, 0)), 0) into v_antes from _rec;

  with up as (
    update public.compras_itens i set
      projecao = coalesce(r.nova_proj, i.projecao),
      qtd_sugerida = r.sug,
      qtd = case when i.qtd is not distinct from r.antiga then r.sug else i.qtd end,
      atualizado_em = now()
    from _rec r
    where i.id = r.id and (r.proj_antiga is distinct from coalesce(r.nova_proj, r.proj_antiga) or r.antiga is distinct from r.sug)
    returning i.lista_id
  )
  select count(*), count(distinct lista_id) into v_n, v_listas from up;

  select coalesce(sum(coalesce(i.qtd, 0) * coalesce(i.preco, 0)), 0) into v_depois
  from public.compras_itens i where i.id in (select id from _rec);

  return jsonb_build_object('pct', v_pct, 'itens', v_n, 'listas', v_listas, 'total_antes', round(v_antes, 2), 'total_depois', round(v_depois, 2));
end $$;
revoke all on function public.compras_recalcular_semana(uuid) from public, anon, authenticated;

drop function if exists public.compras_semana_aumento(uuid, numeric);
create function public.compras_semana_aumento(p_semana uuid, p_pct numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') not in ('socio', 'compras') then raise exception 'Só o setor de compras muda a porcentagem.' using errcode = '42501'; end if;
  if p_pct is null or p_pct < -50 or p_pct > 200 then raise exception 'Porcentagem fora do normal (entre -50%% e 200%%).'; end if;
  update public.compras_semanas set aumento_pct = p_pct where id = p_semana and status = 'aberta';
  if not found then raise exception 'A semana já foi fechada.'; end if;
  return public.compras_recalcular_semana(p_semana);
end $$;
revoke all on function public.compras_semana_aumento(uuid, numeric) from public, anon;
grant execute on function public.compras_semana_aumento(uuid, numeric) to authenticated;

-- a leitura do grupo grava a lista e, se a semana tem %, recalcula na hora (o que a pessoa pediu também ganha o %)
create or replace function public.compras_auto_gravar(p_pessoa uuid, p_semana uuid, p_listas jsonb, p_pedido_texto text, p_modo text DEFAULT 'substituir'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lst jsonb; i jsonb; v_lista uuid; k int; n_listas int := 0; n_itens int := 0;
begin
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  if p_modo = 'substituir' then
    if exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa
               and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)) then
      raise exception 'A pessoa já começou a revisar esta lista.';
    end if;
    update public.compras_listas set status = 'substituida', substituida_em = now()
    where semana_id = p_semana and pessoa_id = p_pessoa and status in ('aguardando', 'em_revisao');
  end if;
  for lst in select * from jsonb_array_elements(coalesce(p_listas, '[]')) loop
    if jsonb_array_length(coalesce(lst->'itens', '[]')) = 0 then continue; end if;
    insert into public.compras_listas (semana_id, pessoa_id, titulo, status, pedido_texto, pedido_em, analisada_em)
    values (p_semana, p_pessoa, nullif(trim(lst->>'titulo'), ''), 'em_revisao',
            coalesce(nullif(trim(lst->>'pedido'), ''), nullif(p_pedido_texto, '')), now(), now())
    returning id into v_lista;
    n_listas := n_listas + 1; k := 0;
    for i in select * from jsonb_array_elements(lst->'itens') loop
      k := k + 1; n_itens := n_itens + 1;
      insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco,
                                        media_4s, projecao, base, produto_nota, confianca)
      values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
        (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
        coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric,
        (i->>'media_4s')::numeric, (i->>'projecao')::numeric, nullif(trim(i->>'base'), ''), nullif(trim(i->>'produto_nota'), ''),
        case when i->>'confianca' in ('alta', 'media', 'baixa') then i->>'confianca' end);
    end loop;
  end loop;
  if n_listas = 0 then raise exception 'A análise não trouxe nenhum item.'; end if;
  if coalesce((select aumento_pct from public.compras_semanas where id = p_semana), 0) <> 0 then
    perform public.compras_recalcular_semana(p_semana);
  end if;
  return jsonb_build_object('listas', n_listas, 'itens', n_itens);
end $function$;
