/** Explicit country selection, shared by onboarding and persistent collection settings. */
import { useState } from 'react';
import { COLLECTION_COUNTRIES } from '@rovdo/shared';
import type { CareerCommand } from '@rovdo/shared';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export function CollectionCountries({
  initial = [],
  busy,
  command,
  onSaved,
}: {
  initial?: string[];
  busy: boolean;
  command: (c: CareerCommand, onSuccess?: () => void) => Promise<void>;
  onSaved?: () => void;
}) {
  const [countries, setCountries] = useState(initial);
  return (
    <div>
      <p>
        Collect every kind of role in these countries. Filter and rank your cached jobs separately.
      </p>
      <label>
        Collection countries
        <select
          multiple
          size={8}
          aria-label="Collection countries"
          value={countries}
          onChange={(e) => setCountries(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {COLLECTION_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {names.of(c)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !countries.length}
        onClick={() =>
          void command(
            { op: 'saveCollectionScope', scope: { version: 1, countries, origin: 'user' } },
            onSaved,
          )
        }
      >
        Save collection countries
      </button>
    </div>
  );
}
