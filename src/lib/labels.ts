import type { CategoryBucket } from "./types";

export const CATEGORY_LABELS: Record<CategoryBucket, string> = {
  first_year_mba: "First-Year MBA",
  second_year_mba: "Second-Year MBA",
  faculty: "Faculty",
  other_unknown: "Other / Unknown",
  not_specified: "Not specified",
};

export const CUSTOMER_CATEGORIES = ["first_year_mba", "second_year_mba", "faculty", "other_unknown"] as const;

// Campaign palette: sky blue, royal blue and OREO-cookie brown (navy and white are the backgrounds,
// red is kept for the CLIF badge). They step from light to dark as the package grows, so they stay
// apart by lightness as well as hue. Order is fixed and never cycled.
export const PRODUCT_COLORS: Record<string, string> = {
  single_bar: "#7DB4FF",
  week_pack: "#1E6BFF",
  exam_week_bundle: "#7A4B33",
};

export function productColor(id: string): string {
  return PRODUCT_COLORS[id] ?? "#5B6478";
}

// Text color that reads on top of a product color.
export function productInk(id: string): string {
  return id === "single_bar" ? "#0a2463" : "#ffffff";
}
