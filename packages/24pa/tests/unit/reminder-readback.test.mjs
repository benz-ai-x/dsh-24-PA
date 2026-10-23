import { expect, it } from 'vitest';
import { ReminderRouter } from '../../lib/reminder-router.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';

it('企微到点提醒读回不是负零，真实工具输出可无损往返 JSON', async () => {
  const operations = { get: async () => null, calendarRemindersForWork: async () => [], begin: async value => ({ row: value }), update: async () => {} };
  const reminders = { getRule: async () => null, insertRule: async () => {} };
  const router = new ReminderRouter({ config: () => ({ ...DEFAULT_CONFIG, calendarChannel: 'wecom' }), repos: () => ({ operations, reminders }), ledger: () => { throw Error('unused'); },
    calendarWrite: async (_item, _kind, args) => ({ eventId: 'reminder-event', platformAccepted: true, verification: { state: 'verified', start: args.start, active: true, reminders: { is_remind: true, reminder_time: [0] } } }) });
  const result = await router.route({ id: 'work' }, { kind: 'once', text: '到点提醒', afterSeconds: 60 });
  expect(Object.is(result.reminderMinutes[0], -0)).toBe(false);
  expect(result.reminderMinutes).toEqual([0]); expect(result.reminderAt).toBe(result.start);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});
