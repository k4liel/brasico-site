-- Contas pagas mantidas de reserva (23/11/2026)
-- O proxy da IPRoyal ficou sem uso quando a Evolution foi desligada (20/11/2026), e o dono decidiu mantê-lo por
-- enquanto ("Manter por enquanto"). Conta com reserva = true aparece em cinza no painel (sem uso, de propósito), com
-- o valor e a próxima cobrança. Para voltar a cobrar atenção: reserva = false. Para parar de mostrar: ativo = false.

alter table public.integracoes_contratos add column if not exists reserva boolean not null default false;

update public.integracoes_contratos
   set reserva = true,
       observacao = 'Comprado em 17/11/2026 para o WhatsApp (Evolution). Sem uso desde 20/11/2026; mantido de reserva por decisão do dono em 23/11/2026.'
 where id = 'iproyal_proxy';

-- O painel passa a mandar o campo
do $$
declare
  d text := pg_get_functiondef('public.integracoes_painel()'::regprocedure);
begin
  if position('''reserva'', c.reserva' in d) > 0 then return; end if;
  if (select count(*) from regexp_matches(d, '''conferido_em'', c\.conferido_em\)', 'g')) <> 1 then
    raise exception 'integracoes_painel mudou: confira o bloco dos contratos';
  end if;
  d := replace(d, '''conferido_em'', c.conferido_em)', '''conferido_em'', c.conferido_em, ''reserva'', c.reserva)');
  execute d;
end $$;
