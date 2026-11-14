# LastRound AI ATS directory for Rovdo

This directory has **9,935 employer ATS board records**, **not individual job postings**.

## Files

- `lastroundai-ats-boards-2026-08.json`: complete compact source data, preserving source company name, ATS vendor, board slug, and crawl date.
- `../../scripts/build-lastroundai-manifest.mjs`: offline generator for Rovdo's strict `StarterDirectoryManifestSchema`.
- `lastroundai-starter-directory.generated.json`: generated locally using the command below. Do not commit a generated file without review.

```bash
node scripts/build-lastroundai-manifest.mjs
```

The generator creates 9,935 employer entries using stable board-scoped IDs, one HTTPS board URL per record, dated provenance, and the `broader` reference-set category. It does not claim Fortune 500, Nasdaq-100, or Forbes Global 2000 membership. Vendor breakdown: Greenhouse 4,966, Ashby 2,856, Lever 2,113.

**Compatibility:** 31 source slugs contain periods and are not accepted by the current Rovdo `feedFromUrl` tenant matcher. The generated manifest retains them as `adapter: "unsupported"`, so they stay visible without being counted as collectible. These may become collectible after a separately tested parser change.

**Validation status:** source crawl dates are July 11 through August 1, 2026. A source crawl is not a current live verification, collection permission, or evidence of open postings. Validate boards at collection time using existing policy gates, rate limits, opt-outs, leases, and health tracking. The source only supplies calendar dates; manifest provenance timestamps use midnight UTC as an encoding convention. Installation should be performed in Rovdo's existing bounded batches and should not synchronously request thousands of boards at startup. Integration into the startup release choice is a separate code change.

## Attribution and license

Original dataset: [LastRound AI ATS Company Directory](https://github.com/fyrosofttech/lastroundai-hiring-data/tree/main/ats-directory)
Original source: [August 2026 CSV](https://github.com/fyrosofttech/lastroundai-hiring-data/blob/main/ats-directory/lastroundai-ats-company-directory-2026-08.csv)
Related study: [LastRound AI pay transparency study](https://lastroundai.com/blog/salary-transparency-study-2026)
License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Adaptation: JSON normalization and Rovdo manifest conversion added November 14, 2026. Source company names, board slugs, providers, and crawl dates are preserved.
