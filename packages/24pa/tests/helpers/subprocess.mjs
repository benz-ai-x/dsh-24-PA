// A stand-in for the host's subprocess service, for the unit tests: the
// service's contract on top of node. Unit tests load no host, so the plugin
// entry never names the real one; this is installed for every test file
// (vitest setupFiles). Unlike the host, it hands a child this process's whole
// environment, since tests pass stand-ins what they need under ordinary
// names; it ends a process the way the local provider does.
import { spawn } from 'node:child_process';

/** `endsTerminated: false` makes a service that never ends a process it was told to, to try the gateway's own bound. */
export function subprocessDouble({ endsTerminated = true } = {}) {
  const specs = [];
  return {
    specs,
    spawn(spec) {
      specs.push(spec);
      const [program, ...args] = spec.argv;
      const grouped = process.platform !== 'win32';
      const child = spawn(program, args, { cwd: spec.cwd, detached: grouped, env: { ...process.env, ...spec.env },
        stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      const kill = name => { try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already exited. */ } };
      return {
        get stdin() { return child.stdin ?? undefined; },
        stdout: child.stdout,
        stderr: child.stderr,
        done: new Promise((resolve, reject) => {
          child.on('error', error => reject(error));
          child.on('close', (code, signal) => resolve({ exitCode: code, signal }));
        }),
        terminate() {
          if (!endsTerminated) return;
          kill('SIGTERM');
          setTimeout(() => kill('SIGKILL'), spec.graceMs).unref();
        },
        // True once no process of the group is left to signal, as the local provider reports its range empty.
        async waitForExit(signal) {
          for (;;) {
            try { process.kill(-child.pid, 0); } catch { return true; }
            if (signal?.aborted) return false;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        },
      };
    },
  };
}

/** The service every test file starts with. */
export const installedSubprocess = subprocessDouble();
