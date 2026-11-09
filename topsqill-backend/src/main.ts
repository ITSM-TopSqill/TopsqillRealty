import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { env, isProd } from "./common/env";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify handles roughly twice the requests per second of Express on the same CPU.
    // Trust only the proxies we know sit in front of us (a number of hops, not
    // `true`), so a client-supplied X-Forwarded-For cannot choose `req.ip`.
    new FastifyAdapter({ trustProxy: env.TRUST_PROXY_HOPS || false, bodyLimit: 2 * 1024 * 1024, disableRequestLogging: true }),
    // Keeps the exact request bytes on `req.rawBody`: Meta signs webhooks over
    // the raw body, which re-serialising the parsed JSON does not reproduce.
    { bufferLogs: true, rawBody: true },
  );

  await app.register(import("@fastify/helmet"), { contentSecurityPolicy: false });
  await app.register(import("@fastify/compress"), { encodings: ["br", "gzip"], threshold: 1024 });

  app.enableCors({
    origin: isProd() ? [/\.topsqill\.ai$/] : true,
    credentials: true,
    maxAge: 86400,
  });

  app.useGlobalPipes(new ValidationPipe({
    transform: true, whitelist: true, forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: false },
  }));

  if (!isProd()) {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle("Topsqill.ai API").setVersion("1.0")
      .addBearerAuth().build());
    SwaggerModule.setup("docs", app, doc);
  }

  // Cloud Run sends SIGTERM before stopping a container: finish in-flight work first.
  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  new Logger("bootstrap").log(`Topsqill.ai API listening on ${env.PORT} (${env.NODE_ENV})`);
}
bootstrap();
