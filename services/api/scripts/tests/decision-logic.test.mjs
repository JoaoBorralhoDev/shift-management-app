// Testes unitários da lógica de decisão usada por validateShift / resolveRestriction
// (services/api/src/index.ts). Replicam fielmente as fórmulas do código real,
// isoladas da camada de persistência (Mongoose/MongoDB), que não está disponível
// neste ambiente de escrita do relatório — ver 6.1.
import assert from "node:assert/strict";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ---- 1. Sobreposição de turnos (linha 216 de index.ts: start < end && end > start) ----
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

test("Sobreposição: turnos coincidentes são sobrepostos", () => {
  assert.equal(overlaps(new Date("2027-01-10T09:00"), new Date("2027-01-10T17:00"),
                         new Date("2027-01-10T09:00"), new Date("2027-01-10T17:00")), true);
});
test("Sobreposição: turnos que apenas tocam na fronteira NÃO são sobrepostos", () => {
  // Turno A termina às 17:00, turno B começa às 17:00 — limite estrito (<, >), não sobrepõe.
  assert.equal(overlaps(new Date("2027-01-10T09:00"), new Date("2027-01-10T17:00"),
                         new Date("2027-01-10T17:00"), new Date("2027-01-10T20:00")), false);
});
test("Sobreposição: 1 minuto de interseção é sobreposto", () => {
  assert.equal(overlaps(new Date("2027-01-10T09:00"), new Date("2027-01-10T17:00"),
                         new Date("2027-01-10T16:59"), new Date("2027-01-10T20:00")), true);
});

// ---- 2. Descanso mínimo (linha 234: gap = min(...)/36e5) ----
const restGap = (newStart, newEnd, otherStart, otherEnd) =>
  Math.min(Math.abs(newStart - otherEnd), Math.abs(otherStart - newEnd)) / 36e5;

test("Descanso: exatamente 11h de intervalo não viola (gap < limite é falso)", () => {
  const prevEnd = new Date("2027-01-10T17:00");
  const newStart = new Date("2027-01-11T04:00"); // +11h
  const gap = restGap(newStart, new Date("2027-01-11T12:00"), new Date("2027-01-10T09:00"), prevEnd);
  assert.equal(gap, 11);
  assert.equal(gap < 11, false); // não viola um limite de 11h
});
test("Descanso: 10h59 de intervalo viola um limite de 11h", () => {
  const prevEnd = new Date("2027-01-10T17:00");
  const newStart = new Date("2027-01-11T03:59");
  const gap = restGap(newStart, new Date("2027-01-11T12:00"), new Date("2027-01-10T09:00"), prevEnd);
  assert.ok(gap < 11);
});

// ---- 3. resolveRestriction: cadeia específica → global → fallback ----
function resolveRestriction(records, type, workerId, fallback) {
  const specific = records.find(r => r.type === type && r.workerId === workerId);
  if (specific) return specific.value;
  const global = records.find(r => r.type === type && r.workerId === "");
  if (global) return global.value;
  return fallback;
}

test("resolveRestriction: sem registos, devolve o valor por defeito", () => {
  assert.equal(resolveRestriction([], "MIN_REST_HOURS", "worker-1", 11), 11);
});
test("resolveRestriction: só regra global, aplica-se a todos os trabalhadores", () => {
  const records = [{ type: "MIN_REST_HOURS", workerId: "", value: 12 }];
  assert.equal(resolveRestriction(records, "MIN_REST_HOURS", "worker-1", 11), 12);
  assert.equal(resolveRestriction(records, "MIN_REST_HOURS", "worker-2", 11), 12);
});
test("resolveRestriction: regra específica prevalece sobre a global", () => {
  const records = [
    { type: "MIN_REST_HOURS", workerId: "", value: 12 },
    { type: "MIN_REST_HOURS", workerId: "worker-1", value: 14 },
  ];
  assert.equal(resolveRestriction(records, "MIN_REST_HOURS", "worker-1", 11), 14);
  assert.equal(resolveRestriction(records, "MIN_REST_HOURS", "worker-2", 11), 12); // worker-2 cai na global
});
test("resolveRestriction: tipos diferentes resolvem-se de forma independente", () => {
  const records = [{ type: "MIN_REST_HOURS", workerId: "worker-1", value: 14 }];
  assert.equal(resolveRestriction(records, "MAX_WEEKLY_HOURS", "worker-1", 40), 40); // sem regra deste tipo
});

// ---- 4. Compatibilidade de cargo (linha 227: required.filter(id => !cargoIds.includes(id))) ----
const missingCargos = (required, cargoIds) => required.filter(id => !cargoIds.includes(id));

test("Cargo: trabalhador com todos os cargos exigidos é elegível", () => {
  assert.deepEqual(missingCargos(["cargo-A", "cargo-B"], ["cargo-A", "cargo-B", "cargo-C"]), []);
});
test("Cargo: falta de um cargo exigido é detetada", () => {
  assert.deepEqual(missingCargos(["cargo-A", "cargo-B"], ["cargo-A"]), ["cargo-B"]);
});

// ---- 5. Limite de horas no período (linha 247: periodHours + duration > max) ----
const exceedsLimit = (hoursAlready, newDuration, max) => hoursAlready + newDuration > max;

test("Limite de horas: exatamente no limite não excede (>, não >=)", () => {
  assert.equal(exceedsLimit(32, 8, 40), false);
});
test("Limite de horas: 1 minuto acima do limite excede", () => {
  assert.equal(exceedsLimit(32, 8.017, 40), true);
});

console.log(`\n${passed} passados, ${failed} falhados, ${passed + failed} no total.`);
process.exit(failed ? 1 : 0);
