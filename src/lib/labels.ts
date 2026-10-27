import type { CategoryBucket } from "./types";

export const CATEGORY_LABELS: Record<CategoryBucket, string> = {
  first_year_mba: "First-Year MBA",
  second_year_mba: "Second-Year MBA",
  faculty: "Faculty",
  other_unknown: "Other / Unknown",
  not_specified: "Not specified",
};

export const CUSTOMER_CATEGORIES = ["first_year_mba", "second_year_mba", "faculty", "other_unknown"] as const;

// Validated categorical palette (dataviz validator: CVD + normal-vision checks pass on the cream surface).
// Order is fixed by product sort order and never cycled.
export const PRODUCT_COLORS: Record<string, string> = {
  single_bar: "#1E6BFF",
  week_pack: "#E08A1E",
  exam_week_bundle: "#0E9384",
};

export function productColor(id: string): string {
  return PRODUCT_COLORS[id] ?? "#5B6478";
}
