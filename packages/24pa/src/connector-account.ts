// 24PA's own account block on the host's Plugins page (#309). The vendor CLIs
// and their sign-ins belong to the official Feishu and WeCom plugins, which
// carry their own blocks; this one reports what is the plugin's own to judge:
// the owner binding, the readability of the configured Feishu resources, and
// the WeCom service-level grants. It shows stored results. Reading the
// platforms is one explicit operation the owner starts, so a page that opens
// never reaches a platform.

import { randomUUID } from 'node:crypto';
import type {
  ConnectorAccountButton, ConnectorAccountCopy, ConnectorAccountDisplay, ConnectorAccountOperation, ConnectorOperation,
  ConnectorOperationResult, ConnectorAccountsService, ConnectorAccountSource, ConnectorAccountView, LocalizedText,
} from './host.js';
import type { AccessDiagnostics } from './feishu.js';
import type { WecomDiagnostics } from './wecom-channels.js';
import type { PaRuntime } from './runtime.js';
import { WECOM_SERVICE_NAMES } from './wecom.js';

/** The account's key on the page, and the package whose bundle page carries the block. */
export const PA24_PACKAGE_NAME = '@benz-ai-x/dsh-24pa';

/** One thing a check found wrong with a channel: what it is about, in each language, and what the check said of it. */
export interface AccessIssue {
  readonly label: LocalizedText;
  /** The runtime's own diagnostic, in its own wording. */
  readonly message: string;
}

/** One channel's stored result. */
export interface AccessReport {
  /** When the channel was last checked; null until then. */
  readonly checkedAt: string | null;
  /** What the check found wrong; empty when the channel is ready. */
  readonly issues: readonly AccessIssue[];
  /** Whether the check reached every item; it stops at what it finds wrong first, leaving the rest unchecked. */
  readonly complete: boolean;
}

/** The account the page shows: no workspace yet, or each switched-on channel's last result. */
export type AccessAccount =
  | { readonly state: 'unbound' }
  | { readonly state: 'reported'; readonly mode: 'demo' | 'feishu'; readonly timeZone: string; readonly feishu: AccessReport | null; readonly wecom: AccessReport | null };

/** The one operation a page button starts: the read-only check. */
export type AccessOperation = 'inspect';
type View = ConnectorAccountView<AccessAccount, AccessOperation>;
type TextKey =
  | 'title' | 'hint' | 'action.inspect' | 'status.checking' | 'status.failed' | 'status.unbound' | 'status.demo' | 'status.unchecked'
  | 'status.attention' | 'status.attention.one' | 'status.ready' | 'badge.attention' | 'badge.ready' | 'detail.unchecked' | 'detail.unbound' | 'detail.incomplete'
  | 'note.checkedAt' | 'note.unchecked'
  | 'activation.title' | 'activation.body' | 'notice.inspected' | 'failure.inspect'
  | 'label.signin' | 'label.owner' | 'label.identity' | 'label.folder' | 'label.wiki' | 'label.tasklist' | 'label.calendar';
type Text = (key: TextKey, params?: Readonly<Record<string, string | LocalizedText>>) => LocalizedText;

/**
 * The block's text by language; English is what a language without a dictionary falls back to. What a check said of an item is
 * the runtime's diagnostic and keeps its wording.
 */
