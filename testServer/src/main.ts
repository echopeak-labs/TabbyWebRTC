import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { detectLanIp } from './config/lan-ip';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });
  app.useWebSocketAdapter(new WsAdapter(app));

  const host = process.env.HOST ?? '0.0.0.0';
  const port = Number(process.env.PORT ?? 3001);
  const lanIp = detectLanIp(process.env.LAN_IP);

  await app.listen(port, host);

  console.log('TabbyRDP test server listening on:');
  console.log(`  REST/WS  http://${lanIp}:${port}  ws://${lanIp}:${port}`);
  console.log(`  (also http://127.0.0.1:${port} for localhost)`);
}

void bootstrap();
