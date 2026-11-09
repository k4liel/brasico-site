-- =====================================================================
-- Escala planejada (06/11/2026, pedido do dono). A escala "real" continua vindo do RHiD (rhid_dias, lida
-- a cada minuto); esta é a escala que a casa monta e controla, dia a dia, mês a mês, no mesmo visual.
-- Cada local + setor vira um grupo de escala; cada grupo tem líderes (login de colaborador, papel 'lider'
-- ou qualquer papel da equipe), que veem e mudam só o grupo deles. Os sócios (rhid_acesso) veem tudo.
-- Códigos do dia: T = trabalho (entrada, saída e intervalo), F = folga, FC = folga compensada (feriado
-- trabalhado), FE = férias, AT = atestado, BH = folga do banco de horas, LIC = licença; '' = sem escala.
-- Nada se apaga: limpar um dia grava codigo = ''. Toda mudança vai para escala_planejada_historico.
-- Os avisos de lei (CLT, CCT RN000194/2026 com o aditivo RN000207/2026, EC 141/2026) são calculados na
-- tela (lib/escala/regras.ts), na hora em que a escala é montada.
-- =====================================================================

create table if not exists public.escala_grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  local text not null,
  setor text not null default '',
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz,
  unique (local, setor)
);

-- Cada pessoa do relógio fica em um grupo (o mesmo local + setor da escala do RH)
create table if not exists public.escala_membros (
  cliente_id bigint not null,
  pessoa_id bigint not null,
  grupo_id uuid not null references public.escala_grupos(id),
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, pessoa_id)
);
create index if not exists escala_membros_grupo on public.escala_membros (grupo_id);

create table if not exists public.escala_lideres (
  grupo_id uuid not null references public.escala_grupos(id),
  pessoa_id uuid not null references public.operacao_pessoas(id),
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz,
  primary key (grupo_id, pessoa_id)
);

