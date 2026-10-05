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

  app.enableCors({
    origin: config.get<string>('corsOrigin')?.split(',') ?? true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // global guard / interceptor / filter / pipe are registered in AppModule

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Codex API')
    .setDescription(
      [
        'REST API for the Codex multi-branch inventory & POS system.',
        '',
        '### Authenticating',
        '1. `POST /api/auth/login` with your email and password.',
        '2. Copy `data.token` from the response.',
        '3. Click **Authorize** (top right) and paste the token.',
        'The token is remembered across page reloads.',
        '',
        '### Response shape',
        'Every success is wrapped: `{ success, message, data }`.',
        'Errors return `{ success: false, statusCode, message, errors? }`,',
        'where `errors` maps a field to its validation messages.',
        '',
        '### Office scoping',
        'Products, locations, sales, customers, racks and roles belong to one',
        'office. List endpoints take `office_id`, and records cannot move',
        'between offices after they are created.',
        '',
        '### Deletes',
        'Deletes are soft: the row is kept and hidden from every read.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Paste the token from POST /api/auth/login',
    })
    .addServer('http://localhost:3000', 'Local')
    .addTag('auth', 'Login, logout, password reset, change password')
    .addTag('dashboard', 'KPIs, sales trend, top products, low stock')
    .addTag('sales', 'Point of sale: bills, refunds, stock movement, receipts')
    .addTag('products', 'Catalogue and stock levels')
    .addTag('locations', 'Racks and their generated row/column/bin slots')
    .addTag('customers', 'Customer book and borrow repayments')
    .addTag('staff', 'Staff accounts')
    .addTag('offices', 'Branches, head office and online payment methods')
    .addTag('roles', 'Office-scoped roles')
    .addTag('access', 'Per-role permission matrix')
    .addTag('profile', 'The signed-in user')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Codex API Docs',
    swaggerOptions: {
      // keeps the bearer token after a refresh — the usual papercut
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // everything lives under /api, so the bare root just points at the docs
  app
    .getHttpAdapter()
    .get('/', (_req: unknown, res: { redirect: (url: string) => void }) =>
      res.redirect('/api/docs'),
    );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
}
void bootstrap();
