-- Cicchetti Ponta Negra na escala (20/11/2026, pedido do dono: "uma área nas escalas para o Cicchetti Ponta Negra,
-- por enquanto só a escala editável, ainda não tem ponto"). A casa ainda não existe no RHiD, então os setores entram
-- como grupos fixos (aparecem vazios e nunca são arquivados; supabase/escala_grupos_fixos.sql). A equipe entra pelo
-- painel "Sem ponto": quem já está no RH (Incluir, escolhendo a casa) ou, para quem ainda não está, "Pessoa nova"
-- (escala_pessoa_nova: só nome, cargo, casa e setor; fica como "Fora do RH (a confirmar)"). Nada se apaga.

insert into public.escala_grupos (nome, local, setor, fixo)
select 'Cicchetti Ponta Negra · ' || v.setor, 'Cicchetti Ponta Negra', v.setor, true
from (values ('Cozinha'), ('Salão'), ('Bar'), ('Gerência')) v(setor)
where not exists (select 1 from public.escala_grupos g where g.local = 'Cicchetti Ponta Negra' and g.setor = v.setor);
update public.escala_grupos set fixo = true, arquivado_em = null
where local = 'Cicchetti Ponta Negra' and setor in ('Cozinha', 'Salão', 'Bar', 'Gerência');

-- Ordem dos setores na casa: Gerência, Cozinha, Salão, Bar
insert into public.escala_setores_ordem (local, setor, posicao)
select 'Cicchetti Ponta Negra', v.setor, v.p from (values ('Gerência', 1), ('Cozinha', 2), ('Salão', 3), ('Bar', 4)) v(setor, p)
on conflict do nothing;

-- Pessoa nova na escala, sem RH nem ponto (contratação recente ou ainda não cadastrada no RH). "cpf" provisório,
-- não é CPF de verdade (como Fiama e Elvis em escala_extras_sem_rh.sql).
create or replace function public.escala_pessoa_nova(p_nome text, p_cargo text, p_local text, p_setor text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_nome text := upper(trim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'))); v_cpf text;
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios mexem na escala de todos.' using errcode = '42501'; end if;
  if length(v_nome) < 2 then raise exception 'Escreva o nome da pessoa.'; end if;
  if coalesce(trim(p_local), '') = '' then raise exception 'Escolha a casa.'; end if;
  v_cpf := 'a-confirmar-' || substr(md5(v_nome || clock_timestamp()::text), 1, 10);
  insert into public.escala_extras (empresa_id, cpf, nome, cargo, local, setor, situacao, atualizado_por)
  values ('terceiro', v_cpf, v_nome, coalesce(trim(p_cargo), ''), trim(p_local), coalesce(trim(p_setor), ''), 'fora', auth.uid());
  return public.escala_contratado_definir('terceiro', v_cpf, 'na_escala', p_local, p_setor);
end $$;
revoke execute on function public.escala_pessoa_nova(text, text, text, text) from public, anon;
grant execute on function public.escala_pessoa_nova(text, text, text, text) to authenticated;
