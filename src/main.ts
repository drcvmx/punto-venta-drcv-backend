import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend integration
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3004',
      'http://abarrotes.local:3000',
      'http://ferreteria.local:3000',
      'http://restaurante.local:3000',
      'http://miselania.local:3000',
      'http://api-industria.local:3000',
      'https://drcv.online',
      /\.drcv\.online$/,
      'https://punto.de.venta.drcv.site',
      'https://api.drcv.site',
      /\.store\.drcv\.site$/,
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization, x-tenant-id',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
