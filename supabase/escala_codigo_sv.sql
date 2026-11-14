-- Código novo no bloquinho da escala (14/11/2026, pedido do dono): SV = trabalha no Sempre Vivo
-- (em "Trabalha em outro lugar", como CC Cicchetti Centro e FL Filha da Lua; sem horário).
alter table public.escala_planejada drop constraint if exists escala_planejada_codigo_check;
alter table public.escala_planejada add constraint escala_planejada_codigo_check
  check (codigo = any (array['', 'T', 'F', 'FC', 'FE', 'AT', 'BH', 'LIC', 'DM', 'FA', 'VN', 'HO', 'CC', 'FL', 'SV']));

-- Feriado a confirmar: quem estava no Sempre Vivo num feriado também conta como trabalhando
do $$
declare d text := pg_get_functiondef('public.escala_compensas_dados()'::regprocedure);
begin
  if position('''CC'', ''FL'')' in d) > 0 then
    d := replace(d, '''CC'', ''FL'')', '''CC'', ''FL'', ''SV'')');
    execute d;
  elsif position('''SV''' in d) = 0 then
    raise exception 'escala_compensas_dados mudou: ajuste este script';
  end if;
end $$;
