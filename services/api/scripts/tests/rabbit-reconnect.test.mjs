// Testes de startRabbit (services/api/src/rabbit.ts) com um broker simulado.
// Executar após compilar:  npm run build && node scripts/tests/rabbit-reconnect.test.mjs
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startRabbit } from "../../dist/rabbit.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
const waitFor = async (condition, ms = 2000) => {
  const limit = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > limit) throw new Error("tempo esgotado à espera da condição");
    await new Promise(r => setTimeout(r, 5));
  }
};

// Broker simulado: as primeiras `failures` ligações falham (como acontece quando o
// RabbitMQ ainda está a arrancar); as seguintes têm sucesso.
function fakeBroker(failures) {
  const state = { attempts: 0, sent: [], connection: null };
  const connect = async () => {
    state.attempts += 1;
    if (state.attempts <= failures) throw new Error("ECONNREFUSED");
    const connection = new EventEmitter();
    connection.createChannel = async () => ({
      assertQueue: async () => ({}),
      sendToQueue: (queue, buffer) => { state.sent.push({ queue, message: JSON.parse(buffer.toString()) }); return true; },
    });
    connection.close = async () => {};
    state.connection = connection;
    return connection;
  };
  return { connect, state };
}

const quiet = { log: console.log, warn: () => {} };
console.warn = quiet.warn; // as tentativas falhadas são esperadas nestes testes

await test("Liga à primeira tentativa quando o broker está disponível", async () => {
  const { connect, state } = fakeBroker(0);
  const rabbit = startRabbit({ url: "amqp://x", queue: "q", retryMs: 10, connect });
  await waitFor(() => rabbit.isConnected());
  assert.equal(state.attempts, 1);
});

await test("Repete a ligação até o broker ficar disponível (2 falhas, 3.ª tentativa liga)", async () => {
  const { connect, state } = fakeBroker(2);
  const rabbit = startRabbit({ url: "amqp://x", queue: "q", retryMs: 10, connect });
  assert.equal(rabbit.isConnected(), false);
  await waitFor(() => rabbit.isConnected());
  assert.equal(state.attempts, 3);
});

await test("publish sem ligação devolve false e não lança erro", async () => {
  const { connect } = fakeBroker(1000);
  const rabbit = startRabbit({ url: "amqp://x", queue: "q", retryMs: 10, connect });
  assert.equal(rabbit.publish({ type: "SHIFT_CREATED" }), false);
});

await test("publish com ligação envia o evento para a fila certa", async () => {
  const { connect, state } = fakeBroker(0);
  const rabbit = startRabbit({ url: "amqp://x", queue: "shiftflow.events", retryMs: 10, connect });
  await waitFor(() => rabbit.isConnected());
  assert.equal(rabbit.publish({ type: "SHIFT_CREATED", payload: { workerId: "w1" } }), true);
  assert.deepEqual(state.sent, [{ queue: "shiftflow.events", message: { type: "SHIFT_CREATED", payload: { workerId: "w1" } } }]);
});

await test("Religa-se sozinho depois de a ligação cair", async () => {
  const { connect, state } = fakeBroker(0);
  const rabbit = startRabbit({ url: "amqp://x", queue: "q", retryMs: 10, connect });
  await waitFor(() => rabbit.isConnected());
  state.connection.emit("close");
  assert.equal(rabbit.isConnected(), false);
  await waitFor(() => rabbit.isConnected());
  assert.equal(state.attempts, 2);
});

console.log(`\n${passed} passados, ${failed} falhados, ${passed + failed} no total.`);
process.exit(failed ? 1 : 0);
