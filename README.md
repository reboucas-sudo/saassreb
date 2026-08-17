# SaaS Plásticos Injetados

Sistema SaaS para fábrica de plásticos injetados — cadastro de produtos, ordem de produção, apontamento de produção (montagem/embalagem e injetoras), carga máquina, WMS/controle de armazém, OEE, dashboards em tempo real.

## 📐 Arquitetura

Monorepo com workspaces (npm):

```
saassreb/
├── packages/
│   ├── backend/          # Node.js + Express + Prisma (MySQL)
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Schema do banco (convertido do PostgreSQL)
│   │   │   └── seed.js          # Dados iniciais
│   │   └── src/
│   │       ├── config/         # env, prisma client
│   │       ├── middlewares/    # auth (JWT), error, validate, notFound
│   │       ├── modules/        # Módulos por domínio
│   │       │   ├── auth/        # Login, renovação de token
│   │       │   ├── produtos/    # CRUD de produtos + validações
│   │       │   └── health/      # Health checks
│   │       ├── utils/          # http, sanitize
│   │       ├── app.js          # Configuração do Express
│   │       └── server.js       # Ponto de entrada
│   └── frontend/         # React + Vite
│       └── src/
│           ├── api/           # Clientes HTTP (auth, produtos)
│           ├── components/    # Layout, ProtectedRoute
│           ├── context/      # AuthContext
│           ├── pages/        # Login, Produtos
│           └── main.jsx      # Roteamento
├── bkp.sql               # Dump PostgreSQL original (referência)
└── package.json          # Workspaces raiz
```

### Princípios de design

- **Modular por domínio**: cada módulo (`produtos`, `auth`, etc.) é auto-contido com `routes`, `controller` e `service`.
- **Sem duplicação**: o `server.js` antigo tinha cada rota duplicada (com e sem `/api`). Agora há uma única definição.
- **Camadas separadas**: `routes` → `controller` → `service` → `prisma`. Facilita manutenção e testes.
- **Validação centralizada**: `express-validator` + middleware `validarRequisicao`.
- **Erros padronizados**: `asyncHandler` captura erros assíncronos; `errorHandler` formata respostas.

## 🚀 Setup

### Pré-requisitos

- Node.js >= 18
- MySQL 8.x
- npm 9+

### 1. Instalar dependências

```bash
# Na raiz do monorepo
npm install
```

### 2. Configurar o backend

```bash
cd packages/backend
cp .env.example .env
# Edite .env com a URL do seu MySQL:
# DATABASE_URL="mysql://USUARIO:SENHA@HOST:3306/saassreb"
```

### 3. Criar o banco e aplicar migrations

```bash
# Crie o banco no MySQL primeiro:
# CREATE DATABASE saassreb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

cd packages/backend
npx prisma migrate dev --name init
npm run db:seed
```

### 4. Rodar em desenvolvimento

```bash
# Na raiz — sobe backend (3001) e frontend (5173) juntos
npm run dev
```

Ou separadamente:

```bash
npm run dev:backend    # http://localhost:3001
npm run dev:frontend   # http://localhost:5173
```

### 5. Credenciais de teste

Após o seed:
- **Email**: `admin@saassreb.local`
- **Senha**: `admin123`

## 📋 Status do projeto

| Módulo | Status | Descrição |
|--------|--------|-----------|
| Estrutura base | ✅ Pronto | Express + middlewares + Prisma + error handling |
| Auth | ✅ Pronto | Login JWT, renovação de token, middleware de proteção |
| Produtos | ✅ Pronto | CRUD completo + validações de referência e EAN |
| Frontend base | ✅ Pronto | Login, layout, listagem e formulário de produtos |
| Ordem de Produção | 📋 Planejado | Próximo módulo |
| Apontamento (Injetoras) | 📋 Planejado | OEE, pulsos, paradas |
| Apontamento (Montagem/Embalagem) | 📋 Planejado | |
| Carga Máquina | 📋 Planejado | |
| WMS / Armazém | 📋 Planejado | Endereçamento, separação, contagem |
| Manutenção | 📋 Planejado | |
| Qualidade | 📋 Planejado | Checklists, não conformidades |
| Dashboard tempo real | 📋 Planejado | Socket.IO |

## 🔄 Migração do sistema antigo

O `server.js` original (25.916 linhas) foi analisado e está sendo reescrito módulo por módulo. O `bkp.sql` (dump PostgreSQL) serve como referência do schema e foi convertido para Prisma + MySQL nesta entrega.
