-- =====================================================================
-- Notas fiscais: gravação em lotes e encadeamento (complementa supabase/notas.sql)
--  - A rota /api/notas grava cada chamada de 50 documentos na hora (notas_worker_gravar);
--    notas_worker_concluir só fecha a execução.
--  - Ao fechar: se faltou documento, pede a continuação; se acabou e a ciência está
--    ligada, pede a ciência das notas que vieram só em resumo (lotes de 20).
--  - No máximo 30 pedidos encadeados por empresa por dia, para nunca virar um laço.
-- =====================================================================

create or replace function public.notas_gravar(p_cnpj text, p_notas jsonb, p_eventos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n jsonb; i jsonb; v jsonb; v_notas int := 0; v_itens int := 0; v_eventos int := 0;
begin
  for n in select * from jsonb_array_elements(coalesce(p_notas, '[]')) loop
    insert into public.notas as t (chave, empresa_cnpj, origem, emitente_cnpj, emitente_nome, emissao, valor, situacao,
      completa, nsu, resumo, xml)
    values (n->>'chave', p_cnpj, 'sefaz', n->>'emitente_cnpj', n->>'emitente_nome', (n->>'emissao')::timestamptz,
      (n->>'valor')::numeric, coalesce(n->>'situacao', 'autorizada'), coalesce((n->>'completa')::boolean, false),
      n->>'nsu', coalesce(n->'resumo', '{}'), n->>'xml')
    on conflict (chave) do update set
      emitente_cnpj = coalesce(excluded.emitente_cnpj, t.emitente_cnpj),
      emitente_nome = coalesce(excluded.emitente_nome, t.emitente_nome),
      emissao = coalesce(excluded.emissao, t.emissao),
      valor = coalesce(excluded.valor, t.valor),
      situacao = case when t.situacao = 'cancelada' then t.situacao else excluded.situacao end,
      completa = t.completa or excluded.completa,
      nsu = case when excluded.completa then excluded.nsu else t.nsu end,
      resumo = case when excluded.completa or not t.completa then excluded.resumo else t.resumo end,
      xml = case when excluded.completa then excluded.xml when t.completa then t.xml else excluded.xml end,
      atualizado_em = now();
    v_notas := v_notas + 1;
    if coalesce((n->>'completa')::boolean, false) then
      for i in select * from jsonb_array_elements(coalesce(n->'itens', '[]')) loop
        insert into public.notas_itens (chave, n_item, codigo, descricao, ncm, cfop, unidade, quantidade,
          valor_unitario, valor_total, desconto, frete)
        values (n->>'chave', (i->>'n_item')::int, i->>'codigo', coalesce(i->>'descricao', '?'), i->>'ncm', i->>'cfop',
          i->>'unidade', (i->>'quantidade')::numeric, (i->>'valor_unitario')::numeric, (i->>'valor_total')::numeric,
          coalesce((i->>'desconto')::numeric, 0), coalesce((i->>'frete')::numeric, 0))
        on conflict (chave, n_item) do update set codigo = excluded.codigo, descricao = excluded.descricao,
          ncm = excluded.ncm, cfop = excluded.cfop, unidade = excluded.unidade, quantidade = excluded.quantidade,
          valor_unitario = excluded.valor_unitario, valor_total = excluded.valor_total,
          desconto = excluded.desconto, frete = excluded.frete;
        v_itens := v_itens + 1;
      end loop;
    end if;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_eventos, '[]')) loop
    insert into public.notas_eventos (chave, empresa_cnpj, tipo, sentido, cstat, motivo, protocolo, quando, xml)
    values (v->>'chave', p_cnpj, v->>'tipo', v->>'sentido', (v->>'cstat')::int, v->>'motivo', v->>'protocolo',
      (v->>'quando')::timestamptz, nullif(v->>'xml', ''))
    on conflict do nothing;
    v_eventos := v_eventos + 1;
    if v->>'sentido' = 'recebido' and v->>'tipo' = '110111' then
      update public.notas set situacao = 'cancelada', atualizado_em = now() where chave = v->>'chave';
    end if;
  end loop;
  return jsonb_build_object('notas', v_notas, 'itens', v_itens, 'eventos', v_eventos);
