-- =====================================================================
-- WhatsApp: um resumo por pedido, com todos os grupos juntos.
-- Desde 28/10/2026 há também o resumo automático diário (sem criado_por),
-- feito pela Edge Function whatsapp-resumo (supabase/whatsapp_resumo_diario.sql).
-- Quando um sócio pede outro período, o Claude lê as mensagens
-- (whatsapp_mensagens), escreve um resumo único e grava com
-- whatsapp_salvar_resumo. O site mostra cada resumo em Menu → WhatsApp → Resumos.
-- A tabela antiga wa_resumos (um resumo por grupo e dia) ficou sem uso.
-- =====================================================================

create table if not exists public.wa_resumos_gerais (
  id uuid primary key default gen_random_uuid(),
  de date not null,                         -- período resumido (horário de Brasília)
  ate date not null,
  resumo text not null,                     -- Markdown: títulos, listas e negrito
  total_mensagens int not null default 0,
  total_grupos int not null default 0,
  criado_por uuid,
  created_at timestamptz not null default now()
);
create index if not exists wa_resumos_gerais_quando_idx on public.wa_resumos_gerais (created_at desc);

-- Exclusões bloqueadas, como no resto do Brasico
drop trigger if exists wa_resumos_gerais_sem_exclusao on public.wa_resumos_gerais;
create trigger wa_resumos_gerais_sem_exclusao before delete on public.wa_resumos_gerais
  for each row execute function public.bloquear_exclusao();
drop trigger if exists wa_resumos_gerais_sem_truncate on public.wa_resumos_gerais;
create trigger wa_resumos_gerais_sem_truncate before truncate on public.wa_resumos_gerais
  for each statement execute function public.bloquear_exclusao();

alter table public.wa_resumos_gerais enable row level security;
drop policy if exists "ver resumos gerais" on public.wa_resumos_gerais;
create policy "ver resumos gerais" on public.wa_resumos_gerais for select using (public.wa_pode_ver(auth.uid()));
revoke all on public.wa_resumos_gerais from anon;
grant select on public.wa_resumos_gerais to authenticated;
do $$ begin alter publication supabase_realtime add table public.wa_resumos_gerais; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Conector
-- ---------------------------------------------------------------------
create or replace function public.mcp_wa_salvar_resumo(p_token text, p_resumo text, p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_de date; v_ate date; v_msgs int; v_grupos int; r public.wa_resumos_gerais;
begin
  v_user := public.mcp_wa_auth(p_token);
  if coalesce(trim(p_resumo), '') = '' then raise exception 'O resumo está vazio.'; end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date);
  v_de := coalesce(p_de, v_ate);
  if v_de > v_ate then raise exception 'A data inicial é depois da final.'; end if;
  select count(*), count(distinct m.grupo_id) into v_msgs, v_grupos
    from public.wa_mensagens m join public.wa_grupos g on g.id = m.grupo_id and g.tipo = 'grupo'
   where m.enviada_em >= (v_de::timestamp at time zone 'America/Sao_Paulo')
     and m.enviada_em < ((v_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
  insert into public.wa_resumos_gerais (de, ate, resumo, total_mensagens, total_grupos, criado_por)
  values (v_de, v_ate, trim(p_resumo), v_msgs, v_grupos, v_user) returning * into r;
  return jsonb_build_object('id', r.id, 'de', r.de, 'ate', r.ate, 'mensagens', r.total_mensagens,
    'grupos', r.total_grupos, 'salvo_em', to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'));
end $$;

-- Mesma assinatura de antes; p_grupo não é mais usado (o resumo é de todos os grupos)
create or replace function public.mcp_wa_resumos(p_token text, p_grupo text default null, p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_wa_auth(p_token);
  return jsonb_build_object('resumos', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'de', x.de, 'ate', x.ate,
      'salvo_em', to_char(x.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
      'mensagens', x.total_mensagens, 'grupos', x.total_grupos, 'resumo', x.resumo) order by x.created_at desc)
    from (select * from public.wa_resumos_gerais r
          where (p_de is null or r.ate >= p_de) and (p_ate is null or r.de <= p_ate)
          order by r.created_at desc limit case when p_de is null and p_ate is null then 5 else 50 end) x), '[]'::jsonb));
end $$;

create or replace function public.mcp_wa_grupos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_wa_auth(p_token);
  return jsonb_build_object('hoje', (now() at time zone 'America/Sao_Paulo')::date, 'grupos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'nome', g.nome, 'ativo', g.ativo,
      'mensagens_7_dias', (select count(*) from public.wa_mensagens m where m.grupo_id = g.id and m.enviada_em > now() - interval '7 days'),
      'ultima_mensagem', (select max(enviada_em) from public.wa_mensagens m where m.grupo_id = g.id)
    ) order by g.ativo desc, g.nome)
    from public.wa_grupos g), '[]'::jsonb));
end $$;

revoke execute on function public.mcp_wa_salvar_resumo(text, text, date, date) from public, authenticated;
grant execute on function public.mcp_wa_salvar_resumo(text, text, date, date) to anon;
