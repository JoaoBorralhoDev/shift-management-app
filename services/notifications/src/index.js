const amqp = require('amqplib');
const mongoose = require('mongoose');

const Delivery = mongoose.model('NotificationDelivery', new mongoose.Schema({
  eventType: String,
  notificationId: String,
  workerId: String,
  message: String,
  deliveredAt: { type: Date, default: Date.now }
}, { timestamps: true }));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Repete a operação até ter sucesso: no arranque com Docker Compose o MongoDB e o
// RabbitMQ demoram alguns segundos a aceitar ligações, e este serviço não deve
// terminar por chegar cedo demais.
async function retry(label, operation, delayMs = 5000) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      console.warn(`${label} indisponível (tentativa ${attempt}); nova tentativa em ${delayMs / 1000}s.`);
      await wait(delayMs);
    }
  }
}

async function consume() {
  const connection = await retry('RabbitMQ', () => amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672'));
  connection.on('error', error => console.warn('Erro na ligação RabbitMQ.', error));
  connection.on('close', () => {
    console.warn('Ligação RabbitMQ fechada; a religar.');
    setTimeout(() => consume().catch(error => { console.error(error); process.exit(1); }), 5000);
  });
  const channel = await connection.createChannel();
  await channel.assertQueue('shiftflow.events', { durable: true });
  await channel.consume('shiftflow.events', async message => {
    if (!message) return;
    try {
      const event = JSON.parse(message.content.toString());
      await Delivery.create({ eventType: event.type, ...event.payload });
      console.log(`Notificação entregue: ${event.type}`);
      channel.ack(message);
    } catch (error) { console.error('Evento inválido.', error); channel.nack(message, false, false); }
  });
}

async function start() {
  await retry('MongoDB', () => mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/shiftflow'));
  await consume();
  console.log('Notifications service pronto.');
}
start().catch(error => { console.error(error); process.exit(1); });
