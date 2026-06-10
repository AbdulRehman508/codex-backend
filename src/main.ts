import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // larger JSON limit so base64 logos fit
  app.useBodyParser('json', { limit: '5mb' });
  app.setGlobalPrefix('api');

  // global guard / interceptor / filter / pipe are registered in AppModule

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Codex API')
    .setDescription('Office resource REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
}
void bootstrap();
