import {
  Injectable, Inject, BadRequestException, ConflictException, NotFoundException, ForbiddenException,
  HttpException, HttpStatus, Logger, ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DB, type Database } from "../db/db.module";
import { REDIS } from "../redis/redis.module";
import { users, refreshTokens } from "../db/schema";
import { env, isProd } from "../common/env";
import { newId } from "../common/ids";
import { isUniqueViolation } from "../common/db-errors";
import { normalisePhone, makeOtp } from "./phone";
import { normaliseEmail, renderCodeEmail } from "./email";
import { MailerService } from "./mailer.service";

/** 429: too many attempts. */
class TooManyRequests extends HttpException { constructor(msg: string) { super(msg, HttpStatus.TOO_MANY_REQUESTS); } }

export type Channel = "phone" | "email";
/**
 * - signin: the account must already exist.
 * - signup: the account must not exist yet; it is created once the code is verified.
 * - auto:   the original mobile flow (sign in, or create a blank account). Kept so
 *           older app builds that call /otp/request and /otp/verify keep working.
 */
export type Intent = "signin" | "signup" | "auto";
export type SignupProfile = { name: string; type: "buyer" | "seller" | "dealer" | "builder"; city?: string };

const OTP_TTL = 300;         // the code is valid for 5 minutes
const OTP_MAX_TRIES = 5;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const NO_ACCOUNT = { phone: "We couldn’t find an account with this mobile number.", email: "We couldn’t find an account with this email." };
const HAS_ACCOUNT = { phone: "An account with this mobile number already exists. Sign in instead.", email: "An account with this email already exists. Sign in instead." };
const INVALID = { phone: "Enter a valid mobile number.", email: "Enter a valid email address." };

