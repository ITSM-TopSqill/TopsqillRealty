import { Injectable, Inject, NotFoundException, ForbiddenException, ConflictException } from "@nestjs/common";
import { and, desc, eq, lt, or, sql, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { jobs, jobApplications, users } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

/**
 * Drizzle wraps database errors, so the Postgres code sits on `cause`.
 * 23505 is a unique-constraint violation: the row already exists.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const err = cur as { code?: string; message?: string; cause?: unknown };
    if (err.code === "23505" || /duplicate key value/i.test(err.message ?? "")) return true;
    cur = err.cause;
  }
  return false;
}

export const JOB_CATEGORIES = ["Sales", "Pre-sales", "Channel partners", "Marketing", "Leasing", "Site and engineering", "Operations"] as const;

@Injectable()
export class JobsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  /** Turns one line ("need 2 sales managers, 4+ years, 8 to 12 LPA") into a full job post. */
  async draft(userId: string, request: string, company: string, city: string) {
    const s = request.toLowerCase();
    const fallback = () => {
      const exp = Number(s.match(/(\d+)\s*\+?\s*(?:years|yrs)/)?.[1] ?? 1);
      const sal = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lac)/);
      const title = /sales manager/.test(s) ? "Sales Manager" : /relationship/.test(s) ? "Relationship Manager"
        : /telecall/.test(s) ? "Telecaller" : /pre-?sales/.test(s) ? "Pre-sales Executive"
        : /channel/.test(s) ? "Channel Partner Manager" : /market/.test(s) ? "Digital Marketing Executive"
        : /leasing/.test(s) ? "Leasing Manager" : /engineer/.test(s) ? "Site Engineer" : "Sales Executive";
      const category = /market/.test(s) ? "Marketing" : /pre-?sales|telecall/.test(s) ? "Pre-sales"
        : /channel/.test(s) ? "Channel partners" : /leasing/.test(s) ? "Leasing" : /engineer|site/.test(s) ? "Site and engineering" : "Sales";
      return {
        title, category, employment: /intern/.test(s) ? "Internship" : "Full-time",
        workMode: category === "Sales" || category === "Leasing" ? "Field" : "On-site",
        openings: Number(s.match(/(?:need|hiring)\s+(\d+)/)?.[1] ?? 1),
        expMin: exp, expMax: exp + 4,
        salaryMin: sal ? Number(sal[1]) : 3, salaryMax: sal ? Number(sal[2]) : 7,
        incentives: /incentive|commission/.test(s) || category === "Sales",
        skills: ["Site visits", "Negotiation", "Client handling", "CRM", "Follow-ups"],
        summary: `${company} is hiring a ${title} in ${city}. Join a growing team with live inventory, a steady flow of qualified leads and clear growth for people who deliver.`,
        responsibilities: ["Own the funnel from enquiry to booking", "Run site visits and close deals", "Follow up with every lead the same day", "Keep the CRM updated"],
        requirements: [`${exp}+ years in real estate or a similar role`, "Confident in Hindi and English", "Comfortable with targets", "Own vehicle preferred for site visits"],
      };
    };
    const prompt = `Write a job post for an Indian real estate company. Return ONLY JSON {"title","category" one of ${JOB_CATEGORIES.join("|")},"employment","workMode" one of On-site|Field|Hybrid,"openings" number,"expMin" number,"expMax" number,"salaryMin" number in lakhs,"salaryMax" number in lakhs,"incentives" boolean,"skills":[5],"summary":"40-60 words","responsibilities":[4],"requirements":[4]}.
Use realistic Indian salary ranges. Company: ${company}. City: ${city}. Request: """${request}"""`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "jobs.draft", maxTokens: 1000 });
    return { ...fallback(), ...data, source };
  }

  async create(userId: string, input: Partial<typeof jobs.$inferInsert> & { company?: string }) {
    const [me] = await this.read.select({ name: users.name, agency: users.agency }).from(users).where(eq(users.id, userId)).limit(1);
    const id = newId();
    const [row] = await this.db.insert(jobs).values({
      ...input, id, ownerId: userId,
      company: input.company ?? me?.agency ?? me?.name ?? "Topsqill.ai member",
      salaryMin: input.salaryMin != null ? String(input.salaryMin) : null,
      salaryMax: input.salaryMax != null ? String(input.salaryMax) : null,
    } as typeof jobs.$inferInsert).returning();
    return row;
  }

  async list(q: { city?: string; category?: string; search?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
    const cur = decodeCursor(q.cursor);
    const where = [eq(jobs.status, "open")];
    if (q.city) where.push(eq(jobs.city, q.city));
    if (q.category) where.push(eq(jobs.category, q.category));
    if (q.search) where.push(sql`to_tsvector('simple', ${jobs.title} || ' ' || ${jobs.company} || ' ' || ${jobs.city}) @@ plainto_tsquery('simple', ${q.search})`);
    if (cur) where.push(or(lt(jobs.createdAt, new Date(cur.t)), and(eq(jobs.createdAt, new Date(cur.t)), lt(jobs.id, cur.id))!)!);

    const rows = await this.read.select().from(jobs).where(and(...where))
      .orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null };
  }

  async get(id: string) {
    const [row] = await this.read.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!row) throw new NotFoundException("That job is no longer available.");
    return row;
  }

  /** How well the member fits the role, with reasons they can act on. */
  async fit(userId: string, jobId: string) {
    const [job, [me]] = await Promise.all([
      this.get(jobId),
      this.read.select().from(users).where(eq(users.id, userId)).limit(1),
    ]);
    const strengths: string[] = [];
    const gaps: string[] = [];
    let score = 50;
    if (me?.city && me.city === job.city) { score += 15; strengths.push(`You are based in ${job.city}, where the role is`); }
    else if (me?.city) gaps.push(`The role is in ${job.city}; you are in ${me.city}`);
    const years = me?.yearsExperience ?? 0;
    if (years >= job.expMin && years <= job.expMax + 3) { score += 15; strengths.push(`Your ${years} years fit the ${job.expMin} to ${job.expMax} year range`); }
    else if (years < job.expMin) gaps.push(`They want ${job.expMin}+ years; you have ${years}`);
    else { score += 8; strengths.push(`You bring more experience than asked`); }
    if (me?.type === "dealer" && /Sales|Pre-sales|Leasing|Channel/.test(job.category)) { score += 12; strengths.push("Your dealer background maps directly to this role"); }
    if (me?.reraVerified) { score += 5; strengths.push("Your RERA registration is verified"); }
    score = Math.min(96, score);
    return { score, strengths, gaps, tip: gaps.length ? "Mention how you would cover the gap in your note." : "Apply with a short note about your best deal." };
  }

  async apply(userId: string, jobId: string, input: { note?: string; phone?: string; email?: string; yearsExperience?: number; noticePeriod?: string }) {
    const job = await this.get(jobId);
    if (job.ownerId === userId) throw new ForbiddenException("You can’t apply to your own job post.");
    const { score } = await this.fit(userId, jobId);
    try {
      const [row] = await this.db.insert(jobApplications).values({
        id: newId(), jobId, userId, ...input, matchScore: score,
      }).returning();
      await this.db.update(jobs).set({ applicantCount: sql`${jobs.applicantCount} + 1` }).where(eq(jobs.id, jobId));
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("You have already applied to this job.");
      throw e;
    }
  }

  /** Applicants for the employer, best match first. */
  async applicants(userId: string, jobId: string) {
    const job = await this.get(jobId);
    if (job.ownerId !== userId) throw new ForbiddenException("Only the employer can see applicants.");
    const rows = await this.read.select({
      id: jobApplications.id, status: jobApplications.status, matchScore: jobApplications.matchScore,
      note: jobApplications.note, phone: jobApplications.phone, email: jobApplications.email,
      yearsExperience: jobApplications.yearsExperience, noticePeriod: jobApplications.noticePeriod,
      createdAt: jobApplications.createdAt,
      userId: users.id, name: users.name, headline: users.headline, city: users.city, avatarMediaId: users.avatarMediaId,
    }).from(jobApplications).innerJoin(users, eq(users.id, jobApplications.userId))
      .where(eq(jobApplications.jobId, jobId))
      .orderBy(desc(jobApplications.matchScore), desc(jobApplications.createdAt)).limit(200);
    return { items: rows };
  }

  async myApplications(userId: string) {
    const rows = await this.read.select({
      id: jobApplications.id, status: jobApplications.status, matchScore: jobApplications.matchScore, createdAt: jobApplications.createdAt,
      jobId: jobs.id, title: jobs.title, company: jobs.company, city: jobs.city,
    }).from(jobApplications).innerJoin(jobs, eq(jobs.id, jobApplications.jobId))
      .where(eq(jobApplications.userId, userId)).orderBy(desc(jobApplications.createdAt)).limit(50);
    return { items: rows };
  }

  async setApplicationStatus(userId: string, applicationId: string, status: "viewed" | "shortlisted" | "rejected" | "hired") {
    const [app] = await this.read.select({ jobId: jobApplications.jobId }).from(jobApplications).where(eq(jobApplications.id, applicationId)).limit(1);
    if (!app) throw new NotFoundException("That application could not be found.");
    const job = await this.get(app.jobId);
    if (job.ownerId !== userId) throw new ForbiddenException("Only the employer can update applications.");
    const [row] = await this.db.update(jobApplications).set({ status }).where(eq(jobApplications.id, applicationId)).returning();
    return row;
  }
}
