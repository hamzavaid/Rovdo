import { DiagnosticEventSchema } from '@rovdo/shared';
export * from './browser';

export function createLogger(
  sink: (line: string) => void,
  now: () => Date = () => new Date(),
): (input: unknown) => void {
  return (input) => {
    const parsed = DiagnosticEventSchema.safeParse(input);
    const event = parsed.success ? parsed.data : {
      level: 'warn', event: 'diagnostics.rejected', component: 'agent-core',
    };
    sink(JSON.stringify({ timestamp: now().toISOString(), ...event }) + '\n');
  };
}
