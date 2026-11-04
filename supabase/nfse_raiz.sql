-- =====================================================================
-- NFS-e: revisão de 04/11/2026, depois do primeiro teste real (aplica depois de nfse.sql)
--  - O ADN só aceita a consulta com ?cnpjConsulta= ("CnpjBase") e devolve as notas de TODA a raiz.
--    Então: uma leitora por raiz (a matriz, nfse_leitora) e cada nota vai para o CNPJ do grupo que
--    aparece nela (emitente → emitida, tomador → tomada; só intermedia → o CNPJ consultado).
--    CNPJ do grupo que ainda não estava na lista entra sozinho (ativa = false: lido junto com a matriz).
--  - Documento que não dá para ler fica em nfse_eventos (tipo 'ilegivel') com o original: o NSU não pula nada.
--  - Teste sem gravar notas: nfse_testar(cnpj, '[{"caminho": "/contribuintes/...", "limite": 800}]') (SQL Editor);
--    o resultado fica em nfse_execucoes.resultado.sondas.
-- =====================================================================
alter table public.nfse_execucoes add column if not exists parametros jsonb not null default '{}';

create or replace function public.nfse_leitora(p_cnpj text)
returns text language sql stable security definer set search_path = public as $$
  select cnpj from public.nfse_empresas where raiz = left(p_cnpj, 8)
  order by (substr(cnpj, 9, 4) = '0001') desc, cnpj limit 1
$$;
revoke execute on function public.nfse_leitora(text) from public, anon, authenticated;

