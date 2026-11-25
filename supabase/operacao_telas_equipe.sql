-- Operação dos hotéis: uma tela liberada para alguém da equipe das casas (25/11/2026, pedido do dono:
-- "compartilha essa página do Memo do Sempre Vivo com a Carol"; ela já monta a escala do Sempre Vivo).
-- Quem não tem a área op_<hotel> (acessos_areas) não abria nada da Operação. Agora um sócio libera telas
-- uma a uma para um login da equipe (papel lider, compras…), sem dar a área inteira nem tirar a pessoa das
-- regras da equipe (ela continua fora de `acessos`, então a Escala dela não muda).
-- - nivel 'ver'    = abre a tela publicada; as funções da tela rodam só para ler.
-- - nivel 'editar' = usa a tela como quem edita (marca tarefas, escreve notas), mas só as funções api_* que a
--                    própria tela chama (procuradas no HTML publicado). Não cria telas, não roda SQL, não vê rascunho.
-- Nada se apaga: tirar = removido_em.

create table if not exists public.op_paginas_pessoas (
  hotel text not null check (hotel in ('filha-da-lua', 'sempre-vivo')),
  slug text not null,
  user_id uuid not null references auth.users(id),
  nivel text not null default 'ver' check (nivel in ('ver', 'editar')),
  liberado_em timestamptz not null default now(),
  liberado_por uuid,
  removido_em timestamptz,
  primary key (hotel, slug, user_id)
);
alter table public.op_paginas_pessoas enable row level security;
-- sem políticas: só as funções abaixo (security definer) leem e gravam

drop trigger if exists op_paginas_pessoas_sem_exclusao on public.op_paginas_pessoas;
create trigger op_paginas_pessoas_sem_exclusao before delete on public.op_paginas_pessoas
  for each row execute function public.bloquear_exclusao();
drop trigger if exists op_paginas_pessoas_sem_truncate on public.op_paginas_pessoas;
create trigger op_paginas_pessoas_sem_truncate before truncate on public.op_paginas_pessoas
  for each statement execute function public.bloquear_exclusao();
drop trigger if exists acesso_guarda on public.op_paginas_pessoas;
create trigger acesso_guarda before insert or delete or update on public.op_paginas_pessoas
  for each row execute function public.acesso_guarda('usuarios');

-- nível da pessoa numa tela liberada (só tela publicada e não arquivada)
create or replace function public.op_tela_nivel(p_hotel text, p_slug text, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select l.nivel from public.op_paginas_pessoas l join public.op_paginas p on p.hotel = l.hotel and p.slug = l.slug
   where l.hotel = p_hotel and l.slug = p_slug and l.user_id = p_user and l.removido_em is null
     and p.arquivado_em is null and p.html is not null
$$;
revoke execute on function public.op_tela_nivel(text, text, uuid) from public, anon, authenticated;

-- as telas liberadas para quem está usando (menu do topo simples e middleware)
create or replace function public.operacao_minhas_telas()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('hotel', p.hotel, 'slug', p.slug, 'titulo', p.titulo, 'nivel', l.nivel)
           order by p.hotel, p.ordem, p.titulo), '[]'::jsonb)
    from public.op_paginas_pessoas l join public.op_paginas p on p.hotel = l.hotel and p.slug = l.slug
   where l.user_id = auth.uid() and l.removido_em is null and p.arquivado_em is null and p.html is not null
$$;
revoke execute on function public.operacao_minhas_telas() from public, anon;
grant execute on function public.operacao_minhas_telas() to authenticated;

-- liberar / tirar (só admins; pelo SQL ou por uma tela no futuro)
create or replace function public.op_tela_liberar(p_hotel text, p_slug text, p_user uuid, p_nivel text default 'ver')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  if p_nivel not in ('ver', 'editar') then raise exception 'Nível inválido: ver ou editar.'; end if;
  if not exists (select 1 from public.op_paginas where hotel = p_hotel and slug = p_slug and arquivado_em is null) then
    raise exception 'Tela não encontrada.';
  end if;
  insert into public.op_paginas_pessoas (hotel, slug, user_id, nivel, liberado_por)
  values (p_hotel, p_slug, p_user, p_nivel, auth.uid())
  on conflict (hotel, slug, user_id) do update
    set nivel = excluded.nivel, removido_em = null, liberado_em = now(), liberado_por = excluded.liberado_por;
