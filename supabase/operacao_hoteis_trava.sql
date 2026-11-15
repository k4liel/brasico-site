-- Trava da Operação dos hotéis (15/11/2026). O SQL livre roda no mesmo banco do Brasico, com o papel
-- op_<hotel>, que não enxerga o schema public. Mas o schema net (pg_net) é aberto a todos os papéis pela
-- própria Supabase (não dá para tirar) e guarda a fila de pedidos do Brasico, com segredos nos cabeçalhos.
-- Por isso todo comando passa por op_sql_seguro antes de valer:
--   1. leitura do texto: recusa net., search_path, set_config, comandos de sessão/transação, extensões,
--      papéis, regras, políticas, CREATE TABLE AS e qualquer menção ao motor;
--   2. simulação (EXPLAIN, sem executar) dos comandos de dados: recusa se o plano usar o net;
--   3. depois de rodar: recusa (e desfaz) se surgiu dependência de algo do net, função em outra linguagem
--      que não sql/plpgsql, função com SET próprio ou corpo com EXECUTE/net./search_path/set_config.
-- O motor (__executar, __explicar, __chamar) fica em op_<hotel>_motor, schema que o papel do hotel não
-- pode alterar (sem CREATE nem USAGE); as funções têm o papel do hotel como dono para rodar com ele.

-- divide um texto SQL em comandos, respeitando aspas, $$ e comentários
create or replace function public.op_dividir_sql(p text)
returns text[] language plpgsql immutable set search_path to 'pg_catalog' as $$
declare
  i int := 1; n int := length(p); c text; tag text; j int; ini int := 1; saida text[] := '{}';
