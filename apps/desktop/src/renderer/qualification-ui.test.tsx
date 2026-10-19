import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QualificationFields, qualificationTitle } from './QualificationFields';
import { sampleCandidate } from '../../../../tests/fixtures/ranking-v2';
it('uses human labels and supports a custom skill without exposing record internals', () => {
 const item=sampleCandidate().intelligence!.skills[0]!;
 const html=renderToStaticMarkup(<QualificationFields section="skills" item={item} prefix="Edit skill" onChange={()=>{}} />);
 expect(html).toContain('Skill name');expect(html).toContain('Practice depth');expect(html).not.toContain('>skillId<');expect(html).not.toContain('evidenceIds');expect(qualificationTitle(item)).toBe('TypeScript');
});
