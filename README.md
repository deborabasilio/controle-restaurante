# 🐊 Jacaré Vermelho — Controle de Bebidas

Sistema de controle de estoque e pedidos de bebidas para o restaurante Jacaré Vermelho. A contagem é feita pelo **WhatsApp** (um bot guia o funcionário item por item), e o gestor acompanha tudo em um **painel web**: alertas de estoque baixo, pedido sugerido da semana e checklist de compra com entrada automática no estoque.

> Uso interno. O acesso ao painel é restrito a usuários convidados e o bot só responde a números previamente autorizados.

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como o pedido sugerido é calculado](#como-o-pedido-sugerido-é-calculado)
- [Arquitetura](#arquitetura)
- [Tecnologias](#tecnologias)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Banco de dados](#banco-de-dados)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Configuração e deploy](#configuração-e-deploy)
- [Segurança](#segurança)
- [Fluxo do bot](#fluxo-do-bot)

---

## Funcionalidades

### Bot de WhatsApp (contagem de estoque)
- Conversa guiada com botões e listas interativas: categoria → item → quantidade.
- Categorias: **Bebidas**, **Cervejas** e **Vinhos**, com paginação da lista de itens.
- Permite contar vários itens e trocar de categoria na mesma contagem.
- Ao finalizar, calcula o **pedido sugerido** e envia o resumo (com alertas de estoque baixo) para quem contou e para os gestores.
- Acesso restrito a **responsáveis** cadastrados e ativos; qualquer outro número não consegue usar o bot.
- Comandos de escape a qualquer momento: `cancelar`, `menu`, `sair`, `reiniciar` ou `voltar`.

### Painel web (gestor)
- **Alertas de estoque:** itens abaixo do nível mínimo, com ajuste rápido da média semanal.
- **Pedido da semana:** checklist de compra gerado a cada contagem finalizada, com seletor das últimas contagens.
  - Itens organizados por categoria; os que não precisam de pedido ficam recolhidos.
  - Botão **"Marcar como comprado"** (com confirmação), que dá entrada no estoque automaticamente.
  - Botão **"Copiar lista pra enviar"**, que gera o texto separado por categoria (vinho tem fornecedor diferente), pronto para colar no WhatsApp.
- **Produtos:** cadastro e edição por categoria (média semanal, nível de alerta, unidades por pacote, código interno).
- **Responsáveis:** gestão dos números autorizados a usar o bot (ativar/desativar).
- **Convidar usuário:** o gestor convida novos usuários por e-mail, com papel de *funcionário* ou *gestor*.
- **Meus dados:** cada usuário atualiza o próprio WhatsApp para receber os resumos.
- Interface responsiva, pensada para uso no celular (menu hambúrguer, campos numéricos, suporte a iOS Safari).

---

## Como o pedido sugerido é calculado

O estoque é sempre armazenado em **unidades**. A sugestão considera a média semanal de consumo definida para cada produto:

| Tipo de produto | Cálculo |
|---|---|
| Bebidas e cervejas (com *unidades por pacote*) | `pacotes a pedir = max(média semanal − pacotes inteiros em estoque, 0)` |
| Vinhos (ou produto sem pacote configurado) | `garrafas a pedir = max(média semanal − garrafas em estoque, 0)` |

Um item entra na lista de compra quando tem sugestão maior que zero, está em alerta (estoque ≤ nível de alerta) ou já foi comprado. Os demais aparecem na seção recolhida *"sem necessidade de pedido"*.

---

## Arquitetura

```
┌──────────────┐   mensagens    ┌───────────────────────┐
│  WhatsApp    │ ─────────────► │  Vercel Function      │
│  (Cloud API) │ ◄───────────── │  /api/whatsapp        │
└──────────────┘    respostas   └──────────┬────────────┘
                                           │ service role
┌──────────────┐   HTTPS + JWT  ┌──────────▼────────────┐
│  Painel web  │ ─────────────► │  Supabase             │
│  (HTML/JS)   │   (RLS)        │  Auth + Postgres      │
└──────┬───────┘                └──────────▲────────────┘
       │ convite de usuário                │
       └────────► /api/convidar-usuario ───┘
                  (Vercel Function, só gestor)
```

- O **painel** acessa o Supabase diretamente com a chave pública e a sessão do usuário; quem protege os dados é o **Row Level Security**.
- O **bot** roda em função serverless e usa a chave de serviço, que fica apenas no servidor.
- O estado da conversa do WhatsApp é persistido no banco, então a função não guarda nada em memória.

---

## Tecnologias

- **Front-end:** HTML, CSS e JavaScript puro (sem framework)
- **Back-end:** funções serverless Node.js na Vercel
- **Banco e autenticação:** Supabase (PostgreSQL, Auth, Row Level Security)
- **Mensageria:** WhatsApp Business Cloud API (Meta)
- **Hospedagem:** Vercel

---

## Estrutura do projeto

```
.
├── index.html              # Tela de login
├── dashboard.html          # Painel do gestor
├── css/
│   ├── style.css           # Estilo do login
│   └── dashboard.css       # Estilo do painel
├── js/
│   ├── auth.js             # Login com e-mail e senha
│   └── dashboard.js        # Lógica do painel
├── api/
│   ├── whatsapp.js         # Webhook e máquina de estados do bot
│   └── convidar-usuario.js # Convite de usuários (apenas gestor)
├── assets/                 # Logo
├── vercel.json             # Cabeçalhos de segurança
└── package.json
```

---

## Banco de dados

Tabelas principais (schema `public`):

| Tabela | Função |
|---|---|
| `produtos` | Catálogo: categoria, unidade, unidades por pacote, estoque, média semanal e nível de alerta |
| `usuarios_app` | Usuários do painel, com papel (`gestor` ou `funcionario`) e WhatsApp |
| `responsaveis` | Números autorizados a usar o bot |
| `contagens_estoque` | Histórico de contagens feitas pelo bot |
| `pedidos` | Um registro por contagem finalizada |
| `itens_pedido` | Itens do pedido: quantidade contada, sugerida, comprada e status |
| `conversas_whatsapp` | Estado atual de cada conversa do bot |
| `mensagens_processadas` | IDs de mensagens já tratadas, para evitar processamento duplicado |

Quando um item é marcado como comprado, um *trigger* no banco registra a movimentação de entrada e soma a quantidade ao estoque do produto.

---

## Variáveis de ambiente

Configure na Vercel (**Settings → Environment Variables**). Nunca versione esses valores.

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (**somente servidor**) |
| `WHATSAPP_TOKEN` | Token permanente de acesso da Cloud API |
| `WHATSAPP_PHONE_ID` | ID do número de telefone do WhatsApp Business |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook (você define) |
| `WHATSAPP_APP_SECRET` | Chave secreta do app Meta, usada para validar a assinatura do webhook |

No front-end (`js/auth.js` e `js/dashboard.js`) ficam apenas a URL do Supabase e a chave **pública** (*publishable*), que é segura para exposição quando o RLS está ativo.

---

## Configuração e deploy

1. **Supabase**
   - Crie o projeto e as tabelas listadas acima.
   - Desative o cadastro público em *Authentication → Sign In / Providers*; novos usuários entram só por convite.
   - Aplique as políticas de RLS (`supabase-seguranca.sql`).
   - Cadastre o primeiro usuário com papel `gestor`.
2. **Meta (WhatsApp Cloud API)**
   - Crie um app, adicione o produto WhatsApp e gere um token permanente por *Usuário do Sistema*.
   - Configure o webhook para `https://SEU-DOMINIO/api/whatsapp`, usando o mesmo valor de `WHATSAPP_VERIFY_TOKEN`, e assine o campo `messages`.
3. **Vercel**
   - Importe o repositório, defina as variáveis de ambiente e faça o deploy.
   - Faça um novo deploy sempre que alterar variáveis.
4. **Primeiros passos**
   - No painel, cadastre os produtos e os **responsáveis** (WhatsApp no formato `5544999999999`, com DDI e DDD).
   - Envie `contagem` pelo WhatsApp de um número autorizado para testar.

---

## Segurança

- **Webhook autenticado:** toda requisição do WhatsApp tem a assinatura `X-Hub-Signature-256` (HMAC-SHA256) validada com o segredo do app; mensagens duplicadas são descartadas.
- **Row Level Security** em todas as tabelas, sem acesso para usuários anônimos. Só o gestor altera produtos e responsáveis, e ninguém consegue alterar o próprio papel.
- **Lista de números autorizados:** o bot ignora quem não está cadastrado como responsável ativo.
- **Convites restritos:** a função de convite valida o token da sessão e exige papel de gestor.
- **Cadastro público desativado** no Supabase.
- **Cabeçalhos HTTP** configurados no `vercel.json`: CSP restritiva, HSTS, proteção contra clickjacking e `nosniff`.
- **Proteção contra XSS:** dados exibidos no painel passam por escape de HTML.
- **Segredos fora do código:** chaves sensíveis ficam só em variáveis de ambiente.

---

## Fluxo do bot

```
"contagem"
   │
   ▼
Escolher categoria ──► Escolher item ──► Informar quantidade
   ▲                        ▲                   │
   │                        └── Contar outro ◄──┤
   └────── Trocar categoria ◄───────────────────┤
                                                ▼
                                           Finalizar
                                                │
                                                ▼
              Resumo com pedido sugerido + alertas
              (enviado ao responsável e aos gestores)
```
