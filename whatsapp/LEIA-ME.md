# WhatsApp da Brasico

O número da Brasico entra nos grupos da companhia e grava as mensagens no Supabase. Para um resumo, peça ao Claude ("resuma o dia no grupo X"): ele lê as mensagens pelo conector (`whatsapp_grupos`, `whatsapp_mensagens`). Todo dia às 7h sai sozinho um resumo de ontem com todos os grupos (Edge Function `whatsapp-resumo`, agenda em `supabase/whatsapp_resumo_diario.sql`). As mensagens aparecem no site (Menu → WhatsApp).

```
Grupos ─► número da Brasico ─► Evolution API (VPS) ─► Edge Function whatsapp-webhook ─► Supabase (wa_mensagens)
                                                         resumo: pedido ao Claude, que lê wa_mensagens pelo conector
```

- Banco: `supabase/whatsapp.sql` (já aplicado).
- Funções: `supabase/functions/whatsapp-webhook` e `supabase/functions/whatsapp-resumo` (já publicadas).
- Esta pasta: o que roda na VPS.

## Cuidados

- A Evolution usa o WhatsApp Web, que **não é oficial**: o número pode ser banido. Para reduzir o risco, o número **só lê**. Não mande mensagens em massa por ele.
- Avise os administradores e participantes dos grupos que o número da Brasico registra e resume as conversas (LGPD).
- Só os sócios (tabela `wa_acesso`) veem as mensagens e os resumos.

## Passo a passo (uma vez)

### 1. Contratar a VPS
Qualquer VPS Linux (Ubuntu 24.04) com 2 GB de RAM serve: Hostinger KVM 1, Hetzner CX22, Contabo. Anote o IP.

### 2. Instalar o Docker na VPS
Entre na VPS pelo terminal (`ssh root@IP-DA-VPS`) e rode:

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Subir a Evolution
Copie esta pasta `whatsapp/` para a VPS (por exemplo, `git clone` do repositório e `cd brasico-site/whatsapp`). Depois:

```bash
cp .env.example .env
nano .env
```

Preencha as quatro linhas (as instruções estão no próprio arquivo). O `wa_segredo` fica no painel do Supabase, em Integrations → Vault. Depois:

```bash
docker compose up -d
```

### 4. Conectar o número
1. Abra `http://IP-DA-VPS:8080/manager` e entre com o `AUTHENTICATION_API_KEY`.
2. Crie uma instância chamada `brasico`, tipo **Baileys**.
3. No celular do número da Brasico: WhatsApp Business → Aparelhos conectados → Conectar um aparelho → leia o QR code.
4. Nas configurações da instância: **Rejeitar chamadas** ligado, **Ler mensagens** desligado, **Ignorar grupos** desligado.

### 5. Chave do Claude no Supabase
Painel do Supabase → Edge Functions → Secrets → adicione:

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API do Claude (console.anthropic.com) |
| `EVOLUTION_URL` | `http://IP-DA-VPS:8080` (opcional: traz o nome dos grupos) |
| `EVOLUTION_API_KEY` | o mesmo `AUTHENTICATION_API_KEY` (opcional, junto com o de cima) |

### 6. Colocar o número nos grupos
Peça aos administradores para adicionar o número da Brasico nos grupos. A partir daí, cada mensagem nova já aparece no banco.

## Teste rápido
Mande uma mensagem num grupo onde o número está e peça ao Claude: "use whatsapp_grupos". O grupo deve aparecer com 1 mensagem.

Para gerar o resumo de um dia na hora, peça ao Claude ou rode no SQL Editor do Supabase:

```sql
select net.http_post(
  url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/whatsapp-resumo',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_segredo')),
  body := '{"dia": "2026-10-20"}'::jsonb, timeout_milliseconds := 300000);
```

## Parar de acompanhar um grupo
Peça ao Claude: "pare de acompanhar o grupo X" (`whatsapp_monitorar`). O número continua no grupo, mas nada mais é gravado nem resumido.

## Manutenção
- Ver se está rodando: `docker compose ps`
- Ver erros: `docker compose logs -f evolution`
- Atualizar: troque a versão da imagem em `docker-compose.yml` e rode `docker compose pull && docker compose up -d`
- Se o número desconectar, leia o QR code de novo no manager.
