import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { env, isProd } from "./common/env";
import { isLocalStorage } from "./media/storage";

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

  // A POST with no body (Like, Connect, Accept) is fine even if the client
  // labels it as JSON: Fastify would otherwise reject it with "Body cannot be
  // empty", which is how those buttons silently failed.
  app.getHttpAdapter().getInstance().addHook("onRequest", async (req: { headers: Record<string, string | string[] | undefined> }) => {
    const h = req.headers;
    const noBody = !h["transfer-encoding"] && (h["content-length"] === undefined || h["content-length"] === "0");
    if (noBody && h["content-type"]) delete h["content-type"];
  });

  // Local development keeps files on disk, so the browser uploads straight to
  // the API: accept raw file bodies on that one route. On Google Cloud files go
  // to Cloud Storage and the API never receives them.
  if (isLocalStorage) {
    app.getHttpAdapter().getInstance().addContentTypeParser(
      /^(image|video|model)\/|^application\/(pdf|octet-stream)/,
      { parseAs: "buffer", bodyLimit: 500 * 1024 * 1024 },
      (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body),
    );
  }
  await app.register(import("@fastify/compress"), { encodings: ["br", "gzip"], threshold: 1024 });

  app.enableCors({
    origin: isProd() ? [/\.topsqill\.ai$/] : true,
    credentials: true,
    // The default list stops at POST, which blocked uploads (PUT) and edits (PATCH).
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
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
