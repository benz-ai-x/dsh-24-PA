import { describe, expect, it, vi } from 'vitest';
import { assertActiveSubagentTree, assertDirectChild, assertSubagentAccess, directChild } from '../../lib/subagent-access.js';

function fixture(catalog = [{ id: 'child' }]) {
  const root = { id: 'root' };
  const parent = { id: 'parent' };
  const agent = { id: 'child', session: { header: { origin: 'subagent', parentSession: { id: 'parent' } } } };
  const agents = new Map([['root', root], ['parent', parent], ['child', agent]]);
  const dispose = vi.fn();
  const observeSession = vi.fn(async () => ({ projections: { values: { subagentCatalog: catalog } }, [Symbol.dispose]: dispose }));
  const host = {
    get: name => name === 'sessionQuery' ? { observeSession } : name === 'agents' ? agents : null,
    subagents: { rootOf: vi.fn(() => root) },
  };
  return { host, root, parent, agent, agents, dispose, observeSession };
}

describe('rc.3 原生子会话归属', () => {
  it('通过持久 catalog 核验直接子级并释放 observation', async () => {
    const f = fixture();
    await expect(directChild(f.host, 'parent', 'child')).resolves.toBe(true);
    await expect(directChild(f.host, 'parent', 'other')).resolves.toBe(false);
    expect(f.observeSession).toHaveBeenCalledTimes(2);
    expect(f.dispose).toHaveBeenCalledTimes(2);
    await expect(assertDirectChild(f.host, 'parent', 'other')).rejects.toThrow('父子');
  });

  it('目录查询失败或 projection 缺失时失败关闭', async () => {
    const missing = { get: () => null, subagents: {} };
    await expect(directChild(missing, 'parent', 'child')).rejects.toThrow('目录查询能力');
    const f = fixture(null);
    await expect(directChild(f.host, 'parent', 'child')).rejects.toThrow('原生子会话目录');
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it('执行前同时要求精确活动树和持久直接父关系', async () => {
    const f = fixture();
    await expect(assertSubagentAccess(f.host, f.agent, 'parent')).resolves.toBeUndefined();
    expect(f.host.subagents.rootOf).toHaveBeenCalledWith(f.agent);
    await expect(assertSubagentAccess(f.host, f.agent, 'other')).rejects.toThrow('持久父会话');
    f.host.subagents.rootOf.mockImplementation(() => { throw new Error('inactive activation'); });
    await expect(assertSubagentAccess(f.host, f.agent, 'parent')).rejects.toThrow('inactive activation');
  });

  it('活动树必须匹配本次运行根，不能借用其他活跃树', async () => {
    const f = fixture();
    expect(() => assertActiveSubagentTree(f.host, f.agent, 'other-root')).toThrow('本次运行');
    await expect(assertSubagentAccess(f.host, f.agent, 'parent', 'other-root')).rejects.toThrow('本次运行');
    await expect(assertSubagentAccess(f.host, f.agent, 'parent', 'root')).resolves.toBeUndefined();
  });

  it('活动树根必须仍是注册表中的同一实例', () => {
    const f = fixture();
    expect(() => assertActiveSubagentTree(f.host, f.agent)).not.toThrow();
    f.agents.set('root', { id: 'root' });
    expect(() => assertActiveSubagentTree(f.host, f.agent)).toThrow(/失效/);
  });
});

import { agentRelayBody, canceledInputIds } from '../../lib/host-turn.js';
import { SkillRunHost } from '../../lib/skill-run-host.js';
import { SkillRuns } from '../../lib/skill-runs.js';

describe('Agent relay 消息信封兼容', () => {
  const payload = [{ type: 'text', text: '原输入' }];
  it.each(['Agent pa24-source sent a message: ', 'Agent lead sent a message: '])('接受新旧显示名并只比较消息体：%s', prefix => {
    const message = { content: [{ type: 'text', text: prefix }, ...payload], source: { kind: 'agent-message', senderSessionId: 'parent' } };
    expect(agentRelayBody(message, 'parent')).toEqual(payload);
  });
  it('发送者或信封前缀不符时拒绝', () => {
    expect(agentRelayBody({ content: [{ type: 'text', text: 'Agent lead sent a message: ' }, ...payload], source: { kind: 'agent-message', senderSessionId: 'other' } }, 'parent')).toBeNull();
    expect(agentRelayBody({ content: payload, source: { kind: 'agent-message', senderSessionId: 'parent' } }, 'parent')).toBeNull();
  });
});

describe('宿主中止与用户取消的证据分界', () => {
  const input = { id: 'original', content: [{ type: 'text', text: '原任务' }], source: { kind: 'user' } };
  const session = (reason, outcome) => ({ ownEvents: () => [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [input] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], ...(outcome ? { outcome } : {}) } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason } } },
  ] });
  it('dispose 与父树退休保留输入供恢复，user 仍显式取消', () => {
    expect(canceledInputIds(session({ kind: 'disposed' })).size).toBe(0);
    expect(canceledInputIds(session({ kind: 'parent' }), undefined, true).size).toBe(0);
    expect([...canceledInputIds(session({ kind: 'parent' }))]).toEqual(['original']);
    expect([...canceledInputIds(session({ kind: 'user' }))]).toEqual(['original']);
  });
  it('同回合显式队列取消不因宿主关闭而消失', () => {
    expect([...canceledInputIds(session({ kind: 'parent' }, 'canceled'), undefined, true)]).toEqual(['original']);
  });
  it('父关闭豁免只覆盖实际等待回合，不延续到后续取消', () => {
    const other = { ...input, id: 'resumed' };
    const consumed = (turn, message) => [
      { type: 'turn/start', data: { turn } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
      { type: 'turn/end', data: { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } } },
    ];
    const events = [...consumed(1, input), ...consumed(2, other)];
    expect([...canceledInputIds({ ownEvents: () => events }, undefined, turn => turn === 1)]).toEqual(['resumed']);
  });
  it('后续宿主关闭不能抵消更早回合的用户取消', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [input] } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'parent' } } } },
    ];
    expect([...canceledInputIds({ ownEvents: () => events })]).toEqual(['original']);
  });
  it('宿主按实际等待回合保留恢复，不依赖旧 waiting 快照', () => {
    const host = new SkillRunHost({}), run = { id: 'run', status: 'waiting', mode: 'business', source_session_id: 'parent' };
    const message = id => ({ id, content: [{ type: 'text', text: '[24PA skill run: run]' }], source: { kind: 'user' } });
    const turn = (turn, input) => [
      { type: 'turn/start', data: { turn } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [input] } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
      { type: 'turn/end', data: { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } } },
    ];
    const events = [...turn(1, message('original')), ...turn(2, message('resumed'))], session = { ownEvents: () => events };
    host.live.set(run.id, { session }); host.markWaiting(run.id);
    expect([...host.canceledInputs(run, session)]).toEqual(['original']);
    const restored = new SkillRunHost({}); restored.markWaiting(run.id, 1);
    expect([...restored.canceledInputs(run, session)]).toEqual(['resumed']);
  });
  it('冷挂载逐段恢复历史等待，而不是只保留最近一段', async () => {
    const run = { id: 'run', status: 'running', mode: 'local', session_id: 'run', workspace_path: '/workspace', snapshot: {} };
    const repos = {
      skillRuns: { bySession: async () => run, calls: async () => [] },
      runControls: { get: async () => ({ state: { blocks: [], waits: [{ start: 1, end: 2 }, { start: 3, end: 4 }] } }), resumes: async () => [] },
    };
    const runs = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages: {}, template: async () => '' });
    const host = new SkillRunHost({}); host.mount = async () => {}; runs.host = host;
    const waiting = vi.spyOn(host, 'markWaiting');
    const events = [1, 2, 3, 4].map(turn => ({ type: 'turn/start', time: turn, data: { turn } }));
    try {
      await runs.attach({ id: run.id, session: { id: run.id, header: { cwd: run.workspace_path }, ownEvents: () => events } });
      expect(waiting.mock.calls).toEqual([[run.id, 1], [run.id, 3]]);
    } finally { runs.dispose(); }
  });
});
