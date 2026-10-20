/**
 * Shared navigation definitions and display-only formatting helpers.
 * Keep presentation rules independent of privileged services and stored candidate data.
 */
export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  if (value > 0 && value < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
export const navigation = [
  {
    label: 'Workspace',
    pages: [
      { id: 'overview', label: 'Overview' },
      { id: 'chat', label: 'Chat' },
      { id: 'browser', label: 'Browser' },
    ],
  },
  {
    label: 'Career',
    pages: [
      { id: 'jobs', label: 'Jobs' },
      { id: 'profile', label: 'Profile' },
    ],
  },
  { label: 'Settings', pages: [{ id: 'models', label: 'Models & Privacy' }] },
] as const;
export type WorkspacePage = (typeof navigation)[number]['pages'][number]['id'];
