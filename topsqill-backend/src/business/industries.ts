/**
 * Universal industry taxonomy for non-real-estate businesses (Universal
 * Multi-Industry Support, Section 2). Real estate keeps its own dedicated
 * flow in src/campaigns - this file never touches it.
 *
 * Deliberately data, not AI: which objectives/conversion events/dashboard
 * KPIs matter for an industry is a lookup, not something to ask a model and
 * risk fabricating. New industries are added by extending this list; nothing
 * elsewhere needs to change (Section 10/11's "no core rewrite" requirement).
 */

export type Sector =
  | "property" | "ecommerce" | "education" | "healthcare" | "finance" | "automotive"
  | "hospitality" | "technology" | "b2b" | "entertainment" | "home_services" | "other";

export type Industry = {
  id: string;
  label: string;
  sector: Sector;
  /** Campaign objectives that make sense for this industry, in priority order (Section 5). */
  objectives: string[];
  /** Conversion events worth tracking for this industry (Section 6). */
  conversionEvents: string[];
  /** Dashboard KPI labels shown in place of real-estate-specific ones (Section 8). */
  dashboardKpis: string[];
  /** True if this industry carries extra ad-policy restrictions on most platforms (Section 9). */
  sensitive?: boolean;
  complianceNote?: string;
};

const SENSITIVE_NOTE = "This category carries extra restrictions on most ad platforms (special ad category rules, consent requirements, or outright prohibitions). Topsqill does not launch ads for sensitive categories automatically - check each platform's current policy before running anything.";

