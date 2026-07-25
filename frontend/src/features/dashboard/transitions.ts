import type { Role, ProjectStatus, TransitionAction } from '../../types';

/** Roles allowed to perform approval transitions. Viewers are read-only. */
const ACTOR_ROLES: readonly Role[] = ['org_admin', 'property_manager', 'approver'];

/** Roles allowed to create/edit/delete projects (mirrors backend WRITE_ROLES).
 * Note: approvers can act on approvals but may NOT modify projects. */
const MANAGE_ROLES: readonly Role[] = ['org_admin', 'property_manager'];

export function canAct(role: Role | undefined): boolean {
  return !!role && ACTOR_ROLES.includes(role);
}

export function canManage(role: Role | undefined): boolean {
  return !!role && MANAGE_ROLES.includes(role);
}

export interface ActionSpec {
  action: TransitionAction;
  label: string;
  color: 'primary' | 'success' | 'error';
}

/**
 * Which transition actions are available from a given status. Terminal
 * statuses (approved/rejected) return an empty list.
 */
export function availableActions(status: ProjectStatus): ActionSpec[] {
  switch (status) {
    case 'draft':
      return [{ action: 'submit', label: 'Submit', color: 'primary' }];
    case 'submitted':
    case 'manager_review':
    case 'finance_review':
      return [
        { action: 'approve', label: 'Approve', color: 'success' },
        { action: 'reject', label: 'Reject', color: 'error' },
      ];
    default:
      return [];
  }
}

/** MUI Chip color for each status. */
export function statusChipColor(
  status: ProjectStatus,
):
  | 'default'
  | 'info'
  | 'warning'
  | 'success'
  | 'error'
  | 'secondary' {
  switch (status) {
    case 'draft':
      return 'default';
    case 'submitted':
      return 'info';
    case 'manager_review':
    case 'finance_review':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    default:
      return 'default';
  }
}
