-- =====================================================================
-- Notas fiscais (Operação · fase 1)
--  - NF-e recebidas pelas empresas do Brasico, baixadas da SEFAZ pela distribuição
--    de documentos do Ambiente Nacional (NT 2014.002: NFeDistribuicaoDFe, até 50 por
--    chamada, últimos 90 dias), com os certificados A1 da tabela certificados.
--  - Ciência da operação (evento 210210) nas notas que chegam só em resumo: libera a
--    nota completa. Só a ciência: nenhuma confirmação, desconhecimento ou recusa.
--  - Nota avulsa: compra sem NF-e (cupom, recibo), lançada com foto, itens e valor.
--  - Pedido em notas_execucoes → o banco chama /api/notas (pg_net) → o site conversa
--    com a SEFAZ e devolve por notas_worker_concluir. Mesmo desenho do eSocial.
--  - Regra da SEFAZ: sem documento novo (cStat 137), esperar 1 hora; consulta antes
--    disso dá 656 e bloqueia o CNPJ por 1 hora (bloqueado_ate).
-- Quem vê: só quem está em notas_acesso (os sócios). Página: /notas.
-- =====================================================================

create table if not exists public.notas_acesso (
  user_id uuid primary key references auth.users(id),
  criado_em timestamptz not null default now()
);
insert into public.notas_acesso (user_id) select user_id from public.cicchetti_acesso on conflict do nothing;

create or replace function public.notas_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notas_acesso where user_id = p_user)
$$;
revoke execute on function public.notas_pode_ver(uuid) from public, anon;
grant execute on function public.notas_pode_ver(uuid) to authenticated;

-- Empresas consultadas: um CNPJ por certificado (matriz e filial separadas)
create table if not exists public.notas_empresas (
  cnpj text primary key references public.certificados(cnpj),
  nome text not null,
  ativa boolean not null default false,          -- entra na rotina semanal
  ciencia boolean not null default false,        -- registra a ciência das notas em resumo
  ult_nsu text not null default '000000000000000',
  max_nsu text,
  bloqueado_ate timestamptz,                     -- regra de 1 hora da SEFAZ
  ultima_consulta timestamptz,
  ultimo_status text,
  atualizado_em timestamptz not null default now()
);
insert into public.notas_empresas (cnpj, nome)
select c.cnpj, c.nome || case when c.matriz then '' else ' (filial ' || substr(c.cnpj, 9, 4) || ')' end
from public.certificados c on conflict (cnpj) do nothing;

