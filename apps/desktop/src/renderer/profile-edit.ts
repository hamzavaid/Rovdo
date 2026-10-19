import type { Intelligence } from '@rovdo/shared';
export type QualificationSection = 'skills' | 'experience' | 'education' | 'projects' | 'certifications';
export function updateQualification(intelligence: Intelligence, section: QualificationSection, id: string, patch: Record<string, unknown>): Intelligence {
  return { ...intelligence, [section]: intelligence[section].map((item) => item.id === id ? { ...item, ...patch, id, evidenceIds: item.evidenceIds, verified: false } : item) };
}
export async function confirmQualification(intelligence: Intelligence, section: QualificationSection, id: string): Promise<Intelligence> {
  const item = intelligence[section].find((item) => item.id === id); if (!item) return intelligence;
  const excerpt = JSON.stringify({ userConfirmed: item, previousEvidenceIds: item.evidenceIds });
  if (excerpt.length > 4000) throw new Error('This record is too long to verify inline. Shorten it or review it through Imports.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(excerpt));
  const evidence = { id: crypto.randomUUID(), sourceId: `user:${id}`, sourceKind: 'user' as const, excerpt, sha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''), confidence: 1, verified: true };
  const previous = item.evidenceIds.filter((ref) => intelligence.evidence.find((e) => e.id === ref)?.verified);
  return { ...intelligence, evidence: [...intelligence.evidence, evidence], [section]: intelligence[section].map((record) => record.id === id ? { ...record, verified: true, evidenceIds: [...previous, evidence.id] } : record) };
}
