-- Líderes da escala passam a ver o ponto (14/11/2026, pedido do dono: "libere o ponto e o switch para todo mundo
-- que tem acesso à escala, completa ou parcial"). Desfaz em parte supabase/escala_lider_sem_rhid.sql:
-- escala_dados manda a todos o ponto ('real': horário do RHiD e batidas) e o afastamento de hoje, sempre só das
-- pessoas dos grupos que a pessoa lidera (os membros já vêm filtrados por escala_grupos_do).
-- Continua só para sócios: o saldo do banco de horas e o "Copiar do RHiD".
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('where v_socio and d.dia between p_de and p_ate)' in d) = 0 then
    raise exception 'escala_dados mudou: ajuste este script';
  end if;
  d := replace(d, 'where v_socio and d.dia between p_de and p_ate)', 'where d.dia between p_de and p_ate)');
  d := replace(d, '''afastado'', case when not v_socio then null else (select coalesce(jt.nome', '''afastado'', case when false then null else (select coalesce(jt.nome');
  execute d;
end $do$;
