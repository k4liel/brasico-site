-- =====================================================================
-- Acervo fiscal: nada se perde ao atualizar um capítulo (05/11/2026)
--  - Toda mudança em receita_acervo guarda antes a versão anterior (os 5 idiomas) em receita_acervo_historico.
--  - Para desfazer: copie de volta as colunas da linha do histórico para receita_acervo (pelo id do capítulo).
--  - O original de 30/10/2026 continua também no projeto "Organograma Fiscal Brasico".
-- =====================================================================
create table if not exists public.receita_acervo_historico (
  hid bigint generated always as identity primary key,
  id uuid not null,
  secao text, ordem int, titulo text, conteudo text,
  titulo_en text, conteudo_en text, titulo_pl text, conteudo_pl text,
  titulo_fr text, conteudo_fr text, titulo_de text, conteudo_de text,
  guardado_em timestamptz not null default now(),
  guardado_por uuid default auth.uid()
);
alter table public.receita_acervo_historico enable row level security;
drop policy if exists receita_acervo_historico_ver on public.receita_acervo_historico;
create policy receita_acervo_historico_ver on public.receita_acervo_historico for select to authenticated
  using (exists (select 1 from public.receita_acesso a where a.user_id = auth.uid()));

create or replace function public.receita_acervo_guardar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if row(old.titulo, old.conteudo, old.titulo_en, old.conteudo_en, old.titulo_pl, old.conteudo_pl,
         old.titulo_fr, old.conteudo_fr, old.titulo_de, old.conteudo_de, old.ordem, old.secao)
     is distinct from
     row(new.titulo, new.conteudo, new.titulo_en, new.conteudo_en, new.titulo_pl, new.conteudo_pl,
         new.titulo_fr, new.conteudo_fr, new.titulo_de, new.conteudo_de, new.ordem, new.secao) then
    insert into public.receita_acervo_historico (id, secao, ordem, titulo, conteudo, titulo_en, conteudo_en,
      titulo_pl, conteudo_pl, titulo_fr, conteudo_fr, titulo_de, conteudo_de)
    values (old.id, old.secao, old.ordem, old.titulo, old.conteudo, old.titulo_en, old.conteudo_en,
      old.titulo_pl, old.conteudo_pl, old.titulo_fr, old.conteudo_fr, old.titulo_de, old.conteudo_de);
  end if;
  return new;
end $$;
revoke execute on function public.receita_acervo_guardar() from public, anon, authenticated;

drop trigger if exists receita_acervo_guardar on public.receita_acervo;
create trigger receita_acervo_guardar before update on public.receita_acervo
  for each row execute function public.receita_acervo_guardar();

-- Capítulo novo ganha id sozinho
alter table public.receita_acervo alter column id set default gen_random_uuid();
