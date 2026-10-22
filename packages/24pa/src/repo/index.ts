// Split from repo.ts (round-3 review): the Repos facade — the unchanged
// seam every caller already uses (repo.ts is now a barrel re-exporting this).
import type { PaDb } from '../db.js';
import { CalendarEventRow, CalendarRepo, CalendarSyncRow } from './calendar.js';
import { DigestOccurrenceRow, DigestPlanRow, DigestRepo, MinutesRepo, MinutesRow } from './digest.js';
import { InboxRepo, InboxRow, InboxStatus, NewInbox } from './inbox.js';
import { MaintenanceRepo } from './maintenance.js';
import { MemoRepo, MemoRow } from './memo.js';
import { NotePageRow, NoteRepo, NoteRow, NoteStatus, NoteVersionRow, NoteVersionStatus, ReviewDecisionRow, ReviewReminderRepo, ReviewReminderRow, ReviewTokenRow } from './notes.js';
import { NewOutbox, OutboxRepo, OutboxRow, OutboxStatus } from './outbox.js';
import { OutreachRepo, OutreachRow, TaskTemplateInstanceRow, TaskTemplateRepo, TaskTemplateRow, WaitingItemRow, WaitingRepo } from './outreach.js';
import { ReminderOccurrenceRow, ReminderRepo, ReminderRuleRow } from './reminder.js';
import { MessageRouteRepo, MessageRouteRow } from './route.js';
import { BindingRepo, BindingRow, WorkspaceStateRepo, WorkspaceStateRow } from './state.js';
import { SkillRepo } from './skill.js';
import { SkillRunRepo } from './skill-run.js';
import { SourceRepo } from './source.js';
import { SourceProjectionRepo } from './source-projection.js';
import { DataChannel, ProjectRepo, ProjectRow, TaskRepo, TaskRow } from './task.js';
import { ActionOperationRepo, ActionOperationRow, OperationStatus, WorkItemRepo, WorkItemRow, WorkItemStatus } from './work.js';

export interface Repos {
  inbox: InboxRepo;
  workItems: WorkItemRepo;
  operations: ActionOperationRepo;
  outbox: OutboxRepo;
  bindings: BindingRepo;
  workspaceState: WorkspaceStateRepo;
  memos: MemoRepo;
  messageRoutes: MessageRouteRepo;
  tasks: TaskRepo;
  projects: ProjectRepo;
  calendar: CalendarRepo;
  reminders: ReminderRepo;
  notes: NoteRepo;
  reviewReminders: ReviewReminderRepo;
  outreach: OutreachRepo;
  taskTemplates: TaskTemplateRepo;
  waiting: WaitingRepo;
  digests: DigestRepo;
  minutes: MinutesRepo;
  maintenance: MaintenanceRepo;
  skills: SkillRepo;
  skillRuns: SkillRunRepo;
  sources: SourceRepo;
  sourceProjection: SourceProjectionRepo;
}

export function createRepos(db: PaDb): Repos {
  return {
    inbox: new InboxRepo(db),
    workItems: new WorkItemRepo(db),
    operations: new ActionOperationRepo(db),
    outbox: new OutboxRepo(db),
    bindings: new BindingRepo(db),
    workspaceState: new WorkspaceStateRepo(db),
    memos: new MemoRepo(db),
    messageRoutes: new MessageRouteRepo(db),
    tasks: new TaskRepo(db),
    projects: new ProjectRepo(db),
    calendar: new CalendarRepo(db),
    reminders: new ReminderRepo(db),
    notes: new NoteRepo(db),
    reviewReminders: new ReviewReminderRepo(db),
    outreach: new OutreachRepo(db),
    taskTemplates: new TaskTemplateRepo(db),
    waiting: new WaitingRepo(db),
    digests: new DigestRepo(db),
    minutes: new MinutesRepo(db),
    maintenance: new MaintenanceRepo(db),
    skills: new SkillRepo(db),
    skillRuns: new SkillRunRepo(db),
    sources: new SourceRepo(db),
    sourceProjection: new SourceProjectionRepo(db),
  };
}
export * from './calendar.js';
export * from './digest.js';
export * from './inbox.js';
export * from './maintenance.js';
export * from './memo.js';
export * from './notes.js';
export * from './outbox.js';
export * from './outreach.js';
export * from './reminder.js';
export * from './route.js';
export * from './state.js';
export * from './task.js';
export * from './work.js';
export * from './skill.js';
export * from './skill-run.js';
export * from './source.js';
export * from './source-projection.js';
