/** Human preview only. Stored excerpts/hashes remain untouched and available in the original assertion disclosure. */
export function evidenceText(excerpt: string): string {
  try {
    const value: unknown = JSON.parse(excerpt);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return excerpt;
    const record = value as Record<string, unknown>;
    if (record.qualification && typeof record.reference === 'string') return record.reference;
    if (
      record.userConfirmed &&
      typeof record.userConfirmed === 'object' &&
      !Array.isArray(record.userConfirmed)
    ) {
      const names: Record<string, string> = {
        name: 'Name',
        skillId: 'Skill',
        displayName: 'Display name',
        version: 'Technology version',
        depth: 'Practice depth',
        proficiency: 'Proficiency',
        title: 'Job title',
        organization: 'Employer',
        institution: 'Institution',
        field: 'Field of study',
        level: 'Level',
        status: 'Degree status',
        graduation: 'Graduation date',
        description: 'Contribution',
        skills: 'Associated skills',
        start: 'Start date',
        end: 'End date',
        ongoing: 'Ongoing',
        issuer: 'Issuer',
        expires: 'Expiry date',
        production: 'Production use',
        url: 'Project link',
        coursework: 'Coursework',
      };
      const details = Object.entries(record.userConfirmed)
        .filter(([k, v]) => names[k] && v !== null && v !== '' && (!Array.isArray(v) || v.length))
        .map(([k, v]) => `${names[k]}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
      return details.length ? 'User-confirmed qualification: ' + details.join('; ') : excerpt;
    }
  } catch {
    /* Ordinary document excerpts are text, not internal assertion JSON. */
  }
  return excerpt;
}