export const INDUSTRIES: Industry[] = [
  // A. Property & Infrastructure (non-residential-brokerage uses; residential/commercial brokerage uses the dedicated Campaigns flow)
  { id: "construction", label: "Construction", sector: "property", objectives: ["Lead generation", "Website conversions", "Reach"], conversionEvents: ["Project enquiries", "Site visit requests"], dashboardKpis: ["Enquiries", "Site visit requests", "Cost per enquiry"] },
  { id: "architecture_interiors", label: "Architecture & interior design", sector: "property", objectives: ["Lead generation", "Website conversions", "Engagement"], conversionEvents: ["Consultation requests", "Portfolio views"], dashboardKpis: ["Consultation requests", "Cost per consultation"] },
  { id: "building_materials", label: "Building materials", sector: "property", objectives: ["Lead generation", "Traffic", "Reach"], conversionEvents: ["Distributor enquiries", "Quote requests"], dashboardKpis: ["Enquiries", "Quote requests"] },

  // B. E-commerce & Retail
  { id: "ecommerce_general", label: "Online store / D2C brand", sector: "ecommerce", objectives: ["Sales", "Purchases", "Website conversions", "Traffic"], conversionEvents: ["Purchases", "Add to cart", "Checkout started"], dashboardKpis: ["Revenue", "Purchases", "ROAS", "Average order value", "Customer acquisition cost"] },
  { id: "fashion_apparel", label: "Fashion & apparel", sector: "ecommerce", objectives: ["Sales", "Purchases", "Engagement"], conversionEvents: ["Purchases", "Add to cart"], dashboardKpis: ["Revenue", "Purchases", "ROAS"] },
  { id: "electronics", label: "Electronics", sector: "ecommerce", objectives: ["Sales", "Purchases", "Traffic"], conversionEvents: ["Purchases", "Product views"], dashboardKpis: ["Revenue", "Purchases", "ROAS"] },
  { id: "jewellery", label: "Jewellery", sector: "ecommerce", objectives: ["Sales", "Store visits", "Engagement"], conversionEvents: ["Purchases", "Store visit requests"], dashboardKpis: ["Revenue", "Purchases", "Store visits"] },
  { id: "furniture", label: "Furniture", sector: "ecommerce", objectives: ["Sales", "Lead generation", "Traffic"], conversionEvents: ["Purchases", "Quote requests"], dashboardKpis: ["Revenue", "Purchases", "ROAS"] },
  { id: "wholesale_distribution", label: "Wholesale & distribution", sector: "ecommerce", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Bulk order enquiries"], dashboardKpis: ["Enquiries", "Cost per enquiry"] },

  // C. Education & Training
  { id: "schools_colleges", label: "Schools, colleges & universities", sector: "education", objectives: ["Lead generation", "Website conversions", "Reach"], conversionEvents: ["Applications", "Admissions enquiries"], dashboardKpis: ["Enquiries", "Applications", "Admissions", "Cost per admission"] },
  { id: "coaching_edtech", label: "Coaching, online education & EdTech", sector: "education", objectives: ["Lead generation", "App installations", "Sales"], conversionEvents: ["Enrolments", "Trial sign-ups"], dashboardKpis: ["Enrolments", "Trial sign-ups", "Cost per enrolment"] },
  { id: "corporate_training", label: "Professional certifications & corporate training", sector: "education", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Enrolments", "Enquiries"], dashboardKpis: ["Enrolments", "Cost per enrolment"] },

  // D. Healthcare & Wellness
  { id: "hospitals_clinics", label: "Hospitals, clinics & diagnostic labs", sector: "healthcare", objectives: ["Lead generation", "Appointment bookings", "Reach"], conversionEvents: ["Appointment enquiries", "Bookings"], dashboardKpis: ["Appointment enquiries", "Bookings"], sensitive: true, complianceNote: SENSITIVE_NOTE },
  { id: "dental", label: "Dental practices", sector: "healthcare", objectives: ["Lead generation", "Appointment bookings"], conversionEvents: ["Appointment enquiries"], dashboardKpis: ["Appointment enquiries", "Bookings"], sensitive: true, complianceNote: SENSITIVE_NOTE },
  { id: "fitness_wellness", label: "Fitness centres, gyms & wellness brands", sector: "healthcare", objectives: ["Lead generation", "Subscriptions", "Engagement"], conversionEvents: ["Memberships", "Trial sign-ups"], dashboardKpis: ["Memberships", "Subscriptions", "Cost per membership"] },
  { id: "healthtech", label: "Healthcare technology", sector: "healthcare", objectives: ["App installations", "Lead generation", "Sales"], conversionEvents: ["App installs", "Sign-ups"], dashboardKpis: ["App installs", "Sign-ups"], sensitive: true, complianceNote: SENSITIVE_NOTE },

  // E. Financial Services
  { id: "banking_fintech", label: "Banking & FinTech", sector: "finance", objectives: ["Lead generation", "App installations", "Website conversions"], conversionEvents: ["Applications", "Sign-ups"], dashboardKpis: ["Applications", "Sign-ups", "Cost per application"], sensitive: true, complianceNote: SENSITIVE_NOTE },
  { id: "insurance", label: "Insurance", sector: "finance", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Quote requests", "Policy enquiries"], dashboardKpis: ["Quote requests", "Policy enquiries"], sensitive: true, complianceNote: SENSITIVE_NOTE },
  { id: "financial_advisory", label: "Financial advisory & wealth management", sector: "finance", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Consultation requests"], dashboardKpis: ["Consultation requests", "Cost per consultation"], sensitive: true, complianceNote: SENSITIVE_NOTE },
  { id: "accounting", label: "Accounting services", sector: "finance", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Consultation requests"], dashboardKpis: ["Consultation requests", "Cost per consultation"] },

  // F. Automotive & Transportation
  { id: "automobile_dealership", label: "Automobile & two-wheeler dealerships", sector: "automotive", objectives: ["Lead generation", "Store visits", "Website conversions"], conversionEvents: ["Test drive bookings", "Enquiries"], dashboardKpis: ["Test drive bookings", "Vehicle sales", "Cost per enquiry"] },
  { id: "ev", label: "Electric vehicles", sector: "automotive", objectives: ["Lead generation", "Website conversions", "Reach"], conversionEvents: ["Test drive bookings", "Enquiries"], dashboardKpis: ["Test drive bookings", "Vehicle sales"] },
  { id: "vehicle_rentals_logistics", label: "Vehicle rentals, transportation & logistics", sector: "automotive", objectives: ["Lead generation", "Website conversions", "Traffic"], conversionEvents: ["Booking enquiries"], dashboardKpis: ["Bookings", "Cost per booking"] },

  // G. Hospitality, Food & Travel
  { id: "hotels_resorts", label: "Hotels & resorts", sector: "hospitality", objectives: ["Sales", "Website conversions", "Reach"], conversionEvents: ["Bookings", "Reservation enquiries"], dashboardKpis: ["Bookings", "Reservations", "Revenue"] },
  { id: "restaurants_cafes", label: "Restaurants, cafes & food delivery", sector: "hospitality", objectives: ["Store visits", "Messages", "Engagement"], conversionEvents: ["Orders", "Reservation requests"], dashboardKpis: ["Orders", "Store visits", "Revenue"] },
  { id: "travel_tourism", label: "Travel agencies, tour operators & airlines", sector: "hospitality", objectives: ["Sales", "Website conversions", "Reach"], conversionEvents: ["Bookings", "Enquiries"], dashboardKpis: ["Bookings", "Revenue"] },

  // H. Technology & Digital Services
  { id: "saas", label: "SaaS & software companies", sector: "technology", objectives: ["App installations", "Website conversions", "Lead generation"], conversionEvents: ["Trial sign-ups", "Subscriptions"], dashboardKpis: ["Trial sign-ups", "Subscriptions", "Customer acquisition cost", "Churn"] },
  { id: "mobile_apps", label: "Mobile applications", sector: "technology", objectives: ["App installations", "App engagement"], conversionEvents: ["App installs", "In-app events"], dashboardKpis: ["App installs", "Cost per install", "Retention"] },
  { id: "it_digital_services", label: "IT services, cybersecurity, cloud & digital agencies", sector: "technology", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Demo requests", "Consultation requests"], dashboardKpis: ["Demo requests", "Qualified prospects"] },

  // I. B2B & Professional Services
  { id: "consulting_legal", label: "Consulting firms & legal services", sector: "b2b", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Consultation requests", "Demo requests"], dashboardKpis: ["Qualified prospects", "Consultations", "Contracts"] },
  { id: "recruitment", label: "Recruitment & employment agencies", sector: "b2b", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Applications", "Candidate enquiries"], dashboardKpis: ["Qualified applicants", "Placements"] },
  { id: "manufacturing_industrial", label: "Manufacturing & industrial suppliers", sector: "b2b", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Distributor enquiries", "Quote requests"], dashboardKpis: ["Distributor enquiries", "Orders"] },
  { id: "enterprise_business_services", label: "Enterprise & business services", sector: "b2b", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Demo requests", "Qualified prospects"], dashboardKpis: ["Qualified prospects", "Demos", "Pipeline value"] },

  // J. Entertainment & Lifestyle
  { id: "events_entertainment", label: "Events, concerts, movies & sports", sector: "entertainment", objectives: ["Sales", "Reach", "Event registrations"], conversionEvents: ["Ticket sales", "Registrations"], dashboardKpis: ["Registrations", "Ticket sales", "Revenue"] },
  { id: "gaming", label: "Gaming", sector: "entertainment", objectives: ["App installations", "App engagement"], conversionEvents: ["App installs", "In-app purchases"], dashboardKpis: ["App installs", "In-app purchases"] },
  { id: "influencer_fashion_lifestyle", label: "Influencer, fashion & beauty/lifestyle services", sector: "entertainment", objectives: ["Engagement", "Sales", "Reach"], conversionEvents: ["Purchases", "Bookings"], dashboardKpis: ["Engagement", "Purchases", "Bookings"] },

  // K. Home & Local Services
  { id: "home_improvement", label: "Interior designers & home improvement", sector: "home_services", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Quote requests", "Consultation requests"], dashboardKpis: ["Enquiries", "Cost per enquiry"] },
  { id: "trade_services", label: "Plumbing, electrical, cleaning, pest control & repair", sector: "home_services", objectives: ["Lead generation", "Messages", "Calls"], conversionEvents: ["Service requests"], dashboardKpis: ["Service requests", "Cost per request"] },
  { id: "security_landscaping", label: "Security & landscaping services", sector: "home_services", objectives: ["Lead generation", "Website conversions"], conversionEvents: ["Quote requests"], dashboardKpis: ["Enquiries", "Cost per enquiry"] },

  // L. Other
  { id: "agriculture_energy", label: "Agriculture & renewable energy", sector: "other", objectives: ["Lead generation", "Reach", "Website conversions"], conversionEvents: ["Enquiries"], dashboardKpis: ["Enquiries", "Cost per enquiry"] },
  { id: "telecom", label: "Telecommunications", sector: "other", objectives: ["Sales", "App installations", "Lead generation"], conversionEvents: ["Sign-ups", "Plan purchases"], dashboardKpis: ["Sign-ups", "Plan purchases"] },
  { id: "ngo_nonprofit", label: "NGOs, non-profits & public awareness", sector: "other", objectives: ["Reach", "Engagement", "Website conversions"], conversionEvents: ["Donations", "Sign-ups"], dashboardKpis: ["Donations", "Sign-ups", "Reach"] },
  { id: "subscriptions_marketplaces", label: "Subscription businesses & marketplaces", sector: "other", objectives: ["Subscriptions", "Sales", "App installations"], conversionEvents: ["Subscriptions", "Sign-ups"], dashboardKpis: ["Subscriptions", "Customer acquisition cost", "Churn"] },
  { id: "other", label: "Other / not listed", sector: "other", objectives: ["Lead generation", "Website conversions", "Reach"], conversionEvents: ["Enquiries"], dashboardKpis: ["Enquiries", "Cost per enquiry"] },
];

/** Every objective ever offered, across industries, for validating a free choice against. */
export const ALL_OBJECTIVES = [
  "Brand awareness", "Reach", "Traffic", "Engagement", "Lead generation", "Sales", "Purchases",
  "Website conversions", "App installations", "App engagement", "Video views", "Messages",
  "WhatsApp enquiries", "Appointment bookings", "Event registrations", "Store visits",
  "Subscriptions", "Calls",
] as const;

export function industryById(id: string) {
  return INDUSTRIES.find((i) => i.id === id) ?? null;
}

export function industriesBySector() {
  const groups = new Map<Sector, Industry[]>();
  for (const i of INDUSTRIES) groups.set(i.sector, [...(groups.get(i.sector) ?? []), i]);
  return [...groups.entries()].map(([sector, industries]) => ({ sector, industries }));
}

/** The industry-aware recommendation Section 4/5/6/8 ask for: deterministic, never fabricated. */
export function recommendationsFor(industryId: string) {
  const ind = industryById(industryId) ?? industryById("other")!;
  return {
    industry: { id: ind.id, label: ind.label, sector: ind.sector },
    objectives: ind.objectives,
    conversionEvents: ind.conversionEvents,
    dashboardKpis: ind.dashboardKpis,
    sensitive: !!ind.sensitive,
    complianceNote: ind.complianceNote ?? null,
  };
}
