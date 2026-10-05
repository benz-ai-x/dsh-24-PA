// Prototype business actions; human review remains outside model tools.
import { randomUUID } from 'node:crypto';
import { createAfterScheduleRecord } from '@deepseek-ai/dsh-schedule';
import { transition } from './model.js';
import { hash } from './feishu.js';
export const text = (value, max = 12000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 字的内容。`);
  return value.trim();
};
export async function perform(runtime, action, actor) {
  const target = 'Lead', at = new Date().toISOString();
  if (runtime.gateway && !runtime.liveReady) throw new Error('飞书连接与身份校验尚未通过。');
  switch (action.type) {
        case 'task.add': {
          const id = randomUUID(), title = text(action.title, 500);
          const external = runtime.gateway ? await runtime.gateway.createTask(id, title) : null;
          runtime.change({ type: 'task.add', id, title, external, session: target }); break;
        }
        case 'task.complete': {
          const task = runtime.state.tasks.find(t => t.id === action.id); if (!task) throw new Error('任务不存在。');
          if (!task.done && task.external) await runtime.gateway.completeTask(task);
          runtime.change(action); break;
        }
        case 'memo.add': {
          const body = text(action.text);
          const external = runtime.gateway ? await runtime.gateway.createDocument('随手记', body) : null;
          runtime.change({ type: 'memo.add', id: randomUUID(), text: body, external }); break;
        }
        case 'reminder.add': {
          const body = text(action.text), id = randomUUID();
          const record = createAfterScheduleRecord(id, body, Number(action.seconds), Date.now(), body.slice(0, 100));
          runtime.change({ type: 'reminder.add', id, text: body, dueAt: Date.parse(record.scheduledAt), session: target }); break;
        }
        case 'reminder.cancel': runtime.change(action); break;
        case 'note.revise': {
          const n = runtime.findNote(action.id), body = text(action.text, 60000), version = n.version + 1;
          const external = await runtime.publishNote(n.id, version, body);
          runtime.change({ type: 'note.revise', id: n.id, text: body, hash: hash(body), external });
          const current = runtime.findNote(n.id), workId = [...runtime.jobs.values()].find(j => j.noteId === n.id)?.id;
          await runtime.notify(`${n.id} v${version} 整理完成，请重新审核。`, target, runtime.reviewCard(current, workId), workId); break;
        }
        case 'note.check': {
          const n = runtime.findNote(action.id);
          if (n.external) { try { await runtime.gateway.verify(n); } catch (e) { runtime.change({ type: 'note.unknown', id: n.id }); throw e; } }
          runtime.change({ type: 'note.verified', id: n.id }); break;
        }
        case 'note.approve': case 'note.reject': {
          const n = runtime.findNote(action.id);
          const next = transition(runtime.state, { ...action, at, actor, reviewer: runtime.config.ownerOpenId || 'dsh 操作者' });
          if (n.status === (action.type === 'note.approve' ? 'approved' : 'rejected') && n.review?.version === n.version && n.review?.decision === n.status) break;
          if (n.external) {
            try { next.notes.find(x => x.id === n.id).external = await runtime.gateway.markReview(n, action.type === 'note.approve'); }
            catch (e) { runtime.change({ type: 'note.unknown', id: n.id }); throw e; }
          }
          runtime.state = next; break;
        }
        case 'note.action': {
          const n = runtime.findNote(action.id), id = randomUUID(), title = text(action.title, 500);
          const next = transition(runtime.state, { ...action, actor, at, title, taskId: id });
          if (n.external) {
            try { await runtime.gateway.verify(n); } catch (e) { runtime.change({ type: 'note.unknown', id: n.id }); throw e; }
            next.tasks.at(-1).external = await runtime.gateway.createTask(id, title);
          }
          runtime.state = next; break;
        }
    default: throw new Error('不支持的业务操作。');
  }
  return runtime.state.lastChange;
}