create table if not exists public.escala_planejada (
  cliente_id bigint not null,
  pessoa_id bigint not null,
  dia date not null,
  codigo text not null default '' check (codigo in ('', 'T', 'F', 'FC', 'FE', 'AT', 'BH', 'LIC')),
  entrada text check (entrada is null or entrada ~ '^\d{2}:\d{2}$'),
  saida text check (saida is null or saida ~ '^\d{2}:\d{2}$'),
  intervalo text check (intervalo is null or intervalo ~ '^\d{2}:\d{2}-\d{2}:\d{2}$'),
  obs text not null default '',
  origem text not null default 'manual' check (origem in ('manual', 'rhid')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  primary key (cliente_id, pessoa_id, dia)
);
create index if not exists escala_planejada_dia on public.escala_planejada (dia);

create table if not exists public.escala_planejada_historico (
  id bigserial primary key,
  cliente_id bigint not null,
  pessoa_id bigint not null,
  dia date not null,
  antes jsonb,
  depois jsonb,
  por uuid,
  em timestamptz not null default now()
);

-- Saldo inicial de folgas a compensar (e acertos), por pessoa
create table if not exists public.escala_compensacoes_ajustes (
  id bigserial primary key,
  cliente_id bigint not null,
  pessoa_id bigint not null,
  dias numeric not null,
  motivo text not null default '',
  por uuid,
  em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['escala_grupos', 'escala_membros', 'escala_lideres', 'escala_planejada', 'escala_planejada_historico', 'escala_compensacoes_ajustes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.rhid_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Líder: papel novo na equipe (só abre /escala); quem já é da equipe e lidera um grupo abre /escala também
alter table public.operacao_pessoas drop constraint if exists operacao_pessoas_papel_check;
alter table public.operacao_pessoas add constraint operacao_pessoas_papel_check check (papel in ('solicitante', 'compras', 'estoque', 'lider'));

-- Grupos que a pessoa logada pode ver e mudar: sócio (rhid_acesso) = todos; líder = os dele
create or replace function public.escala_grupos_do(p_user uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case when public.rhid_pode_ver(p_user)
    then (select coalesce(array_agg(id), '{}') from public.escala_grupos where arquivado_em is null)
    else (select coalesce(array_agg(l.grupo_id), '{}') from public.escala_lideres l
            join public.operacao_pessoas o on o.id = l.pessoa_id
            join public.escala_grupos g on g.id = l.grupo_id and g.arquivado_em is null
          where o.user_id = p_user and o.ativo and l.arquivado_em is null) end
$$;
revoke execute on function public.escala_grupos_do(uuid) from public, anon;
grant execute on function public.escala_grupos_do(uuid) to authenticated;

create or replace function public.escala_eh_lider(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.escala_lideres l join public.operacao_pessoas o on o.id = l.pessoa_id
                 where o.user_id = p_user and o.ativo and l.arquivado_em is null)
$$;
revoke execute on function public.escala_eh_lider(uuid) from public, anon;
grant execute on function public.escala_eh_lider(uuid) to authenticated;

-- Tudo o que a tela da escala precisa num período (até 75 dias), só dos grupos da pessoa:
-- grupos e líderes, pessoas (sem CPF), dias do RHiD (escala contratual e batidas), escala planejada,
-- feriados e o saldo de folgas a compensar (feriado trabalhado desde 01/11/2026 + acertos − FC).
create or replace function public.escala_dados(p_de date, p_ate date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_socio boolean := public.rhid_pode_ver(auth.uid()); v_grupos uuid[] := public.escala_grupos_do(auth.uid());
  v_inicio date := '2026-11-01'; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  if not v_socio and cardinality(v_grupos) = 0 then raise exception 'Sem acesso à escala' using errcode = '42501'; end if;
  if p_ate < p_de or p_ate - p_de > 75 then raise exception 'Período inválido (até 75 dias).'; end if;
  return (
    with membros as (
      select m.cliente_id, m.pessoa_id, m.grupo_id from public.escala_membros m
      join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id and p.situacao = 1 and p.presente
      where m.grupo_id = any(v_grupos)
        and not exists (select 1 from public.rhid_escala_ordem f where f.cliente_id = m.cliente_id and f.pessoa_id = m.pessoa_id and f.fora_da_escala is not null)
      union all
      -- Contratados fora do ponto (escala_extras): cliente_id = 0
      select m.cliente_id, m.pessoa_id, m.grupo_id from public.escala_membros m
      join public.escala_extras e on m.cliente_id = 0 and e.id = m.pessoa_id and e.situacao = 'na_escala'
      where m.grupo_id = any(v_grupos)
    )
    select jsonb_build_object(
      'socio', v_socio,
      'grupos', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'nome', g.nome, 'local', g.local, 'setor', g.setor, 'ordem', g.ordem,
          'lideres', (select coalesce(jsonb_agg(jsonb_build_object('pessoa_id', o.id, 'nome', o.nome, 'usuario', split_part(coalesce(o.email, ''), '@', 1)) order by o.nome), '[]')
                      from public.escala_lideres l join public.operacao_pessoas o on o.id = l.pessoa_id where l.grupo_id = g.id and l.arquivado_em is null and o.ativo))
          order by g.local, g.setor), '[]')
        from public.escala_grupos g where g.id = any(v_grupos)),
      'pessoas', (select coalesce(jsonb_agg(x.j order by x.nome), '[]') from (
        select p.nome, jsonb_build_object(
          'cliente_id', p.cliente_id, 'id', p.id, 'nome', p.nome, 'grupo_id', m.grupo_id,
          'cargo', coalesce(c.nome, ''), 'admissao', p.admissao, 'posicao', o.posicao,
          'saldo_banco', (select d.saldo_banco from public.rhid_dias d where d.cliente_id = p.cliente_id and d.pessoa_id = p.id
                          and d.dia <= v_hoje and d.saldo_banco is not null order by d.dia desc limit 1),
          'comp_creditos', (select count(*) from public.rhid_dias d where d.cliente_id = p.cliente_id and d.pessoa_id = p.id
                            and d.feriado and d.dia >= v_inicio and jsonb_array_length(d.batidas) > 0),
          'comp_debitos', (select count(*) from public.escala_planejada e where e.cliente_id = p.cliente_id and e.pessoa_id = p.id
                           and e.codigo = 'FC' and e.dia >= v_inicio),
          'comp_ajuste', (select coalesce(sum(a.dias), 0) from public.escala_compensacoes_ajustes a where a.cliente_id = p.cliente_id and a.pessoa_id = p.id),
          -- Afastado hoje (férias, atestado, licença…: justificativa do RHiD que afasta): vai para a área "Afastados" do local
          'afastado', (select coalesce(jt.nome, j.texto, 'Afastado') from public.rhid_justificativas j
                       left join public.rhid_justificativa_tipos jt on jt.cliente_id = j.cliente_id and jt.id = j.tipo_id
                       where j.cliente_id = p.cliente_id and j.pessoa_id = p.id and coalesce(j.aprovacao, 2) = 2
                         and (j.inicio at time zone 'America/Fortaleza')::date <= v_hoje
                         and (j.fim at time zone 'America/Fortaleza')::date >= v_hoje
                         and public.rhid_tipo_afasta(coalesce(jt.nome, j.texto))
                       order by j.inicio desc limit 1)) j
        from membros m
        join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id
        left join public.rhid_cargos c on c.cliente_id = p.cliente_id and c.id = p.cargo_id
        left join public.rhid_escala_ordem o on o.cliente_id = p.cliente_id and o.pessoa_id = p.id
        where m.cliente_id <> 0
        union all
        select e.nome, jsonb_build_object(
          'cliente_id', 0, 'id', e.id, 'nome', e.nome, 'grupo_id', m.grupo_id, 'cargo', e.cargo, 'posicao', null, 'saldo_banco', null,
          'comp_creditos', 0,
          'comp_debitos', (select count(*) from public.escala_planejada x where x.cliente_id = 0 and x.pessoa_id = e.id and x.codigo = 'FC' and x.dia >= v_inicio),
          'comp_ajuste', (select coalesce(sum(a.dias), 0) from public.escala_compensacoes_ajustes a where a.cliente_id = 0 and a.pessoa_id = e.id),
          'afastado', null, 'fora_do_ponto', true)
        from membros m join public.escala_extras e on m.cliente_id = 0 and e.id = m.pessoa_id
      ) x),
      'real', (select coalesce(jsonb_agg(jsonb_build_object('cliente_id', d.cliente_id, 'pessoa_id', d.pessoa_id, 'dia', d.dia,
          'horario', d.horario, 'folga', d.folga, 'feriado', d.feriado, 'falta', d.falta, 'justificado', d.justificado,
          'minutos_trabalhados', d.minutos_trabalhados, 'minutos_atraso', d.minutos_atraso, 'alerta', d.alerta,
          'batidas', (select coalesce(jsonb_agg(b) filter (where coalesce(b->>'classificacao', '') <> 'F'), '[]') from jsonb_array_elements(d.batidas) b))), '[]')
        from public.rhid_dias d join membros m on m.cliente_id = d.cliente_id and m.pessoa_id = d.pessoa_id
        where d.dia between p_de and p_ate),
      'planejada', (select coalesce(jsonb_agg(jsonb_build_object('cliente_id', e.cliente_id, 'pessoa_id', e.pessoa_id, 'dia', e.dia,
          'codigo', e.codigo, 'entrada', e.entrada, 'saida', e.saida, 'intervalo', e.intervalo, 'obs', e.obs, 'origem', e.origem,
          'atualizado_em', e.atualizado_em)), '[]')
        from public.escala_planejada e join membros m on m.cliente_id = e.cliente_id and m.pessoa_id = e.pessoa_id
        where e.dia between p_de and p_ate and e.codigo <> ''),
      'feriados', (select coalesce(jsonb_agg(distinct d.dia), '[]') from public.rhid_dias d where d.feriado and d.dia between p_de and p_ate)
    )
  );
end $$;
revoke execute on function public.escala_dados(date, date) from public, anon;
grant execute on function public.escala_dados(date, date) to authenticated;

-- Grava dias da escala: [{cliente_id, pessoa_id, dia, codigo, entrada?, saida?, intervalo?, obs?}]
-- Cada pessoa precisa estar num grupo que quem grava pode mudar.
create or replace function public.escala_gravar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_antes jsonb; v_n int := 0; v_cod text;
begin
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    if not exists (select 1 from public.escala_membros m where m.cliente_id = (v->>'cliente_id')::bigint
                   and m.pessoa_id = (v->>'pessoa_id')::bigint and m.grupo_id = any(v_grupos)) then
      raise exception 'Sem permissão para mudar a escala desta pessoa.' using errcode = '42501';
    end if;
    v_cod := coalesce(v->>'codigo', '');
    select to_jsonb(e) - 'atualizado_em' - 'atualizado_por' into v_antes from public.escala_planejada e
    where e.cliente_id = (v->>'cliente_id')::bigint and e.pessoa_id = (v->>'pessoa_id')::bigint and e.dia = (v->>'dia')::date;
    insert into public.escala_planejada as e (cliente_id, pessoa_id, dia, codigo, entrada, saida, intervalo, obs, origem, atualizado_por)
    values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, (v->>'dia')::date, v_cod,
      case when v_cod = 'T' then v->>'entrada' end, case when v_cod = 'T' then v->>'saida' end,
      case when v_cod = 'T' then nullif(v->>'intervalo', '') end, coalesce(v->>'obs', ''), 'manual', auth.uid())
    on conflict (cliente_id, pessoa_id, dia) do update set
      codigo = excluded.codigo, entrada = excluded.entrada, saida = excluded.saida, intervalo = excluded.intervalo,
      obs = case when v ? 'obs' then excluded.obs else e.obs end, origem = 'manual', atualizado_em = now(), atualizado_por = auth.uid();
    insert into public.escala_planejada_historico (cliente_id, pessoa_id, dia, antes, depois, por)
    values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, (v->>'dia')::date, v_antes, v, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.escala_gravar(jsonb) from public, anon;
