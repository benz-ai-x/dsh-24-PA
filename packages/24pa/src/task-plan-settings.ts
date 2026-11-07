import type { TaskPlanRow } from './repo/task-plan.js';
import { taskPlanTimeZone } from './task-plan.js';
import { taskPlanFingerprint } from './task-plan-access.js';
import { previewPlanTimes } from './plan-time.js';

export function planSettingsForm(row: TaskPlanRow, fallback: string) {
  const spec = row.schedule_spec;
  return { timeZone: taskPlanTimeZone(row, fallback), voice: row.voice,
    ...(spec.daily ? { time: spec.daily.time } : {}),
    ...(spec.weekly ? { time: spec.weekly.time, weekdays: spec.weekly.weekdays } : {}),
    ...(spec.at ? { at: spec.at } : {}) };
}

/** A narrow edit preserves Skill, targets, parameters and the owner's on/off
 * choice. Legacy rows stay legacy; the caller never synthesizes authorization. */
export function planSettings(row: TaskPlanRow, input: unknown, fallback: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请提供要修改的时间或语音设置。');
  const values = input as Record<string, unknown>;
  if (!Object.keys(values).length || Object.keys(values).some(key => !['time', 'timeZone', 'weekdays', 'at', 'voice'].includes(key))) throw new Error('此入口只调整时间、时区、每周日期和语音；其他配置请从原配置入口办理。');
  if (values.voice !== undefined && typeof values.voice !== 'boolean') throw new Error('语音选择须为开或关。');
  const spec = structuredClone(row.schedule_spec), timeZone = String(values.timeZone ?? taskPlanTimeZone(row, fallback));
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('时区无效。'); }
  if (values.time !== undefined) {
    if (!spec.daily && !spec.weekly) throw new Error('该计划不是每日或每周规则，请明确一次性日期或编辑完整配置。');
    const time = String(values.time); (spec.daily ?? spec.weekly).time = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  }
  if (values.weekdays !== undefined) {
    if (!spec.weekly) throw new Error('该计划不是每周规则。');
    spec.weekly.weekdays = values.weekdays;
  }
  if (values.at !== undefined) {
    if (!spec.at) throw new Error('该计划不是一次性规则。');
    spec.at = values.at;
  }
  if (values.timeZone !== undefined) (spec.daily ?? spec.weekly ?? spec.cron ?? spec).time_zone = timeZone;
  const timingChanged = taskPlanFingerprint(spec) !== taskPlanFingerprint(row.schedule_spec);
  // Completed one-offs can still change voice without inventing a future run.
  const nextTimes = timingChanged ? previewPlanTimes(spec).times : [];
  const voice = values.voice === undefined ? row.voice : values.voice;
  const configuration = row.task_config ? structuredClone(row.task_config) : null;
  if (configuration) {
    configuration.timeZone = timeZone; configuration.delivery.voice = voice;
    if (voice && configuration.delivery.channel !== 'feishu') throw new Error('语音版仅适用于飞书，并同时保留完整文本。');
  }
  const kind = row.kind === 'weekdays' && taskPlanFingerprint(spec.weekly?.weekdays) !== taskPlanFingerprint([1, 2, 3, 4, 5]) ? 'weekly' : row.kind;
  return { scheduleSpec: spec, kind, configuration, voice, timeZone, timingChanged, nextTimes };
}
