import { expect, it } from 'vitest';
import { discoveryOptionsForSearch } from './discovery-search';
it('uses the existing search fields without requesting separate JobSpy keywords', () => {
  expect(
    discoveryOptionsForSearch(
      {
        query: 'Firmware engineer',
        company: '',
        workMode: 'remote',
        savedOnly: false,
        includeExcluded: false,
        location: 'Los Angeles',
        employmentType: 'internship',
        freshnessDays: 7,
      },
      { sourceIds: ['linkedin-jobs'], overrides: {} },
    ),
  ).toMatchObject({
    filters: {
      keywords: 'Firmware engineer',
      location: 'Los Angeles',
      workMode: 'remote',
      employmentType: 'internship',
      freshnessDays: 7,
    },
  });
});
