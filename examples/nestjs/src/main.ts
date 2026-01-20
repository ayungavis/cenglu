import { NestFactory } from '@nestjs/core';
import { createLogger, NestLoggerService } from 'cenglu';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createLogger({
    service: 'nestjs-example',
    level: 'debug',
    pretty: { enabled: true },
  });

  const app = await NestFactory.create(AppModule, {
    logger: new NestLoggerService(logger),
  });

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.info('Application started', { port });
}

void bootstrap();
