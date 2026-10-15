import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

// Some terminal hosts run Electron as Node. The desktop must launch in app mode.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const child = spawn(electronPath, [fileURLToPath(new URL('../apps/desktop', import.meta.url))], {
  env, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => {
  process.stderr.write('Unable to launch Rovdo. Run npm ci and npm run build, then retry.\n');
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (child.exitCode === null) child.kill(signal); });
}
