# Arquitetura implementada - Projeto II

O NGINX é o único ponto público de entrada. Mantém o contrato `/api/...` usado pelo frontend e encaminha cada domínio para um contentor próprio.

```text
React -> NGINX -> auth-service     (/auth, /users, /notifications)
                -> workers-service  (/workers, /tasks, /availability)
                -> shifts-service   (/shifts, /schedules, /dashboard)
                -> reports-service  (/reports)

shifts-service -> RabbitMQ (shiftflow.events) -> notifications service
Todos os serviços -> MongoDB
```

## Limites de responsabilidade

| Serviço | Responsabilidade |
| --- | --- |
| `auth-service` | JWT, contas, perfis e notificações consultáveis |
| `workers-service` | Trabalhadores, competências, tarefas e disponibilidades |
| `shifts-service` | Turnos, regras laborais, recorrência, geração e publicação |
| `reports-service` | Consolidação de horas e emissão de PDF |
| `notifications` | Consumo assíncrono de eventos AMQP e registo de entregas |

Os quatro serviços de domínio são executados como processos e contentores independentes, delimitados por `SERVICE_SCOPE`. Nesta entrega usam a mesma instância MongoDB para preservar a consistência das entidades relacionadas durante a transição do monólito inicial. A evolução seguinte, se necessária, é criar uma base de dados Mongo por serviço e substituir as leituras diretas entre domínios por APIs/eventos AMQP.
