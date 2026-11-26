// Where the vendor CLIs come from (#306). lark-cli and wecom-cli are supplied
// by the official connectors: @deepseek-ai/dsh-feishu installs @larksuite/cli,
// @deepseek-ai/dsh-wecom installs the @wecom/cli platform package. An explicit
// larkCliBin / wecomCliBin in the plugin row still wins, for stand-ins and
// self-managed directories. The lookup never falls back to PATH by itself: on
// a host line without the connector service (the rc line) the plugin entry
// names the bare executables, and a runtime built without either has no CLI.

import { accessSync, constants, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';

export type VendorCli = 'lark' | 'wecom';

/** What supplies a vendor CLI: the plugin row, an official connector, or PATH. */
export type CliSource = 'config' | 'official' | 'path';

/** How readiness names each source. The panel shows the same words in its `CLI_SOURCE`; a unit test keeps the two equal. */
export const CLI_SOURCE_LABELS: Record<CliSource, string> = { config: '插件行显式配置', official: '官方连接器提供', path: 'PATH 上的可执行文件' };

/** A vendor CLI that is configured or installed. */
export interface CliLocation {
  /** The executable: an absolute path, or a bare name that PATH resolves. */
  readonly path: string;
  readonly source: CliSource;
  /** The official connector that supplies the CLI, with its version when its manifest has one. */
  readonly connector?: string;
}

/** Whether this host line ships the official connectors: it provides the CLI account service they register with. */
export const hasOfficialConnectors = (host: { get(name: string): unknown }): boolean => !!host.get('cliAccounts');

/** Neither the plugin row nor an official connector supplies the CLI. */
export class CliUnavailableError extends Error {
  constructor(message: string, readonly cli: VendorCli) {
    super(message);
    this.name = 'CliUnavailableError';
  }
}

const OFFICIAL = {
  lark: { connector: '@deepseek-ai/dsh-feishu', cli: '@larksuite/cli', label: '飞书' },
  wecom: { connector: '@deepseek-ai/dsh-wecom', cli: '@wecom/cli', label: '企业微信' },
} as const;
const BARE = { lark: 'lark-cli', wecom: 'wecom-cli' } as const;
const OPTION = { lark: 'larkCliBin', wecom: 'wecomCliBin' } as const;

/** Resolves a package's `package.json` from `from` (by default this package), or null when it is not installed there. */
export type PackageResolver = (name: string, from?: string) => string | null;

/** Read on every lookup, so a row edited after the runtime was built is honoured. */
export interface VendorCliSettings {
  readonly lark?: string;
  readonly wecom?: string;
  /** Whether the host line ships the official connectors, i.e. provides the `cliAccounts` service; asked on each lookup, so a service that activates late is seen. */
  readonly officialConnectors: () => boolean;
  /** The profile this process runs, for the install command in a missing CLI's message. */
  readonly profile?: string;
  /** The profile's own package.json: where packages installed into the profile resolve from. Defaults to this package's location. */
  readonly anchor?: string;
  readonly resolvePackage?: PackageResolver;
}

export interface VendorCliDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  executable?: (path: string) => boolean;
}

const resolveInstalled: PackageResolver = (name, from) => {
  try {
    return createRequire(from ?? import.meta.url).resolve(`${name}/package.json`);
  } catch {
    return null;
  }
};
const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Whether an executable can run as it was given: a path is checked where it stands, a bare name on PATH. Nothing is started. */
export function runnableAsGiven(executable: string): boolean {
  const candidates = /[\\/]/.test(executable) ? [executable] : (process.env.PATH ?? '').split(delimiter).map(dir => join(dir, executable));
  return candidates.some(isExecutable);
}

