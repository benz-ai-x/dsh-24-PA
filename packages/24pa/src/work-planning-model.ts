export interface WorkFocus { id: string; title: string; outcome: string; until: string | null }
export interface FocusSet { items: WorkFocus[]; confirmation: string }
export interface PlanningReference { kind: 'todo' | 'work'; id: string }
export interface WorkPlanItem {
  id: string; title: string; outcome: string; reason: string; nextAction: string;
  focusId: string | null; references: PlanningReference[]; estimateMinutes: number | null;
  start: string | null; end: string | null;
}
export interface PlanningWindow { start: string; end: string }
export interface PlanningEvidence {
  observedAt: string; missing: string[]; focusRevision: number;
  capacityMinutes: number | null; estimateMinutes: number; unknownEstimates: number;
}
export interface AcceptedWorkPlan {
  revision: number; confirmedAt: string; confirmation: string; items: WorkPlanItem[];
  evidence: PlanningEvidence;
}
export interface DailyWorkPlan {
  date: string; timeZone: string; items: WorkPlanItem[]; decisions: string[];
  workWindows: PlanningWindow[]; evidence: PlanningEvidence; accepted: AcceptedWorkPlan | null;
}
export type ReviewStatus = 'completed' | 'progress' | 'blocked' | 'changed' | 'unknown';
export interface ReviewResult { itemId: string; status: ReviewStatus; detail: string; evidence: 'platform' | 'owner' | 'unknown' }
export interface DailyWorkReview {
  date: string; timeZone: string; acceptedRevision: number; results: ReviewResult[];
  adjustments: string[]; question: string | null; questionRepeated: boolean; observedAt: string; missing: string[];
}
export type PlanningContent = FocusSet | DailyWorkPlan | DailyWorkReview;
