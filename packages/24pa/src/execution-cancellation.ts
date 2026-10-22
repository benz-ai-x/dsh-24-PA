import { AsyncLocalStorage } from 'node:async_hooks';

// A deterministic template is an in-process execution. Its read adapters use
// this scope to stop outstanding CLI children and refuse later reads after
// cancellation, without changing the signal of unrelated workspace work.
const execution = new AsyncLocalStorage<AbortSignal>();
export function withExecutionSignal<T>(signal: AbortSignal, work: () => T): T { return execution.run(signal, work); }
export function executionSignal(): AbortSignal | undefined { return execution.getStore(); }
export function checkExecution(): void { execution.getStore()?.throwIfAborted(); }
