-- =====================================================================
-- Receita Federal: Integra Contador (SERPRO), a API oficial que faz o que se faz no e-CAC
-- (caixa postal, situação fiscal, pagamentos e, depois, guias e declarações).
--
-- Como funciona (o mesmo desenho do eSocial, supabase/esocial.sql):
--  - Usa o certificado e-CNPJ A1 que já está no Vault para o eSocial (esocial_cert_<raiz>).
--    A empresa é a contratante, a autora e a contribuinte: só CNPJ próprio, sem procuração.
--  - As chaves do contrato do SERPRO (Consumer Key e Secret) ficam no Vault em
--    receita_serpro_<raiz>, como JSON {"key": "...", "secret": "..."}. Nunca no site nem no GitHub.
--  - Cada pedido vira uma linha em receita_execucoes. O banco chama a rota /api/receita do site
--    (Vercel, Node), que conversa com o SERPRO e devolve o resultado por receita_worker_concluir.
--  - Ambiente 'demonstracao': o ambiente de testes do SERPRO, com dados de mentira, chave pública
--    e sem custo. Ambiente 'producao': dados reais, cobrado por chamada. Produção só roda com
--    receita_empresas.producao_ligada = true e com as chaves do SERPRO no Vault.
--  - Custo: cada chamada ao SERPRO fica em receita_chamadas. Consultar, Emitir e Declarar são
--    cobradas quando o retorno é 200, 202 ou 403; Apoiar e Monitorar são grátis. O preço segue a
--    tabela da loja do SERPRO (faixa pelo total do mês). Há um limite diário de chamadas cobradas.
-- Quem vê: só quem está em receita_acesso. São dados fiscais (sigilo fiscal e LGPD).
-- =====================================================================

create extension if not exists pg_net;

create table if not exists public.receita_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
-- Começa com os mesmos sócios do eSocial
insert into public.receita_acesso (user_id) select user_id from public.esocial_acesso on conflict do nothing;

-- Configuração por empresa (as empresas e os certificados são os do eSocial)
create table if not exists public.receita_empresas (
  id text primary key references public.esocial_empresas(id),
  producao_ligada boolean not null default false,
  limite_diario_cobradas int not null default 30 check (limite_diario_cobradas between 0 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.receita_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id text not null references public.esocial_empresas(id),
  ambiente text not null check (ambiente in ('demonstracao', 'producao')),
  tipo text not null,
  parametros jsonb not null default '{}',
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'sem_dados', 'falha')),
  resultado jsonb not null default '{}',
  erro text not null default '',
  origem text not null default 'site',
  pedido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  inicio timestamptz,
  fim timestamptz
);
create index if not exists receita_execucoes_empresa on public.receita_execucoes (empresa_id, created_at desc);

-- Cada chamada feita ao SERPRO, com o custo
create table if not exists public.receita_chamadas (
  id bigint generated always as identity primary key,
  execucao_id uuid references public.receita_execucoes(id),
  empresa_id text not null references public.esocial_empresas(id),
  ambiente text not null check (ambiente in ('demonstracao', 'producao')),
  endpoint text not null check (endpoint in ('Apoiar', 'Consultar', 'Declarar', 'Emitir', 'Monitorar')),
  id_sistema text not null,
  id_servico text not null,
  http_status int,
  codigo text not null default '',
  categoria text not null check (categoria in ('consulta', 'emissao', 'declaracao', 'gratis')),
  cobrada boolean not null default false,
  custo numeric(10, 2) not null default 0,
  duracao_ms int,
  created_at timestamptz not null default now()
);
create index if not exists receita_chamadas_mes on public.receita_chamadas (ambiente, created_at) where cobrada;

-- Caixa Postal do e-CAC
create table if not exists public.receita_mensagens (
  ambiente text not null check (ambiente in ('demonstracao', 'producao')),
  empresa_id text not null references public.esocial_empresas(id),
  isn text not null,
  assunto text not null default '',
  remetente text not null default '',
  enviada_em date,
  relevancia text not null default '',
  lida_na_receita boolean not null default false,
  ciencia_em date,
  corpo text,
  detalhe jsonb,
  vista_em timestamptz not null default now(),
  detalhada_em timestamptz,
  primary key (ambiente, empresa_id, isn)
);

