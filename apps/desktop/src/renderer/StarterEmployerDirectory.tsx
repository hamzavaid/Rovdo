/** Paged factual directory; inclusion and adapter labels never claim live collection. */
import { useEffect, useState } from 'react';
import type { CareerViewSchema } from '@rovdo/shared';
import type { z } from 'zod';
import { Pager } from './JobsCollection';
import { dateLabel } from './jobs-state';
type Page = NonNullable<z.infer<typeof CareerViewSchema>['starterDirectoryPage']>;
export function StarterEmployerDirectory({ initial }: { initial: Page | undefined }) {
  const [page, setPage] = useState(initial),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      void window
        .rovdo!.careerCommand({ op: 'starterDirectoryPage', query: { query, offset } })
        .then((r) => {
          if (!stale && r.ok) {
            setPage(r.view.starterDirectoryPage);
            setError('');
          } else if (!stale) setError('Unable to load starter employers');
        })
        .catch(() => {
          if (!stale) setError('Unable to load starter employers');
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, offset, initial?.total]);
  return (
    <section className="surface-card" aria-labelledby="starter-directory-title">
      <h2 id="starter-directory-title">Starter employers</h2>
      <p>
        Reviewed employer metadata. The current starter subset does not include the full Fortune
        500, Nasdaq-100 and Forbes Global 2000 union.
      </p>
      <p>
        Directory inclusion, intended adapter, collection permission, and last successful live
        collection are separate. Check the live board inventory for current status.
      </p>
      <label>
        Search starter employers
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {page?.rows.map((e) => (
        <article className="company-directory-card" key={e.id}>
          <h3>{e.name}</h3>
          <p>{e.categories.join(', ')}</p>
          <p>{e.referenceSets.map((r) => `${r.id} (${r.edition})`).join(', ')}</p>
          {e.boards.map((b) => (
            <p key={b.url} className="company-source-url">
              {b.url} | Intended adapter: {b.adapter} |{' '}
              {['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(b.adapter)
                ? 'Live status in board inventory'
                : 'Coverage gap: no automatic collector for this board'}
            </p>
          ))}
          <p className="help-text">
            Metadata reviewed: {dateLabel(Date.parse(e.provenance[0]!.checkedAt))}
          </p>
        </article>
      ))}
      <Pager offset={offset} size={25} total={page?.total ?? 0} onChange={setOffset} />
    </section>
  );
}