const DICTIONARIES: { readonly en: Readonly<Record<TextKey, string>> } & { readonly [language: string]: Readonly<Record<TextKey, string>> } = {
  en: {
    title: '24PA access',
    hint: 'Reports the owner binding, the readability of the configured Feishu resources and the WeCom service grants. Apps are linked and accounts signed in on the official plugins’ pages.',
    'action.inspect': 'Run read-only check',
    'status.checking': 'Checking',
    'status.failed': 'The check did not finish',
    'status.unbound': 'No workspace bound',
    'status.demo': 'Demo mode: neither Feishu access nor the WeCom channel is on',
    'status.unchecked': 'Not checked yet',
    'status.attention': '{count} items need attention',
    'status.attention.one': '1 item needs attention',
    'status.ready': 'Owner, resources and channels are ready',
    'note.checkedAt': '{channel}: checked at {at}',
    'note.unchecked': '{channel}: not checked yet',
    'badge.attention': 'Needs attention',
    'badge.ready': 'Ready',
    'detail.unchecked': 'The check only reads: it sends no message and creates no object.',
    'detail.unbound': 'Bind a workspace in the 24PA panel first.',
    'detail.incomplete': 'The check stops at what it finds wrong first; the remaining items were not checked.',
    'activation.title': 'Check 24PA access',
    'activation.body': 'Run a read-only check to confirm that the owner, the resources and the channels are ready.',
    'notice.inspected': 'The read-only check finished.',
    'failure.inspect': 'Run the check again from the 24PA panel and read the diagnostics there.',
    'label.signin': 'Account sign-in',
    'label.owner': 'Owner binding',
    'label.identity': 'Bot binding & authorized user',
    'label.folder': 'Docs folder',
    'label.wiki': 'Wiki node',
    'label.tasklist': 'Task list',
    'label.calendar': 'Own calendar',
  },
  zh: {
    title: '24私助接入',
    hint: '报告主人绑定、已配置飞书资源的可读性与企业微信服务级授权；应用关联与账号登录在各官方插件的页面完成。',
    'action.inspect': '执行只读检查',
    'status.checking': '正在检查',
    'status.failed': '检查未完成',
    'status.unbound': '尚未绑定工作区',
    'status.demo': '体验模式：飞书接入与企业微信渠道都未启用',
    'status.unchecked': '尚未检查',
    'status.attention': '{count} 项需要处理',
    'status.attention.one': '1 项需要处理',
    'status.ready': '主人、资源与渠道检查通过',
    'note.checkedAt': '{channel}：检查于 {at}',
    'note.unchecked': '{channel}：尚未检查',
    'badge.attention': '需要处理',
    'badge.ready': '已就绪',
    'detail.unchecked': '检查只读取，不发送消息，也不创建任何对象。',
    'detail.unbound': '请先在24私助面板绑定工作区。',
    'detail.incomplete': '检查在第一个不通过处停下，其余项没有检查。',
    'activation.title': '检查24私助接入',
    'activation.body': '执行一次只读检查，确认主人、资源与渠道已就绪。',
    'notice.inspected': '只读检查已完成。',
    'failure.inspect': '请到24私助面板重新执行检查，并在那里查看诊断。',
    'label.signin': '账号登录',
    'label.owner': '主人绑定',
    'label.identity': '机器人绑定与授权真人',
    'label.folder': '文档目录',
    'label.wiki': '知识库',
    'label.tasklist': '任务清单',
    'label.calendar': '本人日历',
  },
};

/**
 * One dictionary key in every language, each `{name}` replaced with its parameter: a string as it is, a localized text in that
 * language (English for a language it has no form in).
 */
const text: Text = (key, params = {}) => {
  const fill = (template: string, language: string): string => template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    return typeof value === 'string' ? value : value[language] ?? value.en;
  });
  const entry: Record<string, string> = {};
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) entry[language] = fill(dictionary[key], language);
  return { ...entry, en: fill(DICTIONARIES.en[key], 'en') };
};

type Block = { state?: unknown; message?: unknown } | null | undefined;
const stateOf = (block: Block): string => block == null ? '' : String(block.state ?? '');
const messageOf = (block: Block): string => block == null ? '' : String(block.message ?? '');
const isIn = (block: Block, ...states: string[]): boolean => states.includes(stateOf(block));

/** A channel that was never checked. */
const neverChecked = (): AccessReport => ({ checkedAt: null, issues: [], complete: true });

/** What a check reported of one item, as the page lists each on its own. */
const issue = (label: LocalizedText, block: Block): AccessIssue => ({ label, message: messageOf(block) });

/** What a failed account check is about: the sign-in itself, or who it turned out to be against the workspace's owner. */
const authLabel = (state: string): LocalizedText => text(state === 'unbound' || state === 'mismatch' ? 'label.owner' : 'label.signin');
const FEISHU_RESOURCE_LABELS: Readonly<Record<string, TextKey>> = { folder: 'label.folder', wiki: 'label.wiki', tasklist: 'label.tasklist', calendar: 'label.calendar' };
const resourceName = (resource: { id?: unknown; label?: unknown }): LocalizedText => {
  const key = FEISHU_RESOURCE_LABELS[String(resource.id)];
  return key ? text(key) : String(resource.label ?? resource.id);
};
const serviceName = (id: string): LocalizedText => {
  const name = WECOM_SERVICE_NAMES[id];
  return name ? { zh: name.zh, en: name.en } : id;
};