-- Relatórios de situação fiscal (SITFIS), em PDF
create table if not exists public.receita_relatorios (
  id uuid primary key default gen_random_uuid(),
  ambiente text not null check (ambiente in ('demonstracao', 'producao')),
  empresa_id text not null references public.esocial_empresas(id),
  tipo text not null default 'situacao_fiscal',
  pdf_base64 text not null,
  tamanho int not null,
  execucao_id uuid references public.receita_execucoes(id),
  created_at timestamptz not null default now()
);
create index if not exists receita_relatorios_empresa on public.receita_relatorios (empresa_id, created_at desc);

-- Pagamentos registrados na Receita (DARF, DAS etc.)
create table if not exists public.receita_pagamentos (
  ambiente text not null check (ambiente in ('demonstracao', 'producao')),
  empresa_id text not null references public.esocial_empresas(id),
  numero_documento text not null,
  tipo_documento text not null default '',
  codigo_receita text not null default '',
  descricao_receita text not null default '',
  periodo_apuracao date,
  data_arrecadacao date,
  data_vencimento date,
  valor_total numeric(14, 2),
  dados jsonb not null default '{}',
  atualizado_em timestamptz not null default now(),
  primary key (ambiente, empresa_id, numero_documento)
);

-- Nada se apaga (mesma proteção das outras tabelas do Brasico)
do $$
declare t text;
begin
  foreach t in array array['receita_acesso', 'receita_empresas', 'receita_execucoes', 'receita_chamadas',
                           'receita_mensagens', 'receita_relatorios', 'receita_pagamentos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.receita_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.receita_acesso where user_id = p_user)
$$;
revoke execute on function public.receita_pode_ver(uuid) from public, anon;
grant execute on function public.receita_pode_ver(uuid) to authenticated;

alter table public.receita_acesso enable row level security;
alter table public.receita_empresas enable row level security;
alter table public.receita_execucoes enable row level security;
alter table public.receita_chamadas enable row level security;
alter table public.receita_mensagens enable row level security;
alter table public.receita_relatorios enable row level security;
alter table public.receita_pagamentos enable row level security;

drop policy if exists "ver acesso" on public.receita_acesso;
create policy "ver acesso" on public.receita_acesso for select using (user_id = auth.uid());
drop policy if exists "ver empresas" on public.receita_empresas;
create policy "ver empresas" on public.receita_empresas for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver execucoes" on public.receita_execucoes;
create policy "ver execucoes" on public.receita_execucoes for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver chamadas" on public.receita_chamadas;
create policy "ver chamadas" on public.receita_chamadas for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver mensagens" on public.receita_mensagens;
create policy "ver mensagens" on public.receita_mensagens for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver relatorios" on public.receita_relatorios;
create policy "ver relatorios" on public.receita_relatorios for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver pagamentos" on public.receita_pagamentos;
create policy "ver pagamentos" on public.receita_pagamentos for select using (public.receita_pode_ver(auth.uid()));

revoke all on public.receita_acesso, public.receita_empresas, public.receita_execucoes, public.receita_chamadas,
  public.receita_mensagens, public.receita_relatorios, public.receita_pagamentos from anon;
grant select on public.receita_acesso, public.receita_empresas, public.receita_execucoes, public.receita_chamadas,
  public.receita_mensagens, public.receita_relatorios, public.receita_pagamentos to authenticated;

do $$ begin alter publication supabase_realtime add table public.receita_execucoes; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Segredo que protege a rota /api/receita (gerado ao acaso aqui)
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'receita_segredo')
where not exists (select 1 from vault.secrets where name = 'receita_segredo');

create or replace function public.receita_conferir_segredo(p_segredo text)
returns void language plpgsql stable security definer set search_path = public, vault as $$
begin
  if coalesce(p_segredo, '') = '' or not exists (
    select 1 from vault.decrypted_secrets where name = 'receita_segredo' and decrypted_secret = p_segredo) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.receita_conferir_segredo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Preço por chamada (tabela da loja do SERPRO, out/2026). A faixa vem do total do mês na categoria.
