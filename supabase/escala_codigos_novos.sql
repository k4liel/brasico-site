-- Códigos novos no bloquinho da escala (11/11/2026, pedido do dono):
--   FA  Falta (não trabalha)
--   VN  Viagem de negócios · HO Home office · CC Cicchetti Centro · FL Filha da Lua
--       (trabalha, fora do lugar de sempre; sem horário, como os outros códigos: só o T tem entrada e saída)
-- O banco de horas já existia (BH, "Folga do banco de horas").
alter table public.escala_planejada drop constraint if exists escala_planejada_codigo_check;
alter table public.escala_planejada add constraint escala_planejada_codigo_check
  check (codigo = any (array['', 'T', 'F', 'FC', 'FE', 'AT', 'BH', 'LIC', 'DM', 'FA', 'VN', 'HO', 'CC', 'FL']));

-- Feriado a confirmar: quem estava trabalhando no feriado também em viagem, home office ou em outra casa
do $$
declare d text := pg_get_functiondef('public.escala_compensas_dados()'::regprocedure);
begin
  if position('e.codigo = ''T'' and e.dia <= v_hoje' in d) > 0 then
    d := replace(d, 'e.codigo = ''T'' and e.dia <= v_hoje', 'e.codigo in (''T'', ''VN'', ''HO'', ''CC'', ''FL'') and e.dia <= v_hoje');
    execute d;
  elsif position('''CC''' in d) = 0 then
    raise exception 'escala_compensas_dados mudou: ajuste este script';
  end if;
end $$;