end $$;
create or replace function public.op_tela_retirar(p_hotel text, p_slug text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  update public.op_paginas_pessoas set removido_em = now()
   where hotel = p_hotel and slug = p_slug and user_id = p_user and removido_em is null;
end $$;
revoke execute on function public.op_tela_liberar(text, text, uuid, text) from public, anon;
revoke execute on function public.op_tela_retirar(text, text, uuid) from public, anon;
grant execute on function public.op_tela_liberar(text, text, uuid, text) to authenticated;
grant execute on function public.op_tela_retirar(text, text, uuid) to authenticated;

-- a página do hotel: quem não tem a área, mas tem telas liberadas, recebe só essas (publicadas, sem rascunho)
create or replace function public.operacao_paginas_site(p_hotel text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nivel text := public.op_nivel(p_hotel, auth.uid());
begin
  if v_nivel is null then
    if not exists (select 1 from public.op_paginas_pessoas where hotel = p_hotel and user_id = auth.uid() and removido_em is null) then
      raise exception 'Sem acesso à Operação deste hotel.' using errcode = '42501';
    end if;
    return jsonb_build_object('nivel', 'ver', 'equipe', true, 'paginas', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'titulo', p.titulo, 'descricao', p.descricao, 'icone', p.icone, 'ordem', p.ordem,
        'html', p.html, 'publicado_em', p.publicado_em, 'atualizado_em', p.atualizado_em,
        'rascunho', null, 'tem_rascunho', false, 'nivel_tela', l.nivel
      ) order by p.ordem, p.titulo)
      from public.op_paginas p join public.op_paginas_pessoas l on l.hotel = p.hotel and l.slug = p.slug
      where p.hotel = p_hotel and p.arquivado_em is null and p.html is not null
        and l.user_id = auth.uid() and l.removido_em is null), '[]'::jsonb));
  end if;
  return jsonb_build_object('nivel', v_nivel, 'paginas', coalesce((select jsonb_agg(jsonb_build_object(
      'slug', p.slug, 'titulo', p.titulo, 'descricao', p.descricao, 'icone', p.icone, 'ordem', p.ordem,
      'html', p.html, 'publicado_em', p.publicado_em, 'atualizado_em', p.atualizado_em,
      'rascunho', case when v_nivel = 'editar' then p.rascunho end,
      'tem_rascunho', p.rascunho is not null and p.rascunho is distinct from p.html
    ) order by p.ordem, p.titulo)
    from public.op_paginas p where p.hotel = p_hotel and p.arquivado_em is null
      and (p.html is not null or v_nivel = 'editar')), '[]'::jsonb));
end $$;

-- a ponte das telas: quem tem telas liberadas só chama as funções api_* que aparecem nelas
create or replace function public.operacao_chamar(p_hotel text, p_funcao text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nivel text := public.op_nivel(p_hotel, auth.uid());
  v_r jsonb;
begin
  if v_nivel is null then
    if coalesce(p_funcao, '') !~ '^api_[a-z0-9_]{1,60}$' then
      raise exception 'Sem acesso à Operação deste hotel.' using errcode = '42501';
    end if;
    select case when bool_or(l.nivel = 'editar') then 'editar' when count(*) > 0 then 'ver' end into v_nivel
      from public.op_paginas_pessoas l join public.op_paginas p on p.hotel = l.hotel and p.slug = l.slug
     where l.hotel = p_hotel and l.user_id = auth.uid() and l.removido_em is null
       and p.arquivado_em is null and p.html is not null
       and p.html ~ ('\m' || p_funcao || '\M');
    if v_nivel is null then raise exception 'Sem acesso a esta função da Operação.' using errcode = '42501'; end if;
  end if;
  if v_nivel <> 'editar' and not exists (select 1 from public.acessos where user_id = auth.uid() and tipo = 'admin') then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  execute format('select %I.__chamar($1, $2, $3)', 'op_' || replace(p_hotel, '-', '_') || '_motor') into v_r
    using p_funcao, p_args, jsonb_build_object('id', auth.uid(), 'nome',
      coalesce((select o.nome from public.operacao_pessoas o where o.user_id = auth.uid() and o.ativo and not exists (select 1 from public.acessos a where a.user_id = auth.uid()) limit 1),
               (select display_name from public.profiles where id = auth.uid())), 'nivel', v_nivel);
  return v_r;
end $$;

-- Primeira liberação: Memo do casamento (Sempre Vivo) para a Carol, líder da escala do Sempre Vivo, usando a tela
-- (marca as tarefas e escreve as notas). Feita pelo SQL em 25/11/2026:
-- select public.op_tela_liberar('sempre-vivo', 'casamento-valentina-diego', '<user_id da Carol>', 'editar');
-- Segunda liberação (25/11/2026, pedido do dono: "igual à Carol"): o mesmo Memo para o Maurício (login de Compras,
-- Sempre Vivo · Salão/Bar), também usando a tela:
-- select public.op_tela_liberar('sempre-vivo', 'casamento-valentina-diego', '<user_id do Maurício>', 'editar');
