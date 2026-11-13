import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { checkoutSignatureOk, webhookSignatureOk } from "../src/ads/razorpay";
import { normaliseAds } from "../src/ads/settings";
import { metaLaunch } from "../src/ads/meta";
import { googleLaunch } from "../src/ads/google";

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let n = 0;
beforeEach(() => {
  calls = []; n = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : String(init.body)) : null;
    calls.push({ url: u, method: init?.method ?? "GET", body });
    if (u.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    if (u.includes("googleAds:mutate") && body?.mutateOperations?.length > 1) {
      return new Response(JSON.stringify({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: "customers/1/campaignBudgets/9" } }, { campaignResult: { resourceName: "customers/1/campaigns/7" } }] }));
    }
    if (u.includes("fields=access_token")) return new Response(JSON.stringify({ access_token: "page-token" }));
    return new Response(JSON.stringify({ id: `id${++n}`, success: true }));
  });
});

describe("razorpay signatures", () => {
  it("accepts the checkout signature only for the right order and payment", () => {
    const sig = createHmac("sha256", "secret").update("order_1|pay_1").digest("hex");
    expect(checkoutSignatureOk("secret", "order_1", "pay_1", sig)).toBe(true);
    expect(checkoutSignatureOk("secret", "order_1", "pay_2", sig)).toBe(false);
    expect(checkoutSignatureOk("other", "order_1", "pay_1", sig)).toBe(false);
  });
  it("checks the webhook over the exact body", () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const sig = createHmac("sha256", "wh").update(raw).digest("hex");
    expect(webhookSignatureOk("wh", raw, sig)).toBe(true);
    expect(webhookSignatureOk("wh", Buffer.from('{"event":"payment.captured" }'), sig)).toBe(false);
  });
});

describe("ads settings", () => {
  it("tidies ids and keeps numbers in range", () => {
    const s = normaliseAds({ feePct: 90, meta: { adAccountId: "act_12345", pageId: " 678 " } as never, google: { customerId: "123-456-7890" } as never });
    expect(s.meta.adAccountId).toBe("12345");
    expect(s.meta.pageId).toBe("678");
    expect(s.google.customerId).toBe("1234567890");
    expect(s.feePct).toBe(50);
    expect(s.gstPct).toBe(18);
    expect(s.enabled).toBe(false);
  });
});

const metaAd = {
  name: "3 BHK Sector 150", link: "https://topsqill.ai/listings/l1?ad=c1", privacyUrl: "https://topsqill.ai/privacy",
  headline: "3 BHK in Sector 150", primaryText: "Park facing home", description: "Sector 150, Noida",
  pictures: ["https://cdn/x.jpg", "https://cdn/y.jpg"], video: null,
  place: { lat: 28.4, lng: 77.5, city: "Noida", radiusKm: 10 }, dailyBudgetPaise: 200000, endsAt: new Date(Date.now() + 10 * 86400e3), purpose: "sale" as const,
};
const ctx = { token: "t", version: "v25.0", adAccountId: "111", pageId: "222", housing: false };

describe("meta launch", () => {
  it("builds form, campaign, ad set, creative and ad paused, then switches them on", async () => {
    const ids = await metaLaunch(ctx, metaAd);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts[0].url).toContain("/222/leadgen_forms");
    const campaign = posts.find((c) => c.url.endsWith("act_111/campaigns"))!;
    expect(campaign.body.objective).toBe("OUTCOME_LEADS");
    expect(campaign.body.status).toBe("PAUSED");
    expect(campaign.body.special_ad_categories).toEqual([]);
    const adset = posts.find((c) => c.url.endsWith("act_111/adsets"))!;
    expect(adset.body.daily_budget).toBe(200000);
    expect(adset.body.targeting.geo_locations.custom_locations[0]).toMatchObject({ latitude: 28.4, longitude: 77.5, radius: 10 });
    expect(adset.body.targeting.age_min).toBe(25);
    const creative = posts.find((c) => c.url.endsWith("act_111/adcreatives"))!;
    expect(creative.body.object_story_spec.link_data.child_attachments).toHaveLength(2);   // two photos: a carousel
    expect(creative.body.object_story_spec.link_data.call_to_action.value.lead_gen_form_id).toBe(ids.formId);
    // Everything switched on only at the end, ad first.
    const on = posts.filter((c) => c.body?.status === "ACTIVE");
    expect(on.map((c) => c.url.split("/").pop())).toEqual([ids.adId, ids.adsetId, ids.campaignId]);
  });

  it("with the housing category, declares it, drops age targeting and widens the area", async () => {
    await metaLaunch({ ...ctx, housing: true }, { ...metaAd, pictures: ["https://cdn/x.jpg"] });
    const campaign = calls.find((c) => c.url.endsWith("act_111/campaigns"))!;
    expect(campaign.body.special_ad_categories).toEqual(["HOUSING"]);
    const adset = calls.find((c) => c.url.endsWith("act_111/adsets"))!;
    expect(adset.body.targeting.age_min).toBeUndefined();
    expect(adset.body.targeting.geo_locations.custom_locations[0].radius).toBe(25);
    const creative = calls.find((c) => c.url.endsWith("act_111/adcreatives"))!;
    expect(creative.body.object_story_spec.link_data.picture).toBe("https://cdn/x.jpg");   // one photo: single image ad
  });
});

describe("google launch", () => {
  it("creates budget, campaign, area, ad group, keywords and ad in one request, then enables it", async () => {
    const r = await googleLaunch(
      { version: "v24", customerId: "1", developerToken: "d", oauth: { client_id: "a", client_secret: "b", refresh_token: "c" } },
      { name: "Test", finalUrl: "https://topsqill.ai/listings/l1", dailyBudgetPaise: 150000,
        headlines: ["3 BHK in Sector 150", "Ready to Move", "Book a Site Visit", "3 BHK in Sector 150"], descriptions: ["Park facing home.", "Verified listing."],
        keywords: ["3 bhk sector 150", "flat for sale in sector 150", "3 BHK sector 150"], place: { lat: 28.4, lng: 77.5, city: "Noida", radiusKm: 10 } });
    expect(r.campaignId).toBe("customers/1/campaigns/7");
    const mutate = calls.find((c) => c.url.includes("googleAds:mutate") && c.body.mutateOperations.length > 1)!;
    const ops = mutate.body.mutateOperations;
    expect(ops[0].campaignBudgetOperation.create.amountMicros).toBe(String(150000 * 10_000));   // ₹1,500 a day
    expect(ops[1].campaignOperation.create.status).toBe("PAUSED");
    expect(ops[2].campaignCriterionOperation.create.proximity.radius).toBe(10);
    const kws = ops.filter((o: any) => o.adGroupCriterionOperation).map((o: any) => o.adGroupCriterionOperation.create.keyword.text);
    expect(kws).toEqual(["3 bhk sector 150", "flat for sale in sector 150"]);                    // duplicates dropped
    const ad = ops.find((o: any) => o.adGroupAdOperation).adGroupAdOperation.create.ad;
    expect(ad.responsiveSearchAd.headlines).toHaveLength(3);
    const enable = calls.filter((c) => c.url.includes("googleAds:mutate")).pop()!;
    expect(enable.body.mutateOperations[0].campaignOperation.update.status).toBe("ENABLED");
  });
});
