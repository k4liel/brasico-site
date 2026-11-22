-- =====================================================================
-- CT-e (conhecimento de transporte eletrônico, o frete) pelo Ambiente Nacional do CT-e
-- (22/11/2026, pedido do dono: "puxe todas as NFC-e e os CT-e também, e deixe separado").
--  - Serviço CTeDistribuicaoDFe (NT 2015.002, versão 1.00), com o certificado A1 da empresa, grátis:
--    https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx. Devolve, por NSU (até 50
--    por chamada), todo CT-e e CT-e OS em que o CNPJ aparece: emitente, remetente, destinatário,
--    expedidor, recebedor, tomador (quem paga o frete) ou autorizado; e os eventos (110111 cancelamento...).
--  - Mesmas regras da NF-e: sem documento novo (137) espera 1 hora; consultar antes dá 656 e bloqueia 1 hora.
--    A SEFAZ guarda um só "último NSU" por CNPJ: se outro sistema consultar o mesmo CNPJ, a rejeição traz o NSU
--    dela; o Brasico segue dali e busca o trecho do meio um a um (lacunas, até 15 por leitura).
--  - Mesmo desenho das notas: cte_pedir → pg_net → /api/cte → cte_worker_gravar (cada lote) → cte_worker_concluir
--    (encadeia a continuação). Segredo: o mesmo notas_segredo. Rotina cte-rodada a cada hora (minuto 20).
--  - Cada CT-e liga às NF-e que ele transporta (nfes = chaves): a página mostra a nota da compra.
-- Quem vê: notas_pode_ver (os sócios). Página: /notas, aba CT-e.
-- =====================================================================

create table if not exists public.cte_empresas (
  cnpj text primary key,
  nome text not null,
  ativa boolean not null default true,           -- entra na rotina de hora em hora
  ult_nsu text not null default '000000000000000',
  max_nsu text,
  lacunas jsonb not null default '[]',           -- trechos de NSU que outro sistema levou: [{de, ate}]
  bloqueado_ate timestamptz,                     -- regra de 1 hora da SEFAZ
  ultima_consulta timestamptz,
  ultimo_status text,
  atualizado_em timestamptz not null default now()
);
insert into public.cte_empresas (cnpj, nome)
select cnpj, nome from public.notas_empresas on conflict (cnpj) do nothing;

create table if not exists public.cte_notas (
  empresa_cnpj text not null references public.cte_empresas(cnpj),
  chave text not null,                           -- 44 dígitos
  papeis text[] not null default '{}',           -- o que o CNPJ é neste CT-e: tomador, destinatario, remetente...
  numero text,
  serie text,
  modelo text,                                   -- 57 CT-e, 67 CT-e OS
  emissao timestamptz,
  cfop text,
  natureza text,
  modal text,                                    -- 01 rodoviário, 02 aéreo, 03 aquaviário, 04 ferroviário, 05 dutoviário, 06 multimodal
  tipo_cte text,                                 -- 0 normal, 1 complemento, 2 anulação, 3 substituto
  tipo_servico text,
  emitente_cnpj text, emitente_nome text, emitente_uf text,     -- a transportadora
  remetente_doc text, remetente_nome text,
  destinatario_doc text, destinatario_nome text,
  expedidor_doc text, expedidor_nome text,
  recebedor_doc text, recebedor_nome text,
  tomador_tipo text, tomador_doc text, tomador_nome text,        -- quem paga o frete
  origem text, destino text,
  valor_prestacao numeric, valor_receber numeric,
  base_icms numeric, icms numeric, aliquota_icms numeric,
  valor_carga numeric, produto text,
  componentes jsonb not null default '[]',
  quantidades jsonb not null default '[]',
  nfes text[] not null default '{}',             -- chaves das NF-e transportadas
  protocolo text,
  observacao text,
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada')),
  desacordo boolean not null default false,      -- evento 610110: prestação de serviço em desacordo
  nsu bigint,
  xml text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_cnpj, chave)
);
create index if not exists cte_notas_emissao on public.cte_notas (empresa_cnpj, emissao desc);
create index if not exists cte_notas_chave on public.cte_notas (chave);
create index if not exists cte_notas_nfes on public.cte_notas using gin (nfes);

create table if not exists public.cte_eventos (
  id bigint generated always as identity primary key,
  empresa_cnpj text not null,
  chave text not null,
  tipo text not null,                            -- 110111 cancelamento, 610110 desacordo, ...; 'ilegivel' = não deu para ler
  descricao text,
  quando timestamptz,
  protocolo text,
  nsu bigint,
  xml text,
  created_at timestamptz not null default now()
);
create unique index if not exists cte_eventos_nsu on public.cte_eventos (empresa_cnpj, nsu);
create index if not exists cte_eventos_chave on public.cte_eventos (chave);

