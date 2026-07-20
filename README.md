# 💈 WhatsApp Booking Bot & Professional Dashboard

Sistema completo de agendamento de horários para barbearias integrado com bot automático de WhatsApp, controle administrativo multi-tenant, grupos de permissões e segurança avançada.

---

## 🛠️ Tecnologias Utilizadas

### Backend
- **Node.js + Express + TypeScript**
- **PostgreSQL** (com connection pool robusto)
- **@whiskeysockets/baileys** (Conexão nativa leve com WhatsApp Web API - sem dependência de Puppeteer)
- **Security Middlewares:** `helmet` (segurança de cabeçalhos), `express-rate-limit` (limitação de requisições), `bcryptjs` (hashing de senhas), `xss` (sanitização de inputs contra Reflected XSS), JWT (sessão stateless).

### Frontend
- **React (Vite) + TypeScript**
- **React Router DOM v6** (Controle de rotas e guards de permissão)
- **Lucide React** (Pacote de ícones premium)
- **Vanilla CSS** (CSS Variables dinâmicas injetadas diretamente na raiz do HTML para customização da paleta de cores de cada barbearia)

---

## 📂 Arquitetura do Projeto

O código está estruturado em duas pastas principais:
- [`backend/`](file:///home/wallde/Desktop/Projetos/bot-whatsapp/backend): Servidor API e Motor do Bot de WhatsApp.
- [`frontend/`](file:///home/wallde/Desktop/Projetos/bot-whatsapp/frontend): Interface administrativa com dashboard, equipe, personalização e painel de QR Code.

---

## 🚀 Como Iniciar o Projeto

### Passo 1: Configurar o Banco de Dados (PostgreSQL)

1. Crie um banco de dados PostgreSQL chamado `bot_whatsapp` (ou outro nome de sua preferência):
   ```sql
   CREATE DATABASE bot_whatsapp;
   ```
2. Configure as variáveis de conexão no arquivo [`backend/.env`](file:///home/wallde/Desktop/Projetos/bot-whatsapp/backend/.env):
   ```env
   DB_USER=seu_usuario
   DB_HOST=localhost
   DB_DATABASE=bot_whatsapp
   DB_PASSWORD=sua_senha
   DB_PORT=5432
   ```

3. Na pasta do backend, execute a migração de banco de dados para criar as tabelas e povoar com dados iniciais (Seed):
   ```bash
   cd backend
   npm run db:init
   ```

### Passo 2: Executar o Backend (Servidor e Bot)

1. Instale as dependências e inicie o servidor em modo de desenvolvimento:
   ```bash
   cd backend
   npm run dev
   ```
   *O backend subirá na porta `5000` e iniciará o bot do WhatsApp. Se você não tiver sessões salvas, o QR Code de conexão será exibido diretamente no seu terminal.*

### Passo 3: Executar o Frontend (React Dashboard)

1. Em um novo terminal, entre na pasta do frontend, instale as dependências e inicie o servidor Vite:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *O frontend subirá em `http://localhost:5173`.*

---

## 🔐 Dados de Login para Testes (Seed Inicial)

O banco de dados é inicializado com a Barbearia "Barbearia Clássica" (slug: `classica`) e os seguintes usuários cadastrados:

- **Proprietário (Acesso total à equipe, bot, configurações e agenda):**
  - **E-mail:** `carlos@barbearia.com`
  - **Senha:** `123456`
- **Barbeiro Juliano (Acesso restrito apenas à sua própria agenda):**
  - **E-mail:** `juliano@barbearia.com`
  - **Senha:** `123456`
- **Barbeiro Caciano (Acesso restrito apenas à sua própria agenda):**
  - **E-mail:** `caciano@barbearia.com`
  - **Senha:** `123456`

Para testar o layout de login personalizado e a injeção dinâmica de paleta de cores da barbearia, acesse com o slug no link:
👉 `http://localhost:5173/login?shop=classica`

---

## 🤖 Como Usar e Testar o Bot do WhatsApp

1. Acesse o painel como proprietário (`carlos@barbearia.com`).
2. Clique na aba **Bot WhatsApp**.
3. Se o bot estiver iniciando, aguarde alguns segundos até que o **QR Code** apareça diretamente na tela do seu painel React.
4. Abra o WhatsApp no seu celular, vá em **Dispositivos Conectados > Conectar Dispositivo** e escaneie o QR Code.
5. Assim que estiver **Conectado**, envie qualquer mensagem de outro número de WhatsApp para o número conectado.
6. O bot responderá de forma personalizada:
   - Digitando `1`, ele listará os profissionais ativos no banco de dados (`Juliano` e `Caciano`).
   - Digitando o número do profissional (ex: `1`), ele buscará na agenda do banco de dados e listará os horários livres daquele dia.
   - Selecionando o horário, ele registrará o agendamento no banco de dados do PostgreSQL e exibirá instantaneamente a reserva na tela do profissional no dashboard!
