-- Novo login dos sócios/editores (15/11/2026): a função da Supabase acessos-convidar cria a conta só com o e-mail
-- (sem senha) e devolve ao administrador um link de 1 hora para a pessoa criar a própria senha (/auth/senha).
-- A pessoa nova entra em acessos como "Só o site", sem área nenhuma, até o administrador marcar o que ela pode.
create or replace function public.acessos_novo_login(p_user uuid, p_nome text, p_por uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.acesso_eh_admin(p_por) then raise exception 'Só administradores' using errcode = '42501'; end if;
  if nullif(trim(p_nome), '') is not null then
    update public.profiles set display_name = trim(p_nome) where id = p_user;
  end if;
  if not exists (select 1 from public.acessos where user_id = p_user) then
    insert into public.acessos (user_id, tipo, atualizado_por) values (p_user, 'usuario', p_por);
    insert into public.acessos_historico (user_id, antes, depois, feito_por)
      values (p_user, null, jsonb_build_object('tipo', 'usuario', 'areas', '{}'::jsonb, 'novo_login', true), p_por);
    perform public.acessos_aplicar(p_user);
  end if;
end $$;
revoke all on function public.acessos_novo_login(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.acessos_novo_login(uuid, text, uuid) to service_role;
