# Brasico — regras para o Claude

Duas pessoas (Kaliel, GitHub `k4liel`, e o sócio) mexem neste projeto, cada uma com o próprio Claude. Nenhum dos dois é programador: responda em português, de forma simples e direta. Explique o que vai fazer, faça e diga o resultado.

## O que é
Central de projetos em https://brasico.vercel.app. Cada projeto é um documento de capítulos em Markdown, mostrado no visual de uma proposta comercial. O site é só para ver: quem cria e edita os projetos são os Claudes, pelo conector **Brasico** (MCP em `/api/mcp`). Veja o [README](README.md) e o [passo a passo](docs/PASSO_A_PASSO.md).

## Por onde mudar cada coisa
- **Conteúdo, visual e estrutura de um projeto:** pelo conector Brasico. Não precisa de código.
- **Funções novas do site:** código neste repositório (`k4liel/brasico-site`, público, branch `main`).
- **Arquivos de clientes (PDFs, planilhas, documentos):** só no bucket privado `workspace-files` do Supabase, pasta `<id do projeto>/<pasta>/`. **Nunca no GitHub.**

## Antes de mudar código
1. `git pull` antes de começar: o outro pode ter enviado algo.
2. Faça mudanças pequenas. Antes de enviar, rode `npx tsc --noEmit` e `npm run build`.
3. Envie para a `main`. A Vercel publica em ~1 min (projeto `brasico`, time `brasico1`). Acompanhe o deploy até ficar READY e teste o site.
4. Se o `git push` for recusado, rode `git pull` de novo, resolva os conflitos com cuidado e só então envie.

## Este repositório é público
- Nunca coloque aqui: chave `service_role`, senhas, tokens, links do conector, e-mails, dados de clientes, propostas, PDFs, seeds com dados reais. O `.gitignore` bloqueia `privado/`, `*.pdf`, `supabase/seed_*.sql` e `.env*`, mas confira antes de cada commit.
- As únicas variáveis do site são `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas por natureza).

## Banco (Supabase `doajznzouxxqbqkvsclv`)
- RLS em todas as tabelas: só membros do projeto (`is_member`).
- O conector usa só funções `mcp_*` (`security definer`, `execute` só para `anon`), que validam o link pelo hash em `mcp_tokens`.
- Mudança de esquema: aplique no Supabase e salve uma cópia do SQL em `supabase/`.
- **Exclusões são bloqueadas no banco** (DELETE, TRUNCATE e DROP nas tabelas do Brasico). Nunca apague dados sem pedido explícito do dono. Só nesse caso use `set local brasico.permitir_exclusao = 'sim';` na mesma transação.
- Toda mudança em capítulo ou no CSS do projeto guarda a versão anterior em `versoes`. Para desfazer, use as ferramentas `versoes_capitulo` / `ler_versao` / `restaurar_versao`.

## Brainstorm (ideias e tarefas da equipe)
- Área geral do site (Menu → Brainstorm), fora dos projetos. Tabelas `ideias` e `ideia_comentarios` (supabase/ideias.sql).
- Quadro: entrada → conversa → decidido → fazendo → feito, mais estacionado. Nada se apaga: arquive.
- Pelo conector: `listar_ideias`, `ler_ideia`, `anotar_ideia`, `atualizar_ideia`, `comentar_ideia` e o método em `guia_brainstorm` (lib/brainstorm.ts; skill em .claude/skills/brainstorm).

## Trabalhando nos projetos pelo conector
- Leia o capítulo antes de alterar e envie a `versao` lida em `atualizar_nota`. Se a gravação for recusada porque o capítulo mudou, leia de novo e junte as mudanças. Nunca descarte o trabalho do outro.
- Antes de uma mudança grande, olhe `ver_atividade` (o painel Mudanças do site).
- Antes de reestruturar um projeto, mostre o plano e espere a confirmação.
- Excluir projeto pelo conector (`remover_projeto`) só manda para a Lixeira; confirme o nome com o usuário antes. Excluir para sempre só existe no site, na Lixeira, digitando o nome do projeto.
- Antes de qualquer ação difícil de desfazer (excluir, reescrever histórico do git, deixar algo público), mostre o plano e espere a confirmação.
