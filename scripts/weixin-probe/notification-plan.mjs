import { createHash } from 'node:crypto';
import { receipt } from './protocol.mjs';

export const NOTIFICATION_EXPERIMENT = 'notification-b-v1';
export const MAX_LATENESS_MS = 120_000;

// A finite experiment, not a product scheduler or a promise about platform limits.
export function notificationPlan(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 6) throw Error('two_to_six_steps_required');
  let previous = 0;
  const steps = input.map((step, index) => {
    if (!step || typeof step !== 'object' || Object.keys(step).some(key => !['afterMs', 'context'].includes(key)) ||
        !Number.isSafeInteger(step.afterMs) || step.afterMs < 60_000 || step.afterMs > 31 * 86400_000 ||
        step.afterMs - previous < 60_000 || !['original', 'omitted', 'invalid'].includes(step.context)) throw Error('invalid_notification_step');
    previous = step.afterMs;
    return { kind: `notification-${index + 1}`, afterMs: step.afterMs, context: step.context };
  });
  if (steps[0].context !== 'original' || steps.filter(step => step.context === 'original').length < 2) throw Error('two_original_context_steps_required');
  return steps;
}

export function notificationScope(run, steps) {
  return `${NOTIFICATION_EXPERIMENT}:${createHash('sha256').update(JSON.stringify([run, steps])).digest('hex')}`;
}

export function notificationReceipt(response) {
  const observed = receipt(response), data = response.data;
  if (observed.status === 'accepted') return { ...observed, basis: 'explicit_ret_zero' };
  // Independently record the response shape observed in the earlier real-account test.
  // Do not rewrite the historical Gate A unknown/manual-reconciliation records.
  if (observed.status === 'unknown' && response.http >= 200 && response.http < 300 && observed.nativeId &&
      data.ret === undefined && data.errcode === undefined && (data.errmsg === undefined || data.errmsg === '')) {
    return { ...observed, status: 'accepted', basis: 'observed_native_message_id_without_failure' };
  }
  return observed;
}

export function notificationAssessment(state, steps) {
  const observations = steps.map(step => {
    const item = state.deliveries.find(row => row.kind === step.kind);
    return { ...step, attempted: !!item, status: item?.status ?? 'not_attempted',
      elapsedMs: item?.elapsedMs ?? null, newInbound: item?.newInbound ?? null,
      ownerConfirmed: !!item && state.received[step.kind]?.clientId === item.clientId,
      onTime: !!item && item.elapsedMs >= step.afterMs && item.elapsedMs <= step.afterMs + MAX_LATENESS_MS };
  });
  return { decision: 'unverified', reviewRequired: true, stopReason: state.notificationStopReason ?? null, observations,
    completed: observations.every(row => row.attempted && row.status !== 'sending'),
    visibleOriginalContextSamples: observations.filter(row => row.context === 'original' && row.ownerConfirmed && row.onTime && row.newInbound === 0).length,
    limits: ['Observed intervals only; no automatic Gate B approval', 'No proven lifetime, quota or server idempotency',
      'An invalid test token is not evidence about naturally expired tokens', 'No product TaskPlan or real-business acceptance'] };
}
