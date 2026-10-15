# GovDeals fixtures

`search-results.html`, `no-results.html` and `unrendered.html` are **modeled** on GovDeals'
rendered search page (Angular app, listing links of the form `/en/asset/<assetId>/<accountId>`).
They were written by hand because the build environment could not reach govdeals.com.

Replace or add a real capture before trusting the selectors:

```bash
node src/cli.js capture "https://www.govdeals.com/en/search?kWord=forklift" \
  --out test/fixtures/govdeals/live-forklift.html
node src/cli.js run govdeals --dry-run --fixture test/fixtures/govdeals/live-forklift.html
```

If the live run fails with "Selector or parse broke", update `src/jobs/govdeals/selectors.js`
(or override a selector under `jobs.govdeals.settings.selectors` in `config/jobs.yaml`) until the
dry run lists the listings you see in the browser, then add an assertion for the live fixture
to `test/govdeals.test.js`.
