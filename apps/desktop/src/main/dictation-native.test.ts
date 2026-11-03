import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WINDOWS_DICTATION_SCRIPT } from './dictation';
it.runIf(process.platform === 'win32' && process.env.ROVDO_SPEECH_VERIFY === '1')(
  'transcribes controlled local synthesized speech through the production recognition event bridge',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovdo-speech-'));
    try {
      const file = join(root, 'speech.wav').replace(/'/g, "''");
      const generate = `Add-Type -AssemblyName System.Speech; $s=[System.Speech.Synthesis.SpeechSynthesizer]::new(); $s.SetOutputToWaveFile('${file}'); $s.Speak('Hello world. This is a test message.'); $s.Dispose();`;
      const script =
        generate +
        WINDOWS_DICTATION_SCRIPT.replace(
          '[RovdoSpeech]::Run($null)',
          `[RovdoSpeech]::Run('${file}')`,
        );
      const result = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { timeout: 45000, maxBuffer: 100000 },
      );
      const events = result.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as { state: string; text?: string });
      expect(
        events.some((e) => e.state === 'text' && /hello|world|test|message/i.test(e.text ?? '')),
      ).toBe(true);
      expect(events.some((e) => e.state === 'processing')).toBe(true);
      expect(
        events.some((e) => ['failed', 'unavailable', 'permission-denied'].includes(e.state)),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