@Injectable()
export class AuthService {
  private readonly log = new Logger("auth");
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
  ) {}

  /** Which ways of signing in actually deliver a code, so the app only offers those. */
  methods() {
    const phone = !isProd() || this.whatsappConfigured();
    const email = !isProd() || this.mailer.configured;
    return { phone, email };
  }

  /** Step 1: send a code. It is stored (hashed) in Redis, never in the database. */
  async requestCode(input: { channel: Channel; identifier: string; intent: Intent; ip: string }) {
    const { channel, intent } = input;
    if (intent === "auto" && channel !== "phone") throw new BadRequestException("Choose sign in or sign up.");
    if (!this.methods()[channel]) {
      throw new ServiceUnavailableException(channel === "email"
        ? "Email sign-in isn’t available right now. Please use your mobile number."
        : "Mobile sign-in isn’t available right now. Please use your email.");
    }
    const id = this.normalise(channel, input.identifier);

    // Rate limits: 5 codes per address or number per hour, 20 per IP per hour.
    for (const [key, limit] of [[`otp:rl:${channel === "email" ? "e" : "p"}:${id}`, 5], [`otp:rl:i:${input.ip}`, 20]] as const) {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 3600);
      if (n > limit) throw new TooManyRequests("Too many attempts. Please try again in an hour.");
    }

    // Tell the member straight away if they are on the wrong screen, rather
    // than after they have waited for and typed in a code.
    const existing = await this.findAccount(channel, id);
    if (intent === "signin" && !existing) throw new NotFoundException(NO_ACCOUNT[channel]);
    if (intent === "signup" && existing) throw new ConflictException(HAS_ACCOUNT[channel]);

    const code = makeOtp();
    const key = this.codeKey(channel, id);
    // A new code starts a fresh allowance of wrong guesses.
    await this.redis.multi().set(key, sha(code), "EX", OTP_TTL).del(`otp:tries:${key}`).exec();

    try {
      await this.deliver(channel, id, code, intent === "signup" ? "signup" : "signin", existing?.name);
    } catch (e) {
      await this.redis.del(key).catch(() => {});
      this.log.error(`${channel} code delivery failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException("We couldn’t send the code. Please try again in a minute.");
    }
    // Outside production the code is returned so the team can test without email or SMS.
    return { sent: true, channel, expiresIn: OTP_TTL, devCode: isProd() ? undefined : code };
  }

  /** Step 2: check the code, then sign in or create the account, and return tokens. */
  async verifyCode(input: { channel: Channel; identifier: string; code: string; intent: Intent; profile?: SignupProfile; device?: string }) {
    const { channel, intent } = input;
    const id = this.normalise(channel, input.identifier);
    if (intent === "signup") this.checkProfile(input.profile);

    await this.consumeCode(this.codeKey(channel, id), input.code);

    let user = await this.findAccount(channel, id);
    let isNew = false;
    if (intent === "signin" && !user) throw new NotFoundException(NO_ACCOUNT[channel]);
    if (intent === "signup" && user) throw new ConflictException(HAS_ACCOUNT[channel]);

    if (!user) {
      isNew = true;
      const p = intent === "signup" ? input.profile! : undefined;
      try {
        [user] = await this.db.insert(users).values({
          id: newId(),
          phone: channel === "phone" ? id : null,
          email: channel === "email" ? id : null,
          emailVerified: channel === "email",
          name: p?.name.trim() || "New member",
          type: p?.type ?? "buyer",
          city: p?.city?.trim() || null,
          status: "active",
        }).returning();
      } catch (e) {
        // Two sign-ups for the same address at once: only one account is created.
        if (isUniqueViolation(e)) throw new ConflictException(HAS_ACCOUNT[channel]);
        throw e;
      }
    }
    if (user.status === "suspended" || user.status === "removed") throw new ForbiddenException("This account is not active. Please contact support.");

    const tokens = await this.issueTokens(user.id, user.type, user.isAdmin, input.device);
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

  /* ------------------------------------------------------------------------ */

  private normalise(channel: Channel, raw: string): string {
    const id = channel === "email" ? normaliseEmail(raw) : normalisePhone(raw);
    if (!id) throw new BadRequestException(INVALID[channel]);
    return id;
  }

  /** Phone codes keep their original key, so codes sent just before a deploy still work. */
  private codeKey(channel: Channel, id: string) { return channel === "email" ? `otp:e:${id}` : `otp:${id}`; }

  /** Only a verified email identifies an account; a typed-in one never does. */
  private async findAccount(channel: Channel, id: string) {
    const where = channel === "email"
      ? and(sql`lower(${users.email}) = ${id}`, eq(users.emailVerified, true))
      : eq(users.phone, id);
    const [u] = await this.db.select().from(users).where(where).limit(1);
    return u ?? null;
  }

  private checkProfile(p?: SignupProfile) {
    if (!p?.name || p.name.trim().length < 2) throw new BadRequestException("Enter your full name.");
    if (!["buyer", "seller", "dealer", "builder"].includes(p.type)) throw new BadRequestException("Choose what describes you best.");
  }

  /**
   * Checks a code and uses it up. Every attempt is counted with an atomic INCR
   * *before* the comparison, so parallel guesses cannot slip in under the limit,
   * and only the request that actually deletes the code may continue.
   */
  private async consumeCode(key: string, code: string) {
    const triesKey = `otp:tries:${key}`;
    const hash = await this.redis.get(key);
    if (!hash) throw new BadRequestException("That code has expired. Please request a new one.");
    const tries = await this.redis.incr(triesKey);
    if (tries === 1) await this.redis.expire(triesKey, OTP_TTL);
    if (tries > OTP_MAX_TRIES) {
      await this.redis.del(key, triesKey);
      throw new TooManyRequests("Too many wrong codes. Please request a new one.");
    }
    if (sha(String(code).trim()) !== hash) throw new BadRequestException("That code isn’t right. Please check and try again.");
    const consumed = await this.redis.del(key);
    await this.redis.del(triesKey);
    if (!consumed) throw new BadRequestException("That code has already been used. Please request a new one.");
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

  private whatsappConfigured() {
    return env.OTP_PROVIDER === "whatsapp" && !!env.WHATSAPP_TOKEN && !!env.WHATSAPP_PHONE_NUMBER_ID;
  }

  /**
   * Email goes out over SMTP and mobile codes over WhatsApp, when configured.
   * Otherwise (development only: `methods()` refuses in production) the code
   * is written to the log.
   */
  private async deliver(channel: Channel, id: string, code: string, intent: "signin" | "signup", name?: string) {
    if (channel === "email") {
      if (!this.mailer.configured) { this.log.log(`Email code for ${id} is ${code}`); return; }
      await this.mailer.send(id, renderCodeEmail({ code, intent, minutes: OTP_TTL / 60, name: name && name !== "New member" ? name : undefined }));
      return;
    }
    if (!this.whatsappConfigured()) { this.log.log(`OTP for ${id} is ${code}`); return; }
    const res = await fetch(`https://graph.facebook.com/v23.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: id.replace("+", ""), type: "template",
        template: { name: "login_code", language: { code: "en" }, components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ] },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
