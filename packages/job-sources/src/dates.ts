/** Source timestamps are data. Reject rollover/local-time ambiguity instead of inventing posting dates. */
import { PartialDateSchema } from '@rovdo/shared';
export function postingTimestamp(
  value: unknown,
  unit: 'seconds' | 'milliseconds' = 'milliseconds',
): string | null {
  let timestamp: number;
  if (typeof value === 'number') timestamp = value * (unit === 'seconds' ? 1000 : 1);
  else if (typeof value === 'string') {
    const input = value.trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input);
    if (date) {
      if (!PartialDateSchema.safeParse(input).success) return null;
      timestamp = Date.parse(input + 'T00:00:00Z');
    } else if (
      /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
        input,
      )
    ) {
      if (!PartialDateSchema.safeParse(input.slice(0, 10)).success) return null;
      timestamp = Date.parse(input);
    } else {
      const rfc =
        /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-]\d{4})$/i.exec(
          input,
        );
      if (!rfc) return null;
      const month =
        [
          'jan',
          'feb',
          'mar',
          'apr',
          'may',
          'jun',
          'jul',
          'aug',
          'sep',
          'oct',
          'nov',
          'dec',
        ].indexOf(rfc[2]!.toLowerCase()) + 1;
      if (
        !PartialDateSchema.safeParse(
          `${rfc[3]}-${String(month).padStart(2, '0')}-${rfc[1]!.padStart(2, '0')}`,
        ).success
      )
        return null;
      timestamp = Date.parse(input);
    }
  } else return null;
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() >= 1 &&
    parsed.getUTCFullYear() <= 9999
    ? parsed.toISOString()
    : null;
}
