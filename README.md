# ShiftFlow – Gestão de Turnos

Aplicação web para gestão e afetação de trabalhadores a turnos, desenvolvida individualmente como projeto final da Licenciatura em Engenharia Informática (Universidade Politécnica de Castelo Branco).

Permite a um **Administrador** planear turnos, validar automaticamente as regras laborais e gerar relatórios de horas em PDF, e a um **Funcionário** consultar os seus turnos, indicar indisponibilidades e receber notificações.

## Funcionalidades

- **Autenticação e perfis** com JWT (Administrador e Funcionário), edição de perfil e gestão de contas.
- **Trabalhadores, cargos e tarefas**, com limites de horas semanais, mensais e anuais por trabalhador.
- **Planeamento de turnos** em calendário (vista semana/mês), com estados de rascunho e publicado. Funcionários só veem turnos publicados.
- **Validação de regras laborais** antes de gravar cada turno:
  - sobreposição de turnos;
  - indisponibilidades (férias, ausências);
  - compatibilidade entre os cargos do trabalhador e os exigidos pela tarefa;
  - descanso mínimo (11 horas por defeito);
  - limites de horas semanais, mensais e anuais.
- **Restrições configuráveis**: regras globais ou específicas de um trabalhador que sobrepõem os valores por defeito.
- **Geração automática de escalas** (distribuição em round-robin), com revisão antes da publicação.
- **Relatórios de horas** com pré-visualização, exportação em PDF (Puppeteer) e histórico.
- **Notificações assíncronas** através de eventos RabbitMQ.
- **Avisos internos** (rascunho/publicado) com notificação automática ao publicar.

## Arquitetura

O NGINX é o único ponto de entrada. A API segue uma arquitetura de monólito modular: o mesmo código é executado em quatro contentores, cada um limitado a um domínio através da variável `SERVICE_SCOPE`, o que prepara a extração futura para microserviços sem alterar os contratos REST.

```text
React ──► NGINX ──► auth-service      (/auth, /users, /notifications, /announcements)
                ├─► workers-service   (/workers, /tasks, /availability, /cargos)
                ├─► shifts-service    (/shifts, /schedules, /dashboard, /restrictions)
                └─► reports-service   (/reports)

shifts-service ──► RabbitMQ (shiftflow.events) ──► notifications
Todos os serviços ──► MongoDB
```

Mais detalhes em [`docs/ARQUITETURA_PROJETO_II.md`](docs/ARQUITETURA_PROJETO_II.md).

## Tecnologias

- **Frontend:** React 18, TypeScript (modo strict), Vite, Tailwind CSS
- **Backend:** Node.js 20, Express, TypeScript (modo strict), Mongoose, JWT, bcrypt
- **Dados e mensagens:** MongoDB 7, RabbitMQ
- **PDF:** Puppeteer (Chromium)
- **Infraestrutura:** Docker Compose, NGINX

## Como executar

Requisitos: [Docker](https://www.docker.com/) com Docker Compose.

1. Copiar o ficheiro de exemplo e definir os segredos:

   ```bash
   cp .env.example .env
   ```

   Alterar `JWT_SECRET` para um valor longo e aleatório (por exemplo, `openssl rand -hex 32`).

2. Arrancar todos os serviços:

   ```bash
   docker compose up --build
   ```

3. Abrir `http://localhost` e criar a primeira conta de administrador.

4. (Opcional) Criar dados de demonstração, com o administrador autenticado:

   ```
   POST http://localhost/api/demo/seed
   ```

   O guião completo está em [`docs/GUIAO_DEMONSTRACAO.md`](docs/GUIAO_DEMONSTRACAO.md).

Outros endereços úteis: `http://localhost/api/health` (estado da API) e `http://localhost:15672` (RabbitMQ Management).

## Testes

Na pasta `services/api`:

```bash
# Lógica de decisão (sobreposição, descanso, limites), isolada da base de dados
node scripts/tests/decision-logic.test.mjs

# Ligação e reconexão ao RabbitMQ, com broker simulado
npm install && npm run build
node scripts/tests/rabbit-reconnect.test.mjs

# Verificação de saúde (com a aplicação a correr)
npm run test:smoke
```

## Estrutura do projeto

```text
.
├── frontend/              # React + Vite + Tailwind
├── services/
│   ├── api/               # API Express/TypeScript (auth, workers, shifts, reports)
│   └── notifications/     # Consumidor de eventos RabbitMQ
├── nginx/                 # Gateway e entrega do frontend
├── docs/                  # Arquitetura, requisitos e guião de demonstração
├── docker-compose.yml
└── .env.example
```

## Documentação

- [Arquitetura](docs/ARQUITETURA_PROJETO_II.md)
- [Matriz de requisitos](docs/MATRIZ_REQUISITOS.md)
- [Guião de demonstração](docs/GUIAO_DEMONSTRACAO.md)

## Limitações e evolução

Todos os serviços partilham a mesma instância MongoDB. O passo seguinte seria uma base de dados por serviço, substituindo as leituras diretas entre domínios por APIs ou eventos.

## Autor

João Pedro Pina Borralho – [LinkedIn](https://www.linkedin.com/in/jo%C3%A3o-borralho-605879449)
