// F29 interface-level tests for the handwriting pipeline: the module's own
// seam, no Host involved. Deep e2e coverage stays in f06/f07/f11–f13; these
// pin the contract edge cases that are cheapest to assert here.
import { describe, expect, it } from 'vitest';
import { HandwritingPipeline } from '../../lib/handwriting-pipeline.js';

const makeDeps = (repos) => ({
  repos: () => repos,
  config: () => { throw new Error('not needed'); },
  cli: () => ({ larkCliBin: 'lark-cli', cliTimeoutMs: 1000 }),
  workspace: () => null,
  transport: () => null,
  accessSessionId: () => null,
  notifyOwner: async () => {},
  assertLive: () => {},
  trackWorkItem: () => {},
  stagedOperation: async () => { throw new Error('not needed'); },
  failStaged: async () => {},
  roleFor: () => null,
  usage: { modelRequests: 0, notePagesInput: 0, noteCrops: 0 },
  dbRef: () => { throw new Error('not needed'); },
});

describe('F29：HandwritingPipeline 接口直测', () => {
  it('isImageFileMessage：仅图片扩展名的文件消息算原稿', () => {
    const hw = new HandwritingPipeline(makeDeps({}));
    expect(hw.isImageFileMessage({ messageType: 'file', fileName: 'note.JPEG' })).toBe(true);
    expect(hw.isImageFileMessage({ messageType: 'file', fileName: 'scan.png' })).toBe(true);
    expect(hw.isImageFileMessage({ messageType: 'file', fileName: 'doc.pdf' })).toBe(false);
    expect(hw.isImageFileMessage({ messageType: 'text', fileName: 'a.png' })).toBe(false);
    expect(hw.isImageFileMessage({ messageType: 'image' })).toBe(false);
  });

  it('publishNoteVersion：无已保存原稿页时拒绝发布（接口边界）', async () => {
    const hw = new HandwritingPipeline(makeDeps({
      notes: { pagesOf: async () => [] },
    }));
    await expect(hw.publishNoteVersion({ id: 'wip-x' }, { id: 'n1' }, null, null))
      .rejects.toThrow('这份笔记还没有已保存的原稿页。');
  });

  it('verifyNote：笔记不存在时报错，不静默成功', async () => {
    const hw = new HandwritingPipeline(makeDeps({
      notes: { getNote: async () => null },
    }));
    await expect(hw.verifyNote('n-missing')).rejects.toThrow('笔记不存在。');
  });
});