create table if not exists public.cte_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_cnpj text not null references public.cte_empresas(cnpj),
  status text not null default 'na_fila' check (status in ('na_fila', 'rodando', 'ok', 'sem_dados', 'falha')),
  origem text not null default 'manual',         -- manual, agenda, encadeada
  cstat int,
  resultado jsonb not null default '{}',
  erro text,
  pedido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  inicio timestamptz,
  fim timestamptz
);
create index if not exists cte_execucoes_empresa on public.cte_execucoes (empresa_cnpj, created_at desc);

do $$ declare t text; begin
  foreach t in array array['cte_empresas', 'cte_notas', 'cte_eventos', 'cte_execucoes'] loop
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
do $$ begin alter publication supabase_realtime add table public.cte_execucoes; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Pedir uma leitura: certificado (o do CNPJ ou o da matriz, nfse_certificado), regra de 1 hora e um pedido por vez
-- ---------------------------------------------------------------------
create or replace function public.cte_pedir(p_cnpj text, p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare e public.cte_empresas; c public.certificados; v_id uuid;
begin
  select * into e from public.cte_empresas where cnpj = p_cnpj;
  if e.cnpj is null then raise exception 'Empresa % não está nos CT-e.', p_cnpj; end if;
  c := public.nfse_certificado(p_cnpj);
  if c.cnpj is null then raise exception 'Não há certificado válido de %. Envie o .pfx em Certificados digitais.', e.nome; end if;
  if e.bloqueado_ate > now() and coalesce(p_origem, 'manual') <> 'encadeada' then
    raise exception 'A SEFAZ pede para esperar até % antes de consultar % de novo (regra de 1 hora).',
      to_char(e.bloqueado_ate at time zone 'America/Fortaleza', 'HH24:MI'), e.nome;
  end if;
  if exists (select 1 from public.cte_execucoes where empresa_cnpj = p_cnpj and status in ('na_fila', 'rodando')
             and created_at > now() - interval '10 minutes') then
    raise exception 'Já há uma leitura em andamento para %. Aguarde ela terminar.', e.nome;
  end if;

  insert into public.cte_execucoes (empresa_cnpj, origem, pedido_por)
  values (p_cnpj, coalesce(p_origem, 'manual'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/cte',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'notas_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.cte_pedir(text, text, uuid) from public, anon, authenticated;

create or replace function public.cte_buscar(p_cnpj text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  return public.cte_pedir(p_cnpj, 'manual', auth.uid());
end $$;
revoke execute on function public.cte_buscar(text) from public, anon;
grant execute on function public.cte_buscar(text) to authenticated;

create or replace function public.cte_ajustar(p_cnpj text, p_ativa boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'Sem acesso às notas' using errcode = '42501'; end if;
  update public.cte_empresas set ativa = p_ativa, atualizado_em = now() where cnpj = p_cnpj;
end $$;
revoke execute on function public.cte_ajustar(text, boolean) from public, anon;
grant execute on function public.cte_ajustar(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Rota do site (/api/cte)
-- ---------------------------------------------------------------------
create or replace function public.cte_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.cte_execucoes; e public.cte_empresas; c public.certificados;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.cte_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.cte_empresas where cnpj = x.empresa_cnpj;
  c := public.nfse_certificado(e.cnpj);
  return jsonb_build_object(
    'execucao', jsonb_build_object('id', x.id, 'origem', x.origem),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu, 'lacunas', e.lacunas),
    'cert_cnpj', c.cnpj,
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.cte_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.cte_worker_pegar(text, uuid) to anon;

-- Grava um lote. p_ctes: os conhecimentos lidos (lib/cte/documentos.ts); p_eventos: [{chave, tipo, descricao, quando, protocolo, nsu, xml}]
create or replace function public.cte_worker_gravar(p_segredo text, p_execucao uuid, p_ctes jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.cte_execucoes; c jsonb; v jsonb; v_ctes int := 0; v_eventos int := 0;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.cte_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then raise exception 'Execução % não está rodando', p_execucao; end if;

  for c in select * from jsonb_array_elements(coalesce(p_ctes, '[]')) loop
    insert into public.cte_notas as t (empresa_cnpj, chave, papeis, numero, serie, modelo, emissao, cfop, natureza, modal, tipo_cte,
      tipo_servico, emitente_cnpj, emitente_nome, emitente_uf, remetente_doc, remetente_nome, destinatario_doc, destinatario_nome,
      expedidor_doc, expedidor_nome, recebedor_doc, recebedor_nome, tomador_tipo, tomador_doc, tomador_nome, origem, destino,
      valor_prestacao, valor_receber, base_icms, icms, aliquota_icms, valor_carga, produto, componentes, quantidades, nfes,
      protocolo, observacao, nsu, xml)
    values (x.empresa_cnpj, c->>'chave', coalesce((select array_agg(p) from jsonb_array_elements_text(c->'papeis') p), '{}'),
      c->>'numero', c->>'serie', c->>'modelo', (c->>'emissao')::timestamptz, c->>'cfop', c->>'natureza', c->>'modal', c->>'tipo_cte',
      c->>'tipo_servico', c->>'emitente_cnpj', c->>'emitente_nome', c->>'emitente_uf', c->>'remetente_doc', c->>'remetente_nome',
      c->>'destinatario_doc', c->>'destinatario_nome', c->>'expedidor_doc', c->>'expedidor_nome', c->>'recebedor_doc',
      c->>'recebedor_nome', c->>'tomador_tipo', c->>'tomador_doc', c->>'tomador_nome', c->>'origem', c->>'destino',
      (c->>'valor_prestacao')::numeric, (c->>'valor_receber')::numeric, (c->>'base_icms')::numeric, (c->>'icms')::numeric,
      (c->>'aliquota_icms')::numeric, (c->>'valor_carga')::numeric, c->>'produto', coalesce(c->'componentes', '[]'),
      coalesce(c->'quantidades', '[]'), coalesce((select array_agg(k) from jsonb_array_elements_text(c->'nfes') k), '{}'),
      c->>'protocolo', c->>'observacao', (c->>'nsu')::bigint, c->>'xml')
    on conflict (empresa_cnpj, chave) do update set
      papeis = excluded.papeis, numero = excluded.numero, serie = excluded.serie, modelo = excluded.modelo, emissao = excluded.emissao,
      cfop = excluded.cfop, natureza = excluded.natureza, modal = excluded.modal, tipo_cte = excluded.tipo_cte,
      tipo_servico = excluded.tipo_servico, emitente_cnpj = excluded.emitente_cnpj, emitente_nome = excluded.emitente_nome,
      emitente_uf = excluded.emitente_uf, remetente_doc = excluded.remetente_doc, remetente_nome = excluded.remetente_nome,
      destinatario_doc = excluded.destinatario_doc, destinatario_nome = excluded.destinatario_nome,
      expedidor_doc = excluded.expedidor_doc, expedidor_nome = excluded.expedidor_nome, recebedor_doc = excluded.recebedor_doc,
      recebedor_nome = excluded.recebedor_nome, tomador_tipo = excluded.tomador_tipo, tomador_doc = excluded.tomador_doc,
      tomador_nome = excluded.tomador_nome, origem = excluded.origem, destino = excluded.destino,
      valor_prestacao = excluded.valor_prestacao, valor_receber = excluded.valor_receber, base_icms = excluded.base_icms,
      icms = excluded.icms, aliquota_icms = excluded.aliquota_icms, valor_carga = excluded.valor_carga, produto = excluded.produto,
      componentes = excluded.componentes, quantidades = excluded.quantidades, nfes = excluded.nfes, protocolo = excluded.protocolo,
      observacao = excluded.observacao, nsu = excluded.nsu, xml = excluded.xml, atualizado_em = now();
    v_ctes := v_ctes + 1;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_eventos, '[]')) loop
    insert into public.cte_eventos (empresa_cnpj, chave, tipo, descricao, quando, protocolo, nsu, xml)
    values (x.empresa_cnpj, v->>'chave', v->>'tipo', v->>'descricao', (v->>'quando')::timestamptz, v->>'protocolo',
      (v->>'nsu')::bigint, v->>'xml')
    on conflict do nothing;
    v_eventos := v_eventos + 1;
  end loop;

  -- Situação pelos eventos da chave (também os que chegaram antes do próprio CT-e)
  update public.cte_notas t set situacao = 'cancelada', atualizado_em = now()
  where t.empresa_cnpj = x.empresa_cnpj and t.situacao = 'autorizada'
    and exists (select 1 from public.cte_eventos v where v.chave = t.chave and v.tipo = '110111');
  update public.cte_notas t set desacordo = true, atualizado_em = now()
  where t.empresa_cnpj = x.empresa_cnpj and not t.desacordo
    and exists (select 1 from public.cte_eventos v where v.chave = t.chave and v.tipo = '610110');

  update public.cte_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(nullif(p_max_nsu, ''), max_nsu), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  return jsonb_build_object('ctes', v_ctes, 'eventos', v_eventos);
end $$;
revoke execute on function public.cte_worker_gravar(text, uuid, jsonb, jsonb, text, text) from public, authenticated;
grant execute on function public.cte_worker_gravar(text, uuid, jsonb, jsonb, text, text) to anon;

create or replace function public.cte_worker_lacunas(p_segredo text, p_execucao uuid, p_lacunas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.cte_execucoes;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.cte_execucoes where id = p_execucao and status = 'rodando';
  if x.id is null then raise exception 'Execução % não está rodando', p_execucao; end if;
  update public.cte_empresas set lacunas = coalesce(p_lacunas, '[]'), atualizado_em = now() where cnpj = x.empresa_cnpj;
end $$;
revoke execute on function public.cte_worker_lacunas(text, uuid, jsonb) from public, authenticated;
grant execute on function public.cte_worker_lacunas(text, uuid, jsonb) to anon;

-- Fim da leitura. Se a rota parou no meio (tempo), encadeia a continuação (no máximo 40 por empresa por dia).
create or replace function public.cte_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat int, p_erro text,
  p_resultado jsonb, p_bloquear_ate timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare x public.cte_execucoes;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.cte_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = coalesce(p_resultado, '{}')
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;
  update public.cte_empresas set ultima_consulta = now(), bloqueado_ate = coalesce(p_bloquear_ate, bloqueado_ate),
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200), atualizado_em = now()
  where cnpj = x.empresa_cnpj;
  if p_status = 'ok' and coalesce((p_resultado->>'continua')::boolean, false)
     and (select count(*) from public.cte_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
          and created_at > now() - interval '1 day') < 40 then
    perform public.cte_pedir(x.empresa_cnpj, 'encadeada', null);
  end if;
end $$;
revoke execute on function public.cte_worker_concluir(text, uuid, text, int, text, jsonb, timestamptz) from public, authenticated;
grant execute on function public.cte_worker_concluir(text, uuid, text, int, text, jsonb, timestamptz) to anon;

create or replace function public.cte_destravar()
returns void language sql security definer set search_path = public as $$
  update public.cte_execucoes set status = 'falha', erro = 'conexão: o site não respondeu a tempo', fim = now()
  where status in ('na_fila', 'rodando') and created_at < now() - interval '15 minutes'
$$;
revoke execute on function public.cte_destravar() from public, anon, authenticated;

-- Rotina de hora em hora: uma leitura por empresa ativa que já pode consultar (a continuação se encadeia sozinha)
create or replace function public.cte_rodada()
returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  perform public.cte_destravar();
  for e in select cnpj from public.cte_empresas where ativa and (bloqueado_ate is null or bloqueado_ate < now()) loop
    begin
      perform public.cte_pedir(e.cnpj, 'agenda', null);
      n := n + 1;
    exception when others then null;  -- sem certificado ou já em andamento: tenta na próxima
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.cte_rodada() from public, anon, authenticated;

select cron.unschedule('cte-rodada') where exists (select 1 from cron.job where jobname = 'cte-rodada');
select cron.schedule('cte-rodada', '20 * * * *', $job$ select public.cte_rodada() $job$);

-- Empresa nova com certificado entra sozinha nos CT-e (a mesma lista das NF-e)
create or replace function public.cte_empresa_nova()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.cte_empresas (cnpj, nome) values (new.cnpj, new.nome) on conflict (cnpj) do nothing;
  return new;
end $$;
drop trigger if exists cte_empresa_nova on public.notas_empresas;
create trigger cte_empresa_nova after insert on public.notas_empresas for each row execute function public.cte_empresa_nova();

-- Totais por mês e empresa (aba CT-e); cancelados ficam fora dos valores
create or replace view public.cte_meses with (security_invoker = true) as
select to_char(emissao at time zone 'America/Fortaleza', 'YYYY-MM') mes, empresa_cnpj,
  count(*) filter (where situacao = 'autorizada')::int ctes,
  count(*) filter (where situacao = 'cancelada')::int cancelados,
  count(*) filter (where situacao = 'autorizada' and 'tomador' = any(papeis))::int pagos,
  coalesce(sum(valor_prestacao) filter (where situacao = 'autorizada'), 0) valor,
  coalesce(sum(valor_prestacao) filter (where situacao = 'autorizada' and 'tomador' = any(papeis)), 0) valor_pago,
  coalesce(sum(icms) filter (where situacao = 'autorizada'), 0) icms,
  coalesce(sum(valor_carga) filter (where situacao = 'autorizada'), 0) carga
from public.cte_notas
where emissao is not null
group by 1, 2;
grant select on public.cte_meses to authenticated;
