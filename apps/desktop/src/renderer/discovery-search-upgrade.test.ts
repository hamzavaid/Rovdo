import { expect, it } from 'vitest';
import type { DiscoveryOptions, JobSearch } from '@rovdo/shared';
import { discoveryOptionsForSearch } from './discovery-search';

const search: JobSearch = {
  query: 'Firmware engineer',
  company: 'Example Devices',
  workMode: 'remote',
  savedOnly: false,
  includeExcluded: false,
  location: 'Seattle',
  employmentType: 'internship',
  freshnessDays: 7,
};

it('keeps selected acquisition sources without passing result-view criteria to collection', () => {
  const fallback: DiscoveryOptions = { sourceIds: ['lever'], overrides: {} };
  const selected: DiscoveryOptions = { sourceIds: ['ashby', 'greenhouse'], overrides: {} };

  expect(discoveryOptionsForSearch({ ...search, discovery: selected }, fallback)).toEqual(selected);
  expect(selected).toEqual({ sourceIds: ['ashby', 'greenhouse'], overrides: {} });
});

it('uses fallback sources when no discovery selection exists and isolates subsequent searches', () => {
  const fallback: DiscoveryOptions = { sourceIds: ['himalayas', 'lever'], overrides: {} };

  const first = discoveryOptionsForSearch(search, fallback);
  const second = discoveryOptionsForSearch(
    { ...search, query: 'Rare museum conservator', location: 'Boston', workMode: 'onsite' },
    fallback,
  );

  expect(first).toEqual({ sourceIds: ['himalayas', 'lever'], overrides: {} });
  expect(second).toEqual(first);
  expect(fallback).toEqual({ sourceIds: ['himalayas', 'lever'], overrides: {} });
});

it('drops legacy global and per-source narrowing instead of silently losing niche opportunities', () => {
  const legacy: DiscoveryOptions = {
    sourceIds: ['lever', 'remotive'],
    filters: { keywords: 'software', location: 'London', workMode: 'remote' },
    overrides: {
      lever: { keywords: 'senior', location: 'London' },
      remotive: { employmentType: 'full-time', freshnessDays: 1 },
    },
  };

  expect(discoveryOptionsForSearch({ ...search, discovery: legacy }, legacy)).toEqual({
    sourceIds: ['lever', 'remotive'],
    overrides: {},
  });
  expect(legacy.filters?.location).toBe('London');
  expect(legacy.overrides.lever).toEqual({ keywords: 'senior', location: 'London' });
});
