-- Quem está inativo no relógio de ponto (RHiD) mas trabalha sem bater ponto (14/11/2026, caso do Maicon,
-- chefe de bar do Cicchetti Centro): se o sócio o pôs na escala como "fora do ponto" (escala_extras na_escala),
-- o RH passa a tratá-lo como "não bate ponto" (sem_ponto) e não como "saiu do ponto".
do $do$
declare d text := pg_get_functiondef('public.rhid_sincronizar_rh()'::regprocedure);
begin
  if position('when x.cpf is null then ''sem_ponto''
      when x.situacao is distinct from 1 then ''inativo''' in d) = 0 then
    raise exception 'rhid_sincronizar_rh mudou: ajuste este script';
  end if;
  d := replace(d, 'when x.cpf is null then ''sem_ponto''
      when x.situacao is distinct from 1 then ''inativo''', 'when x.cpf is null then ''sem_ponto''
      when x.situacao is distinct from 1 and exists (select 1 from public.escala_extras e
        where e.empresa_id = t2.empresa_id and e.cpf = t2.cpf and e.situacao = ''na_escala'') then ''sem_ponto''
      when x.situacao is distinct from 1 then ''inativo''');
  execute d;
end $do$;
