// THROWAWAY PROTOTYPE. Pure state transitions; adapters supply ids, clocks and external results.
export const QUESTION = '飞书统一对接 Lead，专业 Worker 并行办理；在 dsh 工作区维护配置和结构化记忆。';
export function initialState(profile = 'default') {
  return {
    prototype: true, storage: 'memory', profile, active: 'Lead',
    sessions: [{ key: 'Lead', title: '24私助 · 飞书接入', realId: null, running: false, messages: [] }],
    tasks: [], memos: [], reminders: [], notes: [], notifications: [], audit: [],
    lastChange: '工作区原型已就绪。',
  };
}
export function transition(before, action) {
  const state = structuredClone(before);
  const session = () => {
    const found = state.sessions.find(x => x.key === (action.session || state.active));
    if (!found) throw new Error('Lead 会话不存在。');
    return found;
  };
  const note = () => {
    const found = state.notes.find(x => x.id === action.id);
    if (!found) throw new Error('笔记不存在，或原型已重启。');
    return found;
  };
  switch (action.type) {
    case 'session.bind': session().realId = action.realId; break;
    case 'session.message': {
      const target = session();
      target.messages.push({ role: action.role, text: action.text, at: action.at });
      target.messages = target.messages.slice(-30);
      state.lastChange = `${target.key} 收到${action.role === 'assistant' ? '工作结果' : '消息'}。`; break;
    }
    case 'session.running': session().running = action.running; break;
    case 'task.add':
      state.tasks.push({ id: action.id, title: action.title, done: false, session: action.session || state.active, external: action.external || null });
      state.lastChange = `已记录待办：${action.title}`; break;
    case 'task.complete': {
      const task = state.tasks.find(x => x.id === action.id);
      if (!task) throw new Error('任务不存在。');
      task.done = true; state.lastChange = `已完成：${task.title}`; break;
    }
    case 'memo.add':
      state.memos.push({ id: action.id, text: action.text, external: action.external || null });
      state.lastChange = '备忘已保存，可从原型中打开。'; break;
    case 'reminder.add':
      state.reminders.push({ id: action.id, text: action.text, at: action.dueAt, session: action.session || state.active, status: 'pending' });
      state.lastChange = '提醒已安排；本原型重启后提醒规则会清空。'; break;
    case 'reminder.cancel': {
      const reminder = state.reminders.find(x => x.id === action.id);
      if (!reminder) throw new Error('提醒不存在。');
      reminder.status = 'cancelled'; state.lastChange = '已取消该提醒。'; break;
    }
    case 'reminder.fire': {
      const reminder = state.reminders.find(x => x.id === action.id);
      if (!reminder || reminder.status !== 'pending') return before;
      reminder.status = 'triggered';
      state.notifications.push({ id: action.id, text: reminder.text, session: reminder.session, at: action.at });
      state.lastChange = `${reminder.session} 的提醒已到期。`; break;
    }
    case 'reminder.receipt': {
      const r = state.reminders.find(x => x.id === action.id);
      if (r) r.status = action.accepted ? 'sent' : 'unknown';
      state.lastChange = action.accepted ? '提醒已被投递通道接受；不代表本人已读。' : '提醒投递结果未确认，请核对后处理。'; break;
    }
    case 'note.create':
      state.notes.push({ id: action.id, title: action.title, session: action.session || state.active, text: action.text, version: 1, status: 'pending', hash: action.hash, reviewedVersion: null, review: null, external: action.external || null, original: action.original || null, actionsCreated: false });
      state.lastChange = '整理完成，请本人审核 v1。内容审核和创建任务是两个动作。'; break;
    case 'note.revise': {
      const n = note(); n.text = action.text; n.version += 1; n.hash = action.hash;
      n.status = 'pending'; n.external = action.external || null; n.actionsCreated = false;
      state.lastChange = `内容已变更为 v${n.version}，需要重新审核；旧记录只覆盖旧版本。`; break;
    }
    case 'note.approve': case 'note.reject': {
      const n = note();
      if (action.actor !== 'human') throw new Error('审核只能由本人操作，模型不能批准。');
      if (n.version !== action.version || n.hash !== action.hash) throw new Error('这是旧版本审核按钮。请打开当前版本再审核。');
      if (n.status === 'unknown') throw new Error('当前文档无法核验，暂不能审核。');
      n.status = action.type === 'note.approve' ? 'approved' : 'rejected';
      if (n.status === 'approved') n.reviewedVersion = n.version;
      n.review = { version: n.version, hash: n.hash, by: action.reviewer || '本人', at: action.at, decision: n.status };
      state.lastChange = n.status === 'approved' ? `本人已审核 v${n.version}；尚未授权执行行动项。` : `v${n.version} 已退回修改。`; break;
    }
    case 'note.unknown': note().status = 'unknown'; state.lastChange = '无法核验当前文档，请恢复连接后重新核对。'; break;
    case 'note.verified': {
      const n = note(); if (n.status === 'unknown') n.status = 'pending';
      state.lastChange = `已核对 ${n.id} v${n.version}；状态不确定后的版本需要本人再次确认。`; break;
    }
    case 'note.action': {
      const n = note();
      if (action.actor !== 'human' || !action.authorized) throw new Error('请单独选择并授权这项行动。');
      if (n.status !== 'approved' || n.reviewedVersion !== n.version || n.hash !== action.hash) throw new Error('当前版本尚未通过审核。');
      if (n.actionsCreated) throw new Error('本原型已执行该笔记的演示行动，请查看已有任务。');
      n.actionsCreated = true;
      state.tasks.push({ id: action.taskId, title: action.title, done: false, session: n.session, noteId: n.id, noteVersion: n.version, external: action.external || null });
      state.lastChange = `已按单独授权创建任务，来源 ${n.id} v${n.version}。`; break;
    }
    case 'notice': state.lastChange = action.text; break;
    default: throw new Error(`未支持的原型操作：${action.type}`);
  }
  state.audit.push({ type: action.type, at: action.at, message: state.lastChange });
  state.audit = state.audit.slice(-60);
  return state;
}
