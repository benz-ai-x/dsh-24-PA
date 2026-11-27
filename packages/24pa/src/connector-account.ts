// 24私助's own account block on the host's Plugins page (#309). The vendor CLIs
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

/** The account's key on the page, and the package whose bundle page carries the block. */
export const PACKAGE = '@benz-ai-x/dsh-24pa';

/** One channel's stored result. */
export interface AccessReport {
  /** When the channel was last checked; null until then. */
  readonly checkedAt: string | null;
  /** What keeps the channel from being ready; empty when it is. */
  readonly issues: readonly string[];
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
  | 'status.attention' | 'status.ready' | 'badge.attention' | 'badge.ready' | 'detail.unchecked' | 'detail.unbound'
  | 'activation.title' | 'activation.body' | 'notice.inspected' | 'failure.inspect';
type Text = (key: TextKey, params?: Readonly<Record<string, string>>) => LocalizedText;

/** The block's text by language; English is what a language without a dictionary falls back to. */
const DICTIONARIES: { readonly en: Readonly<Record<TextKey, string>> } & { readonly [language: string]: Readonly<Record<TextKey, string>> } = {
  en: {
    title: '24私助 access',
    hint: 'Reports the owner binding, the readability of the configured Feishu resources and the WeCom service grants. Apps are linked and accounts signed in on the official plugins’ pages.',
    'action.inspect': 'Run read-only check',
    'status.checking': 'Checking',
    'status.failed': 'The check did not finish',
    'status.unbound': 'No workspace bound',
    'status.demo': 'Demo mode: neither Feishu access nor the WeCom channel is on',
    'status.unchecked': 'Not checked yet',
    'status.attention': '{count} items need attention',
    'status.ready': 'Owner, resources and channels are ready',
    'badge.attention': 'Needs attention',
    'badge.ready': 'Ready',
    'detail.unchecked': 'The check only reads: it sends no message and creates no object.',
    'detail.unbound': 'Bind a workspace in the 24私助 panel first.',
    'activation.title': 'Check 24私助 access',
    'activation.body': 'Run a read-only check to confirm that the owner, the resources and the channels are ready.',
    'notice.inspected': 'The read-only check finished.',
    'failure.inspect': 'Run the check again from the 24私助 panel and read the diagnostics there.',
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
    'status.ready': '主人、资源与渠道检查通过',
    'badge.attention': '需要处理',
    'badge.ready': '已就绪',
    'detail.unchecked': '检查只读取，不发送消息，也不创建任何对象。',
    'detail.unbound': '请先在24私助面板绑定工作区。',
    'activation.title': '检查24私助接入',
    'activation.body': '执行一次只读检查，确认主人、资源与渠道已就绪。',
    'notice.inspected': '只读检查已完成。',
    'failure.inspect': '请到24私助面板重新执行检查，并在那里查看诊断。',
  },
};

/** One dictionary key in every language, each `{name}` replaced with its parameter. */
const text: Text = (key, params = {}) => {
  const fill = (template: string): string => template.replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] ?? placeholder);
  const entry: Record<string, string> = {};
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) entry[language] = fill(dictionary[key]);
  return { ...entry, en: fill(DICTIONARIES.en[key]) };
};

const stateOf = (block: { state?: unknown } | null | undefined): string => block == null ? '' : String(block.state ?? '');
const messageOf = (block: { message?: unknown } | null | undefined): string => block == null ? '' : String(block.message ?? '');

/** What keeps the Feishu channel from being ready, from its stored access check. */
export function feishuAccessReport(result: AccessDiagnostics | null): AccessReport {
  if (!result) return { checkedAt: null, issues: [] };
  // Each issue names what it is about, as the page lists them on their own.
  const issues: string[] = [];
  if (stateOf(result.cli) === 'error') issues.push(`lark-cli：${messageOf(result.cli)}`);
  if (stateOf(result.source) === 'error') issues.push(`AGENTS.md：${messageOf(result.source)}`);
  if (stateOf(result.auth) !== 'ok') issues.push(`账号登录：${messageOf(result.auth)}`);
  for (const resource of result.resources) {
    // The wiki node is optional: an unset one is the documented fallback, not a gap.
    if (stateOf(resource) !== 'ok' && !(resource.id === 'wiki' && stateOf(resource) === 'missing')) issues.push(`${String(resource.label)}：${messageOf(resource)}`);
  }
  return { checkedAt: result.checkedAt, issues };
}

