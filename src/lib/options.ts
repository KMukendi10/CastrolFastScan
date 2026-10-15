// Fixed sets. They mirror the enums in db/001_schema.sql. Lookup lists
// (regions, business types, ...) come from the database instead.
export const LANGUAGES = ["English", "Afrikaans", "isiZulu", "isiXhosa", "Sesotho", "Setswana", "Sepedi", "Xitsonga", "Tshivenda", "siSwati", "isiNdebele", "Other"];
export const VEHICLES = ["0-5", "6-10", "11-15", "16-20", "20+"];
export const YEARS_OP = ["1-3 years", "4-7 years", "8-15 years", "15+ years"];
export const STOCK_LEVELS = ["Low", "Medium", "High"];
export const BRANDING = ["None", "Limited", "Moderate", "Strong"];
export const WEEKLY = ["1-10", "11-25", "26-50", "50+"];

export type Kind = "mechanics_profile" | "independent_mechanic" | "spares";
export const KIND_LABEL: Record<Kind, string> = {
  mechanics_profile: "Mechanic profile",
  independent_mechanic: "Independent mechanic",
  spares: "Spares shop",
};
export const isKind = (k: string): k is Kind => k in KIND_LABEL;

// DRAFT wording. Have your legal team approve the real text before the pilot,
// then change CONSENT_VERSION so every record shows which text was agreed to.
export const CONSENT_VERSION = "v2-draft";
export const CONSENT_TEXT =
  "I agree that Castrol may store my details (name, contact numbers, email, workshop or shop details and location) and contact me about Castrol FastScan, training and Castrol products. I understand I can ask to be removed at any time.";
