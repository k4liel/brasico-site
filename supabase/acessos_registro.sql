-- Registro e limites explícitos (15/11/2026, pedido do dono antes da Camila começar: "tem que ser muito bem explícito
-- e coordenado e ter travas… e ter forma da gente verificar caso alguma coisa aconteça").
--   * acessos_recusas: toda tentativa do Claude recusada por falta de acesso (o conector registra depois do erro,
--     numa chamada separada, porque o erro desfaz a transação que tentou gravar).
--   * mcp_meus_acessos: o Claude de cada pessoa pergunta o que pode editar e o que só vê, antes de mudar algo.
--   * operacao_menu: as telas de cada Operação, leves, para o menu (subpáginas da Operação).
--   * acessos_registro: para os administradores, tudo o que cada pessoa fez (projetos, Operação, recusas, acessos).

create table if not exists public.acessos_recusas (
  id bigserial primary key,
  user_id uuid not null,
  origem text not null default 'claude',
  ferramenta text,
  mensagem text,
  em timestamptz not null default now()
);
alter table public.acessos_recusas enable row level security;
revoke all on public.acessos_recusas from anon, authenticated;
create index if not exists acessos_recusas_em on public.acessos_recusas (em desc);

-- quem é o dono do link (sem exigir projeto; não levanta erro)
create or replace function public.mcp_dono_do_link(p_token text)
returns uuid language sql stable security definer set search_path to 'public', 'extensions' as $$
  select t.user_id from public.mcp_tokens t
  where t.revoked_at is null
    and t.token_hash = encode(digest(regexp_replace(coalesce(p_token, ''), '\|[0-9a-fA-F-]{36}$', ''), 'sha256'), 'hex')
$$;
revoke all on function public.mcp_dono_do_link(text) from public, anon, authenticated;

create or replace function public.mcp_registrar_recusa(p_token text, p_ferramenta text, p_mensagem text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v uuid := public.mcp_dono_do_link(p_token);
begin
  if v is null then return; end if;
  -- no máximo 200 registros por pessoa por hora (um Claude insistindo não enche a tabela)
  if (select count(*) from public.acessos_recusas where user_id = v and em > now() - interval '1 hour') >= 200 then return; end if;
  insert into public.acessos_recusas (user_id, ferramenta, mensagem)
    values (v, left(coalesce(p_ferramenta, ''), 80), left(coalesce(p_mensagem, ''), 500));
end $$;
revoke all on function public.mcp_registrar_recusa(text, text, text) from public, authenticated;
grant execute on function public.mcp_registrar_recusa(text, text, text) to anon;

create or replace function public.mcp_meus_acessos(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v uuid := public.mcp_dono_do_link(p_token);
  v_tipo text;
  nomes jsonb := '{"projetos":"Projetos (todos os não restritos)","brainstorm":"Brainstorm","hoteis":"Hotéis · Gestão (dados do PMS)","op_filha_da_lua":"Operação · Filha da Lua","op_sempre_vivo":"Operação · Sempre Vivo","totvs":"Vendas (TOTVS)","operacao":"Notas, compras, fichas e câmara fria","rh":"RH, ponto e escala","receita":"Fiscal (Receita Federal)","whatsapp":"WhatsApp","integracoes":"Integrações","certificados":"Certificados","usuarios":"Usuários"}';
begin
  if v is null then raise exception 'Token inválido ou revogado' using errcode = '28000'; end if;
  v_tipo := public.acesso_tipo(v);
  if v_tipo = 'admin' or v_tipo is null then
    return jsonb_build_object('pessoa', (select display_name from public.profiles where id = v), 'tipo', coalesce(v_tipo, 'socio'),
      'resumo', 'Administrador: pode ver e editar tudo.');
  end if;
  return jsonb_build_object(
    'pessoa', (select display_name from public.profiles where id = v),
    'tipo', v_tipo,
    'pode_editar', coalesce((select jsonb_agg(coalesce(nomes->>area, area) order by area) from public.acessos_areas where user_id = v and nivel = 'editar'), '[]'),
    'so_pode_ver', coalesce((select jsonb_agg(coalesce(nomes->>area, area) order by area) from public.acessos_areas where user_id = v and nivel = 'ver'), '[]'),
    'regras', jsonb_build_array(
      'Só edite o que está em pode_editar. Em so_pode_ver, apenas leia e mostre os dados.',
      'Tudo o que você criar na Operação fica dentro da Operação do hotel: tabelas no banco do hotel e telas (cada tela nova é uma subpágina da Operação). Não existe outro lugar para criar.',
      'O banco recusa qualquer gravação fora do permitido, e cada tentativa recusada fica registrada para os administradores.',
      'Toda mudança (capítulos, SQL, telas) fica no histórico com o nome da pessoa e pode ser desfeita.'),
    'resumo', 'Editor: edita só o que está em pode_editar; o resto é só para ver.');
end $$;
revoke all on function public.mcp_meus_acessos(text) from public, authenticated;
grant execute on function public.mcp_meus_acessos(text) to anon;

-- telas de cada Operação que a pessoa pode ver (só título e slug, para o menu)
create or replace function public.operacao_menu()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(h.hotel, h.telas), '{}'::jsonb) from (
    select x.hotel, coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'rascunho', p.html is null) order by p.ordem, p.titulo)
      from public.op_paginas p where p.hotel = x.hotel and p.arquivado_em is null
        and (p.html is not null or public.op_nivel(x.hotel, auth.uid()) = 'editar')), '[]'::jsonb) telas
    from (values ('filha-da-lua'), ('sempre-vivo')) x(hotel)
    where public.op_nivel(x.hotel, auth.uid()) is not null) h
