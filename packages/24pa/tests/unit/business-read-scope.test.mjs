import { describe, expect, it, vi } from 'vitest';
import { captureBusinessReads, emptyBusinessReadScope, IncompleteReadScope, mergeBusinessReadScopes, recordBusinessSource, unverifiedBusinessRead } from '../../lib/business-read-scope.js';
import { TaskPlanAccess } from '../../lib/task-plan-access.js';
import { SourceTodo } from '../../lib/source-todo.js';
import { sourceObjectId } from '../../lib/repo/source-projection.js';

const target = (id, revision = 1) => ({ sourceId: 'proof', domain: 'todo', platform: 'feishu', identityKey: 'owner',
  resource: { kind: 'tasklist', id }, registrationRevision: revision, scopeHash: 'scope', connectionHash: 'connection' });

describe('业务读取范围', () => {
  it('合并时去重同一来源同一修订的条目；缺版本或不全的范围让合并结果不全', () => {
    const merged = mergeBusinessReadScopes({ version: 1, complete: true, targets: [target('a')] }, { version: 1, complete: true, targets: [target('a'), target('b')] });
    expect(merged).toEqual({ version: 1, complete: true, targets: [target('a'), target('b')] });
    expect(mergeBusinessReadScopes({ version: 1, complete: true, targets: [target('a')] }, { version: 1, complete: true, targets: [target('a', 2)] }).targets).toHaveLength(2);
    for (const scope of [null, undefined, { version: 1, complete: false, targets: [] }, { version: 2, complete: true, targets: [] }, { version: 1, complete: true }])
      expect(mergeBusinessReadScopes(emptyBusinessReadScope(), scope).complete).toBe(false);
  });
  it('捕获期间登记的来源随范围保存；捕获之外登记的无处可去', async () => {
    const saved = [];
    await captureBusinessReads(async () => { recordBusinessSource(target('a')); recordBusinessSource(target('a')); recordBusinessSource(target('b')); },
      async scope => { saved.push(scope); });
    expect(saved).toEqual([{ version: 1, complete: true, targets: [target('a'), target('b')] }]);
    recordBusinessSource(target('outside')); unverifiedBusinessRead();
    expect(saved[0]).toMatchObject({ version: 1, complete: true, targets: [target('a'), target('b')] });
  });
  it('工作抛错时仍保存已读的范围，并原样抛出工作的错误', async () => {
    const saved = [], failure = new Error('业务失败');
    await expect(captureBusinessReads(async () => { recordBusinessSource(target('a')); unverifiedBusinessRead(); throw failure; },
      async scope => { saved.push(scope); })).rejects.toBe(failure);
    expect(saved[0]).toMatchObject({ version: 1, complete: false }); expect(saved[0].targets).toEqual([target('a')]);
  });
  it('工作成功而保存失败时不放出结果；工作已失败时保存失败只记日志，不替换原错误', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(captureBusinessReads(async () => '结果', async () => { throw new Error('账本不可写'); })).rejects.toThrow('账本不可写');
      expect(warn).not.toHaveBeenCalled();
      const failure = new Error('业务失败');
      await expect(captureBusinessReads(async () => { throw failure; }, async () => { throw new Error('账本不可写'); })).rejects.toBe(failure);
      expect(warn).toHaveBeenCalledTimes(1); expect(String(warn.mock.calls[0][0])).toContain('账本不可写');
    } finally { warn.mockRestore(); }
  });
  it('读旧结果时，缺依据或不全的范围以 IncompleteReadScope 拒绝；齐全的逐项核对读取权限', async () => {
    const verify = vi.fn(), access = new TaskPlanAccess({ sources: { verify }, owner: async () => { throw new Error('不应解析投递身份'); } });
    for (const scope of [null, undefined, { version: 1, complete: false, targets: [] }, { version: 1, complete: true }])
      await expect(access.verifyReadScope(scope)).rejects.toBeInstanceOf(IncompleteReadScope);
    expect(verify).not.toHaveBeenCalled();
    await access.verifyReadScope({ version: 1, complete: true, targets: [target('a'), target('b')] });
    expect(verify.mock.calls.map(call => [call[0].resource.id, call[1], call[2]])).toEqual([['a', 'read', false], ['b', 'read', false]]);
    verify.mockRejectedValueOnce(new Error('读取权限已收回'));
    await expect(access.verifyReadScope({ version: 1, complete: true, targets: [target('a')] })).rejects.toThrow('读取权限已收回');
  });
  it('表里只要有一条待办没有来源回执，这一次读取的范围就不全；有回执的记下它的来源', async () => {
    const receiptFor = target => ({ status: 'succeeded', params: { sourceTarget: target },
      receipt: { guid: 'guid-1', channel: 'feishu', sourceTarget: target, objectId: sourceObjectId(target, 'guid-1') } });
    const todo = new SourceTodo({ operation: async id => (id === 'with-receipt' ? receiptFor(target('list')) : null), projection: () => ({ locations: async () => [] }) });
    const row = (id, guid) => ({ id, task_guid: guid, channel: 'feishu' });
    const scopeOf = async work => { let scope; await captureBusinessReads(work, async value => { scope = value; }); return scope; };
    expect(await scopeOf(() => todo.recordLocalReadScope([row('with-receipt', 'guid-1')]))).toEqual({ version: 1, complete: true, targets: [target('list')] });
    // The legacy row comes without a receipt: the scope cannot be verified whatever the others prove, and reading stops there.
    const mixed = await scopeOf(() => todo.recordLocalReadScope([row('with-receipt', 'guid-1'), row('legacy', 'guid-2'), row('with-receipt', 'guid-1')]));
    expect(mixed).toMatchObject({ version: 1, complete: false }); expect(mixed.targets).toEqual([target('list')]);
  });
});
