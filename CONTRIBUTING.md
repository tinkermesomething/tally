# Contributing

Tally's a small, self-hosted personal/household budget app. Bug reports, feature ideas, and pull requests are all welcome via [issues](https://github.com/tinkermesomething/tally/issues) and PRs on this repo.

## Development setup

```
npm install
npm run dev
```

Copy `.env.example` to `.env.local` first - see the comments in that file for what each value does. Before opening a PR:

```
npm run lint
npx tsc --noEmit
npm test
```

Database changes are hand-authored migrations (`drizzle/NNNN_*.sql` + a matching `drizzle/meta/NNNN_snapshot.json` and a `drizzle/meta/_journal.json` entry) - see any recent migration in that folder for the shape, and run `npx drizzle-kit check` + `npx drizzle-kit generate` before committing; `generate` should report "No schema changes, nothing to migrate" if the hand-written snapshot actually matches `lib/db/schema.ts`.

## Translations

Tally is being translated beyond English - Italian, French, Portuguese, German and Polish are set up so far, with more likely later. This is ongoing, ad-hoc work, not a finished effort - most of the app is still English-only. Help with any of the below is genuinely useful.

### How it works

- Every UI string lives in `messages/<locale>.json` (`en`, `it`, `fr`, `pt`, `de`, `pl`), grouped by a short namespace (e.g. `nav`, `userMenu`).
- `messages/en.json` is the source of truth - every key that exists anywhere exists there first.
- A locale file **doesn't need every key**. If a key is missing from, say, `messages/pl.json`, that string just shows in English instead of breaking or showing blank. This means a partial translation is always safe to submit - you don't have to translate the whole app in one PR.
- The language picker lives in Settings > Account. Switching it is the only way to actually see your change rendered.

### Improving an existing language

1. Open `messages/<locale>.json` and edit the value for whichever key reads wrong, or add a key that's currently missing (check `messages/en.json` for the full key list - anything present there and absent in your locale file is still showing in English).
2. Run `npm test` - `tests/messages.test.ts` checks every locale file parses and that every key it has is a real key in `en.json` (catches a typo'd key name, which next-intl can't fall back from the way it falls back from a genuinely missing one).
3. Start the app (`npm run dev`), switch to that language in Settings > Account, and look at the string in context before opening a PR - a phrase that's technically correct can still read oddly once it's sitting in a nav bar or a button.

If you're fixing a translation someone else added and you're not confident which reading is right, say so in the PR - a second opinion from another speaker of that language is worth more than a confident guess.

### Adding a language that isn't supported yet

1. Add the language's ISO 639-1 code to `SUPPORTED_LOCALES` in `lib/locales.ts`, and its name **in that language** (not English - "Italiano", not "Italian") to `LOCALE_LABELS` in the same file.
2. Create `messages/<code>.json`. It's fine to start with just the `nav` and `userMenu` namespaces translated (copy `messages/en.json`'s structure) and leave the rest - see "how it works" above.
3. Add the new `import("../messages/<code>.json")` entry to `MESSAGE_LOADERS` in `i18n/request.ts` - this has to be a literal, static import per locale (not a dynamic path built from a variable) or the bundler won't include the file in a production build at all; confirmed the hard way, don't change this back to a template-literal import.
4. Run `npm test` and `npx tsc --noEmit` - the new locale needs to show up cleanly in both.

### What's intentionally not translated (yet)

The architecture (`i18n/request.ts`, the per-user `locale` setting, `NextIntlClientProvider`) is in place for the whole app, but only the header nav and the account menu are actually translated right now - everything else (every page, dialog, button, error message) is still hardcoded English strings waiting to be migrated to `useTranslations()` (client components) or `getTranslations()` (server components), one file at a time. If you want to pick a page and translate it, that's exactly the kind of PR this needs - check an already-migrated file (`components/app-header.tsx` for a server component, `components/user-menu.tsx` for a client one) for the pattern first.
