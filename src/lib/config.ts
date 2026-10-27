// Branding lives here so the product name can be changed in one place.
export const APP = {
  name: "LedgerPro",
  subtitle: "Finance & Collection Manager",
  // The business name shown in the app and on every PDF. NEXT_PUBLIC_BUSINESS_NAME overrides it.
  owner: { name: "Rajendran", business: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Bagavan Finance", initials: "RJ" },
  demoPin: "1234",
} as const;