grant execute on function public.escala_gravar(jsonb) to authenticated;

-- Começa (ou completa) o período com a escala contratual do RHiD: dia com horário vira T (entrada, saída e
-- o intervalo entre as duas faixas); sem horário, F. Só preenche dias vazios, a não ser com p_sobrescrever.
create or replace function public.escala_copiar_rhid(p_grupos uuid[], p_de date, p_ate date, p_sobrescrever boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_n int;
begin
  if exists (select 1 from unnest(p_grupos) g where not g = any(v_grupos)) then
    raise exception 'Sem permissão para algum desses grupos.' using errcode = '42501';
  end if;
  if p_ate < p_de or p_ate - p_de > 75 then raise exception 'Período inválido (até 75 dias).'; end if;
  with fonte as (
    select d.cliente_id, d.pessoa_id, d.dia,
      case when d.folga or coalesce(d.horario, '') !~ '\d{1,2}:\d{2}' then 'F' else 'T' end codigo,
      lpad(substring(d.horario from '(\d{1,2}:\d{2})'), 5, '0') entrada,
      lpad(substring(d.horario from '.*-\s*(\d{1,2}:\d{2})'), 5, '0') saida,
      case when d.horario ~ '\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+\d{1,2}:\d{2}\s*-' then
        lpad(substring(d.horario from '^\s*\d{1,2}:\d{2}\s*-\s*(\d{1,2}:\d{2})'), 5, '0') || '-' ||
        lpad(substring(d.horario from '^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+(\d{1,2}:\d{2})'), 5, '0') end intervalo
    from public.rhid_dias d
    join public.escala_membros m on m.cliente_id = d.cliente_id and m.pessoa_id = d.pessoa_id and m.grupo_id = any(p_grupos)
    where d.dia between p_de and p_ate
  ), gravados as (
    insert into public.escala_planejada as e (cliente_id, pessoa_id, dia, codigo, entrada, saida, intervalo, origem, atualizado_por)
    select cliente_id, pessoa_id, dia, codigo, case when codigo = 'T' then entrada end, case when codigo = 'T' then saida end,
      case when codigo = 'T' then intervalo end, 'rhid', auth.uid() from fonte
    on conflict (cliente_id, pessoa_id, dia) do update set
      codigo = excluded.codigo, entrada = excluded.entrada, saida = excluded.saida, intervalo = excluded.intervalo,
      origem = 'rhid', atualizado_em = now(), atualizado_por = auth.uid()
      where p_sobrescrever or e.codigo = ''
    returning 1
  ) select count(*) into v_n from gravados;
  return v_n;
end $$;
revoke execute on function public.escala_copiar_rhid(uuid[], date, date, boolean) from public, anon;
grant execute on function public.escala_copiar_rhid(uuid[], date, date, boolean) to authenticated;

-- Os grupos acompanham a escala do RH: a página (de um sócio) manda o local e o setor de cada pessoa
-- (o mesmo da grade, com o que foi organizado à mão) e cada local + setor vira um grupo.
create or replace function public.escala_membros_sincronizar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupo uuid; v_n int := 0; v_local text; v_setor text;
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios organizam os grupos.' using errcode = '42501'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_local := coalesce(nullif(trim(v->>'local'), ''), 'Sem local');
    v_setor := coalesce(trim(v->>'setor'), '');
    select id into v_grupo from public.escala_grupos where local = v_local and setor = v_setor;
    if v_grupo is null then
      insert into public.escala_grupos (nome, local, setor) values (v_local || case when v_setor <> '' then ' · ' || v_setor else '' end, v_local, v_setor)
      returning id into v_grupo;
    elsif exists (select 1 from public.escala_grupos where id = v_grupo and arquivado_em is not null) then
      update public.escala_grupos set arquivado_em = null where id = v_grupo;
    end if;
    insert into public.escala_membros (cliente_id, pessoa_id, grupo_id) values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, v_grupo)
    on conflict (cliente_id, pessoa_id) do update set grupo_id = excluded.grupo_id, atualizado_em = now()
      where escala_membros.grupo_id <> excluded.grupo_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.escala_membros_sincronizar(jsonb) from public, anon;
