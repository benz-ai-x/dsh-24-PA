import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { weixinApiBase, type WeixinIdentity } from './weixin-protocol.js';

export interface WeixinCredentials extends WeixinIdentity { base: string; token: string; context?: string }
interface Vault { version: 1; bindings: Record<string, WeixinCredentials> }
const matches = (a: WeixinIdentity, b: WeixinIdentity) => a.generation === b.generation && a.accountId === b.accountId && a.ownerId === b.ownerId && a.sessionId === b.sessionId;
const writes = new Map<string, Promise<unknown>>();

/** Never part of the business ledger, model input or backup. File policy also
 * excludes atomic temporary files because they retain the secrets.json prefix. */
export class WeixinCredentialVault {
  private readonly path: string;
  constructor(workspacePath: string) { this.path = join(workspacePath, '.24pa', 'weixin', 'secrets.json'); }
  private async read(): Promise<Vault> {
    try {
      const value: Vault = JSON.parse(await readFile(this.path, 'utf8'));
      if (value.version !== 1 || !value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) throw new Error();
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, bindings: {} };
      throw new Error('微信凭据库无法读取，请在电脑端核对或重新登录。');
    }
  }
  async get(identity: WeixinIdentity): Promise<WeixinCredentials | null> {
    await writes.get(this.path);
    const entry = (await this.read()).bindings[identity.generation];
    if (!entry) return null;
    if (!matches(identity, entry) || typeof entry.token !== 'string' || !entry.token) throw new Error('微信凭据与原绑定身份不一致。');
    weixinApiBase(entry.base);
    return entry;
  }
  async save(credentials: WeixinCredentials): Promise<void> {
    weixinApiBase(credentials.base);
    if (!credentials.token) throw new Error('微信凭据缺失。');
    await this.change(vault => {
      const prior = vault.bindings[credentials.generation];
      if (prior && !matches(prior, credentials)) throw new Error('不能覆盖其他微信身份的凭据。');
      vault.bindings[credentials.generation] = { generation: credentials.generation, accountId: credentials.accountId,
        ownerId: credentials.ownerId, sessionId: credentials.sessionId, token: credentials.token, base: credentials.base,
        ...(credentials.context || prior?.context ? { context: credentials.context ?? prior?.context } : {}) };
    });
  }
  async context(identity: WeixinIdentity, token: string): Promise<void> {
    if (!token) return;
    await this.change(vault => {
      const entry = vault.bindings[identity.generation];
      if (!entry || !matches(entry, identity)) throw new Error('回复上下文与微信绑定不符。');
      entry.context = token;
    });
  }
  async forget(identity: WeixinIdentity): Promise<void> {
    await this.change(vault => { const entry = vault.bindings[identity.generation]; if (entry && matches(entry, identity)) delete vault.bindings[identity.generation]; });
  }
  private change(update: (vault: Vault) => void): Promise<void> {
    const run = (writes.get(this.path) ?? Promise.resolve()).then(async () => {
      const vault = await this.read(); update(vault);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.path), 0o700);
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(tmp, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(vault)); await file.sync(); } finally { await file.close(); }
        await rename(tmp, this.path);
        const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      } finally { await rm(tmp, { force: true }); }
    });
    const settled = run.catch(() => {});
    writes.set(this.path, settled);
    void settled.then(() => { if (writes.get(this.path) === settled) writes.delete(this.path); });
    return run;
  }
}
