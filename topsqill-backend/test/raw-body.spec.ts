/**
 * Meta signs webhooks over the exact bytes it sends. This boots the same
 * Fastify setup the API uses and checks those bytes reach the handler intact.
 */
import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { Controller, Module, Post, Req, type RawBodyRequest } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

@Controller()
class EchoController {
  @Post("echo")
  echo(@Req() req: RawBodyRequest<{ body: unknown }>) {
    return { raw: req.rawBody?.toString("utf8") ?? null, parsed: req.body };
  }
}
@Module({ controllers: [EchoController] })
class EchoModule {}

describe("raw request body", () => {
  it("is preserved byte for byte alongside the parsed JSON", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(EchoModule, new FastifyAdapter(), { rawBody: true, logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    // Spacing and key order a re-serialised copy would not reproduce.
    const payload = '{ "b": 1,   "a": "x" }';
    const res = await app.getHttpAdapter().getInstance().inject({
      method: "POST", url: "/echo", payload, headers: { "content-type": "application/json" },
    });
    const body = res.json() as { raw: string; parsed: unknown };
    expect(body.raw).toBe(payload);
    expect(body.parsed).toEqual({ b: 1, a: "x" });
    await app.close();
  });
});
