-- =====================================================================
-- Compras · login por usuário e senha para a equipe das casas (03/11/2026)
-- Quem pede no grupo COMPRAS e a Fernanda (setor de compras) entram com um usuário (o primeiro nome),
-- sem e-mail. Por baixo, o usuário vira o e-mail <usuario>@usuarios.brasico (nenhum e-mail é enviado);
-- a tela de login completa o domínio quando a pessoa digita só o usuário (app/login/page.tsx).
-- operacao_definir_login cria a conta (ou troca a senha, se já existir) e liga à pessoa em operacao_pessoas.
-- Só sócios (notas_acesso) ou o service_role chamam. Senhas nunca vão para este repositório.
-- =====================================================================

create or replace function public.operacao_definir_login(p_pessoa uuid, p_usuario text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_usuario text := lower(trim(coalesce(p_usuario, '')));
  v_email text;
  v_user uuid;
  v_pessoa public.operacao_pessoas;
begin
  if auth.uid() is not null and not exists (select 1 from public.notas_acesso where user_id = auth.uid()) then
    raise exception 'Só os sócios criam logins' using errcode = '42501';
  end if;
  if v_usuario !~ '^[a-z0-9._-]{2,40}$' then raise exception 'Usuário inválido: use só letras sem acento, números, ponto ou traço.'; end if;
  if length(coalesce(p_senha, '')) < 8 then raise exception 'A senha precisa ter pelo menos 8 caracteres.'; end if;
  select * into v_pessoa from public.operacao_pessoas where id = p_pessoa;
  if v_pessoa.id is null then raise exception 'Pessoa não encontrada.'; end if;

  v_email := v_usuario || '@usuarios.brasico';
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null and v_pessoa.user_id is not null and v_pessoa.user_id <> v_user then
    raise exception 'Este usuário já pertence a outra pessoa.';
  end if;

  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token,
      is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      crypt(p_senha, gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('nome', v_pessoa.nome), now(), now(),
      '', '', '', '', '', '', false, false);
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, v_user::text, 'email',
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true, 'phone_verified', false), null, now(), now());
  else
    update auth.users set encrypted_password = crypt(p_senha, gen_salt('bf')), updated_at = now() where id = v_user;
  end if;

  update public.operacao_pessoas set user_id = v_user, email = v_email, convidado_em = coalesce(convidado_em, now()) where id = p_pessoa;
  return jsonb_build_object('pessoa', v_pessoa.nome, 'usuario', v_usuario, 'criado', v_pessoa.user_id is null);
end $$;
revoke execute on function public.operacao_definir_login(uuid, text, text) from public, anon;
grant execute on function public.operacao_definir_login(uuid, text, text) to authenticated, service_role;
