-- Equipe de origem na escala do Cicchetti Ponta Negra (23/11/2026, pedido do dono: "coloque todos juntos, separados por
-- setor — cozinha, salão e bar —, mas com legenda pra sabermos"). A casa junta a equipe do Cicchetti com a que veio do
-- Illusion Hotel. Cada pessoa de escala_extras pode ter `equipe` (Illusion | Cicchetti); a grade mostra uma marca antes
-- do nome (C ou I) e a legenda embaixo, só onde houver alguém com equipe (hoje, só no Ponta Negra), no lugar do
-- aviso "fora do ponto". As pessoas foram cadastradas pelo escala_pessoa_nova (os nomes ficam só no banco).

alter table public.escala_extras add column if not exists equipe text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'escala_extras_equipe_check') then
    alter table public.escala_extras add constraint escala_extras_equipe_check check (equipe is null or equipe in ('Illusion', 'Cicchetti'));
  end if;
end $$;
comment on column public.escala_extras.equipe is 'De qual equipe a pessoa vem (Ponta Negra, 23/11/2026): Illusion (equipe do Illusion Hotel) ou Cicchetti. Aparece como marca ao lado do nome, com legenda.';

-- escala_dados passa a devolver a equipe dos de fora do ponto ('equipe' no objeto de cada pessoa de escala_extras)
do $$
declare v text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('''equipe'', e.equipe' in v) = 0 then
    v := replace(v, '''fora_do_ponto'', true)', '''fora_do_ponto'', true, ''equipe'', e.equipe)');
    execute v;
  end if;
end $$;

-- Para marcar a equipe de alguém: update public.escala_extras set equipe = 'Illusion' where id = <id>;