/** What keeps the WeCom channel from being ready, from its stored check. */
export function wecomAccessReport(result: WecomDiagnostics | null): AccessReport {
  if (!result) return { checkedAt: null, issues: [] };
  // Each issue names what it is about, as the page lists them on their own.
  const issues: string[] = [];
  if (result.cli.state !== 'ok') issues.push(`wecom-cli：${result.cli.message}`);
  if (result.identity.state !== 'ok') issues.push(`机器人绑定与授权真人：${result.identity.message}`);
  const labels: Record<string, string> = { calendar: '日程', todo: '待办', push: '推送' };
  for (const service of result.services) {
    // Skipped services are off, and push has no read-only probe: neither is a gap.
    if (!['ok', 'skipped', 'unverified'].includes(service.state)) issues.push(`${labels[service.id] ?? service.id}：${service.message}`);
  }
  return { checkedAt: result.checkedAt, issues };
}

/** When a channel was checked, in the workspace's time zone and in each language. */
export function checkedAtNote(channel: 'feishu' | 'wecom', checkedAt: string, timeZone: string): LocalizedText {
  const at = (locale: string): string => new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false })
    .format(new Date(checkedAt));
  return channel === 'feishu' ? { en: `Feishu: checked at ${at('en-US')}`, zh: `飞书：检查于 ${at('zh-CN')}` } : { en: `WeCom: checked at ${at('en-US')}`, zh: `企业微信：检查于 ${at('zh-CN')}` };
}

/** Map the view to what the block shows. */
export function presentAccess(view: View): ConnectorAccountDisplay {
  const inspect: ConnectorAccountButton = { label: text('action.inspect'), command: { kind: 'start', operation: 'inspect' }, variant: 'primary' };
  if (view.operation) return { phase: 'checking', status: text('status.checking'), buttons: [], notes: [] };
  // The check's own diagnostics are in the panel; what it threw may carry credentials, so nothing of it is shown here.
  if (view.result?.outcome === 'failed') return { phase: 'unavailable', status: text('status.failed'), buttons: [inspect], notes: [], failure: { text: text('failure.inspect') } };
  const account = view.account;
  if (account.state === 'unbound') return { phase: 'unavailable', status: text('status.unbound'), buttons: [], notes: [], detail: text('detail.unbound') };
  const channels = ([[account.feishu, 'feishu'], [account.wecom, 'wecom']] as const).filter(([report]) => report !== null);
  // Nothing is switched on, so there is nothing a check could read.
  if (!channels.length) return { phase: 'disconnected', status: text('status.demo'), buttons: [], notes: [], detail: text('detail.unchecked') };
  const issues = channels.flatMap(([report]) => report!.issues);
  if (issues.length) return { phase: 'disconnected', badge: text('badge.attention'), status: text('status.attention', { count: String(issues.length) }), buttons: [inspect], notes: issues.map(issue => ({ text: issue })) };
  if (channels.some(([report]) => report!.checkedAt === null)) return { phase: 'disconnected', status: text('status.unchecked'), buttons: [inspect], notes: [], detail: text('detail.unchecked') };
  return {
    phase: 'connected', badge: text('badge.ready'), status: text('status.ready'), buttons: [inspect],
    notes: channels.map(([report, channel]) => ({ text: checkedAtNote(channel, report!.checkedAt!, account.timeZone) })),
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
    void this.execute(id);
    this.changed();
    return id;
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
      await this.runtime.accessCheck();
    } catch {
      outcome = 'failed';
    } finally {
      this.operation = undefined;
      this.result = { id, kind: 'inspect', outcome };
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
  const operations: readonly ConnectorAccountOperation<AccessOperation>[] = [{ kind: 'inspect', notice: text('notice.inspected') }];
  const copy: ConnectorAccountCopy = {
    title: text('title'), hint: text('hint'),
    activation: { title: text('activation.title'), body: text('activation.body'), connect: text('action.inspect') },
  };
  const withdraw = registry.register({ key: PACKAGE, packageName: PACKAGE, source, operations, copy, present: presentAccess });
  return () => { withdraw(); source.dispose(); };
}
