-- Escala: Fiama e Elvis deixam de ser "Fora do RH (a confirmar)" (23/11/2026).
-- Estavam na escala como terceiros (cpf provisório), mas são funcionários da LAIF com folha paga em out/2026:
-- Fiama Marinho dos Santos (Supervisor de Reservas, Sempre Vivo · Reservas) e Elvis de Freitas Marcelino
-- (Contador, Sempre Vivo · Financeiro). Ligar ao CPF real faz o RH, a escala e o ponto tratarem os dois como a mesma
-- pessoa (rhid_sincronizar_rh: inativo no relógio + na escala = trabalha sem bater ponto). O id da linha não muda,
-- então os dias já montados na escala (escala_planejada com cliente_id 0 e pessoa_id = id) continuam.
update public.escala_extras x set empresa_id = t.empresa_id, cpf = t.cpf, nome = t.nome, atualizado_em = now()
from public.esocial_trabalhadores t
where x.empresa_id = 'terceiro' and t.empresa_id = '50639716'
  and ((x.cpf = 'a-confirmar-fiamma' and t.nome = 'FIAMA MARINHO DOS SANTOS')
    or (x.cpf = 'a-confirmar-elvis' and t.nome = 'ELVIS DE FREITAS MARCELINO'));