grant execute on function public.escala_membros_sincronizar(jsonb) to authenticated;

-- Líderes de um grupo (só sócios): liga uma pessoa da equipe que já existe, ou cria a pessoa e o login
-- (usuário e senha, como a equipe das Compras) e liga. p_ativo = false tira a liderança (fica no histórico).
create or replace function public.escala_lider_definir(p_grupo uuid, p_pessoa uuid, p_ativo boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios definem líderes.' using errcode = '42501'; end if;
  insert into public.escala_lideres (grupo_id, pessoa_id, arquivado_em) values (p_grupo, p_pessoa, case when p_ativo then null else now() end)
  on conflict (grupo_id, pessoa_id) do update set arquivado_em = case when p_ativo then null else now() end;
end $$;
revoke execute on function public.escala_lider_definir(uuid, uuid, boolean) from public, anon;
grant execute on function public.escala_lider_definir(uuid, uuid, boolean) to authenticated;

create or replace function public.escala_lider_criar(p_grupo uuid, p_nome text, p_usuario text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.escala_grupos; v_pessoa uuid; v_login jsonb;
begin
  if not public.rhid_pode_ver(auth.uid()) or not public.notas_pode_ver(auth.uid()) then
    raise exception 'Só os sócios criam líderes.' using errcode = '42501';
  end if;
  select * into g from public.escala_grupos where id = p_grupo;
  if g.id is null then raise exception 'Grupo não encontrado.'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe o nome.'; end if;
  insert into public.operacao_pessoas (nome, unidade, setor, papel, ativo) values (trim(p_nome), g.local, g.setor, 'lider', true)
  returning id into v_pessoa;
  v_login := public.operacao_definir_login(v_pessoa, p_usuario, p_senha);
  perform public.escala_lider_definir(p_grupo, v_pessoa, true);
  return v_login || jsonb_build_object('pessoa_id', v_pessoa);
end $$;
revoke execute on function public.escala_lider_criar(uuid, text, text, text) from public, anon;
grant execute on function public.escala_lider_criar(uuid, text, text, text) to authenticated;

-- Acerto do saldo de folgas a compensar (saldo inicial, folga dada fora do sistema): só sócio ou líder do grupo
create or replace function public.escala_compensacao_ajustar(p_cliente bigint, p_pessoa bigint, p_dias numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.escala_membros m where m.cliente_id = p_cliente and m.pessoa_id = p_pessoa
                 and m.grupo_id = any(public.escala_grupos_do(auth.uid()))) then
    raise exception 'Sem permissão para esta pessoa.' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Diga o motivo do acerto.'; end if;
  insert into public.escala_compensacoes_ajustes (cliente_id, pessoa_id, dias, motivo, por) values (p_cliente, p_pessoa, p_dias, trim(p_motivo), auth.uid());
end $$;
revoke execute on function public.escala_compensacao_ajustar(bigint, bigint, numeric, text) from public, anon;
grant execute on function public.escala_compensacao_ajustar(bigint, bigint, numeric, text) to authenticated;

-- Pessoas da equipe que podem virar líder (só sócios)
create or replace function public.escala_candidatos_lider()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.rhid_pode_ver(auth.uid()) then
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'papel', papel, 'unidade', unidade, 'tem_login', user_id is not null) order by nome), '[]')
     from public.operacao_pessoas where ativo) else '[]'::jsonb end
$$;
revoke execute on function public.escala_candidatos_lider() from public, anon;
grant execute on function public.escala_candidatos_lider() to authenticated;
