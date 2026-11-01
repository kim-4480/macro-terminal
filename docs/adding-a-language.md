# Adding a language

English and Korean ship by default. Any other language takes one command:

```bash
npm run lang:add -- ja 日本語 Japanese ja-JP
```

The arguments are the language code, its name in that language (shown in the dropdown), its English name (used to tell the model which language to write), and the locale for dates and numbers.

This creates `src/locales/ja.ts` and registers it in `src/locales/index.ts`. Restart the app and the language is in the dropdown.

What works right away, with nothing translated:

- **Model output:** briefings, news translation and summaries, coaching and agent answers are written in the new language. Prompts use the English text plus an instruction naming the language (`withLang` in `src/shared/languages.ts`).
- **Screen text:** falls back to English until you translate it.

To translate the screen, copy keys from the `en` block of `src/lib/strings.ts` (terminal) and `src/trade/strings.ts` (paper trading) into the `strings` and `trade` fields of your file. Any subset works; the rest stays English. `tsc` checks the key names.

Optional extras:

- **News in that language:** news searches run in English and Korean, then get translated. To search local news too, add an edition in `src/server/sources/news.ts`.
- **Country names on the map:** register the language in `src/lib/countries.ts` (`i18n-iso-countries/langs/<code>.json`).
- **Hand-written prompts:** if the English-plus-instruction output is not good enough, add a language to the prompt tables. Search for `Record<BaseLang` to find them.