create table if not exists public.notas (
  chave text primary key,                        -- 44 dígitos; nota avulsa: 'AVULSA-<uuid>'
  empresa_cnpj text not null,                    -- quem recebeu (destinatário)
  origem text not null check (origem in ('sefaz', 'avulsa')),
  emitente_cnpj text,
  emitente_nome text,
  emissao timestamptz,
  valor numeric,
  situacao text not null default 'autorizada',   -- autorizada, cancelada, denegada
  completa boolean not null default false,       -- false: só o resumo da SEFAZ
  nsu text,
  resumo jsonb not null default '{}',
  xml text,
  foto text,                                     -- nota avulsa: caminho no bucket notas-avulsas
  observacao text,
  lancada_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists notas_empresa_emissao on public.notas (empresa_cnpj, emissao desc);
create index if not exists notas_emitente on public.notas (emitente_cnpj);

create table if not exists public.notas_itens (
  chave text not null references public.notas(chave),
  n_item int not null,
  codigo text,
  descricao text not null,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric,
  valor_unitario numeric,
  valor_total numeric,
  desconto numeric not null default 0,
  frete numeric not null default 0,
  preco_efetivo numeric generated always as (
    case when coalesce(quantidade, 0) > 0 then (coalesce(valor_total, 0) - desconto + frete) / quantidade end) stored,
  primary key (chave, n_item)
);
create index if not exists notas_itens_descricao on public.notas_itens using gin (to_tsvector('portuguese', descricao));

-- Eventos: os que o Brasico enviou (ciência) e os que vieram da SEFAZ (ex.: cancelamento)
create table if not exists public.notas_eventos (
  id bigint generated always as identity primary key,
  chave text not null,
  empresa_cnpj text not null,
  tipo text not null,                            -- 210210 ciência, 110111 cancelamento, ...
  sentido text not null check (sentido in ('enviado', 'recebido')),
  cstat int,
  motivo text,
  protocolo text,
  quando timestamptz,
  xml text,
  created_at timestamptz not null default now()
);
create unique index if not exists notas_eventos_enviado on public.notas_eventos (chave, tipo) where sentido = 'enviado' and cstat in (135, 136, 573);
create index if not exists notas_eventos_chave on public.notas_eventos (chave);

create table if not exists public.notas_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_cnpj text not null references public.notas_empresas(cnpj),
  tipo text not null check (tipo in ('distribuicao', 'ciencia')),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'sem_dados', 'falha')),
  origem text not null default 'manual',         -- manual, agenda, encadeada
  parametros jsonb not null default '{}',
  resultado jsonb not null default '{}',
  cstat int,
  erro text,
  pedido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  inicio timestamptz,
  fim timestamptz
);
create index if not exists notas_execucoes_empresa on public.notas_execucoes (empresa_cnpj, created_at desc);

-- Acesso: leitura para notas_acesso; escrita só pelas funções abaixo
do $$ declare t text; begin
  foreach t in array array['notas_acesso', 'notas_empresas', 'notas', 'notas_itens', 'notas_eventos', 'notas_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table public.notas_execucoes; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Segredo que protege a rota /api/notas (gerado ao acaso aqui)
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'notas_segredo')
where not exists (select 1 from vault.secrets where name = 'notas_segredo');

create or replace function public.notas_conferir_segredo(p_segredo text)
returns void language plpgsql stable security definer set search_path = public, vault as $$
begin
  if coalesce(p_segredo, '') = '' or not exists (
    select 1 from vault.decrypted_secrets where name = 'notas_segredo' and decrypted_secret = p_segredo) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.notas_conferir_segredo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pedir uma chamada à SEFAZ: confere certificado, regra de 1 hora e um pedido por vez
