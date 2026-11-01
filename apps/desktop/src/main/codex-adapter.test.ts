import { expect, it, vi } from 'vitest';
import { CodexCliAdapter, CliService } from './cli-service';
import { CliRuntime } from './cli-runtime';
import { SettingsStore } from '@rovdo/storage';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('runs a restricted fixture executable, preserves conversation roles and reports usage without invented streaming/costs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-codex-fixture-'));
  const script = join(root, 'codex.cjs');
  await writeFile(
    script,
    `if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0);}
if(!process.argv.includes('features.shell_tool=false')||!process.argv.includes('approval_policy="never"')||process.argv.includes('--dangerously-bypass-approvals-and-sandbox'))process.exit(9);
let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const c=JSON.parse(s).conversation;if(c.length!==2||c[0].role!=='assistant'||!c[1].content.includes('$()'))process.exit(8);
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
console.log(JSON.stringify({type:'turn.started'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'hello'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:2,cached_input_tokens:1}}));});`,
  );
  const runtime = new CliRuntime();
  const check = vi.fn(async () => {});
  const adapter = new CodexCliAdapter(
    runtime,
    { executable: process.execPath, prefix: [script] },
    '',
    5000,
    check,
  );
  try {
    const text: string[] = [];
    const result = await adapter.generate(
      {
        messages: [
          { role: 'assistant', content: 'prior' },
          { role: 'user', content: 'literal $() & ;' },
        ],
        tools: [],
      },
      new AbortController().signal,
      (s) => text.push(s),
    );
    expect(check).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      text: 'hello',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 2, source: 'reported' },
    });
    expect(text).toEqual(['hello']);
    expect(await adapter.capabilities()).toMatchObject({
      streaming: 'unknown',
      tools: 'unsupported',
      reportedUsage: 'supported',
    });
    expect(adapter.estimateCost()).toBe(null);
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['0.164.0', '0.165.1', '1.0.0'])('fails closed on unreviewed Codex %s', async (version) => {
  const store = new SettingsStore(':memory:');
  const run = vi.fn(async () => ({ stdout: `codex-cli ${version}\n`, stderr: '', exitCode: 0 }));
  const runtime = { run, shutdown: async () => {} } as unknown as CliRuntime;
  const service = new CliService(store, {
    runtime,
    find: async (id) => (id === 'codex' ? { executable: process.execPath, prefix: [] } : null),
  });
  try {
    await service.scan();
    expect(service.views().find((v) => v.id === 'codex')?.status).toBe('unsupported-version');
    await expect(service.adapter('codex')).rejects.toThrow('CLI_UNSUPPORTED');
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
  }
});

it('rejects changed versions, tools, private guidance and hostile output before releasing any text', async () => {
  const signal = new AbortController().signal;
  const req = { messages: [{ role: 'user' as const, content: 'hello' }], tools: [] };
  const run = vi.fn(
    async (
      _launcher: unknown,
      args: string[],
      _input: string,
      inner: AbortSignal,
      _timeout: number,
      onText?: (s: string) => void,
    ) => {
      if (args.includes('--version'))
        return { stdout: 'codex-cli 0.165.0', stderr: '', exitCode: 0 };
      onText?.(
        JSON.stringify({
          type: 'item.started',
          item: { type: 'command_execution', command: 'secret' },
        }) + '\n',
      );
      expect(inner.aborted).toBe(true);
      throw new Error('CANCELED');
    },
  );
  const runtime = { run } as unknown as CliRuntime;
  const launcher = { executable: process.execPath, prefix: [] };
  const text = vi.fn();
  await expect(
    new CodexCliAdapter(runtime, launcher, '', 5000, async () => {}).generate(req, signal, text),
  ).rejects.toThrow('CLI_ISOLATION_REQUIRED');
  expect(text).not.toHaveBeenCalled();
  run.mockClear();
  await expect(
    new CodexCliAdapter(runtime, launcher, '', 5000, async () => {
      throw new Error('CLI_ISOLATION_REQUIRED');
    }).generate(req, signal),
  ).rejects.toThrow('CLI_ISOLATION_REQUIRED');
  expect(run).not.toHaveBeenCalled();
  await expect(
    new CodexCliAdapter(runtime, launcher, '', 5000).generate({ ...req, tools: [{}] }, signal),
  ).rejects.toThrow('CLI_ISOLATION_REQUIRED');
  expect(run).not.toHaveBeenCalled();
  run.mockResolvedValue({ stdout: 'codex-cli 0.165.1', stderr: '', exitCode: 0 });
  await expect(
    new CodexCliAdapter(runtime, launcher, '', 5000, async () => {}).generate(req, signal),
  ).rejects.toThrow('CLI_UNSUPPORTED');
  expect(run).toHaveBeenCalledTimes(1);
});
