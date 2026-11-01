/** Main-only process boundary. No shell, no inherited secrets, no prompt argv or repository cwd. */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { CliIdSchema } from '@rovdo/shared';
import type { CliId } from '@rovdo/shared';

export type Launcher = { executable: string; prefix: string[] };
const packages: Record<CliId, string[]> = {
  codex: ['@openai/codex/bin/codex.js'],
  claude: ['@anthropic-ai/claude-code/cli.js'],
  gemini: ['@google/gemini-cli/bundle/gemini.js', '@google/gemini-cli/dist/index.js'],
  qwen: [
    '@qwen-code/qwen-code/scripts/cli-entry.js',
    '@qwen-code/qwen-code/cli.js',
    '@qwen-code/qwen-code/dist/index.js',
  ],
  ollama: [],
};
export function executableCandidates(
  id: CliId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  if (!CliIdSchema.safeParse(id).success) throw new Error('VALIDATION_ERROR');
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = (env.PATH ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .map((d) => d.replace(/^"|"$/g, ''))
    .filter((d) => p.isAbsolute(d));
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA)
      dirs.push(
        p.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'),
        p.join(env.LOCALAPPDATA, 'Programs', 'Ollama'),
      );
    dirs.push(p.join(home, '.local', 'bin'), p.join(home, 'scoop', 'shims'));
  } else
    dirs.push(
      p.join(home, '.local', 'bin'),
      p.join(home, '.npm-global', 'bin'),
      '/usr/local/bin',
      '/usr/bin',
      ...(platform === 'darwin'
        ? ['/opt/homebrew/bin', '/Applications/Ollama.app/Contents/Resources']
        : []),
    );
  return [...new Set(dirs)].flatMap((d) =>
    (platform === 'win32' ? [`${id}.exe`, `${id}.cmd`] : [id]).map((n) => p.join(d, n)),
  );
}
async function regular(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
export async function resolveLauncher(
  file: string,
  id: CliId,
  node = process.execPath,
): Promise<Launcher> {
  CliIdSchema.parse(id);
  if (!path.isAbsolute(file) || !(await regular(file))) throw new Error('CLI_NOT_INSTALLED');
  if (path.extname(file).toLowerCase() === '.cmd') {
    if (path.basename(file).toLowerCase() !== `${id}.cmd` || !packages[id].length)
      throw new Error('CLI_UNSUPPORTED');
    // Never execute batch wrappers. Resolve the fixed package entry relative to the npm shim.
    const root = await realpath(path.join(path.dirname(file), 'node_modules'));
    for (const relative of packages[id]) {
      const candidate = path.join(root, relative);
      if (!(await regular(candidate))) continue;
      const entry = await realpath(candidate);
      if (!entry.startsWith(root + path.sep)) throw new Error('CLI_UNSUPPORTED');
      return { executable: node, prefix: [entry] };
    }
    throw new Error('CLI_UNSUPPORTED');
  }
  await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  return { executable: await realpath(file), prefix: [] };
}
export async function findCli(id: CliId): Promise<Launcher | null> {
  for (const candidate of executableCandidates(id)) {
    try {
      return await resolveLauncher(candidate, id);
    } catch {
      /* Try the next known location; never run a wrapper to resolve it. */
    }
  }
  return null;
}
export function cliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (
      /^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|LC_ALL|XDG_CONFIG_HOME|XDG_DATA_HOME|DBUS_SESSION_BUS_ADDRESS)$/i.test(
        key,
      ) &&
      value !== undefined
    )
      env[key] = value;
  // Electron can safely act as Node for fixed npm entrypoints. No NODE_OPTIONS/preloads/API keys.
  env.ELECTRON_RUN_AS_NODE = '1';
  env.NO_COLOR = '1';
  env.CI = '1';
  return env;
}
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const root = process.env.SYSTEMROOT ?? 'C:\\Windows';
    const killer = spawn(
      path.join(root, 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore', env: cliEnvironment() },
    );
    killer.on('error', () => {
      child.kill();
    });
    killer.unref();
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
export class CliRuntime {
  private readonly active = new Map<ChildProcess, Promise<void>>();
  private stopped = false;
  get size() {
    return this.active.size;
  }
  async run(
    launcher: Launcher,
    args: string[],
    input: string,
    signal: AbortSignal,
    timeoutMs: number,
    onText?: (text: string) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (signal.aborted || this.stopped) throw new Error('CANCELED');
    if (this.active.size >= 2) throw new Error('BUSY');
    if (Buffer.byteLength(input) > 128000 || !path.isAbsolute(launcher.executable))
      throw new Error('VALIDATION_ERROR');
    const cwd = await mkdtemp(path.join(tmpdir(), 'rovdo-cli-'));
    try {
      if (signal.aborted || this.stopped) throw new Error('CANCELED');
      if (this.active.size >= 2) throw new Error('BUSY');
      return await new Promise((resolve, reject) => {
        const child = spawn(launcher.executable, [...launcher.prefix, ...args], {
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          cwd,
          env: cliEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let released!: () => void;
        const ended = new Promise<void>((r) => {
          released = r;
        });
        this.active.set(child, ended);
        const decoder = new StringDecoder('utf8');
        let stdout = '',
          stderr = '',
          bytes = 0;
        let failure: string | null = null;
        const stop = (code: string) => {
          if (failure) return;
          failure = code;
          killTree(child);
        };
        const abort = () => stop('CANCELED');
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          if (failure) return;
          bytes += chunk.length;
          if (bytes > 1_000_000) {
            stop('INVALID_RESPONSE');
            return;
          }
          const text = decoder.write(chunk);
          stdout += text;
          try {
            onText?.(text);
          } catch {
            stop('INVALID_RESPONSE');
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (failure) return;
          bytes += chunk.length;
          if (bytes > 1_000_000) {
            stop('INVALID_RESPONSE');
            return;
          }
          stderr += chunk.toString('utf8');
        });
        child.stdin.on('error', () => {});
        child.on('error', () => {
          failure ??= 'CLI_EXECUTION_FAILED';
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          this.active.delete(child);
          released();
          const tail = decoder.end();
          stdout += tail;
          if (tail && !failure) {
            try {
              onText?.(tail);
            } catch {
              failure = 'INVALID_RESPONSE';
            }
          }
          if (failure) reject(new Error(failure));
          else resolve({ stdout, stderr, exitCode: code ?? -1 });
        });
        if (signal.aborted) abort();
        else child.stdin.end(input, 'utf8');
      });
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  }
  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const child of this.active.keys()) killTree(child);
    await Promise.all(this.active.values());
  }
}
