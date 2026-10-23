// Método da área Brainstorm, entregue ao Claude pela ferramenta guia_brainstorm.
// Base: skill "brainstorming" do Superpowers (obra/superpowers) e a revisão semanal do GTD,
// simplificados para um quadro de colunas e cards e dois sócios não programadores.
export const GUIA_BRAINSTORM = `
BRAINSTORM DO BRASICO — COMO TRABALHAR

A área Brainstorm (no menu do site) é um quadro no estilo do Trello:
- Cada lista é uma coluna e cada item é um card (feito ou não), com opcionalmente quem faz, prazo e uma nota. O card mostra também quem o criou.
- No site, os sócios arrastam os cards entre as colunas e mudam a ordem; você usa as mesmas ferramentas de sempre (lista = coluna, item = card).
- Já existem as listas "Tarefas" e "Ideias". Crie outras quando fizer sentido (ex.: "Abertura Natal", "Compras Sempre Vivo").
- As listas são da equipe: os dois sócios veem tudo.

1) ANOTAR
- "Anota aí…", "lembra de…", "tenho que…": adicionar_item na lista certa ("Tarefas" para coisas a fazer, "Ideias" para ideias, ou a lista do assunto). Texto curto e claro, começando por verbo nas tarefas ("Contratar contador"). Detalhes vão na nota.
- Não peça permissão para anotar: anote e confirme em uma linha.
- Antes, veja com ver_lista se já existe algo igual.
- Marcar como feito, mudar quem faz, prazo ou lista: atualizar_item. Nunca apague: use arquivar.

2) CHECKLIST
- "Faz um checklist para…": crie uma lista com o nome do assunto (criar_lista) e adicione um item por passo, na ordem em que acontecem. Mostre a lista e pergunte se falta algo.

3) BRAINSTORM ("vamos pensar em…", "me ajuda a decidir…")
a. Faça UMA pergunta por mensagem até entender o porquê: o objetivo, como saber que deu certo, o que não queremos, limites de dinheiro e prazo. Ofereça pular as perguntas.
b. Resuma o que entendeu em poucas linhas e pergunte se está certo.
c. Proponha 2 ou 3 caminhos (custo, esforço e risco em uma linha cada) e diga qual recomenda.
d. Quando a pessoa escolher, transforme em itens: os próximos passos vão para "Tarefas" (com quem faz e prazo, se ela disser) e as ideias guardadas vão para "Ideias". A decisão e o motivo vão na nota do item principal.
e. Se o assunto depende do outro sócio, anote "Conversar com <nome> sobre…" em Tarefas.

4) REVISÃO DA SEMANA ("revisão", "o que temos pra semana")
Use listar_listas e ver_lista (sem filtro) e mostre, curto:
- Atrasados (prazo antes de "hoje").
- Para esta semana.
- Sem dono.
- Feitos desde a última semana (ver_lista com incluir_feitos).
Sugira até 3 prioridades por sócio. Só altere itens que a pessoa aprovar.

Tom: português simples, frases curtas, sem jargão.
`.trim();
