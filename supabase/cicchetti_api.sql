-- =====================================================================
-- API externa do Cicchetti Management (somente leitura), consumida pelo Brasico.
-- Base: https://www.cicchettimanagement.com/api/integracoes/externas/v1
-- Endpoints: /unidades, /vendas/resumo, /vendas/produtos, /cmv/notas,
-- /cmv/notas/{nota_id}/itens e /rh/colaboradores. Unidades: midway, pipa_centro, pipa_producao.
--
-- A consulta é feita pelo próprio banco (extensão http), dentro da função mcp_cicchetti,
-- chamada pelo conector Brasico. A chave nunca sai do banco: fica só no Vault.
-- Cadastrar a chave (criada em Sistema > API externa no Cicchetti Management),
-- direto no SQL Editor do Supabase, nunca neste arquivo nem no chat:
--   select vault.create_secret('<chave cic_api_...>', 'cicchetti_api_chave');
-- Trocar a chave: select vault.update_secret((select id from vault.secrets where name = 'cicchetti_api_chave'), '<nova chave>');
-- Quem consulta: só quem está em cicchetti_acesso (os sócios). Cada consulta fica em
-- cicchetti_consultas, com o request_id devolvido pela API (nunca a chave).
-- =====================================================================

create extension if not exists http with schema extensions;

create table if not exists public.cicchetti_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
-- Começa com os mesmos sócios da TOTVS
insert into public.cicchetti_acesso (user_id) select user_id from public.totvs_acesso on conflict do nothing;

