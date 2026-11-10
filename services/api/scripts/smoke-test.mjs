const baseUrl = process.env.SHIFTFLOW_URL || 'http://localhost';
const response = await fetch(`${baseUrl}/api/health`);
if (!response.ok) throw new Error(`Health check falhou: HTTP ${response.status}`);
const body = await response.json();
if (body.status !== 'ok') throw new Error('Health check não devolveu status ok.');
console.log(`Smoke test concluído com sucesso em ${baseUrl}.`);
