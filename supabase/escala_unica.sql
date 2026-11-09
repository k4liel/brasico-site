-- Escala única (09/11/2026, pedido do dono): uma grade só na página Escala, organizada como o Ponto, com a escala
-- montada nas células (dia sem escala fica vazio; o ponto do RHiD só aparece ligando "Ver o ponto"). Os líderes podem ter a casa
-- inteira (escala_lideres_locais: vale para todos os setores, inclusive os que aparecerem depois) ou só alguns setores
-- (escala_lideres, por grupo). Quem escolhe: os sócios, no quadro "Quem monta a escala" da própria página.
-- Nada se apaga: tirar = arquivado_em.
create table if not exists public.escala_lideres_locais (
  pessoa_id uuid not null references public.operacao_pessoas(id),
  local text not null,
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz,
  primary key (pessoa_id, local)
);
alter table public.escala_lideres_locais enable row level security;
drop policy if exists escala_lideres_locais_ver on public.escala_lideres_locais;
create policy escala_lideres_locais_ver on public.escala_lideres_locais for select using (public.rhid_pode_ver(auth.uid()));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_lideres_locais_sem_exclusao') then
    create trigger escala_lideres_locais_sem_exclusao before delete on public.escala_lideres_locais for each row execute function public.bloquear_exclusao();
    create trigger escala_lideres_locais_sem_truncate before truncate on public.escala_lideres_locais for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

-- Grupos que a pessoa vê e edita: sócio = todos; líder = os setores dele + todos os grupos das casas inteiras dele
create or replace function public.escala_grupos_do(p_user uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case when public.rhid_pode_ver(p_user)
    then (select coalesce(array_agg(id), '{}') from public.escala_grupos where arquivado_em is null)
    else (select coalesce(array_agg(distinct g.id), '{}') from public.escala_grupos g
          join public.operacao_pessoas o on o.user_id = p_user and o.ativo
          where g.arquivado_em is null
            and (exists (select 1 from public.escala_lideres l where l.pessoa_id = o.id and l.grupo_id = g.id and l.arquivado_em is null)
              or exists (select 1 from public.escala_lideres_locais ll where ll.pessoa_id = o.id and ll.local = g.local and ll.arquivado_em is null)))
  end
$$;

create or replace function public.escala_eh_lider(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.escala_lideres l join public.operacao_pessoas o on o.id = l.pessoa_id
                 where o.user_id = p_user and o.ativo and l.arquivado_em is null)
      or exists (select 1 from public.escala_lideres_locais ll join public.operacao_pessoas o on o.id = ll.pessoa_id
                 where o.user_id = p_user and o.ativo and ll.arquivado_em is null)
$$;

-- O quadro "Quem monta a escala" (só sócios): as casas com os setores, os líderes de cada uma e quem pode virar líder
create or replace function public.escala_lideranca()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') <> 'socio' then raise exception 'Só os sócios definem quem monta a escala.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'casas', (select coalesce(jsonb_agg(jsonb_build_object('local', c.local, 'setores', c.setores) order by c.local), '[]') from (
        select g.local, coalesce(jsonb_agg(distinct g.setor) filter (where g.setor <> ''), '[]') setores
        from public.escala_grupos g where g.arquivado_em is null group by g.local) c),
    'lideres', (select coalesce(jsonb_agg(x order by x->>'local', x->>'nome'), '[]') from (
        select jsonb_build_object('pessoa_id', o.id, 'nome', o.nome, 'usuario', split_part(coalesce(o.email, ''), '@', 1),
                                  'local', ll.local, 'tudo', true, 'setores', '[]'::jsonb) x
        from public.escala_lideres_locais ll join public.operacao_pessoas o on o.id = ll.pessoa_id
        where ll.arquivado_em is null and o.ativo
        union all
        select jsonb_build_object('pessoa_id', o.id, 'nome', o.nome, 'usuario', split_part(coalesce(o.email, ''), '@', 1),
                                  'local', g.local, 'tudo', false, 'setores', jsonb_agg(g.setor order by g.setor))
        from public.escala_lideres l join public.escala_grupos g on g.id = l.grupo_id and g.arquivado_em is null
        join public.operacao_pessoas o on o.id = l.pessoa_id
        where l.arquivado_em is null and o.ativo
          and not exists (select 1 from public.escala_lideres_locais ll where ll.pessoa_id = o.id and ll.local = g.local and ll.arquivado_em is null)
        group by o.id, o.nome, o.email, g.local) t),
    'candidatos', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'usuario', split_part(coalesce(o.email, ''), '@', 1),
                    'casa', coalesce(o.unidade, '')) order by o.nome), '[]')
        from public.operacao_pessoas o where o.ativo and o.user_id is not null)
  );
