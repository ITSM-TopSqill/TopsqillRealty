import { Injectable, Inject, BadRequestException, HttpException, HttpStatus, Logger } from "@nestjs/common";

/** 429: too many attempts. */
class TooManyRequests extends HttpException { constructor(msg: string) { super(msg, HttpStatus.TOO_MANY_REQUESTS); } }
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../db/db.module";
import { REDIS } from "../redis/redis.module";
import { users, refreshTokens } from "../db/schema";
import { env } from "../common/env";
import { newId } from "../common/ids";
import { normalisePhone, makeOtp } from "./phone";

const OTP_TTL = 300;         // the code is valid for 5 minutes
const OTP_MAX_TRIES = 5;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

@Injectable()
export class AuthService {
  private readonly log = new Logger("auth");
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwt: JwtService,
  ) {}

  /** Step 1: send the code. Stored in Redis, never in the database. */
  async requestOtp(rawPhone: string, ip: string) {
    const phone = normalisePhone(rawPhone);
    if (!phone) throw new BadRequestException("Enter a valid mobile number.");

    // Rate limits: 5 codes per number per hour, 20 per IP per hour.
    for (const [key, limit] of [[`otp:rl:p:${phone}`, 5], [`otp:rl:i:${ip}`, 20]] as const) {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 3600);
      if (n > limit) throw new TooManyRequests("Too many attempts. Please try again in an hour.");
    }

    const code = makeOtp();
    await this.redis.set(`otp:${phone}`, JSON.stringify({ hash: sha(code), tries: 0 }), "EX", OTP_TTL);
    await this.send(phone, code);
    // In development the code is returned so the team can test without SMS.
    return { sent: true, expiresIn: OTP_TTL, devCode: env.NODE_ENV === "production" ? undefined : code };
  }

  /** Step 2: check the code, create the account if new, and return tokens. */
  async verifyOtp(rawPhone: string, code: string, device?: string) {
    const phone = normalisePhone(rawPhone);
    if (!phone) throw new BadRequestException("Enter a valid mobile number.");
    const key = `otp:${phone}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new BadRequestException("That code has expired. Please request a new one.");
    const state = JSON.parse(raw) as { hash: string; tries: number };
    if (state.tries >= OTP_MAX_TRIES) { await this.redis.del(key); throw new TooManyRequests("Too many wrong codes. Please request a new one."); }
    if (sha(String(code)) !== state.hash) {
      state.tries += 1;
      await this.redis.set(key, JSON.stringify(state), "KEEPTTL");
      throw new BadRequestException("That code isn’t right. Please check and try again.");
    }
    await this.redis.del(key);

    let [user] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    let isNew = false;
    if (!user) {
      isNew = true;
      const id = newId();
      [user] = await this.db.insert(users).values({ id, phone, name: "New member", status: "active" }).returning();
    }
    if (user.status === "suspended" || user.status === "removed") throw new BadRequestException("This account is not active. Please contact support.");

    const tokens = await this.issueTokens(user.id, user.type, user.isAdmin, device);
    return { ...tokens, isNew, user: { id: user.id, name: user.name, type: user.type, city: user.city } };
  }

  /** Refresh tokens are single-use: using one issues a new pair and retires the old. */
  async refresh(token: string, device?: string) {
    const hash = sha(token);
    const [row] = await this.db.select().from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .limit(1);
    if (!row) throw new BadRequestException("Please sign in again.");
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status !== "active") throw new BadRequestException("Please sign in again.");
    return this.issueTokens(user.id, user.type, user.isAdmin, device);
  }

  async logout(token: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha(token)));
    return { ok: true };
  }

  private async issueTokens(userId: string, type: string, isAdmin: boolean, device?: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: type, adm: isAdmin }, { expiresIn: env.JWT_ACCESS_TTL });
    const refreshToken = randomBytes(32).toString("base64url");
    await this.db.insert(refreshTokens).values({
      id: newId(), userId, tokenHash: sha(refreshToken), device: device?.slice(0, 160),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
    });
    return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL };
  }

  /** Sends the code over WhatsApp when configured; logs it otherwise. */
  private async send(phone: string, code: string) {
    if (env.OTP_PROVIDER === "whatsapp" && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
      try {
        await fetch(`https://graph.facebook.com/v23.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp", to: phone.replace("+", ""), type: "template",
            template: { name: "login_code", language: { code: "en" }, components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ] },
          }),
        });
        return;
      } catch (e) { this.log.error("OTP send failed: " + (e as Error).message); }
    }
    this.log.log(`OTP for ${phone} is ${code}`);
  }
}