create or replace function public.nfse_pedir(p_cnpj text, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare e public.nfse_empresas; c public.certificados; v_id uuid;
begin
  select * into e from public.nfse_empresas where cnpj = public.nfse_leitora(p_cnpj);
  if e.cnpj is null then raise exception 'Empresa % não está nas NFS-e.', p_cnpj; end if;
  c := public.nfse_certificado(e.cnpj);
  if c.cnpj is null then raise exception 'Não há certificado válido da raiz de %. Envie o .pfx em Certificados digitais.', e.nome; end if;
  if e.bloqueado_ate > now() and coalesce(p_origem, 'manual') <> 'encadeada' then
    raise exception 'O Portal Nacional pede para esperar até % antes de consultar % de novo.',
      to_char(e.bloqueado_ate at time zone 'America/Fortaleza', 'HH24:MI'), e.nome;
  end if;
  if exists (select 1 from public.nfse_execucoes where empresa_cnpj = e.cnpj and status in ('na_fila', 'rodando')
             and created_at > now() - interval '10 minutes') then
    raise exception 'Já há uma leitura em andamento para %. Aguarde ela terminar.', e.nome;
  end if;

  insert into public.nfse_execucoes (empresa_cnpj, origem, pedido_por)
  values (e.cnpj, coalesce(p_origem, 'manual'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/nfse',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notas_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.nfse_pedir(text, text, uuid) from public, anon, authenticated;

create or replace function public.nfse_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.nfse_execucoes; e public.nfse_empresas; c public.certificados;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.nfse_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.nfse_empresas where cnpj = x.empresa_cnpj;
  c := public.nfse_certificado(e.cnpj);
  return jsonb_build_object(
    'execucao', jsonb_build_object('id', x.id, 'origem', x.origem, 'teste', x.parametros->'teste'),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu),
    'cert_cnpj', c.cnpj,
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.nfse_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.nfse_worker_pegar(text, uuid) to anon;

create or replace function public.nfse_testar(p_cnpj text, p_teste jsonb)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  insert into public.nfse_execucoes (empresa_cnpj, origem, parametros) values (p_cnpj, 'teste', jsonb_build_object('teste', p_teste))
  returning id into v_id;
  perform net.http_post(
    url := 'https://brasico.vercel.app/api/nfse',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notas_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.nfse_testar(text, jsonb) from public, anon, authenticated;

create or replace function public.nfse_worker_gravar(p_segredo text, p_execucao uuid, p_notas jsonb, p_eventos jsonb, p_ult_nsu bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.nfse_execucoes; n jsonb; v jsonb; v_emp text; v_notas int := 0; v_eventos int := 0;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.nfse_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then raise exception 'Execução % não está rodando', p_execucao; end if;

  for n in select * from jsonb_array_elements(coalesce(p_notas, '[]')) loop
    v_emp := coalesce(n->>'empresa_cnpj', x.empresa_cnpj);
    if left(v_emp, 8) <> left(x.empresa_cnpj, 8) then v_emp := x.empresa_cnpj; end if;
    -- CNPJ do grupo que ainda não estava na lista (outra filial da mesma raiz): entra lido junto com a matriz
    insert into public.nfse_empresas (cnpj, raiz, nome, ativa)
    values (v_emp, left(v_emp, 8),
      coalesce(case when n->>'papel' = 'emitida' then n->>'emitente_nome' else n->>'tomador_nome' end, v_emp)
        || ' (filial ' || substr(v_emp, 9, 4) || ')', false)
    on conflict (cnpj) do nothing;

    insert into public.nfse_notas as t (empresa_cnpj, chave, papel, numero, emissao, competencia, emitente_cnpj,
      emitente_nome, emitente_municipio, tomador_doc, tomador_nome, local_incidencia, codigo_servico, descricao,
      valor_servico, base_calculo, aliquota, iss, iss_retido, valor_liquido, nsu, xml)
    values (v_emp, n->>'chave', n->>'papel', n->>'numero', (n->>'emissao')::timestamptz,
      (n->>'competencia')::date, n->>'emitente_cnpj', n->>'emitente_nome', n->>'emitente_municipio',
      n->>'tomador_doc', n->>'tomador_nome', n->>'local_incidencia', n->>'codigo_servico', n->>'descricao',
      (n->>'valor_servico')::numeric, (n->>'base_calculo')::numeric, (n->>'aliquota')::numeric, (n->>'iss')::numeric,
      (n->>'iss_retido')::boolean, (n->>'valor_liquido')::numeric, (n->>'nsu')::bigint, n->>'xml')
    on conflict (empresa_cnpj, chave) do update set
      papel = excluded.papel, numero = excluded.numero, emissao = excluded.emissao, competencia = excluded.competencia,
      emitente_cnpj = excluded.emitente_cnpj, emitente_nome = excluded.emitente_nome,
      emitente_municipio = excluded.emitente_municipio, tomador_doc = excluded.tomador_doc,
      tomador_nome = excluded.tomador_nome, local_incidencia = excluded.local_incidencia,
      codigo_servico = excluded.codigo_servico, descricao = excluded.descricao, valor_servico = excluded.valor_servico,
      base_calculo = excluded.base_calculo, aliquota = excluded.aliquota, iss = excluded.iss,
      iss_retido = excluded.iss_retido, valor_liquido = excluded.valor_liquido, nsu = excluded.nsu, xml = excluded.xml,
      atualizado_em = now();
    v_notas := v_notas + 1;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_eventos, '[]')) loop
    insert into public.nfse_eventos (empresa_cnpj, chave, tipo, descricao, quando, nsu, xml)
    values (x.empresa_cnpj, v->>'chave', v->>'tipo', v->>'descricao', (v->>'quando')::timestamptz,
      (v->>'nsu')::bigint, v->>'xml')
    on conflict do nothing;
    v_eventos := v_eventos + 1;
  end loop;

  -- Situação vem dos eventos da chave (também dos que chegaram antes da própria nota)
  update public.nfse_notas t set situacao = case when exists (
      select 1 from public.nfse_eventos v where v.chave = t.chave and v.tipo = '105102') then 'substituida' else 'cancelada' end,
    atualizado_em = now()
  where left(t.empresa_cnpj, 8) = left(x.empresa_cnpj, 8) and t.situacao = 'normal'
    and exists (select 1 from public.nfse_eventos v where v.chave = t.chave
                and v.tipo in ('101101', '105102', '105104', '305101'));

  update public.nfse_empresas set ult_nsu = greatest(ult_nsu, coalesce(p_ult_nsu, 0)), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  return jsonb_build_object('notas', v_notas, 'eventos', v_eventos);
end $$;
revoke execute on function public.nfse_worker_gravar(text, uuid, jsonb, jsonb, bigint) from public, authenticated;
grant execute on function public.nfse_worker_gravar(text, uuid, jsonb, jsonb, bigint) to anon;

create or replace function public.nfse_rodada()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  perform public.nfse_destravar();
  for e in select distinct public.nfse_leitora(cnpj) cnpj from public.nfse_empresas where ativa loop
    begin
      if exists (select 1 from public.nfse_empresas where cnpj = e.cnpj and (bloqueado_ate is null or bloqueado_ate < now())) then
        perform public.nfse_pedir(e.cnpj, 'agenda', null);
        n := n + 1;
      end if;
    exception when others then null;  -- sem certificado ou já em andamento: tenta na próxima
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.nfse_rodada() from public, anon, authenticated;

-- As filiais são lidas junto com a matriz
update public.nfse_empresas set ativa = false where cnpj <> public.nfse_leitora(cnpj);
