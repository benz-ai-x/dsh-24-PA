import { describe, expect, it } from 'vitest';
import { isDelegatedInputSource } from '../../lib/host-turn.js';

const relay = { kind: 'agent-message', form: 'relay', senderSessionId: 'parent' };
const owner = { kind: 'user', rpcId: 'rpc-1' };

describe('委派输入的来源判定', () => {
  it('起始输入认 0.2.3 起的父会话中继，也认升级前写入的 user 消息；续办输入只认父会话中继', () => {
    expect(isDelegatedInputSource(relay, 'start', 'parent')).toBe(true);
    expect(isDelegatedInputSource(owner, 'start', 'parent')).toBe(true);
    expect(isDelegatedInputSource(relay, 'followup', 'parent')).toBe(true);
    expect(isDelegatedInputSource(owner, 'followup', 'parent')).toBe(false);
  });

  it('其他会话、缺失发送方、无来源与其他来源都不构成委派输入', () => {
    expect(isDelegatedInputSource({ ...relay, senderSessionId: 'sibling' }, 'start', 'parent')).toBe(false);
    expect(isDelegatedInputSource({ ...relay, senderSessionId: 'sibling' }, 'followup', 'parent')).toBe(false);
    expect(isDelegatedInputSource({ kind: 'agent-message' }, 'start', 'parent')).toBe(false);
    expect(isDelegatedInputSource(undefined, 'start', 'parent')).toBe(false);
    expect(isDelegatedInputSource({ kind: 'schedule' }, 'start', 'parent')).toBe(false);
  });
});
