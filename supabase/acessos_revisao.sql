-- Revisão dos acessos (15/11/2026), antes do primeiro editor com Claude (Camila). Fecha o que conferia
-- só "vê a área" e não "pode editar":
--   * envio de arquivos (projetos, fotos das fichas, notas avulsas);
--   * certificado digital (cofre) e logins da equipe (auth.users), que não passam pelo acesso_guarda;
--   * funções da Supabase chamadas pelo site (whatsapp-enviar, operacao-convidar) usam acesso_edita;
--   * link público, projeto restrito e exclusão para sempre: só administradores (gatilho em workspaces).

-- pode editar a área? (para quem chama sem sessão, como as funções da Supabase com a chave de serviço)
create or replace function public.acesso_edita(p_user uuid, p_area text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case when p_user is null then false
              when not exists (select 1 from public.acessos where user_id = p_user) then true
              else public.acesso_nivel(p_area, p_user) = 'editar' end
$$;
revoke all on function public.acesso_edita(uuid, text) from public, anon;
grant execute on function public.acesso_edita(uuid, text) to authenticated, service_role;

-- trava no começo de uma função (logo depois do primeiro BEGIN)
create or replace function public.acesso_travar_funcao(p_funcao regprocedure, p_area text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare d text := pg_get_functiondef(p_funcao);
begin
  if d like '%acesso_pode_editar(''' || p_area || ''')%' then return; end if;
  d := regexp_replace(d, '\mbegin\M', 'begin
  if not public.acesso_pode_editar(''' || p_area || ''') then
    raise exception ''Você só tem acesso para ver esta área (' || p_area || '). Peça a um administrador para liberar a edição.'' using errcode = ''42501'';
  end if;');
  execute d;
end $$;
revoke all on function public.acesso_travar_funcao(regprocedure, text) from public, anon, authenticated;

select public.acesso_travar_funcao('public.esocial_guardar_certificado(text,text,text,text,text,timestamp with time zone,text)', 'certificados');
select public.acesso_travar_funcao('public.operacao_definir_login(uuid,text,text)', 'usuarios');

-- link público, restrito e exclusão de projeto: só administradores
create or replace function public.workspaces_so_admin()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v uuid := public.acesso_usuario();
begin
  if v is null or not exists (select 1 from public.acessos where user_id = v) or public.acesso_eh_admin(v) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Só os administradores excluem um projeto para sempre.' using errcode = '42501';
  end if;
  if new.is_public is distinct from old.is_public or new.public_slug is distinct from old.public_slug then
    raise exception 'Só os administradores ligam ou trocam o link público de um projeto.' using errcode = '42501';
  end if;
  if new.restrito is distinct from old.restrito then
    raise exception 'Só os administradores marcam um projeto como restrito.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists workspaces_so_admin on public.workspaces;
create trigger workspaces_so_admin before update or delete on public.workspaces
  for each row execute function public.workspaces_so_admin();

-- envio de arquivos: quem só vê não envia
alter policy "membros enviam arquivos" on storage.objects
  with check (bucket_id = 'workspace-files' and is_member(((storage.foldername(name))[1])::uuid) and public.acesso_pode_editar('projetos'));
alter policy "fichas fotos enviar" on storage.objects
  with check (bucket_id = 'fichas-fotos' and fichas_pode(auth.uid()) and public.acesso_pode_editar('operacao'));
alter policy "notas avulsas enviar" on storage.objects
  with check (bucket_id = 'notas-avulsas' and notas_pode_lancar(auth.uid()) and public.acesso_pode_editar('operacao'));

revoke execute on function public.acessos_lista() from anon;

-- correção: o editor ganha a área "conectar" (para conectar o Claude); a junção do texto ao array quebrava
do $m$
declare d text := pg_get_functiondef('public.acessos_aplicar(uuid)'::regprocedure);
begin
  d := replace(d, 'v_areas := v_areas || ''conectar'';', 'v_areas := array_append(v_areas, ''conectar''::text);');
  execute d;
end $m$;