-- ---------------------------------------------------------------------
create or replace function public.receita_preco(p_categoria text, p_no_mes int)
returns numeric language sql immutable set search_path = public as $$
  select case p_categoria
    when 'consulta' then case
      when p_no_mes <= 300 then 0.24 when p_no_mes <= 1000 then 0.21 when p_no_mes <= 3000 then 0.18
      when p_no_mes <= 7000 then 0.16 when p_no_mes <= 15000 then 0.14 when p_no_mes <= 23000 then 0.11
      when p_no_mes <= 30000 then 0.09 else 0.06 end
    when 'emissao' then case
      when p_no_mes <= 500 then 0.32 when p_no_mes <= 5000 then 0.29 when p_no_mes <= 10000 then 0.26
      when p_no_mes <= 15000 then 0.22 when p_no_mes <= 25000 then 0.19 when p_no_mes <= 35000 then 0.16
      when p_no_mes <= 50000 then 0.12 else 0.08 end
    when 'declaracao' then case
      when p_no_mes <= 100 then 0.40 when p_no_mes <= 500 then 0.36 when p_no_mes <= 1000 then 0.32
      when p_no_mes <= 3000 then 0.28 when p_no_mes <= 5000 then 0.24 when p_no_mes <= 8000 then 0.20
      when p_no_mes <= 10000 then 0.16 else 0.12 end
    else 0 end
$$;