create table if not exists public.cicchetti_consultas (
  id bigserial primary key,
  user_id uuid references auth.users(id),
  endpoint text not null,
  unidade text,
  de date,
  ate date,
  http_status int,
  request_id text,
  erro text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists cicchetti_consultas_quando on public.cicchetti_consultas (created_at desc);

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['cicchetti_acesso', 'cicchetti_consultas'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.cicchetti_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cicchetti_acesso where user_id = p_user)
$$;
revoke execute on function public.cicchetti_pode_ver(uuid) from public, anon;
grant execute on function public.cicchetti_pode_ver(uuid) to authenticated;

alter table public.cicchetti_acesso enable row level security;
alter table public.cicchetti_consultas enable row level security;
drop policy if exists "ver acesso" on public.cicchetti_acesso;
create policy "ver acesso" on public.cicchetti_acesso for select using (user_id = auth.uid());
drop policy if exists "ver consultas" on public.cicchetti_consultas;
create policy "ver consultas" on public.cicchetti_consultas for select using (public.cicchetti_pode_ver(auth.uid()));
revoke all on public.cicchetti_acesso, public.cicchetti_consultas from anon;
grant select on public.cicchetti_acesso, public.cicchetti_consultas to authenticated;

-- ---------------------------------------------------------------------
-- Consulta à API (uma função só, com os endpoints permitidos)
-- p_endpoint: unidades | vendas_resumo | vendas_produtos | cmv_notas | cmv_itens | rh_colaboradores
-- ---------------------------------------------------------------------
create or replace function public.mcp_cicchetti(p_token text, p_endpoint text, p_unidade text default null,
  p_de date default null, p_ate date default null, p_busca text default null, p_fornecedor text default null,
  p_limite int default null, p_nota uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  base constant text := 'https://www.cicchettimanagement.com/api/integracoes/externas/v1';
  a record; v_user uuid; v_caminho text; v_params jsonb := '{}'; v_url text; v_chave text;
  v_resp extensions.http_response; v_corpo jsonb; v_req text; v_erro text;
begin
  select * into a from public.mcp_auth(p_token);
  v_user := a.o_user;
  if not public.cicchetti_pode_ver(v_user) then
    raise exception 'Sem acesso à API do Cicchetti Management' using errcode = '42501';
  end if;

  -- Endpoint e parâmetros (só os permitidos, sempre com unidade e período quando a API exige)
  if p_endpoint = 'unidades' then
    v_caminho := '/unidades';
  else
    if p_unidade is null or p_unidade not in ('midway', 'pipa_centro', 'pipa_producao') then
      raise exception 'Informe a unidade: midway, pipa_centro ou pipa_producao.';
    end if;
    v_params := jsonb_build_object('unidade', p_unidade);
    if p_endpoint in ('vendas_resumo', 'vendas_produtos', 'cmv_notas') then
      if p_de is null or p_ate is null then raise exception 'Informe o período (de e ate, AAAA-MM-DD).'; end if;
      if p_ate < p_de then raise exception 'A data final vem antes da inicial.'; end if;
      if p_ate - p_de > 366 then raise exception 'Período longo demais (máximo de 1 ano por consulta).'; end if;
      v_params := v_params || jsonb_build_object('data_inicio', p_de, 'data_fim', p_ate);
    end if;
    if p_limite is not null and (p_limite < 1 or p_limite > 100) then raise exception 'O limite vai de 1 a 100.'; end if;
    case p_endpoint
      when 'vendas_resumo' then v_caminho := '/vendas/resumo';
      when 'vendas_produtos' then
        v_caminho := '/vendas/produtos';
        v_params := v_params || jsonb_strip_nulls(jsonb_build_object('busca', left(p_busca, 80), 'limite', p_limite));
      when 'cmv_notas' then
        v_caminho := '/cmv/notas';
        v_params := v_params || jsonb_strip_nulls(jsonb_build_object('fornecedor', left(p_fornecedor, 100), 'limite', p_limite));
      when 'cmv_itens' then
        if p_nota is null then raise exception 'Informe o id da nota (vem de cicchetti_cmv_notas).'; end if;
        v_caminho := '/cmv/notas/' || p_nota::text || '/itens';
      when 'rh_colaboradores' then
        v_caminho := '/rh/colaboradores';
        v_params := v_params || jsonb_strip_nulls(jsonb_build_object('busca', left(p_busca, 80)));
      else raise exception 'Endpoint desconhecido: %', p_endpoint;
    end case;
  end if;

  -- Limite da API: 120 por minuto por chave (aqui, no máximo 100 somando os dois sócios)
  if (select count(*) from public.cicchetti_consultas where created_at > now() - interval '1 minute') >= 100 then
    raise exception 'Muitas consultas no último minuto. Espere um pouco e tente de novo.';
  end if;

  select decrypted_secret into v_chave from vault.decrypted_secrets where name = 'cicchetti_api_chave';
  if coalesce(v_chave, '') = '' then
    raise exception 'A chave da API do Cicchetti Management ainda não foi cadastrada no cofre do Brasico (cicchetti_api_chave).';
  end if;

  select base || v_caminho || coalesce('?' || string_agg(k || '=' || extensions.urlencode(v), '&' order by k), '')
    into v_url from jsonb_each_text(v_params) as p(k, v);

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
    v_resp := extensions.http(('GET', v_url,
      array[extensions.http_header('Authorization', 'Bearer ' || v_chave), extensions.http_header('Accept', 'application/json')],
      null, null)::extensions.http_request);
  exception when others then
    insert into public.cicchetti_consultas (user_id, endpoint, unidade, de, ate, erro)
    values (v_user, p_endpoint, p_unidade, p_de, p_ate, 'falha de conexão');
    return jsonb_build_object('ok', false, 'erro', 'Falha de conexão com o Cicchetti Management. Tente de novo em instantes.');
  end;

  begin
    v_corpo := v_resp.content::jsonb;
  exception when others then
    v_corpo := null;
  end;
  v_req := coalesce(v_corpo #>> '{meta,request_id}', v_corpo #>> '{error,request_id}');
  v_erro := case when v_resp.status between 200 and 299 and v_corpo is not null then ''
                 else coalesce(nullif(concat_ws(': ', v_corpo #>> '{error,code}', v_corpo #>> '{error,message}'), ''), 'resposta inesperada') end;

  insert into public.cicchetti_consultas (user_id, endpoint, unidade, de, ate, http_status, request_id, erro)
  values (v_user, p_endpoint, p_unidade, p_de, p_ate, v_resp.status, v_req, v_erro);

  if v_erro = '' then
    return jsonb_build_object('ok', true, 'endpoint', v_caminho, 'unidade', p_unidade, 'de', p_de, 'ate', p_ate,
      'request_id', v_req, 'data', v_corpo -> 'data', 'meta', v_corpo -> 'meta');
  end if;
  return jsonb_build_object('ok', false, 'http', v_resp.status, 'erro', v_erro, 'request_id', v_req,
    'significado', case v_resp.status
      when 400 then 'parâmetro inválido'
      when 401 then 'chave ausente, inválida, expirada ou revogada: é preciso criar uma chave nova no Cicchetti Management e trocar no cofre'
      when 403 then 'esta unidade ou este tipo de dado (vendas, cmv, rh) não está liberado para a chave'
      when 404 then 'endpoint ou registro não encontrado'
      when 429 then 'limite de 120 consultas por minuto excedido'
      else 'falha no Cicchetti Management ou em um sistema que ele usa' end);
end $$;

revoke execute on function public.mcp_cicchetti(text, text, text, date, date, text, text, int, uuid) from public, authenticated;
grant execute on function public.mcp_cicchetti(text, text, text, date, date, text, text, int, uuid) to anon;
