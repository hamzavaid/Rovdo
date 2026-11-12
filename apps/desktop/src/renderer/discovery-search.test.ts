import { expect, it } from 'vitest';
import { discoveryOptionsForSearch } from './discovery-search';
it('retains source selection independently of view criteria', () => {
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
  ).toEqual({ sourceIds: ['linkedin-jobs'], overrides: {} });
});