begin
  while i <= n loop
    c := substr(p, i, 1);
    if c = '''' then
      i := i + 1;
      while i <= n loop
        if substr(p, i, 1) = '''' then
          if substr(p, i + 1, 1) = '''' then i := i + 2; continue; end if;
          exit;
        end if;
        i := i + 1;
      end loop;
    elsif c = '"' then
      i := i + 1;
      while i <= n and substr(p, i, 1) <> '"' loop i := i + 1; end loop;
    elsif c = '-' and substr(p, i + 1, 1) = '-' then
      while i <= n and substr(p, i, 1) <> E'\n' loop i := i + 1; end loop;
    elsif c = '/' and substr(p, i + 1, 1) = '*' then
      j := strpos(substr(p, i + 2), '*/');
      if j = 0 then i := n; else i := i + 2 + j; end if;
    elsif c = '$' then
      tag := substring(substr(p, i) from '^\$[A-Za-z_]*\$');
      if tag is not null then
        j := strpos(substr(p, i + length(tag)), tag);
        if j = 0 then i := n; else i := i + length(tag) + j + length(tag) - 2; end if;
      end if;
    elsif c = ';' then
      saida := saida || btrim(substr(p, ini, i - ini), E' \n\r\t');
      ini := i + 1;
    end if;
    i := i + 1;
  end loop;
  saida := saida || btrim(substr(p, ini), E' \n\r\t');
  return array(select s from unnest(saida) s where s <> '');
end $$;

-- o que não pode aparecer no texto de um comando ou no corpo de uma função
create or replace function public.op_texto_proibido(p text)
returns text language sql immutable set search_path to 'pg_catalog' as $$
  select case
    when l ~ '(^|[^a-z0-9_$])"?net"?\s*\.' then 'o schema net (fila de pedidos do Brasico) não pode ser usado'
    when l ~ 'search_path' then 'não pode mudar onde o banco procura as tabelas (search_path)'
    when l ~ 'set_config' then 'set_config não é permitido'
    when l ~ 'u&["'']' then 'texto com escape unicode (U&) não é permitido'
    when l ~ '_motor|__executar|__explicar|__chamar' then 'o motor da Operação não pode ser alterado'
    when l ~ '\mset\s+(local\s+|session\s+)?(role|session)' then 'não pode trocar de papel'
    when l ~ '(pg_sleep|dblink|lo_import|lo_export|lo_unlink|pg_terminate_backend|pg_cancel_backend|pg_advisory|pg_read_|pg_ls_|pg_reload_conf|pg_rotate_logfile)'
      then 'essa função do sistema não é permitida'
    else null end
  from (select lower(p) l) x
$$;

create or replace function public.op_net_dependencias()
returns bigint language sql stable security definer set search_path to 'pg_catalog' as $$
  select count(*) from pg_depend d
  where (d.refclassid = 'pg_class'::regclass and d.refobjid in (select oid from pg_class where relnamespace = 'net'::regnamespace))
     or (d.refclassid = 'pg_proc'::regclass and d.refobjid in (select oid from pg_proc where pronamespace = 'net'::regnamespace))
     or (d.refclassid = 'pg_type'::regclass and d.refobjid in (select oid from pg_type where typnamespace = 'net'::regnamespace))
$$;

-- motor de cada hotel (refaz o op_preparar_hotel: o motor sai do schema do hotel)
create or replace function public.op_preparar_motor(p_hotel text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  k text := replace(p_hotel, '-', '_');
  r text := 'op_' || k;
  d text := 'op_' || k || '_dados';
  m text := 'op_' || k || '_motor';
begin
  execute format('create schema if not exists %I', m);
  execute format('revoke all on schema %I from public', m);
  -- tira o motor antigo do schema do hotel (o hotel podia trocá-lo)
  execute format('drop function if exists %I.__executar(text)', r);
  execute format('drop function if exists %I.__chamar(text, jsonb, jsonb)', r);

  execute format($f$
    create or replace function %1$I.__executar(p_sql text)
    returns jsonb language plpgsql security definer set search_path = %2$I, %3$I, pg_catalog as $b$
    declare v_r jsonb; v_n bigint; v_sql text := btrim(p_sql, E' \n\r\t;');
    begin
      if v_sql ~* '^(select|with|values|table)\M' then
        begin
          execute pg_catalog.format('select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)), ''[]''::jsonb) from (%%s) t', v_sql) into v_r;
          return pg_catalog.jsonb_build_object('linhas', v_r);
        exception when sqlstate '0A000' then null;
        end;
      end if;
      execute v_sql;
      get diagnostics v_n = row_count;
      return pg_catalog.jsonb_build_object('ok', true, 'linhas_afetadas', v_n);
    end $b$
  $f$, m, r, d);
  execute format($f$
    create or replace function %1$I.__explicar(p_sql text)
    returns text language plpgsql security definer set search_path = pg_catalog, %2$I, %3$I as $b$
    declare v_r text;
    begin
      execute 'explain (verbose, format json) ' || p_sql into v_r;
      return v_r;
    end $b$
  $f$, m, r, d);
  execute format($f$
    create or replace function %1$I.__chamar(p_funcao text, p_args jsonb, p_usuario jsonb)
    returns jsonb language plpgsql security definer set search_path = pg_catalog, %2$I, %3$I as $b$
    declare v_r jsonb;
    begin
      if p_funcao !~ '^api_[a-z0-9_]{1,60}$' then
        raise exception 'A tela só chama funções que começam com api_ (recebido: %%)', p_funcao;
      end if;
      perform set_config('op.usuario', coalesce(p_usuario, '{}'::jsonb)::text, true);
      execute format('select to_jsonb(%%I.%%I($1))', %4$L, p_funcao) into v_r using coalesce(p_args, '{}'::jsonb);
      return v_r;
    end $b$
  $f$, m, r, d, r);
  -- o dono precisa de CREATE no schema só na hora de trocar o dono; depois sai
  execute format('grant create on schema %I to %I', m, r);
  execute format('alter function %I.__executar(text) owner to %I', m, r);
  execute format('alter function %I.__explicar(text) owner to %I', m, r);
  execute format('alter function %I.__chamar(text, jsonb, jsonb) owner to %I', m, r);
  execute format('revoke create on schema %I from %I', m, r);
  execute format('revoke all on function %I.__executar(text) from public', m);
  execute format('revoke all on function %I.__explicar(text) from public', m);
  execute format('revoke all on function %I.__chamar(text, jsonb, jsonb) from public', m);
end $$;
revoke all on function public.op_preparar_motor(text) from public, anon, authenticated;
select public.op_preparar_motor('filha-da-lua');
select public.op_preparar_motor('sempre-vivo');

-- roda o SQL do hotel com as três conferências; devolve o resultado de cada comando
create or replace function public.op_sql_seguro(p_hotel text, p_sql text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  k text := replace(p_hotel, '-', '_');
  s text := 'op_' || k;
  m text := 'op_' || k || '_motor';
  v_cmd text; v_limpo text; v_kw text; v_prob text; v_plano text; v_r jsonb;
  v_antes bigint; v_saida jsonb := '[]'::jsonb; f record;
begin
  if p_hotel not in ('filha-da-lua', 'sempre-vivo') then raise exception 'Hotel desconhecido.'; end if;
  foreach v_cmd in array public.op_dividir_sql(coalesce(p_sql, '')) loop
    -- tira comentários do começo para ler a primeira palavra
    v_limpo := v_cmd;
    loop
      exit when v_limpo !~ '^\s*(--[^\n]*(\n|$)|/\*)';
      v_limpo := regexp_replace(v_limpo, '^\s*(--[^\n]*(\n|$)|/\*.*?\*/)', '');
    end loop;
    v_kw := lower(substring(v_limpo from '^[\s(]*([A-Za-z]+)'));
    v_prob := public.op_texto_proibido(v_cmd);
    if v_prob is null and v_kw is null then v_prob := 'comando não reconhecido'; end if;
    if v_prob is null and v_kw not in ('select', 'with', 'values', 'table', 'insert', 'update', 'delete', 'merge',
        'create', 'alter', 'drop', 'comment', 'truncate', 'call', 'analyze', 'refresh', 'reindex') then
      v_prob := format('o comando %s não é permitido na Operação', upper(v_kw));
    end if;
    if v_prob is null and v_kw in ('create', 'alter', 'drop') and lower(v_limpo) ~
        '^\s*(create|alter|drop)\s+(or\s+replace\s+)?(extension|schema|role|user|group|rule|policy|event|foreign|server|publication|subscription|database|tablespace|cast|language|transform|access|default|system|owned|operator|statistics|text\s+search|conversion|collation)\M' then
      v_prob := 'esse tipo de objeto não pode ser criado nem alterado na Operação';
    end if;
    if v_prob is null and lower(v_limpo) ~ '^\s*create\s+((global|local)\s+)?((temp|temporary|unlogged)\s+)?table\s+(if\s+not\s+exists\s+)?[a-z0-9_."]+\s*(\([^)]*\)\s*)?as\M' then
      v_prob := 'CREATE TABLE ... AS não é permitido: crie a tabela e depois use INSERT ... SELECT';
    end if;
    if v_prob is null and lower(v_limpo) ~ '\mowner\s+to\M|\mreassign\M|\mgrant\M|\mrevoke\M' then
      v_prob := 'trocar dono ou permissões não é permitido';
    end if;
    if v_prob is not null then raise exception 'Recusado: %. Comando: %', v_prob, left(v_cmd, 200) using errcode = '42501'; end if;

    -- 2. comandos de dados: simula antes
    if v_kw in ('select', 'with', 'values', 'table', 'insert', 'update', 'delete', 'merge') then
      execute format('select %I.__explicar($1)', m) into v_plano using v_cmd;
      if v_plano ~* '"Schema": "net"' or v_plano ~* '(^|[^a-z0-9_$])net\.' or v_plano ~* 'set_config' then
        raise exception 'Recusado: o comando usa o schema net. Comando: %', left(v_cmd, 200) using errcode = '42501';
      end if;
    end if;

    -- 3. roda e confere o que ficou
    v_antes := public.op_net_dependencias();
    execute format('select %I.__executar($1)', m) into v_r using v_cmd;
    if public.op_net_dependencias() > v_antes then
      raise exception 'Recusado: o comando criou algo que depende do schema net.' using errcode = '42501';
    end if;
    for f in select p.proname, l.lanname, p.proconfig, p.prosrc from pg_proc p join pg_language l on l.oid = p.prolang
             where p.pronamespace = s::regnamespace loop
      if f.lanname not in ('sql', 'plpgsql') then
        raise exception 'Recusado: a função % usa a linguagem %; só sql e plpgsql.', f.proname, f.lanname using errcode = '42501';
      end if;
      if f.proconfig is not null then
        raise exception 'Recusado: a função % tem configuração própria (SET); tire o SET.', f.proname using errcode = '42501';
      end if;
      v_prob := public.op_texto_proibido(f.prosrc);
      if v_prob is null and f.lanname = 'plpgsql' and lower(f.prosrc) ~ '\mexecute\M' then
        v_prob := 'EXECUTE (SQL montado na hora) não é permitido; escreva os comandos direto';
      end if;
      if v_prob is not null then
        raise exception 'Recusado: a função % — %.', f.proname, v_prob using errcode = '42501';
      end if;
    end loop;
    v_saida := v_saida || jsonb_build_array(v_r);
  end loop;
  return case when jsonb_array_length(v_saida) = 1 then v_saida->0 else jsonb_build_object('comandos', v_saida) end;
end $$;
revoke all on function public.op_sql_seguro(text, text) from public, anon, authenticated;

-- conector e site passam a usar o motor protegido
create or replace function public.mcp_operacao_sql(p_token text, p_hotel text, p_sql text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel); v_r jsonb; v_id bigint;
begin
  insert into public.op_sql_historico (hotel, sql, por) values (p_hotel, p_sql, v_user) returning id into v_id;
  begin
    v_r := public.op_sql_seguro(p_hotel, p_sql);
  exception when others then
    update public.op_sql_historico set ok = false, resposta = sqlerrm where id = v_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm, 'codigo', sqlstate);
  end;
  update public.op_sql_historico set ok = true, resposta = left(v_r::text, 2000) where id = v_id;
  return v_r;
end $$;

create or replace function public.operacao_chamar(p_hotel text, p_funcao text, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_nivel text := public.op_nivel(p_hotel, auth.uid());
  v_r jsonb;
begin
  if v_nivel is null then raise exception 'Sem acesso à Operação deste hotel.' using errcode = '42501'; end if;
  if v_nivel <> 'editar' and not exists (select 1 from public.acessos where user_id = auth.uid() and tipo = 'admin') then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  execute format('select %I.__chamar($1, $2, $3)', 'op_' || replace(p_hotel, '-', '_') || '_motor') into v_r
    using p_funcao, p_args, jsonb_build_object('id', auth.uid(), 'nome',
      (select display_name from public.profiles where id = auth.uid()), 'nivel', v_nivel);
  return v_r;
end $$;

create or replace function public.mcp_operacao_testar(p_token text, p_hotel text, p_funcao text, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel); v_r jsonb;
begin
  execute format('select %I.__chamar($1, $2, $3)', 'op_' || replace(p_hotel, '-', '_') || '_motor') into v_r
    using p_funcao, p_args, jsonb_build_object('id', v_user, 'nome', (select display_name from public.profiles where id = v_user), 'nivel', 'editar', 'teste', true);
  return v_r;
exception when others then
  return jsonb_build_object('ok', false, 'erro', sqlerrm, 'codigo', sqlstate);
end $$;

-- visões do PMS que conferem a permissão de quem lê (security_invoker) viram funções do próprio hotel,
-- com dono postgres, que já devolvem só as linhas daquele hotel (migration operacao_dados_funcoes)
create or replace function public.op_preparar_dados(p_hotel text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  k text := replace(p_hotel, '-', '_');
  r text := 'op_' || k;
  d text := 'op_' || k || '_dados';
  v record;
begin
  for v in select * from (values ('reservas', 'pms_estadias_canal'), ('bloqueios', 'pms_bloqueios_atuais'),
      ('dias', 'pms_dia_hotel'), ('meses', 'pms_mes_hotel'), ('previsao', 'pms_previsao_atual')) as x(nome, origem) loop
    execute format('drop view if exists %I.%I', d, v.nome);
    execute format('create or replace function %I.%I() returns setof public.%I language sql stable security definer
                    set search_path to public as $b$ select * from public.%I where hotel_id = %L $b$',
                   d, '__' || v.nome, v.origem, v.origem, p_hotel);
    execute format('revoke all on function %I.%I() from public', d, '__' || v.nome);
    execute format('grant execute on function %I.%I() to %I', d, '__' || v.nome, r);
    execute format('create view %I.%I as select * from %I.%I()', d, v.nome, d, '__' || v.nome);
    execute format('grant select on %I.%I to %I', d, v.nome, r);
  end loop;
end $$;
revoke all on function public.op_preparar_dados(text) from public, anon, authenticated;
select public.op_preparar_dados('filha-da-lua');
select public.op_preparar_dados('sempre-vivo');
