import amqp, { Channel } from 'amqplib';

// Contrato mínimo da ligação usado aqui; permite injetar uma ligação simulada nos testes.
type Connection = {
  createChannel(): Promise<Channel>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
};
type Connect = (url: string) => Promise<Connection>;

export interface RabbitOptions {
  url: string;
  queue: string;
  retryMs?: number;
  connect?: Connect;
}

/**
 * Liga ao RabbitMQ sem bloquear o arranque da API. Se o broker ainda não estiver
 * pronto (situação normal no arranque com Docker Compose), repete a ligação a
 * cada `retryMs`; se a ligação cair mais tarde, volta a ligar-se sozinha.
 * Enquanto não houver ligação, publish() devolve false e não lança erro: a
 * notificação já foi gravada na base de dados, só o evento é que não é publicado.
 */
export function startRabbit({ url, queue, retryMs = 5000, connect = amqp.connect as unknown as Connect }: RabbitOptions) {
  let channel: Channel | null = null;
  let attempt = 0;

  async function open(): Promise<void> {
    attempt += 1;
    let connection: Connection | undefined;
    try {
      connection = await connect(url);
      const opened = await connection.createChannel();
      await opened.assertQueue(queue, { durable: true });
      channel = opened;
      attempt = 0;
      connection.on('error', (error: unknown) => console.warn('Erro na ligação RabbitMQ.', error));
      connection.on('close', () => {
        channel = null;
        console.warn(`Ligação RabbitMQ fechada; nova tentativa em ${retryMs / 1000}s.`);
        setTimeout(open, retryMs);
      });
      console.log('RabbitMQ ligado.');
    } catch (error) {
      channel = null;
      try { await connection?.close(); } catch { /* ligação já inutilizável */ }
      console.warn(`RabbitMQ indisponível (tentativa ${attempt}); nova tentativa em ${retryMs / 1000}s.`);
      setTimeout(open, retryMs);
    }
  }

  void open();

  return {
    isConnected: () => channel !== null,
    publish(message: unknown): boolean {
      if (!channel) return false;
      return channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
    },
  };
}
