export type Role = "pending" | "seller" | "admin";

export type CustomerCategory = "first_year_mba" | "second_year_mba" | "faculty" | "other_unknown";
export type CategoryBucket = CustomerCategory | "not_specified";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
}

export interface Inventory {
  initial: number;
  adjustments_in: number;
  adjustments_out: number;
  available_total: number;
  bars_sold: number;
  remaining: number;
  pct_sold: number;
  transactions: number;
}

export interface ProductState {
  id: string;
  name: string;
  tagline: string | null;
  bars_per_unit: number;
  tickets_per_unit: number;
  active: boolean;
  sort_order: number;
  packages_sold: number;
  bars_sold: number;
  tickets: number;
  transactions_with: number;
}

export interface EventSettings {
  event_name: string;
  timezone: string;
  initial_inventory: number;
  sales_started_at: string | null;
  duplicate_window_seconds: number;
  seller_undo_minutes: number;
}

export interface LiveState {
  version: number;
  inventory: Inventory;
  settings: EventSettings;
  products: ProductState[];
}

export interface Kpis {
  total_tickets: number;
  total_bars: number;
  transactions: number;
  unique_customers: number;
  avg_tickets_per_transaction: number;
  avg_bars_per_transaction: number;
  first_sale_at: string | null;
  last_sale_at: string | null;
}

export interface CategoryRow {
  category: CategoryBucket;
  customers: number;
  transactions: number;
  tickets: number;
  bars: number;
}

export interface TimelineBucket {
  bucket: string;
  transactions: number;
  tickets: number;
  bars: number;
}

export interface Dashboard extends LiveState {
  kpis: Kpis;
  voided: { count: number; bars: number; tickets: number };
  categories: CategoryRow[];
  timeline: TimelineBucket[];
}

export interface VoidedSummary {
  id: number;
  created_at: string;
  voided_at: string;
  total_bars: number;
  total_tickets: number;
  void_reason: string;
  seller_name: string;
  voided_by_name: string | null;
}

export interface Adjustment {
  id: number;
  created_at: string;
  kind: "restock" | "correction";
  delta: number;
  reason: string;
  created_by_name: string;
}

export interface Report extends Dashboard {
  generated_at: string;
  voided_transactions: VoidedSummary[];
  adjustments: Adjustment[];
}

export interface TransactionRow {
  id: number;
  created_at: string;
  netid: string;
  customer_name: string | null;
  customer_category: CustomerCategory | null;
  items: Record<string, number>;
  total_bars: number;
  total_tickets: number;
  seller_id: string;
  seller_name: string;
  status: "completed" | "voided";
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

export interface SaleResult {
  duplicate_request: boolean;
  transaction: TransactionRow;
  inventory: Inventory;
}

export interface Member {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
  created_at: string;
  sales: number;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  actor_name: string | null;
}

export interface AdminState {
  members: Member[];
  adjustments: Adjustment[];
  audit: AuditEntry[];
}
