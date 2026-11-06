-- =====================================================================
-- Usuários (06/11/2026, pedido do dono): uma página só dos sócios (/usuarios) com todos os logins da
-- equipe (operacao_pessoas): quem é, o usuário de entrada, o último acesso e o que cada um abre —
-- Compras (papel solicitante ou compras), Câmara fria (registra_estoque ou papel estoque) e Escala
-- (os grupos da escala que lidera, escala_lideres). Os logins de Compras são reaproveitados: basta
-- marcar os grupos da escala. Papel 'lider' = quem só abre a escala. Senha nunca aparece na tela.
-- =====================================================================

create or replace function public.usuarios_lista()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') <> 'socio' then raise exception 'Só os sócios veem os usuários.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'papel', p.papel, 'unidade', coalesce(p.unidade, ''), 'setor', coalesce(p.setor, ''),
      'wa_nome', coalesce(p.wa_nome, ''), 'ativo', p.ativo, 'registra_estoque', coalesce(p.registra_estoque, false),
      'tem_login', p.user_id is not null,
      'usuario', case when p.email like '%@usuarios.brasico' then split_part(p.email, '@', 1) else coalesce(p.email, '') end,
      'ultimo_acesso', u.last_sign_in_at, 'criado_em', p.created_at,
      'grupos', (select coalesce(jsonb_agg(l.grupo_id), '[]') from public.escala_lideres l
                 join public.escala_grupos g on g.id = l.grupo_id and g.arquivado_em is null
                 where l.pessoa_id = p.id and l.arquivado_em is null)
    ) order by p.ativo desc, p.nome), '[]')
    from public.operacao_pessoas p left join auth.users u on u.id = p.user_id);
end $$;
revoke execute on function public.usuarios_lista() from public, anon;
grant execute on function public.usuarios_lista() to authenticated;

-- Cria ou muda uma pessoa (nome, papel, casa, setor, nome no WhatsApp, câmara fria, ativo)
create or replace function public.usuarios_salvar(p_id uuid, p_nome text, p_papel text, p_unidade text, p_setor text,
  p_wa_nome text, p_registra_estoque boolean, p_ativo boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(public.operacao_papel(auth.uid()), '') <> 'socio' then raise exception 'Só os sócios mudam os usuários.' using errcode = '42501'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome.'; end if;
  if p_papel not in ('solicitante', 'compras', 'estoque', 'lider') then raise exception 'Papel inválido.'; end if;
  if p_id is null then
    insert into public.operacao_pessoas (nome, papel, unidade, setor, wa_nome, registra_estoque, ativo)
    values (trim(p_nome), p_papel, nullif(trim(coalesce(p_unidade, '')), ''), nullif(trim(coalesce(p_setor, '')), ''),
      nullif(trim(coalesce(p_wa_nome, '')), ''), coalesce(p_registra_estoque, false), coalesce(p_ativo, true))
    returning id into v_id;
  else
    update public.operacao_pessoas set nome = trim(p_nome), papel = p_papel,
      unidade = nullif(trim(coalesce(p_unidade, '')), ''), setor = nullif(trim(coalesce(p_setor, '')), ''),
      wa_nome = nullif(trim(coalesce(p_wa_nome, '')), ''), registra_estoque = coalesce(p_registra_estoque, registra_estoque),
      ativo = coalesce(p_ativo, ativo)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Pessoa não encontrada.'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.usuarios_salvar(uuid, text, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.usuarios_salvar(uuid, text, text, text, text, text, boolean, boolean) to authenticated;

-- Grupos da escala que a pessoa lidera (os que saem da lista ficam arquivados, não apagados)
create or replace function public.usuarios_escala_grupos(p_pessoa uuid, p_grupos uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.operacao_papel(auth.uid()), '') <> 'socio' then raise exception 'Só os sócios definem líderes.' using errcode = '42501'; end if;
  update public.escala_lideres set arquivado_em = now()
  where pessoa_id = p_pessoa and arquivado_em is null and not grupo_id = any(coalesce(p_grupos, '{}'));
  insert into public.escala_lideres (grupo_id, pessoa_id)
  select g, p_pessoa from unnest(coalesce(p_grupos, '{}')) g
  on conflict (grupo_id, pessoa_id) do update set arquivado_em = null;
end $$;
revoke execute on function public.usuarios_escala_grupos(uuid, uuid[]) from public, anon;
grant execute on function public.usuarios_escala_grupos(uuid, uuid[]) to authenticated;

-- Os grupos da escala (para escolher na página de usuários)
create or replace function public.usuarios_grupos_escala()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when coalesce(public.operacao_papel(auth.uid()), '') = 'socio' then
    (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'nome', g.nome, 'local', g.local, 'setor', g.setor,
       'pessoas', (select count(*) from public.escala_membros m join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id
                   and p.situacao = 1 and p.presente where m.grupo_id = g.id)) order by g.local, g.setor), '[]')
     from public.escala_grupos g where g.arquivado_em is null) else '[]'::jsonb end
$$;
revoke execute on function public.usuarios_grupos_escala() from public, anon;
grant execute on function public.usuarios_grupos_escala() to authenticated;

-- "Quem sou eu" da equipe: também diz se a pessoa lidera algum grupo da escala (abre /escala)
create or replace function public.operacao_eu()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('papel', public.operacao_papel(auth.uid()), 'lider', public.escala_eh_lider(auth.uid()),
    'pessoa', (select to_jsonb(p) - 'email' from public.operacao_pessoas p where p.user_id = auth.uid() and p.ativo limit 1))
$$;
