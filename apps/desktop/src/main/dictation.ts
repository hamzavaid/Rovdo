/** Optional offline Windows speech recognition. No renderer microphone capability or remote fallback. */
import path from 'node:path';
import { DictationEventSchema } from '@rovdo/shared';
import type { DictationEvent } from '@rovdo/shared';
import { CliRuntime } from './cli-runtime';
// Static application code only: user text, paths and arguments are never interpolated.
const script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
try {
 Add-Type -AssemblyName System.Speech
 $engines=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
 if($engines.Count -eq 0){[Console]::WriteLine('{"state":"unavailable"}');exit 0}
 $engine=[System.Speech.Recognition.SpeechRecognitionEngine]::new($engines[0])
 $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
 $engine.SetInputToDefaultAudioDevice()
 $null=Register-ObjectEvent $engine SpeechRecognized -SourceIdentifier RovdoSpeech
 $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
 [Console]::WriteLine('{"state":"listening"}')
 while($true){
  $event=Wait-Event -SourceIdentifier RovdoSpeech -Timeout 1
  if($null -ne $event){
   $text=$event.SourceEventArgs.Result.Text
   if($text.Length -le 4000){[Console]::WriteLine((@{state='text';text=$text}|ConvertTo-Json -Compress))}
   Remove-Event -EventIdentifier $event.EventIdentifier
  }
 }
} catch {
 if($_.Exception.HResult -eq -2147024891){[Console]::WriteLine('{"state":"permission-denied"}')}
 else{[Console]::WriteLine('{"state":"unavailable"}')}
} finally {if($null -ne $engine){$engine.Dispose()}}
`;
export class DictationService {
  private active: {
    id: string;
    controller: AbortController;
    send: (event: DictationEvent) => void;
  } | null = null;
  private pending: Promise<void> | null = null;
  constructor(
    private readonly runtime = new CliRuntime(),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  get supported() {
    return this.platform === 'win32';
  }
  start(id: string, send: (event: DictationEvent) => void) {
    if (!this.supported) {
      send({ type: 'dictation', requestId: id, state: 'unavailable' });
      return;
    }
    if (this.active || this.pending) throw new Error('BUSY');
    const controller = new AbortController();
    this.active = { id, controller, send };
    send({ type: 'dictation', requestId: id, state: 'starting' });
    let pending = '';
    const launcher = {
      executable: path.win32.join(
        process.env.SYSTEMROOT ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      prefix: [],
    };
    this.pending = this.runtime
      .run(
        launcher,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        '',
        controller.signal,
        300000,
        (chunk) => {
          if (this.active?.id !== id || controller.signal.aborted) return;
          pending += chunk;
          if (pending.length > 16000) throw new Error('INVALID_RESPONSE');
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = DictationEventSchema.parse({
              ...JSON.parse(line),
              type: 'dictation',
              requestId: id,
            });
            send(event);
          }
        },
      )
      .then(
        () => {},
        () => {
          if (this.active?.id === id && !controller.signal.aborted)
            send({ type: 'dictation', requestId: id, state: 'failed' });
        },
      )
      .finally(() => {
        if (this.active?.id === id) {
          send({ type: 'dictation', requestId: id, state: 'stopped' });
          this.active = null;
        }
        this.pending = null;
      });
  }
  stop(id?: string) {
    if (this.active && (!id || this.active.id === id)) {
      const current = this.active;
      this.active = null;
      current.controller.abort();
      current.send({ type: 'dictation', requestId: current.id, state: 'stopped' });
    }
  }
  async shutdown() {
    this.stop();
    await this.pending;
    await this.runtime.shutdown();
  }
}
