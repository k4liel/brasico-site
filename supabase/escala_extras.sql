-- Contratados fora do ponto na escala (09/11/2026, pedido do dono): quem está ativo no RH (esocial_trabalhadores)
-- mas não tem cadastro no ponto do RHiD (ponto_situacao sem_ponto; os inativos no RHiD não, pedido do dono) aparece numa lista na página Escala; o sócio
-- escolhe o local e o setor e a pessoa entra na escala (Ponto e Planejada) com o aviso "fora do ponto" ao lado do
-- nome. Na escala ela usa cliente_id = 0 e pessoa_id = escala_extras.id (as tabelas da escala não ligam ao RHiD).
-- Nada se apaga: tirar = situacao 'fora'; "não trabalha aqui" = 'ignorado' (sai da lista).
create table if not exists public.escala_extras (
  id bigint generated always as identity primary key,
  empresa_id text not null,
  cpf text not null,
  nome text not null,
  cargo text not null default '',
  local text not null default '',
  setor text not null default '',
  situacao text not null default 'na_escala' check (situacao in ('na_escala', 'ignorado', 'fora')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  unique (empresa_id, cpf)
);
alter table public.escala_extras enable row level security;
drop policy if exists escala_extras_ver on public.escala_extras;
create policy escala_extras_ver on public.escala_extras for select using (public.rhid_pode_ver(auth.uid()));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_extras_sem_exclusao') then
    create trigger escala_extras_sem_exclusao before delete on public.escala_extras for each row execute function public.bloquear_exclusao();
    create trigger escala_extras_sem_truncate before truncate on public.escala_extras for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

-- Lista: contratados do RH fora do ponto, com a situação na escala (só sócios)
create or replace function public.escala_contratados_fora()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Sem acesso' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'empresa_id', t.empresa_id, 'cpf', t.cpf, 'nome', t.nome, 'cargo', coalesce(t.cargo, ''), 'unidade', coalesce(t.unidade, ''),
      'admissao', t.admissao, 'ponto', t.ponto_situacao,
      'extra_id', x.id, 'situacao', x.situacao, 'local', x.local, 'setor', x.setor) order by t.nome), '[]')
    from public.esocial_trabalhadores t
    left join public.escala_extras x on x.empresa_id = t.empresa_id and x.cpf = t.cpf
    where t.ativo and (t.ponto_situacao = 'sem_ponto' or x.situacao = 'na_escala'));
end $$;
revoke execute on function public.escala_contratados_fora() from public, anon;
grant execute on function public.escala_contratados_fora() to authenticated;

-- Incluir na escala (ou trocar o local/setor), marcar "não trabalha aqui" ou tirar
create or replace function public.escala_contratado_definir(p_empresa text, p_cpf text, p_situacao text, p_local text default '', p_setor text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_grupo uuid; v_local text := coalesce(nullif(trim(p_local), ''), 'Sem local'); v_setor text := coalesce(trim(p_setor), '');
  t record;
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios mexem na escala de todos.' using errcode = '42501'; end if;
  if p_situacao not in ('na_escala', 'ignorado', 'fora') then raise exception 'Situação inválida'; end if;
  select * into t from public.esocial_trabalhadores where empresa_id = p_empresa and cpf = p_cpf;
  if not found then raise exception 'Pessoa não encontrada no RH'; end if;
  insert into public.escala_extras as x (empresa_id, cpf, nome, cargo, local, setor, situacao, atualizado_por)
  values (p_empresa, p_cpf, t.nome, coalesce(t.cargo, ''), v_local, v_setor, p_situacao, auth.uid())
  on conflict (empresa_id, cpf) do update set nome = excluded.nome, cargo = excluded.cargo,
    local = case when p_situacao = 'na_escala' then excluded.local else x.local end,
    setor = case when p_situacao = 'na_escala' then excluded.setor else x.setor end,
    situacao = excluded.situacao, atualizado_em = now(), atualizado_por = auth.uid()
  returning id into v_id;
  if p_situacao = 'na_escala' then
    select id into v_grupo from public.escala_grupos where local = v_local and setor = v_setor;
    if v_grupo is null then
      insert into public.escala_grupos (nome, local, setor) values (v_local || case when v_setor <> '' then ' · ' || v_setor else '' end, v_local, v_setor)
      returning id into v_grupo;
    else
      update public.escala_grupos set arquivado_em = null where id = v_grupo and arquivado_em is not null;
    end if;
    insert into public.escala_membros (cliente_id, pessoa_id, grupo_id) values (0, v_id, v_grupo)
    on conflict (cliente_id, pessoa_id) do update set grupo_id = excluded.grupo_id, atualizado_em = now();
  end if;
  return v_id;
end $$;
revoke execute on function public.escala_contratado_definir(text, text, text, text, text) from public, anon;
grant execute on function public.escala_contratado_definir(text, text, text, text, text) to authenticated;

-- Grupo vazio = sem gente do RHiD ativa e sem contratado fora do ponto na escala
create or replace function public.escala_arquivar_vazios()
returns int language sql security definer set search_path = public as $$
  with x as (
    update public.escala_grupos g set arquivado_em = now()
    where g.arquivado_em is null
      and not exists (select 1 from public.escala_membros m
                      join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id and p.situacao = 1 and p.presente
                      where m.grupo_id = g.id)
      and not exists (select 1 from public.escala_membros m join public.escala_extras e on m.cliente_id = 0 and e.id = m.pessoa_id and e.situacao = 'na_escala'
                      where m.grupo_id = g.id)
      and not exists (select 1 from public.escala_lideres l where l.grupo_id = g.id and l.arquivado_em is null)
    returning 1)
  select count(*)::int from x
$$;
revoke execute on function public.escala_arquivar_vazios() from public, anon, authenticated;

-- escala_dados com os contratados fora do ponto (cliente_id = 0, "fora_do_ponto": true)
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