/** The version in a package's manifest, when it has a readable one. */
function packageVersion(manifest: string): string | undefined {
  try {
    const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' && version ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Answers how each vendor CLI is supplied. Only the installed-layout lookup is cached; it cannot change while the process runs. */
export class VendorClis {
  private readonly installed = new Map<VendorCli, CliLocation | CliUnavailableError>();

  constructor(private readonly settings: VendorCliSettings, private readonly deps: VendorCliDeps = {}) {}

  /** Whether this host line ships the official connectors; asked of the host each time. */
  officialConnectors(): boolean { return this.settings.officialConnectors(); }

  /** How `cli` is supplied, or why it is not; never throws. */
  describe(cli: VendorCli): CliLocation | CliUnavailableError {
    const configured = cli === 'lark' ? this.settings.lark : this.settings.wecom;
    if (configured && /[\\/]/.test(configured)) return { path: configured, source: 'config' };
    if (!this.settings.officialConnectors()) {
      // A host line without the official connectors: the row's bare name, which PATH resolves when a process starts.
      if (configured) return { path: configured, source: 'path' };
      return new CliUnavailableError(`未设置 ${BARE[cli]}：请在24私助插件行设置 ${OPTION[cli]}。`, cli);
    }
    // Beside the official connectors a bare name could pick up any CLI on PATH, so an override must name a file.
    if (configured) {
      return new CliUnavailableError(`插件行配置的 ${BARE[cli]} 不是路径（${configured}）：提供官方连接器的宿主上，${OPTION[cli]} 只接受可执行文件的绝对路径；要用官方插件托管的 ${BARE[cli]}，请删除这一项。`, cli);
    }
    let found = this.installed.get(cli);
    if (!found) this.installed.set(cli, found = this.fromConnector(cli));
    return found;
  }

  /** The official connector packages installed in this profile, whatever supplies the CLIs; each with its version when its manifest has one. */
  connectors(): string[] {
    const resolvePackage = this.settings.resolvePackage ?? ((name: string, from?: string) => resolveInstalled(name, from ?? this.settings.anchor));
    return (['lark', 'wecom'] as const).flatMap(cli => {
      const name = OFFICIAL[cli].connector;
      const manifest = resolvePackage(name);
      if (!manifest) return [];
      const version = packageVersion(manifest);
      return [version ? `${name}@${version}` : name];
    });
  }

  /** The executable to run; throws {@link CliUnavailableError} when nothing supplies it. */
  get(cli: VendorCli): string {
    const answer = this.describe(cli);
    if (answer instanceof CliUnavailableError) throw answer;
    return answer.path;
  }

  /** The connector's own lookup: its CLI dependency from the connector's location. */
  private fromConnector(cli: VendorCli): CliLocation | CliUnavailableError {
    const official = OFFICIAL[cli], name = BARE[cli];
    const missing = (problem: string): CliUnavailableError => {
      const install = this.settings.profile ? `dsh plugin --profile ${this.settings.profile} add ${official.connector}` : `dsh plugin --profile <实例名> add ${official.connector}`;
      return new CliUnavailableError(`需要官方${official.label}插件提供的 ${name}：${problem}。请安装官方${official.label}插件后重启宿主：在宿主「插件」页安装，或执行 ${install}；也可在24私助插件行显式设置 ${OPTION[cli]}。`, cli);
    };
    // Packages installed into the profile resolve from the profile itself, wherever this plugin's own files live.
    const resolvePackage = this.settings.resolvePackage ?? ((name, from) => resolveInstalled(name, from ?? this.settings.anchor));
    const connector = resolvePackage(official.connector);
    if (!connector) return missing(`当前实例未安装官方${official.label}插件（${official.connector}）`);
    const cliPackage = resolvePackage(official.cli, connector);
    if (!cliPackage) return missing(`官方${official.label}插件缺少它托管的 ${official.cli} 包`);
    let binDir = join(dirname(cliPackage), 'bin');
    if (cli === 'wecom') {
      const platform = `${this.deps.platform ?? process.platform}-${this.deps.arch ?? process.arch}`;
      const platformPackage = resolvePackage(`@wecom/cli-${platform}`, cliPackage);
      if (!platformPackage) return missing(`官方企业微信插件的 @wecom/cli 没有 ${platform} 平台包`);
      binDir = join(dirname(platformPackage), 'bin');
    }
    const path = join(binDir, (this.deps.platform ?? process.platform) === 'win32' ? `${name}.exe` : name);
    if (!(this.deps.executable ?? isExecutable)(path)) return missing(`官方${official.label}插件托管的 ${name} 不可执行（${path}）；请重新安装该插件${cli === 'lark' ? '，并批准 @larksuite/cli 的安装脚本' : ''}`);
    const version = packageVersion(connector);
    return { path, source: 'official', connector: version ? `${official.connector}@${version}` : official.connector };
  }
}