-- ---------------------------------------------------------------------
create or replace function public.notas_pedir(p_cnpj text, p_tipo text, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare e public.notas_empresas; c public.certificados; v_id uuid;
begin
  select * into e from public.notas_empresas where cnpj = p_cnpj;
  if e.cnpj is null then raise exception 'Empresa % não está nas notas.', p_cnpj; end if;
  select * into c from public.certificados where cnpj = p_cnpj;
  if c.validade <= now() then raise exception 'O certificado de % venceu. Envie o novo em Certificados digitais.', e.nome; end if;
  if p_tipo = 'distribuicao' and e.bloqueado_ate > now() then
    raise exception 'A SEFAZ pede para esperar até % antes de consultar % de novo.',
      to_char(e.bloqueado_ate at time zone 'America/Fortaleza', 'HH24:MI'), e.nome;
  end if;
  if p_tipo = 'ciencia' and not e.ciencia then raise exception 'A ciência está desligada para %.', e.nome; end if;
  if exists (select 1 from public.notas_execucoes where empresa_cnpj = p_cnpj and status in ('na_fila', 'rodando')
             and created_at > now() - interval '10 minutes') then
    raise exception 'Já há um pedido em andamento para %. Aguarde ele terminar.', e.nome;
  end if;

  insert into public.notas_execucoes (empresa_cnpj, tipo, origem, pedido_por)
  values (p_cnpj, p_tipo, coalesce(p_origem, 'manual'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/notas',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notas_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.notas_pedir(text, text, text, uuid) from public, anon, authenticated;

-- Botão "Buscar agora" da página (sócios)
create or replace function public.notas_buscar(p_cnpj text, p_tipo text default 'distribuicao')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  return public.notas_pedir(p_cnpj, p_tipo, 'manual', auth.uid());
end $$;
revoke execute on function public.notas_buscar(text, text) from public, anon;
grant execute on function public.notas_buscar(text, text) to authenticated;

-- Ligar a empresa na rotina e a ciência (sócios)
create or replace function public.notas_ajustar(p_cnpj text, p_ativa boolean, p_ciencia boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  update public.notas_empresas set ativa = coalesce(p_ativa, ativa), ciencia = coalesce(p_ciencia, ciencia), atualizado_em = now()
  where cnpj = p_cnpj;
end $$;
revoke execute on function public.notas_ajustar(text, boolean, boolean) from public, anon;
grant execute on function public.notas_ajustar(text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Rota do site (/api/notas): pega o pedido com o certificado e devolve o resultado
-- ---------------------------------------------------------------------
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
  -- Ciência: até 20 notas em resumo, autorizadas, sem ciência registrada (o lote da SEFAZ aceita 20 eventos)
  if x.tipo = 'ciencia' then
    select coalesce(jsonb_agg(n.chave), '[]') into v_chaves from (
      select chave from public.notas n
      where n.empresa_cnpj = e.cnpj and n.origem = 'sefaz' and not n.completa and n.situacao = 'autorizada'
        and length(n.chave) = 44
        and not exists (select 1 from public.notas_eventos v where v.chave = n.chave and v.tipo = '210210'
                        and v.sentido = 'enviado' and v.cstat in (135, 136, 573))
        and not exists (select 1 from public.notas_eventos v where v.chave = n.chave and v.tipo = '210210'
                        and v.sentido = 'enviado' and v.created_at > now() - interval '1 day')
      order by n.emissao desc limit 20) n;
  end if;
  return jsonb_build_object(
    'execucao', to_jsonb(x),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu),
    'chaves', coalesce(v_chaves, '[]'),
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.notas_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.notas_worker_pegar(text, uuid) to anon;

-- p_notas: [{chave, emitente_cnpj, emitente_nome, emissao, valor, situacao, completa, nsu, resumo, xml, itens:[...]}]
-- p_eventos: [{chave, tipo, sentido, cstat, motivo, protocolo, quando, xml}]
-- Nota completa nunca volta a ser resumo; evento de cancelamento recebido marca a nota.
create or replace function public.notas_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat int,
  p_erro text, p_resultado jsonb, p_notas jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text, p_bloquear_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; n jsonb; i jsonb; v jsonb; v_notas int := 0; v_itens int := 0; v_eventos int := 0;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then return null; end if;

  for n in select * from jsonb_array_elements(coalesce(p_notas, '[]')) loop
    insert into public.notas as t (chave, empresa_cnpj, origem, emitente_cnpj, emitente_nome, emissao, valor, situacao,
      completa, nsu, resumo, xml)
    values (n->>'chave', x.empresa_cnpj, 'sefaz', n->>'emitente_cnpj', n->>'emitente_nome', (n->>'emissao')::timestamptz,
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
        insert into public.notas_itens as t (chave, n_item, codigo, descricao, ncm, cfop, unidade, quantidade,
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
    values (v->>'chave', x.empresa_cnpj, v->>'tipo', v->>'sentido', (v->>'cstat')::int, v->>'motivo', v->>'protocolo',
      (v->>'quando')::timestamptz, v->>'xml')
    on conflict do nothing;
    v_eventos := v_eventos + 1;
    if v->>'sentido' = 'recebido' and v->>'tipo' = '110111' then
      update public.notas set situacao = 'cancelada', atualizado_em = now() where chave = v->>'chave';
    end if;
  end loop;

  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu),
    bloqueado_ate = case when x.tipo = 'distribuicao' then p_bloquear_ate else bloqueado_ate end,
    ultima_consulta = case when x.tipo = 'distribuicao' then now() else ultima_consulta end,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200),
    atualizado_em = now()
  where cnpj = x.empresa_cnpj;

  update public.notas_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = coalesce(p_resultado, '{}') || jsonb_build_object('notas', v_notas, 'itens', v_itens, 'eventos', v_eventos)
  where id = x.id;
  return jsonb_build_object('notas', v_notas, 'itens', v_itens, 'eventos', v_eventos);
end $$;
revoke execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) from public, authenticated;
grant execute on function public.notas_worker_concluir(text, uuid, text, int, text, jsonb, jsonb, jsonb, text, text, timestamptz) to anon;

-- Pedido que travou (site não respondeu): vira falha depois de 15 minutos
create or replace function public.notas_destravar()
returns void language sql security definer set search_path = public as $$
  update public.notas_execucoes set status = 'falha', erro = 'conexão: o site não respondeu a tempo', fim = now()
  where status in ('na_fila', 'rodando') and created_at < now() - interval '15 minutes'
$$;
revoke execute on function public.notas_destravar() from public, anon, authenticated;
select cron.unschedule('notas-destravar') where exists (select 1 from cron.job where jobname = 'notas-destravar');
select cron.schedule('notas-destravar', '*/15 * * * *', $job$ select public.notas_destravar() $job$);

-- ---------------------------------------------------------------------
-- Nota avulsa: compra sem NF-e (cupom, recibo). Foto no bucket privado notas-avulsas.
-- p_itens: [{descricao, quantidade, unidade, valor_total}]
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('notas-avulsas', 'notas-avulsas', false) on conflict (id) do nothing;
drop policy if exists "notas avulsas enviar" on storage.objects;
create policy "notas avulsas enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'notas-avulsas' and public.notas_pode_ver(auth.uid()));
drop policy if exists "notas avulsas ver" on storage.objects;
create policy "notas avulsas ver" on storage.objects for select to authenticated
  using (bucket_id = 'notas-avulsas' and public.notas_pode_ver(auth.uid()));

create or replace function public.notas_lancar_avulsa(p_empresa text, p_loja text, p_data date, p_valor numeric,
  p_itens jsonb, p_foto text, p_observacao text)
returns text language plpgsql security definer set search_path = public as $$
declare v_chave text := 'AVULSA-' || gen_random_uuid(); i jsonb; k int := 0;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  if coalesce(trim(p_loja), '') = '' then raise exception 'Informe onde foi a compra.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor total da compra.'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Inclua pelo menos um item.'; end if;
  insert into public.notas (chave, empresa_cnpj, origem, emitente_nome, emissao, valor, completa, resumo, foto, observacao, lancada_por)
  values (v_chave, coalesce(nullif(p_empresa, ''), '-'), 'avulsa', trim(p_loja), coalesce(p_data, current_date)::timestamptz,
    p_valor, true, '{}', nullif(p_foto, ''), nullif(trim(p_observacao), ''), auth.uid());
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    if coalesce(trim(i->>'descricao'), '') = '' then raise exception 'O item % está sem nome.', k; end if;
    insert into public.notas_itens (chave, n_item, descricao, unidade, quantidade, valor_total, valor_unitario)
    values (v_chave, k, trim(i->>'descricao'), nullif(trim(i->>'unidade'), ''), (i->>'quantidade')::numeric,
      (i->>'valor_total')::numeric,
      case when coalesce((i->>'quantidade')::numeric, 0) > 0 then (i->>'valor_total')::numeric / (i->>'quantidade')::numeric end);
  end loop;
  return v_chave;
end $$;
revoke execute on function public.notas_lancar_avulsa(text, text, date, numeric, jsonb, text, text) from public, anon;
grant execute on function public.notas_lancar_avulsa(text, text, date, numeric, jsonb, text, text) to authenticated;
