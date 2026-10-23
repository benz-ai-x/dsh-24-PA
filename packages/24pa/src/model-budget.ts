import { createHash } from 'node:crypto';
import { localDay, localInstant } from './calendar-time.js';

export interface ModelPrice {
  provider: string; model: string; inputPerMillion: number; outputPerMillion: number;
  cacheReadPerMillion?: number; cacheWritePerMillion?: number; basis: string;
}
export interface BudgetConfig {
  period: 'day' | 'month'; warningRatio: number; maxRequests: number | null; maxTokens: number | null;
  maxEstimatedCost: number | null; currency: 'CNY' | 'USD'; prices: ModelPrice[];
}
export const DEFAULT_BUDGET: BudgetConfig = { period: 'month', warningRatio: 0.8, maxRequests: null, maxTokens: null, maxEstimatedCost: null, currency: 'CNY', prices: [] };
export function validateBudget(raw: unknown): BudgetConfig {
  if (raw === undefined) return structuredClone(DEFAULT_BUDGET);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('budget 必须为预算配置对象。');
  const value = { ...DEFAULT_BUDGET, ...raw } as BudgetConfig;
  if (Object.keys(raw).some(key => !(key in DEFAULT_BUDGET)) || !['day','month'].includes(value.period) || !['CNY','USD'].includes(value.currency)) throw new Error('预算周期或币种无效。');
  if (!Number.isFinite(value.warningRatio) || value.warningRatio <= 0 || value.warningRatio >= 1) throw new Error('预算预警比例须大于 0 且小于 1。');
  for (const key of ['maxRequests','maxTokens','maxEstimatedCost'] as const) {
    const n = value[key];
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (key !== 'maxEstimatedCost' && !Number.isSafeInteger(n)))) throw new Error(`${key} 须为非负数或 null（不限）。`);
  }
  if (!Array.isArray(value.prices) || value.prices.length > 100) throw new Error('模型价格须为数组，最多 100 项。');
  const seen = new Set<string>();
  for (const price of value.prices) {
    if (!price || typeof price !== 'object' || Object.keys(price).some(key => !['provider','model','inputPerMillion','outputPerMillion','cacheReadPerMillion','cacheWritePerMillion','basis'].includes(key))) throw new Error('模型价格字段无效。');
    for (const key of ['provider','model','basis'] as const) if (typeof price[key] !== 'string' || !price[key].trim() || price[key].length > 1000) throw new Error('模型价格须填写 provider、model 和可核对的价格依据。');
    for (const key of ['inputPerMillion','outputPerMillion','cacheReadPerMillion','cacheWritePerMillion'] as const) if ((price[key] !== undefined || !key.startsWith('cache')) && (typeof price[key] !== 'number' || !Number.isFinite(price[key]) || price[key]! < 0)) throw new Error('模型价格须为非负的每百万 token 单价。');
    const key = JSON.stringify([price.provider, price.model]); if (seen.has(key)) throw new Error('同一模型价格不能重复。'); seen.add(key);
  }
  return structuredClone(value);
}
export interface BudgetUsage { inputTokens: number; outputTokens: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }
export function budgetUsage(raw: unknown): BudgetUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as BudgetUsage;
  for (const key of ['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'] as const) {
    if ((value[key] !== undefined || ['inputTokens','outputTokens'].includes(key)) && (!Number.isSafeInteger(value[key]) || value[key]! < 0)) return null;
  }
  if ((value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0) > value.inputTokens || (value.reasoningTokens ?? 0) > value.outputTokens) return null;
  return value;
}
export function estimateUsage(usage: BudgetUsage | null, price: ModelPrice | undefined): number | null {
  if (!usage || !price || (usage.cacheReadTokens && price.cacheReadPerMillion === undefined) || (usage.cacheWriteTokens && price.cacheWritePerMillion === undefined)) return null;
  return ((usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)) * price.inputPerMillion
    + usage.outputTokens * price.outputPerMillion + (usage.cacheReadTokens ?? 0) * (price.cacheReadPerMillion ?? 0)
    + (usage.cacheWriteTokens ?? 0) * (price.cacheWritePerMillion ?? 0)) / 1_000_000;
}
export function budgetPeriod(config: BudgetConfig, timeZone: string, now = new Date()) {
  const day = localDay(now, timeZone);
  if (config.period === 'day') return { from: day.from, to: day.to, timeZone };
  const [y, m] = day.date.split('-').map(Number);
  const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;
  return { from: localInstant(`${y}-${String(m).padStart(2, '0')}-01`, '00:00:00', timeZone), to: localInstant(next, '00:00:00', timeZone), timeZone };
}
export const budgetHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface BudgetMeasurement {
  proposed: { provider: string; model: string }; actual?: { provider: string; model: string };
  prices: ModelPrice[]; currency: string; usage?: BudgetUsage | null; estimate?: number | null; price?: ModelPrice;
  eventType?: string; interrupted?: boolean; at: string; settledAt?: string;
}
export function budgetSummary(records: BudgetMeasurement[], config: BudgetConfig) {
  const unknownUsage = records.filter(row => !row.usage).length;
  const unknownCost = records.filter(row => row.estimate == null || row.currency !== config.currency).length;
  const knownTokens = records.reduce((sum, row) => sum + (row.usage ? row.usage.totalTokens ?? row.usage.inputTokens + row.usage.outputTokens : 0), 0);
  const knownEstimatedCost = records.reduce((sum, row) => sum + (row.currency === config.currency ? row.estimate ?? 0 : 0), 0);
  const reasons: string[] = [], warnings: string[] = [];
  for (const [label, limit, amount, unknown] of [
    ['模型请求', config.maxRequests, records.length, 0], ['token', config.maxTokens, knownTokens, unknownUsage], ['估算费用', config.maxEstimatedCost, knownEstimatedCost, unknownCost],
  ] as const) {
    if (limit === null) continue;
    if (amount >= limit) reasons.push(`${label}已达到预算限额（${amount} / ${limit}）`);
    else if (unknown) reasons.push(`${label}有 ${unknown} 次未知用量或价格，不能证明仍在限额内`);
    else if (amount >= limit * config.warningRatio) warnings.push(`${label}已接近预算限额（${amount} / ${limit}）`);
  }
  return { requests: records.length, knownTokens, tokens: unknownUsage ? null : knownTokens, unknownUsage, unknownCost,
    knownEstimatedCost, estimatedCost: unknownCost ? null : knownEstimatedCost, currency: config.currency,
    pending: records.filter(row => !row.eventType).length, reasons, warnings, status: reasons.length ? 'blocked' : warnings.length ? 'warning' : 'ok' };
}
