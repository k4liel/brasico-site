-- =====================================================================
-- Brasico — OPCIONAL: permissões de exclusão
-- Rode no SQL Editor do Supabase se quiser:
--   · apagar arquivos também do armazenamento (hoje some só da lista);
--   · registrar exclusões de tarefas, notas, arquivos e métricas na Atividade;
--   · permitir que um membro saia de um espaço.
-- Não foi aplicado automaticamente porque comandos com exclusão exigem
-- confirmação manual no Supabase.
-- =====================================================================

create policy "membros apagam arquivos" on storage.objects for delete
  using (bucket_id = 'workspace-files'
         and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "sair do workspace" on public.workspace_members for delete
  using (user_id = auth.uid());

create or replace trigger tasks_log_d after delete on public.tasks
  for each row execute function public.log_activity();
create or replace trigger notes_log_d after delete on public.notes
  for each row execute function public.log_activity();
create or replace trigger files_log_d after delete on public.files
  for each row execute function public.log_activity();
create or replace trigger metrics_log_d after delete on public.metrics
  for each row execute function public.log_activity();

-- Tabela de teste vazia criada durante a configuração inicial
drop table if exists public._brasico_teste;

-- Regras do "acesso aberto" (16/10/2026), já neutralizadas (using false).
-- Podem ser removidas com segurança:
drop policy if exists "acesso aberto" on public.workspaces;
drop policy if exists "acesso aberto" on public.workspace_members;
drop policy if exists "acesso aberto" on public.tasks;
drop policy if exists "acesso aberto" on public.notes;
drop policy if exists "acesso aberto" on public.files;
drop policy if exists "acesso aberto" on public.metrics;
drop policy if exists "acesso aberto" on public.activity_log;
drop policy if exists "acesso aberto" on public.profiles;
drop policy if exists "acesso aberto leitura" on storage.objects;
drop policy if exists "acesso aberto envio" on storage.objects;
drop function if exists public.criar_espaco(text);
drop function if exists public.claude_links(uuid);
drop function if exists public.claude_gerar_link(uuid, text, text);
drop function if exists public.claude_revogar_link(uuid);
