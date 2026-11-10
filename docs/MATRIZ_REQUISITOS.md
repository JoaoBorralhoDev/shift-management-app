# Matriz de rastreabilidade - Projeto II

Esta matriz liga os requisitos definidos no Projeto I às evidências executáveis do Projeto II.

| Requisito | Evidência de implementação | Demonstração |
| --- | --- | --- |
| RF01 | JWT, perfis ADMIN/WORKER, edição de perfil | Criar administrador, autenticar e editar o perfil |
| RF02 | CRUD `/workers` com limites semanal, mensal e anual | Criar, editar e eliminar trabalhador |
| RF03 | CRUD `/tasks` com prioridade e estado | Criar tarefa e atribuí-la a um turno |
| RF04/RF08 | Calendário semanal, criação/edição/eliminação de turnos | Criar turno no planeamento e consultar o mapa |
| RF05 | `POST /shifts/generate` distribui turnos úteis pelos dias úteis | Usar “Gerar semana” e rever os turnos criados |
| RF06 | Validação de sobreposição, disponibilidade, descanso de 11h e limites temporais | Tentar criar um turno incompatível e observar a mensagem |
| RF07 | Pré-visualização de horas e `GET /reports/hours.pdf` com Puppeteer | Filtrar período, visualizar e descarregar PDF |
| RF09 | CRUD de indisponibilidades integrado na validação e geração | Registar férias e tentar agendar nesse intervalo |
| RF10 | Eventos AMQP em `shiftflow.events` e notificações persistidas | Criar/publicar/alterar/cancelar turno e consultar notificações |
| RF11 (novo) | CRUD `/announcements` com estado rascunho/publicado, filtragem por destinatário e notificação automática ao publicar | Criar aviso, publicá-lo e confirmar que o trabalhador o vê e recebe notificação |
| RF01.4 (reforço) | `GET /dashboard` devolve `assignments` (Schedule ativos) e `utilization` (% médio de horas semanais atribuídas vs. limite de cada trabalhador) | Comparar com Fig. 41 do relatório |
| RF01.5 (reforço) | `PUT /users/:id` permite ao Admin editar qualquer conta (nome, email, perfil, dados do trabalhador associado) | Editar a conta de outro utilizador no ecrã "Contas" |
| RF05.3 (reforço) | `GET /shifts` só devolve turnos `published:true` ao Funcionário; ecrã "Calendário" mostra rascunhos com selo "Rascunho" e botão Publicar/"Publicar visíveis" só para Admin | Gerar uma proposta, confirmar que o trabalhador não a vê, publicar e confirmar que passa a aparecer |
| RF08 (reforço) | Alternância de vista Semana/Mês e filtros por trabalhador/tarefa no calendário | Trocar de vista e aplicar filtros |
| 3.4.11 (reforço) | `DELETE /users/:id` faz soft-delete (`deletedAt`, `active:false`), cancela e notifica turnos futuros do trabalhador associado | Eliminar uma conta com turnos futuros e confirmar cancelamento/notificação |
| 3.4.15 (reforço) | `DELETE /shifts/:id` bloqueia turnos passados e marca futuros como `CANCELLED` (soft) em vez de apagar | Tentar eliminar um turno passado (erro) e um futuro (fica cancelado, não desaparece do histórico) |
| RF07 (reforço) | Novo modelo `Report`; cada PDF gerado grava um registo (`from`, `to`, `generatedBy`, `totalHours`); `GET /reports/history` lista os últimos 50 | Gerar um PDF e confirmar que aparece no histórico do ecrã de Relatórios |
| RF03 / diagrama de classes / 3.4.13 (Cargos) | Modelo `Cargo` + CRUD `/cargos`, com bloqueio de nomes duplicados (case-insensitive) e bloqueio de eliminação se associado a `Worker.cargoIds` ou `Task.requiredCargoIds`. `Worker.qualifications` e `Task.requiredQualifications` (texto livre) foram substituídos por `cargoIds`/`requiredCargoIds` (referências a `Cargo`). `validateShift` passou a validar compatibilidade por Cargo em vez de string matching. | Criar um cargo, tentar duplicar o nome (erro), associá-lo a um trabalhador e a uma tarefa, tentar eliminá-lo (erro), desassociar e eliminar (sucesso) |
| RF06 / diagrama de classes (Restrição) | Novo modelo `Restriction` (tipo, valor, âmbito global ou por trabalhador) + CRUD `/restrictions`. `validateShift` resolve cada limite (descanso mínimo, horas semana/mês/ano) através de `resolveRestriction`: usa a regra específica do trabalhador se existir, senão a regra global, senão o valor por defeito (11h / campos do `Worker`). | Criar uma restrição `MIN_REST_HOURS` com valor 14 para um trabalhador específico e confirmar que passa a ser esse o limite aplicado só a ele |

## Novo módulo: Avisos (RF11)

Módulo de gestão de conteúdo (mini-CMS) para comunicação interna: o
Administrador redige um aviso (fica em rascunho), pode editá-lo, e só ao
publicá-lo é que fica visível para os trabalhadores e dispara notificação
(reaproveitando o mesmo mecanismo de eventos/notificações do RF10). É
deliberadamente pequeno — sem versionamento, sem media, sem workflow de
aprovação — porque o objetivo é resolver a comunicação de avisos internos,
não substituir um CMS de propósito geral.

## Limites atuais assumidos conscientemente

A aplicação está organizada por domínios (`auth`, `workers`, `shifts`, `reports`) dentro da API de demonstração. O RabbitMQ já é utilizado para eventos de turno; a extração destes domínios para contentores Node autónomos é o passo seguinte de industrialização, sem alterar os contratos REST expostos pelo NGINX.

