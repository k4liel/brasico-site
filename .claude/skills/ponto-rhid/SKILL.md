---
name: ponto-rhid
description: Consulta o ponto dos funcionários no RHiD (relógios de ponto da Control iD) pelo conector Brasico — quem bateu ponto hoje, escala prevista, faltas, atrasos, horas extras e banco de horas por pessoa, unidade e período. Use quando o usuário perguntar quem está trabalhando, quem faltou ou chegou atrasado, qual a escala de alguém, quanto alguém tem no banco de horas, ou pedir para atualizar a leitura do ponto.
---

# Ponto (RHiD) pelo conector Brasico

Leia primeiro a ferramenta `guia_ponto` do conector: ela tem o passo a passo e o que cada número quer dizer. Resumo:

1. **Quem e quando.** Pessoa (nome, CPF ou id `cliente:id`) ou unidade (parte do nome do departamento); período em AAAA-MM-DD, horário de Fortaleza.
2. **Ferramentas.** `rhid_situacao` (visão geral, relógios, última leitura), `rhid_equipe` (pessoas ativas no relógio), `rhid_ponto` (dia a dia: escala, batidas, horas, faltas, atrasos, saldo), `rhid_banco_horas` (saldo de todo mundo), `rhid_atualizar` (ler agora).
3. **Minutos → horas** ao responder (436 min = 7h16; negativo com sinal).
4. **LGPD.** Dados pessoais: mostre só o necessário; CPF só se pedido. Cada consulta fica registrada no RH.
5. **Só leitura.** Batidas e justificativas se lançam no RHiD, não por aqui. Salários não estão no conector.

Regras que não mudam: nunca peça nem mostre a senha do RHiD; não invente números; se o período não foi lido, diga e peça `rhid_atualizar`.
