import { expect, it } from 'vitest';
import { parseGithubListings, GITHUB_LIST_CONTRACTS } from './global-adapters';
const fixtures = [
  '| Company | Role | Location | Application/Link |\n| Fixture | Engineer | Remote | [Apply](https://jobs.lever.co/enclosed/1) |\n| ↳ | Data Engineer | US | [Apply](https://jobs.lever.co/enclosed/2) |',
  '<table><tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th></tr><tr><td>Fixture</td><td>Engineer</td><td>Remote</td><td><a\nhref="https://jobs.lever.co/enclosed/1">Apply</a></td></tr><tr><td>&#8627;</td><td>Data Engineer</td><td>US</td><td><a href="https://jobs.lever.co/enclosed/2">Apply</a></td></tr></table>',
  '| Application | Location | Company | Role | Status |\n| [Apply](https://jobs.lever.co/enclosed/1) | Remote | Fixture | Engineer | Open |\n| [Apply](https://jobs.lever.co/enclosed/2) | US | ↳ | Data Engineer | Open |\n| [Apply](https://jobs.lever.co/enclosed/3) | US | Other | Engineer | Closed |',
  '<table><tr><th>Link</th><th>Location</th><th>Role</th><th>Company</th><th>Status</th></tr><tr><td><a href="https://jobs.lever.co/enclosed/1">Apply</a></td><td>US</td><td>Engineer</td><td>Fixture</td><td>Open</td></tr><tr><td><a href="https://jobs.lever.co/enclosed/2">Apply</a></td><td>US</td><td>Data Engineer</td><td>↳</td><td>Open</td></tr></table>',
];
it.each(Object.keys(GITHUB_LIST_CONTRACTS).map((id, i) => ({ id, text: fixtures[i]! })))(
  'parses the declared $id table contract with continuation provenance',
  ({ id, text }) => {
    const records = parseGithubListings(text, id);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.company)).toEqual(['Fixture', 'Fixture']);
    expect(records[1]!.companyEvidence).toBe('Fixture');
    expect(records[1]!.url).toContain('/2');
  },
);
it('does not invent an employer for an undocumented blank continuation', () => {
  const records = parseGithubListings(
    '| Fixture | Engineer | US | [Apply](https://jobs.lever.co/f/1) |\n| | Engineer | US | [Apply](https://jobs.lever.co/f/2) |',
  );
  expect(records[1]!.company).toBe(null);
});