/** What keeps the Feishu channel from being ready, from its stored access check. */
export function feishuAccessReport(result: AccessDiagnostics | null): AccessReport {
  if (!result) return neverChecked();
  // Without a runnable lark-cli nothing below was checked.
  if (isIn(result.cli, 'error')) return { checkedAt: result.checkedAt, issues: [issue('lark-cli', result.cli)], complete: false };
  const issues: AccessIssue[] = [];
  if (isIn(result.source, 'error')) issues.push(issue('AGENTS.md', result.source));
  if (!isIn(result.auth, 'ok', 'unchecked')) issues.push(issue(authLabel(stateOf(result.auth)), result.auth));
  // An item the check did not reach is no finding: the account did not come out as the workspace's owner, so the resources were not read.
  let complete = !isIn(result.auth, 'unchecked');
  for (const resource of result.resources) {
    if (isIn(resource, 'unchecked')) complete = false;
    // The wiki node is optional: an unset one is the documented fallback, not a gap.
    else if (!isIn(resource, 'ok') && !(resource.id === 'wiki' && isIn(resource, 'missing'))) issues.push(issue(resourceName(resource), resource));
  }
  return { checkedAt: result.checkedAt, issues, complete };
}

/** What keeps the WeCom channel from being ready, from its stored check. */
export function wecomAccessReport(result: WecomDiagnostics | null): AccessReport {
  if (!result) return neverChecked();
  // Without a runnable wecom-cli nothing below was checked.
  if (result.cli.state !== 'ok') return { checkedAt: result.checkedAt, issues: [issue('wecom-cli', result.cli)], complete: false };
  // The services are read as the resolved identity only: without it none was read, whatever state the check recorded them with.
  if (result.identity.state !== 'ok') return { checkedAt: result.checkedAt, issues: [issue(text('label.identity'), result.identity)], complete: false };
  const issues: AccessIssue[] = [];
  // Skipped services are off, and push has no read-only probe: neither is a gap.
  for (const service of result.services) {
    if (!['ok', 'skipped', 'unverified'].includes(service.state)) issues.push(issue(serviceName(service.id), service));
  }
  return { checkedAt: result.checkedAt, issues, complete: true };
}

const CHANNEL_NAMES = { feishu: { zh: '飞书', en: 'Feishu' }, wecom: { zh: '企业微信', en: 'WeCom' } } as const;
type Channel = keyof typeof CHANNEL_NAMES;

/** When a channel was checked, in the workspace's time zone and in each language. */
export function checkedAtNote(channel: Channel, checkedAt: string, timeZone: string): LocalizedText {
  const at = (locale: string): string => new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false })
    .format(new Date(checkedAt));
  return text('note.checkedAt', { channel: CHANNEL_NAMES[channel], at: { en: at('en-US'), zh: at('zh-CN') } });
}

/** A line for each channel that has not been checked yet. */
const uncheckedNotes = (channels: ReadonlyArray<readonly [AccessReport, Channel]>): { readonly text: LocalizedText }[] =>
  channels.filter(([report]) => report.checkedAt === null).map(([, channel]) => ({ text: text('note.unchecked', { channel: CHANNEL_NAMES[channel] }) }));

/** How many items a check found wrong, in each language; English has a form for one. */
const attention = (count: number): LocalizedText => text(count === 1 ? 'status.attention.one' : 'status.attention', { count: String(count) });

/** An issue as one line: what it is about in the page's language, then what the check said in its own wording. */
const issueLine = ({ label, message }: AccessIssue): LocalizedText =>
  typeof label === 'string' ? { zh: `${label}：${message}`, en: `${label}: ${message}` } : { zh: `${label.zh}：${message}`, en: `${label.en}: ${message}` };

