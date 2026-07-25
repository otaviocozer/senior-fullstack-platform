// ---------------------------------------------------------------------------
// Domain & API types shared across the app.
// ---------------------------------------------------------------------------

/** Roles a user can hold within an organization. Ordered loosely by privilege. */
export type Role = 'org_admin' | 'property_manager' | 'approver' | 'viewer';

/** Lifecycle states of a CapEx project (the approval state machine). */
export type ProjectStatus =
  | 'draft'
  | 'submitted'
  | 'manager_review'
  | 'finance_review'
  | 'approved'
  | 'rejected';

/** Transition actions accepted by the backend state machine. */
export type TransitionAction = 'submit' | 'approve' | 'reject';

/** The authenticated user, as returned by login / refresh / me endpoints. */
export interface User {
  id: number | string;
  email: string;
  role: Role;
  org_id: number | string;
  org_name: string;
  property_ids: Array<number | string>;
}

/** A CapEx project / budget line item. */
export interface Project {
  id: number | string;
  org_id: number | string;
  property_id: number | string;
  property_name: string;
  title: string;
  category: string;
  fiscal_period: string;
  budget_amount: number;
  actual_cost: number;
  status: ProjectStatus;
  variance_pct: number;
  current_level: string | null;
  created_at: string;
}

/** A property (building/site) belonging to an organization. */
export interface Property {
  id: number | string;
  name: string;
  code: string;
  org_id: number | string;
}

// --- Auth request/response shapes ------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface RefreshResponse {
  access: string;
}

// --- Projects list ----------------------------------------------------------

/** Query params for the paginated project list endpoint. */
export interface ProjectListParams {
  page?: number;
  page_size?: number;
  status?: ProjectStatus | '';
  category?: string;
  property?: string | number;
  fiscal_period?: string;
  search?: string;
}

/** DRF-style paginated response. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// --- Transition -------------------------------------------------------------

export interface TransitionRequest {
  id: number | string;
  action: TransitionAction;
}

// --- Analytics --------------------------------------------------------------

export interface AnalyticsKpis {
  total_budget: number;
  total_actual: number;
  variance_pct: number;
  project_count: number;
  pending_approval: number;
  avg_cycle_time_hours: number;
}

export interface CategoryBreakdown {
  category: string;
  budget: number;
  actual: number;
  variance_pct: number;
  count: number;
}

export interface StatusBreakdown {
  status: ProjectStatus;
  count: number;
}

export interface BacklogLevel {
  level: string;
  count: number;
}

export interface DashboardAnalytics {
  generated_at: string | null;
  stale: boolean;
  kpis: AnalyticsKpis;
  by_category: CategoryBreakdown[];
  by_status: StatusBreakdown[];
  backlog_by_level: BacklogLevel[];
}

/** Real-time message pushed over the dashboard websocket. */
export interface ApprovalUpdateMessage {
  type: 'approval.update';
  project_id: number | string;
  status: ProjectStatus;
  property_id?: number | string;
  [key: string]: unknown;
}
