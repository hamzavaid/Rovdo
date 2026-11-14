#!/usr/bin/env node
/**
 * Expand the compact LastRound AI source directory into Rovdo's strict
 * StarterDirectoryManifestSchema. No network access or API keys required.
 *
 * Source: https://github.com/fyrosofttech/lastroundai-hiring-data
 * License: CC BY 4.0. Attribution: LastRound AI.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = resolve(process.argv[2] || 'data/ats/lastroundai-ats-boards-2026-08.json');
const output = resolve(
  process.argv[3] || 'data/ats/lastroundai-starter-directory.generated.json',
);
const source = JSON.parse(readFileSync(input, 'utf8'));
if (
  source.format !== 'rovdo-ats-board-directory-1' ||
  !Array.isArray(source.rows) ||
  !Array.isArray(source.vendorLookup) ||
  source.rows.length !== 9935
) throw new Error('Invalid LastRound AI directory input');

const hosts = {
  greenhouse: 'https://job-boards.greenhouse.io/',
  lever: 'https://jobs.lever.co/',
  ashby: 'https://jobs.ashbyhq.com/',
};
const boardUrls = new Set();
const employerIds = new Set();
const counts = { greenhouse: 0, lever: 0, ashby: 0, unsupported: 0 };
const employers = source.rows.map((entry, index) => {
  if (!Array.isArray(entry) || entry.length !== 4) {
    throw new Error('Unexpected source row at index ' + index);
  }
  const [vendorIndex, name, slug, lastCrawled] = entry;
  const vendor = source.vendorLookup[vendorIndex];
  if (
    !Object.hasOwn(hosts, vendor) ||
    typeof name !== 'string' || !name.trim() || name.length > 500 ||
    typeof slug !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(slug) ||
    typeof lastCrawled !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(lastCrawled)
  ) throw new Error('Invalid source row at index ' + index);
  const lowerSlug = slug.toLowerCase();
  const id = 'lastroundai.' + vendor + '.' + lowerSlug;
  const canonical = vendor + ':' + lowerSlug;
  if (employerIds.has(id) || boardUrls.has(canonical)) {
    throw new Error('Duplicate ATS board: ' + canonical);
  }
  employerIds.add(id);
  boardUrls.add(canonical);
  const supported = /^[a-zA-Z0-9_-]{1,120}$/.test(slug);
  const url = hosts[vendor] + slug;
  counts[vendor]++;
  if (!supported) counts.unsupported++;
  return {
    id,
    name: name.trim(),
    aliases: [],
    categories: [],
    referenceSets: [{ id: 'broader', edition: source.source.sourceEdition }],
    boards: [{ url, adapter: supported ? vendor : 'unsupported' }],
    provenance: [{
      url: source.source.url,
      // Original source has date-only precision. Midnight UTC is a schema convention.
      checkedAt: lastCrawled + 'T00:00:00.000Z',
    }],
  };
});
employers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const manifest = {
  version: 1,
  releasedAt: '2026-11-14T00:00:00.000Z',
  employers,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\\n', 'utf8');
console.log(JSON.stringify({
  output, employers: employers.length, ...counts,
  warning: 'These are board candidates, not current jobs or fresh live validations.',
}, null, 2));
