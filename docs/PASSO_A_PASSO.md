# Brasico — Passo a passo de implantação e operação

Guia para operar o Brasico sem se perder. ✅ = concluído · ⏳ = pendente.

## Endereços do projeto

| O quê | Onde |
|---|---|
| Site (produção) | https://brasico.vercel.app |
| Código | https://github.com/k4liel/brasico-site (público) |
| Painel da Vercel | https://vercel.com/brasico1/brasico |
| Painel do Supabase | https://supabase.com/dashboard/project/doajznzouxxqbqkvsclv |
| Configuração de login | https://supabase.com/dashboard/project/doajznzouxxqbqkvsclv/auth/url-configuration |
| SQL Editor do Supabase | https://supabase.com/dashboard/project/doajznzouxxqbqkvsclv/sql/new |

---

## Fase 1 — Infraestrutura

### Etapa 1 · Repositório no GitHub ✅
- Repositório **público** `k4liel/brasico-site`, branch `main`. Público porque, no plano gratuito da Vercel, só assim os commits do sócio também publicam.
- Por ser público, aqui fica **só código**. Arquivos e dados de clientes ficam no Supabase.
- Cada push na `main` publica na Vercel; o GitHub Actions roda checagem de tipos e build.
- O repositório antigo `k4liel/Brasico` (privado) fica **arquivado** como cópia de segurança. Não excluir.
- ⏳ Adicionar o sócio como colaborador em *Settings → Collaborators*.

### Etapa 2 · Banco de dados no Supabase ✅
Projeto **Brasico** (`doajznzouxxqbqkvsclv`), com:
- 10 tabelas com **RLS** ativo: `profiles`, `workspaces`, `workspace_members`, `workspace_invites`, `tasks`, `notes`, `files`, `metrics`, `activity_log`, `mcp_tokens`.
- Bucket privado `workspace-files` (pasta `<projeto>/<pasta>/<arquivo>`) e tempo real nas tabelas de conteúdo.
- 13 funções do conector do Claude (`mcp_*`), que validam o link e restringem o acesso ao espaço.

Arquivos de referência: [`supabase/schema.sql`](../supabase/schema.sql) e [`supabase/mcp_functions.sql`](../supabase/mcp_functions.sql).

Opcional: [`supabase/opcional_exclusoes.sql`](../supabase/opcional_exclusoes.sql) libera a exclusão de arquivos do armazenamento, registra exclusões na Atividade e remove uma tabela de teste vazia. Rode no SQL Editor quando quiser.

### Etapa 3 · Login (Supabase Auth) ✅
Em *Authentication → URL Configuration* (link na tabela acima):

| Campo | Valor |
|---|---|
| Site URL | `https://brasico.vercel.app` |
| Redirect URLs | `https://brasico.vercel.app/auth/callback` |
| Redirect URLs (desenvolvimento) | `http://localhost:3000/auth/callback` |

Sem isso, o link que chega por e-mail aponta para `localhost` e o login não completa.

### Etapa 4 · Variáveis na Vercel ✅

| Nome | Status |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ configurada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ configurada |

Nenhuma chave secreta é usada: o conector do Claude acessa o banco só pelas funções `mcp_*`, com a chave pública.

### Etapa 5 · Publicação ✅
- Site no ar em **https://brasico.vercel.app**. Cada push na `main` publica sozinho.
- Mudou uma variável? *Deployments* → último deploy → **⋯ → Redeploy**.

---

## Fase 2 — Primeiro uso

### Etapa 6 · Entrar ✅
Entre com o seu e-mail (senha ou link por e-mail). A página inicial é a **central de projetos**.

### Etapa 7 · Arquivos dos projetos ✅
- PDFs, capas e documentos de clientes ficam no bucket privado `workspace-files`, na pasta `<id do projeto>/<pasta>/` (capas em `.../capas/`).
- O site entrega pelo endereço `/api/arquivo/<id do projeto>/<pasta>/<arquivo>.pdf`, só para quem está logado e é da equipe.
- **Nunca** coloque esses arquivos no GitHub.

### Etapa 8 · Conectar o Claude (cada um faz o seu) ⏳
1. No site, abra **Claude e equipe** → **Gerar meu link** → **Copiar** (o link só aparece uma vez).
2. No Claude: *Configurações → Conectores → Adicionar conector personalizado* → nome **Brasico**, URL = o link → salvar.
3. Teste: *"liste meus projetos no Brasico"*.
4. Link vazou ou trocou de computador? **Desconectar** na mesma página e gerar outro.

### Etapa 9 · Convidar o sócio ⏳
1. **Claude e equipe** → *Equipe* → e-mail dele → **Convidar** (entra em todos os projetos, inclusive os futuros).
2. Avise para ele abrir o site e criar a conta com esse e-mail; depois ele faz a Etapa 8 no Claude dele.

---

## Fase 3 — Rotina de trabalho

O site é para ver; tudo se pede ao Claude.

| Quero | Peço ao Claude |
|---|---|
| Começar um projeto | "Crie no Brasico o projeto Carnaval 2027, com capa e um capítulo de cardápio" |
| Mudar um capítulo | "No projeto X, refaça o capítulo de custos com o novo público" |
| Tirar um capítulo | "Remova o capítulo 11 do projeto X" (dá para restaurar depois) |
| Saber o que mudou | Olhe *Últimas mudanças* no projeto, ou peça "o que mudou hoje no projeto X?" |

### Como dividimos o trabalho
- **Conteúdo, visual e estrutura dos projetos:** pelo conector Brasico. Aparece na hora e não mexe no código.
- **Funções novas no site:** código no `brasico-site`. Sempre baixe a versão mais nova antes (`git pull`), faça mudanças pequenas e envie para a `main`. A Vercel publica em ~1 min; acompanhe o deploy até ficar pronto.
- **Arquivos de clientes (PDFs, planilhas, documentos):** nunca no GitHub. Sempre no bucket `workspace-files`, pasta do projeto.

### Dois Claudes no mesmo projeto
- Ler o capítulo antes de alterar.
- Olhar **Mudanças** antes de uma mudança grande (o outro pode ter mexido).
- Mostrar o plano antes de reestruturar um projeto.

### Segurança
- Nunca colocar a chave `service_role` do Supabase, senhas ou tokens no código.
- Nunca apagar dados do banco sem pedido explícito.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Link do e-mail abre `localhost` ou volta para o login | Redirect URL não cadastrada | Etapa 3 |
| Site abre com erro de Supabase | Variáveis ausentes | Etapa 4 e Redeploy |
| Claude responde "Token inválido" | Link desconectado ou copiado errado | Gere um novo link (Etapa 8) |
| Sócio não vê os projetos | Entrou com outro e-mail | Convide o e-mail certo (Etapa 9) |
| Arquivo apagado continua ocupando espaço | Exclusão no armazenamento não liberada | Rode `supabase/opcional_exclusoes.sql` |