-- ---------------------------------------------------------------------
-- Pedir uma chamada à Receita: confere as regras, registra e chama o site
-- Tipos: caixa_postal, situacao_fiscal, pagamentos
-- ---------------------------------------------------------------------
create or replace function public.receita_pedir(p_empresa text, p_ambiente text, p_tipo text, p_parametros jsonb,
  p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  e public.esocial_empresas;
  r public.receita_empresas;
  v_id uuid;
  v_usadas int;
begin
  select * into e from public.esocial_empresas where id = p_empresa;
  if e.id is null then raise exception 'Empresa "%" não encontrada.', p_empresa; end if;
  insert into public.receita_empresas (id) values (e.id) on conflict do nothing;
  select * into r from public.receita_empresas where id = e.id;

  if p_ambiente not in ('demonstracao', 'producao') then
    raise exception 'Ambiente inválido (demonstracao ou producao).';
  end if;
  if p_tipo not in ('caixa_postal', 'situacao_fiscal', 'pagamentos') then
    raise exception 'Tipo de pedido desconhecido: %', p_tipo;
  end if;

  if p_ambiente = 'producao' then
    if not r.producao_ligada then
      raise exception 'A Receita em produção ainda não foi ligada para %. Por enquanto só a demonstração.', e.nome;
    end if;
    if e.cert_validade is null or e.cert_validade <= now() then
      raise exception 'O certificado da empresa % venceu ou não existe. Envie o novo pela tela do eSocial.', e.nome;
    end if;
    if not exists (select 1 from vault.secrets where name = 'receita_serpro_' || e.id) then
      raise exception 'Faltam as chaves do contrato do SERPRO para %.', e.nome;
    end if;
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = p_ambiente
               and status in ('na_fila', 'rodando') and created_at > now() - interval '5 minutes') then
      raise exception 'Já há um pedido à Receita em andamento para esta empresa; tente em instantes.';
    end if;
    select count(*) into v_usadas from public.receita_chamadas
    where empresa_id = e.id and ambiente = 'producao' and cobrada
      and (created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_usadas >= r.limite_diario_cobradas then
      raise exception 'Limite de % chamadas cobradas por dia já foi usado para %.', r.limite_diario_cobradas, e.nome;
    end if;
  end if;

  insert into public.receita_execucoes (empresa_id, ambiente, tipo, parametros, origem, pedido_por)
  values (e.id, p_ambiente, p_tipo, coalesce(p_parametros, '{}'), coalesce(p_origem, 'site'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/receita',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'receita_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.receita_pedir(text, text, text, jsonb, text, uuid) from public, anon, authenticated;

-- Pelo site, por quem tem acesso
create or replace function public.receita_consultar(p_empresa text, p_ambiente text, p_tipo text, p_parametros jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.receita_pode_ver(auth.uid()) then raise exception 'Sem acesso à Receita' using errcode = '42501'; end if;
  return public.receita_pedir(p_empresa, p_ambiente, p_tipo, p_parametros, 'site', auth.uid());
end $$;
revoke execute on function public.receita_consultar(text, text, text, jsonb) from public, anon;
grant execute on function public.receita_consultar(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Rota do site (/api/receita): pega o pedido (com certificado e chaves só em produção)
-- ---------------------------------------------------------------------
create or replace function public.receita_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.receita_execucoes; e public.esocial_empresas; v_prod boolean;
begin
  perform public.receita_conferir_segredo(p_segredo);
  update public.receita_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.esocial_empresas where id = x.empresa_id;
  v_prod := x.ambiente = 'producao';
  return jsonb_build_object(
    'execucao', to_jsonb(x),
    'empresa', jsonb_build_object('id', e.id, 'nome', e.nome, 'cnpj', e.cnpj),
    'certificado', case when v_prod then
      (select decrypted_secret from vault.decrypted_secrets where name = 'esocial_cert_' || e.id) end,
    'serpro', case when v_prod then
      (select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'receita_serpro_' || e.id) end,
    -- mensagens que já têm o texto completo (não precisa pedir o detalhe de novo)
    'mensagens_detalhadas', coalesce((select jsonb_agg(m.isn) from public.receita_mensagens m
      where m.ambiente = x.ambiente and m.empresa_id = e.id and m.corpo is not null), '[]'::jsonb));
end $$;
revoke execute on function public.receita_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.receita_worker_pegar(text, uuid) to anon;

-- Converte 'AAAAMMDD' ou 'AAAA-MM-DD...' em data
create or replace function public.receita_data(p text)
returns date language sql immutable set search_path = public as $$
  select case
    when p ~ '^\d{8}$' then to_date(p, 'YYYYMMDD')
    when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date
  end
$$;

-- p_chamadas:   [{endpoint, id_sistema, id_servico, http_status, codigo, duracao_ms}]
-- p_mensagens:  [{isn, assunto, remetente, enviada_em, relevancia, lida, ciencia_em, corpo?, detalhe?}]
-- p_relatorios: [{tipo, pdf_base64}]
-- p_pagamentos: [{numero_documento, tipo_documento, codigo_receita, descricao_receita, periodo_apuracao,
--                 data_arrecadacao, data_vencimento, valor_total, dados}]
create or replace function public.receita_worker_concluir(p_segredo text, p_execucao uuid, p_status text,
  p_resultado jsonb, p_erro text, p_chamadas jsonb, p_mensagens jsonb, p_relatorios jsonb, p_pagamentos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.receita_execucoes;
  c jsonb; m jsonb; p jsonb; r jsonb;
  v_cat text; v_cobrada boolean; v_no_mes int;
begin
  perform public.receita_conferir_segredo(p_segredo);
  update public.receita_execucoes set status = p_status, resultado = coalesce(p_resultado, '{}'),
    erro = left(coalesce(p_erro, ''), 1000), fim = now()
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;

  for c in select * from jsonb_array_elements(coalesce(p_chamadas, '[]')) loop
    v_cat := case c->>'endpoint' when 'Consultar' then 'consulta' when 'Emitir' then 'emissao'
                                 when 'Declarar' then 'declaracao' else 'gratis' end;
    v_cobrada := x.ambiente = 'producao' and v_cat <> 'gratis' and (c->>'http_status')::int in (200, 202, 403);
    if v_cobrada then
      select count(*) + 1 into v_no_mes from public.receita_chamadas
      where ambiente = 'producao' and cobrada and categoria = v_cat
        and date_trunc('month', created_at at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo');
    end if;
    insert into public.receita_chamadas (execucao_id, empresa_id, ambiente, endpoint, id_sistema, id_servico,
      http_status, codigo, categoria, cobrada, custo, duracao_ms)
    values (x.id, x.empresa_id, x.ambiente, c->>'endpoint', coalesce(c->>'id_sistema', ''), coalesce(c->>'id_servico', ''),
      (c->>'http_status')::int, left(coalesce(c->>'codigo', ''), 200), v_cat, v_cobrada,
      case when v_cobrada then public.receita_preco(v_cat, v_no_mes) else 0 end, (c->>'duracao_ms')::int);
  end loop;

  for m in select * from jsonb_array_elements(coalesce(p_mensagens, '[]')) loop
    insert into public.receita_mensagens as t (ambiente, empresa_id, isn, assunto, remetente, enviada_em, relevancia,
      lida_na_receita, ciencia_em, corpo, detalhe, detalhada_em)
    values (x.ambiente, x.empresa_id, m->>'isn', coalesce(m->>'assunto', ''), coalesce(m->>'remetente', ''),
      public.receita_data(m->>'enviada_em'), coalesce(m->>'relevancia', ''), coalesce((m->>'lida')::boolean, false),
      public.receita_data(m->>'ciencia_em'), m->>'corpo', m->'detalhe', case when m ? 'corpo' then now() end)
    on conflict (ambiente, empresa_id, isn) do update set
      assunto = case when excluded.assunto <> '' then excluded.assunto else t.assunto end,
      remetente = case when excluded.remetente <> '' then excluded.remetente else t.remetente end,
      enviada_em = coalesce(excluded.enviada_em, t.enviada_em),
      relevancia = case when excluded.relevancia <> '' then excluded.relevancia else t.relevancia end,
      lida_na_receita = excluded.lida_na_receita or t.lida_na_receita,
      ciencia_em = coalesce(excluded.ciencia_em, t.ciencia_em),
      corpo = coalesce(excluded.corpo, t.corpo),
      detalhe = coalesce(excluded.detalhe, t.detalhe),
      detalhada_em = coalesce(excluded.detalhada_em, t.detalhada_em);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_relatorios, '[]')) loop
    insert into public.receita_relatorios (ambiente, empresa_id, tipo, pdf_base64, tamanho, execucao_id)
    values (x.ambiente, x.empresa_id, coalesce(r->>'tipo', 'situacao_fiscal'), r->>'pdf_base64',
      length(r->>'pdf_base64') * 3 / 4, x.id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]')) loop
    insert into public.receita_pagamentos as t (ambiente, empresa_id, numero_documento, tipo_documento, codigo_receita,
      descricao_receita, periodo_apuracao, data_arrecadacao, data_vencimento, valor_total, dados)
    values (x.ambiente, x.empresa_id, p->>'numero_documento', coalesce(p->>'tipo_documento', ''),
      coalesce(p->>'codigo_receita', ''), coalesce(p->>'descricao_receita', ''), public.receita_data(p->>'periodo_apuracao'),
      public.receita_data(p->>'data_arrecadacao'), public.receita_data(p->>'data_vencimento'),
      (p->>'valor_total')::numeric, coalesce(p->'dados', '{}'))
    on conflict (ambiente, empresa_id, numero_documento) do update set
      tipo_documento = excluded.tipo_documento, codigo_receita = excluded.codigo_receita,
      descricao_receita = excluded.descricao_receita, periodo_apuracao = excluded.periodo_apuracao,
      data_arrecadacao = excluded.data_arrecadacao, data_vencimento = excluded.data_vencimento,
      valor_total = excluded.valor_total, dados = excluded.dados, atualizado_em = now();
  end loop;
end $$;
revoke execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, authenticated;
grant execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) to anon;

-- Pedidos que travaram (o site caiu no meio) viram falha depois de 10 minutos
create or replace function public.receita_destravar()
returns void language sql security definer set search_path = public as $$
  update public.receita_execucoes set status = 'falha', erro = 'O site não respondeu a tempo.', fim = now()
  where status in ('na_fila', 'rodando') and created_at < now() - interval '10 minutes';
$$;
revoke execute on function public.receita_destravar() from public, anon, authenticated;
select cron.schedule('receita-destravar', '*/10 * * * *', $job$ select public.receita_destravar() $job$);