end $$;
revoke execute on function public.escala_lideranca() from public, anon;
grant execute on function public.escala_lideranca() to authenticated;

-- Define o que a pessoa monta numa casa: a casa inteira (p_tudo) ou só os setores de p_setores; nada = deixa de ser líder ali
create or replace function public.escala_lideranca_definir(p_pessoa uuid, p_local text, p_tudo boolean, p_setores text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') <> 'socio' then raise exception 'Só os sócios definem quem monta a escala.' using errcode = '42501'; end if;
  if not exists (select 1 from public.operacao_pessoas where id = p_pessoa and ativo) then raise exception 'Pessoa não encontrada'; end if;
  if p_tudo then
    insert into public.escala_lideres_locais (pessoa_id, local) values (p_pessoa, p_local)
    on conflict (pessoa_id, local) do update set arquivado_em = null;
    update public.escala_lideres l set arquivado_em = now()
    from public.escala_grupos g where g.id = l.grupo_id and g.local = p_local and l.pessoa_id = p_pessoa and l.arquivado_em is null;
  else
    update public.escala_lideres_locais set arquivado_em = now() where pessoa_id = p_pessoa and local = p_local and arquivado_em is null;
    update public.escala_lideres l set arquivado_em = now()
    from public.escala_grupos g where g.id = l.grupo_id and g.local = p_local and l.pessoa_id = p_pessoa and l.arquivado_em is null
      and not g.setor = any(coalesce(p_setores, '{}'));
    insert into public.escala_lideres (grupo_id, pessoa_id)
    select g.id, p_pessoa from public.escala_grupos g
    where g.local = p_local and g.arquivado_em is null and g.setor = any(coalesce(p_setores, '{}'))
    on conflict (grupo_id, pessoa_id) do update set arquivado_em = null;
  end if;
end $$;
revoke execute on function public.escala_lideranca_definir(uuid, text, boolean, text[]) from public, anon;
grant execute on function public.escala_lideranca_definir(uuid, text, boolean, text[]) to authenticated;

-- escala_dados: grupos com 'fixo' e os líderes das casas inteiras; os de fora do ponto com a posição
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('''fixo''' in d) = 0 then
    d := replace(d, '''ordem'', g.ordem,', '''ordem'', g.ordem, ''fixo'', g.fixo,');
    d := replace(d, 'from public.escala_lideres l join public.operacao_pessoas o on o.id = l.pessoa_id where l.grupo_id = g.id and l.arquivado_em is null and o.ativo)',
      'from public.operacao_pessoas o where o.ativo and (exists (select 1 from public.escala_lideres l where l.pessoa_id = o.id and l.grupo_id = g.id and l.arquivado_em is null)
                        or exists (select 1 from public.escala_lideres_locais ll where ll.pessoa_id = o.id and ll.local = g.local and ll.arquivado_em is null)))');
    d := replace(d, '''posicao'', null, ''saldo_banco'', null', '''posicao'', e.posicao, ''saldo_banco'', null');
    execute d;
  end if;
end $do$;
