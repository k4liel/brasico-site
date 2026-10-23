---
name: brainstorm
description: Organiza tarefas, ideias e checklists na área Brainstorm do Brasico (quadro de colunas e cards, como o Trello), conduz um brainstorm ou a revisão da semana. Use quando o usuário quiser anotar algo, montar um checklist, pensar numa ideia, decidir entre caminhos ou revisar a semana.
---

# Brainstorm do Brasico

O método completo está em `lib/brainstorm.ts` (o mesmo texto que o conector entrega pela ferramenta `guia_brainstorm`). Resumo:

1. **Anotar**: tarefa ou ideia vira item numa lista (`adicionar_item` em "Tarefas", "Ideias" ou na lista do assunto). Veja antes com `ver_lista` se já existe.
2. **Checklist**: crie uma lista com o nome do assunto (`criar_lista`) e um item por passo.
3. **Brainstorm**: uma pergunta por mensagem até entender o porquê; resuma; proponha 2–3 caminhos com recomendação; quando a pessoa escolher, os próximos passos viram itens em "Tarefas".
4. **Revisão da semana**: atrasados, para esta semana, sem dono e feitos; sugira até 3 prioridades por sócio. Só altere o que a pessoa aprovar.

Nunca apague: arquive.
