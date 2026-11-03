/** Optional offline Windows speech recognition. No renderer microphone capability or remote fallback. */
import path from 'node:path';
import { DictationEventSchema } from '@rovdo/shared';
import type { DictationEvent } from '@rovdo/shared';
import { CliRuntime } from './cli-runtime';
// Static application code only: user text, paths and arguments are never interpolated.
export const WINDOWS_DICTATION_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Speech.Recognition;
using System.Threading;
public static class RovdoSpeech {
 static readonly object Gate = new object();
 static int segment;
 static void Emit(string state, string text = null) {
  lock(Gate) {
   string escaped = text == null ? "" : text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
   if(escaped.Length > 4000) return;
   Console.WriteLine("{\"state\":\""+state+"\",\"segment\":"+segment+(text==null ? "" : ",\"text\":\""+escaped+"\"")+"}");
   Console.Out.Flush();
  }
 }
 public static void Run(string wave) {
  try {
   var installed=SpeechRecognitionEngine.InstalledRecognizers();
   if(installed.Count==0) { Emit("unavailable"); return; }
   using(var engine=new SpeechRecognitionEngine(installed[0]))
   using(var done=new ManualResetEvent(false)) {
    engine.LoadGrammar(new DictationGrammar());
    engine.SpeechDetected += (sender,e) => Emit("processing");
    engine.SpeechHypothesized += (sender,e) => Emit("interim",e.Result.Text);
    engine.SpeechRecognized += (sender,e) => { lock(Gate) { Emit("text",e.Result.Text); segment++; } Emit("listening"); };
    engine.SpeechRecognitionRejected += (sender,e) => { lock(Gate) { segment++; } Emit("listening"); };
    engine.RecognizeCompleted += (sender,e) => { if(e.Error!=null) Emit("failed"); done.Set(); };
    if(wave==null) engine.SetInputToDefaultAudioDevice(); else engine.SetInputToWaveFile(wave);
    Emit("listening");
    engine.RecognizeAsync(RecognizeMode.Multiple);
    done.WaitOne(295000);
    engine.RecognizeAsyncCancel();
   }
  } catch(Exception error) {
   while(error.InnerException!=null) error=error.InnerException;
   Emit(error.HResult == -2147024891 ? "permission-denied" : "unavailable");
  }
 }
}
'@
[RovdoSpeech]::Run($null)
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
          Buffer.from(WINDOWS_DICTATION_SCRIPT, 'utf16le').toString('base64'),
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
        (result) => {
          if (result.exitCode !== 0 && this.active?.id === id && !controller.signal.aborted)
            send({ type: 'dictation', requestId: id, state: 'failed' });
        },
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
