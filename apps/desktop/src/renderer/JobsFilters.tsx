/** One immediate, local-result filter surface; no source switches or network calls. */
import type { JobSearch } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
import { useState } from 'react';
export function JobsFilters({
  search,
  onChange,
  onClose,
  total,
  companySuggestions = [],
}: {
  search: JobSearch;
  onChange: (s: JobSearch) => void;
  onClose: () => void;
  total: number;
  companySuggestions?: string[];
}) {
  const [companyInput, setCompanyInput] = useState('');
  const set = (key: keyof JobSearch, value: unknown) =>
    onChange({ ...search, [key]: value, offset: 0 });
  const select = (key: keyof JobSearch, label: string, values: string[]) => (
    <label>
      {label}
      <select value={String(search[key] ?? 'all')} onChange={(e) => set(key, e.target.value)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v === 'all' ? 'Any' : v}
          </option>
        ))}
      </select>
    </label>
  );
  const number = (key: keyof JobSearch, label: string, min: number, max: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={String(search[key] ?? '')}
        onChange={(e) => {
          const next = { ...search, offset: 0 };
          if (e.target.value) Object.assign(next, { [key]: Number(e.target.value) });
          else delete next[key];
          onChange(next);
        }}
      />
    </label>
  );
  return (
    <ProfileDialog
      title="All Filters"
      closeLabel="Close search filters"
      className="filters-drawer jobs-v5-dialog"
      onClose={onClose}
    >
      <p className="help-text">
        Changes update your indexed results automatically. Collection sources are managed in Scope
        &amp; Collection.
      </p>
      <section className="filter-section">
        <h3>Focus</h3>
        <div className="jobs-chips">
          {[
            ['Remote', 'remote'],
            ['Embedded', 'embedded'],
            ['Robotics', 'robotics'],
            ['Semiconductor', 'semiconductor'],
            ['Aerospace', 'aerospace'],
          ].map(([label, value]) => (
            <button
              key={value}
              aria-pressed={
                value === 'remote'
                  ? search.workMode === 'remote'
                  : (search.focusTerms?.includes(
                      value as NonNullable<JobSearch['focusTerms']>[number],
                    ) ?? false)
              }
              onClick={() =>
                value === 'remote'
                  ? set('workMode', search.workMode === 'remote' ? 'all' : 'remote')
                  : set(
                      'focusTerms',
                      search.focusTerms?.includes(
                        value as NonNullable<JobSearch['focusTerms']>[number],
                      )
                        ? search.focusTerms.filter((t) => t !== value)
                        : [...(search.focusTerms ?? []), value],
                    )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="filter-section">
        <h3>Companies</h3>
        <div className="filter-company-picker">
          <div className="filter-company-entry">
            <label>
              Add company filter
              <input
                list="indexed-company-choices"
                value={companyInput}
                onChange={(e) => setCompanyInput(e.target.value)}
                maxLength={200}
                placeholder="Exact company name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (companyInput.trim() && (search.companies?.length ?? 0) < 100) {
                      set('companies', [
                        ...new Set([...(search.companies ?? []), companyInput.trim()]),
                      ]);
                      setCompanyInput('');
                    }
                  }
                }}
              />
            </label>
            <datalist id="indexed-company-choices">
              {[...new Set(companySuggestions)].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button
              disabled={!companyInput.trim() || (search.companies?.length ?? 0) >= 100}
              onClick={() => {
                set('companies', [...new Set([...(search.companies ?? []), companyInput.trim()])]);
                setCompanyInput('');
              }}
            >
              Add company
            </button>
          </div>
          <div className="jobs-chips">
            {search.companies?.map((c) => (
              <button
                key={c}
                onClick={() =>
                  set(
                    'companies',
                    search.companies?.filter((v) => v !== c),
                  )
                }
              >
                {c} ×
              </button>
            ))}
          </div>
        </div>
        <label>
          Company name
          <input
            placeholder="Any company"
            value={search.company}
            onChange={(e) => set('company', e.target.value)}
          />
        </label>
      </section>
      <section className="filter-section">
        <h3>Work &amp; posting</h3>
        <div className="career-fields">
          {select('workMode', 'Work arrangement', ['all', 'remote', 'hybrid', 'onsite'])}
          {select('experienceLevel', 'Experience level', [
            'all',
            'new-grad',
            'junior',
            'mid',
            'senior',
            'unknown',
          ])}
          <label>
            Posted within
            <select
              value={search.freshnessDays ?? ''}
              onChange={(e) =>
                set('freshnessDays', e.target.value ? Number(e.target.value) : undefined)
              }
            >
              <option value="">Any time</option>
              <option value="1">24 hours</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
            </select>
          </label>
        </div>
        <div className="filter-checks">
          <label>
            <input
              type="checkbox"
              checked={search.availability === 'verified'}
              onChange={(e) => set('availability', e.target.checked ? 'verified' : 'all')}
            />
            Verified posting only
          </label>
          <label>
            <input
              type="checkbox"
              checked={search.hideApplied ?? false}
              onChange={(e) => set('hideApplied', e.target.checked)}
            />
            Hide applied jobs
          </label>
          <label>
            <input
              type="checkbox"
              checked={search.includeExcluded}
              onChange={(e) =>
                onChange({
                  ...search,
                  includeExcluded: e.target.checked,
                  eligibility:
                    !e.target.checked && search.eligibility === 'fail' ? 'all' : search.eligibility,
                  offset: 0,
                })
              }
            />
            Show excluded
          </label>
        </div>
      </section>
      <details className="filter-extra">
        <summary>More criteria</summary>
        <div className="career-fields">
          {select('employmentType', 'Employment type', [
            'all',
            'full-time',
            'part-time',
            'contract',
            'internship',
            'temporary',
            'unknown',
          ])}
          {select('roleFamily', 'Technical role family', [
            'all',
            'software',
            'platform',
            'data-science',
            'embedded',
            'hardware',
            'robotics',
            'mechanical',
            'electrical',
            'civil',
            'manufacturing',
            'finance',
            'healthcare',
            'security',
            'unknown',
          ])}
          {select('season', 'Internship season', ['all', 'spring', 'summer', 'fall', 'winter'])}
          {number('graduationYear', 'Graduation eligibility year', 2000, 2100)}
          {number('minimumSalary', 'Minimum published annual salary', 0, 10000000)}
          <label>
            Salary filter currency
            <input
              maxLength={3}
              value={search.salaryCurrency ?? 'USD'}
              onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Eligibility constraint
            <select
              value={search.eligibility ?? 'all'}
              onChange={(e) =>
                onChange({
                  ...search,
                  eligibility: e.target.value as JobSearch['eligibility'],
                  includeExcluded: e.target.value === 'fail' ? true : search.includeExcluded,
                  offset: 0,
                })
              }
            >
              <option value="all">All outcomes</option>
              <option value="pass">Published checks passed</option>
              <option value="review">Needs review</option>
              <option value="fail">Explicit failure</option>
            </select>
          </label>
          {select('feedback', 'My relevance feedback', ['all', 'relevant', 'irrelevant'])}
          {select('availability', 'Posting verification', ['all', 'verified', 'unverified'])}
        </div>
      </details>
      <div className="dialog-actions">
        <button
          onClick={() =>
            onChange({
              query: search.query,
              location: search.location,
              employmentType: search.employmentType,
              company: '',
              workMode: 'all',
              savedOnly: search.savedOnly,
              includeExcluded: false,
              scope: search.scope,
              discovery: search.discovery,
              pageSize: search.pageSize,
              rankingId: search.rankingId,
              offset: 0,
            })
          }
        >
          Reset filters
        </button>
        <button className="primary-button" onClick={onClose}>
          Show {total} results
        </button>
      </div>
    </ProfileDialog>
  );
}
