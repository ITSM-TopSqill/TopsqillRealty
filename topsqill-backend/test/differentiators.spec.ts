import { describe, it, expect } from "vitest";
import {
  DIFFERENTIATORS, differentiatorById, validateCondition, validateSegmentDefinition,
  matchesSegment, filterLeads, InvalidConditionError, type LeadFacts, type Condition, type ConditionGroup, type SegmentDefinition,
} from "../src/customer-intelligence/differentiators";

const leadA: LeadFacts = { id: "a", name: "Asha", stage: "new", qualified: true, score: 85, source: "google", campaignSourced: true, budgetMax: 9_000_000, locality: "Sector 65", city: "Gurgaon", daysSinceActivity: 1, daysSinceCreated: 2 };
const leadB: LeadFacts = { id: "b", name: "Bimal", stage: "booked", qualified: false, score: 40, source: "manual", campaignSourced: false, budgetMax: 2_000_000, locality: "Sector 45", city: "Gurgaon", daysSinceActivity: 40, daysSinceCreated: 60 };
const leadC: LeadFacts = { id: "c", name: "Chetan", stage: "contacted", qualified: true, score: 72, source: "meta", campaignSourced: true, budgetMax: null, locality: null, city: "Noida", daysSinceActivity: 10, daysSinceCreated: 10 };

describe("differentiator catalog", () => {
  it("has no duplicate ids and every entry has at least one operator", () => {
    const ids = DIFFERENTIATORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DIFFERENTIATORS) expect(d.operators.length).toBeGreaterThan(0);
  });

  it("never marks a differentiator as directly targetable, since no Custom Audience push exists", () => {
    for (const d of DIFFERENTIATORS) {
      expect(d.directlyTargetable).toBe(false);
      expect(d.analyticsOnly).toBe(true);
    }
  });

  it("never includes a sensitive/financial-inference field (net worth, bank, health) in the catalog", () => {
    const names = DIFFERENTIATORS.map((d) => `${d.id} ${d.name} ${d.description}`.toLowerCase());
    for (const n of names) {
      expect(n).not.toMatch(/net worth|bank account|credit card|health condition|wealth/);
    }
  });

  it("differentiatorById returns null for an unknown id", () => {
    expect(differentiatorById("nope")).toBeNull();
    expect(differentiatorById("lead_score")?.valueType).toBe("number");
  });
});

describe("validateCondition", () => {
  it("rejects an unknown differentiator id", () => {
    expect(() => validateCondition({ kind: "condition", differentiatorId: "net_worth", operator: "gte", value: 1 })).toThrow(InvalidConditionError);
  });

  it("rejects an operator the differentiator doesn't support", () => {
    expect(() => validateCondition({ kind: "condition", differentiatorId: "lead_stage", operator: "gte", value: "new" })).toThrow(InvalidConditionError);
  });

  it("rejects an enum value that isn't a real stage", () => {
    expect(() => validateCondition({ kind: "condition", differentiatorId: "lead_stage", operator: "eq", value: "made_up_stage" })).toThrow(InvalidConditionError);
  });

  it("accepts a well-formed condition", () => {
    expect(() => validateCondition({ kind: "condition", differentiatorId: "lead_score", operator: "gte", value: 70 })).not.toThrow();
  });
});

describe("matchesSegment (AND/OR/NOT)", () => {
  it("matches a flat AND group only when every condition is true", () => {
    const def: SegmentDefinition = {
      include: { kind: "group", match: "all", conditions: [
        { kind: "condition", differentiatorId: "lead_qualified", operator: "eq", value: true },
        { kind: "condition", differentiatorId: "lead_score", operator: "gte", value: 80 },
      ] },
    };
    expect(matchesSegment(leadA, def)).toBe(true);   // qualified, score 85
    expect(matchesSegment(leadC, def)).toBe(false);  // qualified but score only 72
  });

  it("matches an OR group when any condition is true", () => {
    const def: SegmentDefinition = {
      include: { kind: "group", match: "any", conditions: [
        { kind: "condition", differentiatorId: "lead_source", operator: "eq", value: "google" },
        { kind: "condition", differentiatorId: "lead_source", operator: "eq", value: "meta" },
      ] },
    };
    expect(matchesSegment(leadA, def)).toBe(true);
    expect(matchesSegment(leadC, def)).toBe(true);
    expect(matchesSegment(leadB, def)).toBe(false);
  });

  it("applies NOT via the negate flag on a single condition", () => {
    const def: SegmentDefinition = {
      include: { kind: "group", match: "all", conditions: [
        { kind: "condition", differentiatorId: "lead_stage", operator: "eq", value: "booked", negate: true },
      ] },
    };
    expect(matchesSegment(leadA, def)).toBe(true);
    expect(matchesSegment(leadB, def)).toBe(false);
  });

  it("excludes leads matching the exclude group even when they match include", () => {
    const def: SegmentDefinition = {
      include: { kind: "group", match: "all", conditions: [{ kind: "condition", differentiatorId: "lead_qualified", operator: "eq", value: true }] },
      exclude: { kind: "group", match: "any", conditions: [{ kind: "condition", differentiatorId: "lead_stage", operator: "in", value: ["booked", "lost"] }] },
    };
    expect(matchesSegment(leadA, def)).toBe(true);
    expect(matchesSegment(leadC, def)).toBe(true);
    const bookedQualified: LeadFacts = { ...leadA, stage: "booked" };
    expect(matchesSegment(bookedQualified, def)).toBe(false);
  });

  it("supports nested condition groups, not just one flat level", () => {
    const inner: ConditionGroup = { kind: "group", match: "any", conditions: [
      { kind: "condition", differentiatorId: "city", operator: "eq", value: "Gurgaon" },
      { kind: "condition", differentiatorId: "city", operator: "eq", value: "Noida" },
    ] };
    const def: SegmentDefinition = { include: { kind: "group", match: "all", conditions: [
      { kind: "condition", differentiatorId: "lead_qualified", operator: "eq", value: true },
      inner,
    ] } };
    expect(matchesSegment(leadA, def)).toBe(true);   // qualified + Gurgaon
    expect(matchesSegment(leadC, def)).toBe(true);   // qualified + Noida
    expect(matchesSegment(leadB, def)).toBe(false);  // not qualified
  });

  it("the real estate 'premium buyer' example from the spec: declared high budget AND recent activity, excluding closed leads", () => {
    const def: SegmentDefinition = {
      include: { kind: "group", match: "all", conditions: [
        { kind: "condition", differentiatorId: "budget_max", operator: "gte", value: 5_000_000 },
        { kind: "condition", differentiatorId: "days_since_activity", operator: "lte", value: 7 },
      ] },
      exclude: { kind: "group", match: "any", conditions: [{ kind: "condition", differentiatorId: "lead_stage", operator: "in", value: ["booked", "lost"] }] },
    };
    expect(filterLeads([leadA, leadB, leadC], def).map((l) => l.id)).toEqual(["a"]);
  });
});

describe("validateSegmentDefinition", () => {
  it("walks nested groups and throws on the first invalid condition found anywhere", () => {
    const bad: SegmentDefinition = {
      include: { kind: "group", match: "all", conditions: [
        { kind: "condition", differentiatorId: "lead_qualified", operator: "eq", value: true },
        { kind: "group", match: "any", conditions: [{ kind: "condition", differentiatorId: "nope", operator: "eq", value: 1 } as Condition] },
      ] },
    };
    expect(() => validateSegmentDefinition(bad)).toThrow(InvalidConditionError);
  });
});
