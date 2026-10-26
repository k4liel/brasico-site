// Como o Claude trabalha com o ponto do RHiD, entregue pela ferramenta guia_ponto do conector.
// O mesmo resumo está na skill .claude/skills/ponto-rhid.
export const GUIA_PONTO = `
PONTO (RHiD) DO BRASICO — COMO TRABALHAR

De onde vêm os dados
- Do RHiD (ponto em nuvem da Control iD), copiados pelo Brasico: pessoas ativas no relógio, a apuração de cada dia (escala prevista, batidas, horas trabalhadas, extras, atrasos, faltas, banco de horas) e os relógios.
- Cadastros são lidos às 5h; o ponto a cada 10 min das 5h às 7h50 e de novo às 12h e 17h (Fortaleza). Os dias futuros (até 13 dias) trazem a ESCALA prevista; os passados trazem o que foi batido.
- Os sócios veem tudo também no site: Menu → RH · eSocial → Ponto e escalas / Banco de horas.
- O cadastro de ponto se liga ao RH (eSocial) pelo CPF. Pessoa "sem ficha no RH" = CPF fora do cadastro do eSocial (ou sem CPF no RHiD).

Ferramentas
- rhid_situacao: clientes RHiD (LAIF, Brasico77, Genesis), empresas e CNPJ, quantas pessoas ativas, relógios (conectados nas últimas 24h?), período já lido e as últimas leituras. Comece por aqui se algo parecer desatualizado.
- rhid_equipe: pessoas ativas no relógio, com unidade (departamento do RHiD), última batida, escala de hoje, saldo do banco e se têm ficha no RH. Filtros: busca (nome, CPF ou id "cliente:id") e unidade (parte do nome).
- rhid_ponto: o ponto por dia de uma pessoa ou de uma unidade num período (padrão: últimos 7 dias; máximo 93). Por dia: escala prevista, folga, batidas (horas), minutos trabalhados, extras, atraso, saída antecipada, falta (e se foi justificada), abono, saldo do banco e o alerta do RHiD. Traz também os totais do período (sem o dia de hoje).
- rhid_banco_horas: o saldo do banco de horas de todo mundo (ou de uma unidade), do mais negativo ao mais positivo, com a variação em 30 dias e os totais positivo e negativo.
- rhid_atualizar: pede uma leitura agora ("batidas" = ponto; "cadastros" = pessoas/relógios). Leva até 2 minutos; confira em rhid_situacao.

Passo a passo de um pedido
1. Entenda quem (pessoa ou unidade) e o período. "Hoje" é no horário de Fortaleza; rhid_situacao devolve a data de hoje.
2. Para quem está trabalhando agora, faltou ou chegou atrasado: rhid_ponto do dia. Para escala da semana: rhid_ponto com de/ate à frente.
3. Para banco de horas: rhid_banco_horas (resuma: quantos positivos, quantos negativos, os maiores de cada lado).
4. Responda com os números e diga de onde vieram (RHiD, dia da última leitura). Se o período pedido ainda não foi lido, diga e peça com rhid_atualizar.

O que cada número quer dizer
- Tudo em MINUTOS. Converta para horas ao responder (436 min = 7h16).
- escala: horário contratual do dia ("07:00-12:00 / 13:00-15:20"). Dia lido sem escala e sem feriado = folga.
- batidas: horas batidas de fato (entrada, saída para o almoço, volta, saída). Número ímpar de batidas hoje = a pessoa ainda está trabalhando.
- falta: dia inteiro sem trabalhar numa data com escala; falta_justificada = com justificativa aprovada no RHiD (atestado, abono).
- atraso_min: atraso na entrada; saida_antecipada_min: saiu antes do horário.
- saldo_banco_min: saldo do banco de horas calculado pelo RHiD no fim daquele dia (negativo = devendo horas).
- alerta: a observação do próprio RHiD para o dia ("Falta", "Extra acima de 10 min (banco de horas)").
- O RHiD recalcula os últimos dias quando alguém lança uma justificativa: números de ontem podem mudar hoje.

Como responder
- Português, curto, horas no formato 7h16; negativo com sinal (−17h27).
- Dados pessoais (LGPD): mostre só o necessário para o pedido. Nunca liste CPF se não foi pedido. Toda consulta fica registrada e aparece na área técnica do RH.
- Não invente números que não vieram das ferramentas.

O que não fazer
- Nunca peça nem mostre e-mail ou senha do RHiD. Ficam só no cofre do Supabase.
- Não há como lançar ou alterar batidas e justificativas por aqui: é só leitura. Isso se faz no RHiD.
- Salários não estão no conector (só na tela Salários do RH, para os sócios).
`;