$$;
revoke all on function public.operacao_menu() from public, anon;
grant execute on function public.operacao_menu() to authenticated;

-- tudo o que cada pessoa fez, para os administradores (página Usuários → Registro)
create or replace function public.acessos_registro(p_dias int default 7, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_de timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 7), 1), 90));
begin
  if not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('pessoa', (select p.display_name from public.profiles p where p.id = r.user_id)) order by r.em desc) from (
    (select l.created_at em, l.user_id, 'projeto' tipo, coalesce(l.source, 'site') origem, w.name onde,
            l.action || ' · ' || coalesce(l.entity, '') || coalesce(' · ' || l.details, '') o_que, true ok
       from public.activity_log l left join public.workspaces w on w.id = l.workspace_id
      where l.created_at >= v_de and (p_user is null or l.user_id = p_user)
        and coalesce(l.details, '') !~ '\((inglês|polonês|francês|alemão)\)$'
      order by l.created_at desc limit 400)
    union all
    (select s.em, s.por, 'operacao_sql', 'claude', 'Operação · ' || s.hotel, left(s.sql, 400), s.ok
       from public.op_sql_historico s where s.em >= v_de and (p_user is null or s.por = p_user) order by s.em desc limit 300)
    union all
    (select h.em, h.por, 'operacao_tela', 'claude', 'Operação · ' || h.hotel, h.tipo || ' · ' || coalesce(h.titulo, h.slug), true
       from public.op_paginas_historico h where h.em >= v_de and (p_user is null or h.por = p_user) order by h.em desc limit 300)
    union all
    (select x.em, x.user_id, 'recusa', x.origem, x.ferramenta, x.mensagem, false
       from public.acessos_recusas x where x.em >= v_de and (p_user is null or x.user_id = p_user) order by x.em desc limit 300)
    union all
    (select a.feito_em, a.user_id, 'acesso', 'site', 'Usuários', 'acesso mudado por ' || coalesce((select display_name from public.profiles where id = a.feito_por), '?'), true
       from public.acessos_historico a where a.feito_em >= v_de and (p_user is null or a.user_id = p_user) order by a.feito_em desc limit 100)
  ) r), '[]'::jsonb);
end $$;
revoke all on function public.acessos_registro(int, uuid) from public, anon;
grant execute on function public.acessos_registro(int, uuid) to authenticated;
