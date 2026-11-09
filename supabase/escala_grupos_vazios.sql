-- Escala planejada (09/11/2026): a Fazenda virou um lugar à parte (era setor do Sempre Vivo) e a Vila da Barra
-- entrou no Hello Barra (é de lá) — regra em lib/esocial/locais.ts. Ao sincronizar, grupo que ficou sem ninguém
-- (e sem líder) é arquivado, para não aparecer vazio na tela; nada se apaga, e ele volta se alguém entrar.
create or replace function public.escala_membros_sincronizar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupo uuid; v_n int := 0; v_local text; v_setor text;
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios organizam os grupos.' using errcode = '42501'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_local := coalesce(nullif(trim(v->>'local'), ''), 'Sem local');
    v_setor := coalesce(trim(v->>'setor'), '');
    select id into v_grupo from public.escala_grupos where local = v_local and setor = v_setor;
    if v_grupo is null then
      insert into public.escala_grupos (nome, local, setor) values (v_local || case when v_setor <> '' then ' · ' || v_setor else '' end, v_local, v_setor)
      returning id into v_grupo;
    elsif exists (select 1 from public.escala_grupos where id = v_grupo and arquivado_em is not null) then
      update public.escala_grupos set arquivado_em = null where id = v_grupo;
    end if;
    insert into public.escala_membros (cliente_id, pessoa_id, grupo_id) values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, v_grupo)
    on conflict (cliente_id, pessoa_id) do update set grupo_id = excluded.grupo_id, atualizado_em = now()
      where escala_membros.grupo_id <> excluded.grupo_id;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform public.escala_arquivar_vazios(); end if;
  return v_n;
end $$;
revoke execute on function public.escala_membros_sincronizar(jsonb) from public, anon;
grant execute on function public.escala_membros_sincronizar(jsonb) to authenticated;

create or replace function public.escala_arquivar_vazios()
returns int language sql security definer set search_path = public as $$
  with x as (
    update public.escala_grupos g set arquivado_em = now()
    where g.arquivado_em is null
      and not exists (select 1 from public.escala_membros m
                      join public.rhid_pessoas p on p.cliente_id = m.cliente_id and p.id = m.pessoa_id and p.situacao = 1 and p.presente
                      where m.grupo_id = g.id)
      and not exists (select 1 from public.escala_lideres l where l.grupo_id = g.id and l.arquivado_em is null)
    returning 1)
  select count(*)::int from x
$$;
revoke execute on function public.escala_arquivar_vazios() from public, anon, authenticated;

-- Acerto de agora: Fazenda num grupo próprio, Vila da Barra no Hello Barra
insert into public.escala_grupos (nome, local, setor)
select 'Fazenda', 'Fazenda', '' where not exists (select 1 from public.escala_grupos where local = 'Fazenda' and setor = '');
update public.escala_membros m set grupo_id = (select id from public.escala_grupos where local = 'Fazenda' and setor = ''), atualizado_em = now()
where m.grupo_id in (select id from public.escala_grupos where local = 'Sempre Vivo' and setor = 'Fazenda');
update public.escala_membros m set grupo_id = (select id from public.escala_grupos where local = 'Hello Barra' and setor = ''), atualizado_em = now()
where m.grupo_id in (select id from public.escala_grupos where local = 'Vila da Barra');
select public.escala_arquivar_vazios();

-- Fora da escala (09/11/2026): pessoa que o dono mandou tirar da escala (continua no RHiD). Some do ponto e da
-- escala do site (usePonto e escala_dados); null = aparece. Primeiro caso: Jessica Carolina, do Sempre Vivo.
alter table public.rhid_escala_ordem add column if not exists fora_da_escala timestamptz;
-- escala_dados (supabase/escala.sql) ganhou no "membros": and not exists (... rhid_escala_ordem ... fora_da_escala is not null)
update public.rhid_escala_ordem set local = null, setor = null, fora_da_escala = now(), atualizado_em = now()
where cliente_id = 34040 and pessoa_id = 204;
