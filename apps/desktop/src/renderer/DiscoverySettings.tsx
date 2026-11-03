/** Supported public discovery needs no interpreter, endpoint or credentials. */
export function DiscoverySettings() {
  return (
    <section className="settings-page">
      <header className="page-heading">
        <h1>Discovery &amp; imports</h1>
      </header>
      <section className="surface-card">
        <h2>Automatic public discovery</h2>
        <p>
          Search All uses supported employer feeds, public job lists and keyless archive indexes.
          Validated companies are cached locally and reused across searches.
        </p>
        <p>
          Source selection and collection health are available in Jobs. No Python, search endpoint
          or API key is required. Robots restrictions, TLS checks, rate limits and browser
          protections remain enforced.
        </p>
        <p>Personal profiles and transcripts can be imported locally under Profile &gt; Imports.</p>
      </section>
    </section>
  );
}
