# Contributing

Thanks for looking. This is an early project built for real shows, so the most useful contribution is a report of what broke at a rehearsal.

## Ways to help

- **Open an issue** with what you did, what you expected, what happened, and your browser. A screenshot helps. Use the templates.
- **Try it with your own set** and tell me which part of your workflow it does not cover.
- **Send a pull request** for a bug, a translation (the interface is Traditional Chinese now; English is the first roadmap item), a venue, or a lighting-file importer.

## Before a pull request

1. Open an issue first for anything bigger than a small fix, so we agree on the direction.
2. Keep it small and in one concern. No build step is a feature: plain files, no bundler, no framework.
3. Run the tests and attach the result:

```bash
npm install
npm run serve &
npm test
```

4. Do not add private data: no real show names, venue names with branding, people's names, passwords or personal media. The smoke test scans for leftovers.
5. Do not add media you do not own. Sample media has separate terms (see `NOTICE`).

## Licence of contributions

By sending a pull request you agree that your contribution is licensed under the MIT licence of this repository, and that you have the right to license it. Sign off your commits with `git commit -s` (Developer Certificate of Origin, https://developercertificate.org).

## Name and logo

The code is MIT. The name "Flowboard", "Mono Labs" and the logo are not part of that licence, see `TRADEMARKS.md`.
