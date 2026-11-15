-- "Claude e equipe" mostra só os sócios (15/11/2026, pedido do dono).
-- Colaboradores com login próprio (ex.: a Karina, Operação completa) continuam
-- membros dos projetos que usam, mas não aparecem na equipe dos sócios.
create or replace function public.minha_equipe()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'pessoas', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'email', p.email, 'nome', p.display_name))
      from public.workspace_members m1
      join public.workspace_members m2 on m2.workspace_id = m1.workspace_id
      join public.profiles p on p.id = m2.user_id
      where m1.user_id = auth.uid()
        and coalesce(public.operacao_papel(p.id), 'socio') = 'socio'), '[]'::jsonb),
    'convites', coalesce((select jsonb_agg(distinct lower(i.email))
      from public.workspace_invites i
      join public.workspace_members m on m.workspace_id = i.workspace_id and m.user_id = auth.uid()
      where i.accepted_at is null), '[]'::jsonb));
$function$;