end $$;
revoke execute on function public.notas_gravar(text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.notas_worker_gravar(p_segredo text, p_execucao uuid, p_notas jsonb, p_eventos jsonb,
  p_ult_nsu text, p_max_nsu text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; r jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then raise exception 'Execução % não está rodando.', p_execucao; end if;
  r := public.notas_gravar(x.empresa_cnpj, p_notas, p_eventos);
  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  update public.notas_execucoes set resultado = resultado || jsonb_build_object(
    'notas', coalesce((resultado->>'notas')::int, 0) + (r->>'notas')::int,
    'itens', coalesce((resultado->>'itens')::int, 0) + (r->>'itens')::int,
    'eventos', coalesce((resultado->>'eventos')::int, 0) + (r->>'eventos')::int)
  where id = x.id;
  return r;
end $$;
revoke execute on function public.notas_worker_gravar(text, uuid, jsonb, jsonb, text, text) from public, authenticated;
grant execute on function public.notas_worker_gravar(text, uuid, jsonb, jsonb, text, text) to anon;

create or replace function public.notas_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat int,
  p_erro text, p_resultado jsonb, p_notas jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text, p_bloquear_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; e public.notas_empresas; r jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then return null; end if;
  r := public.notas_gravar(x.empresa_cnpj, p_notas, p_eventos);

  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu),
    bloqueado_ate = case when x.tipo = 'distribuicao' then p_bloquear_ate else bloqueado_ate end,
    ultima_consulta = case when x.tipo = 'distribuicao' then now() else ultima_consulta end,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200),
    atualizado_em = now()
  where cnpj = x.empresa_cnpj returning * into e;

  update public.notas_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = x.resultado || coalesce(p_resultado, '{}')
  where id = x.id;

  if (select count(*) from public.notas_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
      and created_at > now() - interval '1 day') < 30 then
    if x.tipo = 'distribuicao' and coalesce((p_resultado->>'continua')::boolean, false) then
      perform public.notas_pedir(x.empresa_cnpj, 'distribuicao', 'encadeada', null);
    elsif x.tipo = 'distribuicao' and p_status in ('ok', 'sem_dados') and e.ciencia and exists (
      select 1 from public.notas n where n.empresa_cnpj = x.empresa_cnpj and n.origem = 'sefaz' and not n.completa
        and n.situacao = 'autorizada' and length(n.chave) = 44
        and not exists (select 1 from public.notas_eventos v where v.chave = n.chave and v.tipo = '210210' and v.sentido = 'enviado'
                        and (v.cstat in (135, 136, 573) or v.created_at > now() - interval '1 day'))) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo = 'ciencia' and p_status = 'ok' and coalesce((p_resultado->>'pedidas')::int, 0) >= 20 then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) from public, authenticated;
grant execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) to anon;

-- ---------------------------------------------------------------------
-- Prazo da ciência: a SEFAZ só aceita até 10 dias depois da emissão (cStat 596 depois disso,
-- visto no primeiro teste em 28/10/2026). Nota mais velha que isso, ou já recusada, não entra.
-- ---------------------------------------------------------------------
create or replace function public.notas_pendentes_ciencia(p_cnpj text)
returns table (chave text) language sql stable security definer set search_path = public as $$
  select n.chave from public.notas n
  where n.empresa_cnpj = p_cnpj and n.origem = 'sefaz' and not n.completa and n.situacao = 'autorizada'
    and length(n.chave) = 44 and n.emissao > now() - interval '10 days'
    and not exists (select 1 from public.notas_eventos v where v.chave = n.chave and v.tipo = '210210' and v.sentido = 'enviado'
                    and (v.cstat in (135, 136, 573, 596) or v.created_at > now() - interval '1 day'))
  order by n.emissao desc
$$;
revoke execute on function public.notas_pendentes_ciencia(text) from public, anon, authenticated;

create or replace function public.notas_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.notas_execucoes; e public.notas_empresas; c public.certificados; v_chaves jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.notas_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.notas_empresas where cnpj = x.empresa_cnpj;
  select * into c from public.certificados where cnpj = x.empresa_cnpj;
  if x.tipo = 'ciencia' then
    select coalesce(jsonb_agg(p.chave), '[]') into v_chaves from (select chave from public.notas_pendentes_ciencia(e.cnpj) limit 20) p;
  end if;
  return jsonb_build_object(
    'execucao', to_jsonb(x),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu),
    'chaves', coalesce(v_chaves, '[]'),
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.notas_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.notas_worker_pegar(text, uuid) to anon;

create or replace function public.notas_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat int,
  p_erro text, p_resultado jsonb, p_notas jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text, p_bloquear_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; e public.notas_empresas; r jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then return null; end if;
  r := public.notas_gravar(x.empresa_cnpj, p_notas, p_eventos);

  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu),
    bloqueado_ate = case when x.tipo = 'distribuicao' then p_bloquear_ate else bloqueado_ate end,
    ultima_consulta = case when x.tipo = 'distribuicao' then now() else ultima_consulta end,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200),
    atualizado_em = now()
  where cnpj = x.empresa_cnpj returning * into e;

  update public.notas_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = x.resultado || coalesce(p_resultado, '{}')
  where id = x.id;

  if (select count(*) from public.notas_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
      and created_at > now() - interval '1 day') < 30 then
    if x.tipo = 'distribuicao' and coalesce((p_resultado->>'continua')::boolean, false) then
      perform public.notas_pedir(x.empresa_cnpj, 'distribuicao', 'encadeada', null);
    elsif x.tipo = 'distribuicao' and p_status in ('ok', 'sem_dados') and e.ciencia
      and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo = 'ciencia' and p_status = 'ok' and coalesce((p_resultado->>'pedidas')::int, 0) >= 20
      and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) from public, authenticated;
grant execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) to anon;
