import z from '@deepseek-ai/schemastery';
import { PrototypeRuntime } from './runtime.js';

export const name = 'pa24-prototype';
export const inject = ['sessionController', 'sessions', 'connection', 'webServer', 'agentPresets'];
export const Config = z.object({
  mode: z.union(['demo', 'feishu']).default('demo'),
  larkProfile: z.string().default(''), ownerOpenId: z.string().default(''),
  folderToken: z.string().default(''), tasklistId: z.string().default(''),
  timeZone: z.string().default('Asia/Shanghai'), sessionPrefix: z.string().default('pa24-prototype'),
  appIdEnv: z.string().default('PA24_FEISHU_APP_ID'), appSecretEnv: z.string().default('PA24_FEISHU_APP_SECRET'),
  larkCliBin: z.string().default('lark-cli'),
  reminderTickMs: z.natural().min(250).default(1000), maxImageBytes: z.natural().min(1024).max(20971520).default(10485760),
  cliTimeoutMs: z.natural().min(1000).default(90000), modelTimeoutMs: z.natural().min(1000).default(180000),
  maxModelJobs: z.natural().min(1).max(5).default(2),
});
export function apply(ctx, config) {
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(config.sessionPrefix)) throw new Error('sessionPrefix 必须为 1–50 位字母、数字、下划线或连字符。');
  new Intl.DateTimeFormat('zh-CN', { timeZone: config.timeZone });
  if (config.mode === 'feishu') {
    for (const key of ['larkProfile','ownerOpenId','folderToken','tasklistId']) if (!config[key]) throw new Error(`真实飞书模式缺少 ${key}，请使用独立体验目录和清单。`);
    for (const key of [config.appIdEnv, config.appSecretEnv]) if (!process.env[key]) throw new Error(`缺少环境变量 ${key}；不要把密钥写入源码。`);
  }
  const runtime = new PrototypeRuntime(ctx, config);
  ctx.effect(() => ctx.reflect.provide('pa24Prototype', runtime));
  ctx.on('session/event', (session, event) => { void runtime.enqueue(() => runtime.onTurn(session, event)).catch(error => runtime.report(error)); });
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/24pa-prototype', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const respond = value => Response.json(value, { headers: { 'cache-control': 'no-store' } });
      try {
        const { endpoint, payload } = await request.json();
        if (endpoint === 'snapshot') return respond({ ok: true, value: runtime.snapshot() });
        if (endpoint === 'peek') return respond({ ok: true, value: await runtime.peek(payload?.session) });
        if (endpoint === 'action') return respond({ ok: true, value: await runtime.act(payload, 'human') });
        throw new Error('未知原型接口。');
      } catch (error) { return respond({ ok: false, error: { message: error.message } }); }
    },
  }));
  ctx.effect(() => { void runtime.start().catch(error => runtime.report(error)); return () => runtime.stop(); });
}
