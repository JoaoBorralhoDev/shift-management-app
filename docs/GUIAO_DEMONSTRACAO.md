# Guião de demonstração - ShiftFlow

## Preparação

1. Executar `docker compose up --build`.
2. Abrir `http://localhost` e criar o primeiro administrador.
3. Em Postman ou terminal autenticado, chamar `POST /api/demo/seed` para criar dados consistentes de demonstração.

## Percurso de 5 minutos

1. Abrir **Visão geral** e explicar as métricas globais.
2. Em **Trabalhadores**, criar ou editar um trabalhador e mostrar os três limites de horas.
3. Em **Disponibilidades**, criar férias para um trabalhador; em **Planeamento**, tentar criar um turno nesse período e mostrar a validação.
4. Criar um turno válido, editar o respetivo horário e publicar o turno. Explicar a criação de notificação e o evento RabbitMQ.
5. Usar **Gerar semana** e indicar que os turnos propostos são revistos no calendário antes da publicação.
6. Abrir **Relatório de horas**, selecionar o intervalo e descarregar o PDF gerado no servidor.

## Verificações para o júri

- `http://localhost/api/health` devolve `{ "status": "ok" }`.
- Em RabbitMQ Management (`http://localhost:15672`), a fila `shiftflow.events` evidencia a comunicação assíncrona.
- A API valida limites semanais, mensais e anuais, descanso mínimo e sobreposições antes de persistir o turno.