/** Map the view to what the block shows. */
export function presentAccess(view: View): ConnectorAccountDisplay {
  const inspect: ConnectorAccountButton = { label: text('action.inspect'), command: { kind: 'start', operation: 'inspect' }, variant: 'primary' };
  if (view.operation) return { phase: 'checking', status: text('status.checking'), buttons: [], notes: [] };
  // The check's own diagnostics are in the panel; what it threw may carry credentials, so nothing of it is shown here.
  if (view.result?.outcome === 'failed') return { phase: 'unavailable', status: text('status.failed'), buttons: [inspect], notes: [], failure: { text: text('failure.inspect') } };
  const account = view.account;
  if (account.state === 'unbound') return { phase: 'unavailable', status: text('status.unbound'), buttons: [], notes: [], detail: text('detail.unbound') };
  const channels = ([[account.feishu, 'feishu'], [account.wecom, 'wecom']] as const).filter((entry): entry is readonly [AccessReport, Channel] => entry[0] !== null);
  // Nothing is switched on, so there is nothing a check could read.
  if (!channels.length) return { phase: 'disconnected', status: text('status.demo'), buttons: [], notes: [], detail: text('detail.unchecked') };
  const reports = channels.map(([report]) => report);
  const issues = reports.flatMap(report => report.issues);
  const incomplete = reports.some(report => !report.complete);
  if (issues.length) return {
    phase: 'disconnected', badge: text('badge.attention'), status: attention(issues.length), buttons: [inspect],
    ...(incomplete ? { detail: text('detail.incomplete') } : {}),
    // A channel that was never checked is no finding; it is said of all the same, so that it is not taken for checked.
    notes: [...issues.map(item => ({ text: issueLine(item) })), ...uncheckedNotes(channels)],
  };
  if (incomplete || reports.some(report => report.checkedAt === null)) {
    return { phase: 'disconnected', status: text('status.unchecked'), buttons: [inspect], notes: [], detail: incomplete ? text('detail.incomplete') : text('detail.unchecked') };
  }
  return {
    phase: 'connected', badge: text('badge.ready'), status: text('status.ready'), buttons: [inspect],
    notes: channels.map(([report, channel]) => ({ text: checkedAtNote(channel, report.checkedAt!, account.timeZone) })),
  };
}

/**
 * The page's source of the block: the stored results, and the one operation that reads the platforms. It is registered
 * with the host's page registry directly; the CLI account service would also put this plugin's lark-cli path into every
 * session's context, which is the official Feishu plugin's to state.
 */
export class AccessAccountSource implements ConnectorAccountSource<AccessAccount, AccessOperation> {
  private operation: ConnectorOperation<AccessOperation> | undefined;
  private result: ConnectorOperationResult<AccessOperation> | undefined;
  private inflight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stopListening: () => void;

  constructor(private readonly runtime: PaRuntime) {
    this.stopListening = runtime.onAccessAccount(() => this.changed());
  }

  snapshot(): View {
    return { account: this.runtime.accessAccountState(), ...(this.operation ? { operation: this.operation } : {}), ...(this.result ? { result: this.result } : {}) };
  }

  observe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Each new page subscriber calls this. The view is built from stored results, so nothing is refreshed and no platform is read. */
  refresh(): void {}

  /** The owner's read-only check, one at a time; the page follows it by the returned id. */
  start(kind: AccessOperation): string {
    if (kind !== 'inspect') throw new Error(`pa24: the access block has no operation "${kind}"`);
    if (this.operation) throw new Error('pa24: an access check is already running');
    const id = randomUUID();
    this.operation = { id, kind, phase: 'checking', cancellable: false };
    this.result = undefined;
    this.inflight = this.execute(id);
    this.changed();
    return id;
  }

  /** Resolves once no check of this source is running. */
  settled(): Promise<void> {
    return this.inflight ?? Promise.resolve();
  }

  /** The check only reads, and is not long; it is not cancelled. */
  async cancel(): Promise<void> {}

  /** Stop following the plugin's results; the page's registration ends separately. */
  dispose(): void {
    this.stopListening();
    this.listeners.clear();
  }

  private async execute(id: string): Promise<void> {
    let outcome: ConnectorOperationResult<AccessOperation>['outcome'] = 'succeeded';
    try {
      await this.runtime.checkSwitchedOnAccess();
    } catch {
      outcome = 'failed';
    } finally {
      this.operation = undefined;
      this.result = { id, kind: 'inspect', outcome };
      this.inflight = null;
      this.changed();
    }
  }

  private changed(): void {
    for (const notify of this.listeners) notify();
  }
}

/** Put the block on the host's Plugins page; the returned function withdraws it. */
export function registerAccessAccount(registry: ConnectorAccountsService, runtime: PaRuntime): () => void {
  const source = new AccessAccountSource(runtime);
  try {
    const operations: readonly ConnectorAccountOperation<AccessOperation>[] = [{ kind: 'inspect', notice: text('notice.inspected') }];
    const copy: ConnectorAccountCopy = {
      title: text('title'), hint: text('hint'),
      activation: { title: text('activation.title'), body: text('activation.body'), connect: text('action.inspect') },
    };
    const withdraw = registry.register({ key: PA24_PACKAGE_NAME, packageName: PA24_PACKAGE_NAME, source, operations, copy, present: presentAccess });
    return () => { withdraw(); source.dispose(); };
  } catch (error) {
    // The key or the package is taken: nothing was registered, so nothing follows the plugin's results.
    source.dispose();
    throw error;
  }
}
