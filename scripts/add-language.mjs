#!/usr/bin/env node
// 새 언어 추가: 번역 파일을 만들고 src/locales/index.ts 에 등록한다.
//   npm run lang:add -- ja 日本語 Japanese ja-JP
// 자세한 방법: docs/adding-a-language.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [code, name, englishName, locale] = process.argv.slice(2);
if (!code || !name || !englishName || !locale) {
  console.error('Usage: npm run lang:add -- <code> <native name> <English name> <locale>\nExample: npm run lang:add -- ja 日本語 Japanese ja-JP');
  process.exit(1);
}
if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(code)) {
  console.error(`Not a language code: ${code}`);
  process.exit(1);
}
const file = `src/locales/${code}.ts`;
if (existsSync(file) || code === 'en' || code === 'ko') {
  console.error(`${code} already exists`);
  process.exit(1);
}

const ident = code.replace(/-/g, '_');
const js = (s) => JSON.stringify(s);
writeFileSync(file, `import type { LocalePack } from './types';

// Anything left out here shows in English. Copy keys from the \`en\` block in
// src/lib/strings.ts (terminal) and src/trade/strings.ts (paper trading) and translate them.
export const ${ident}: LocalePack = {
  code: ${js(code)},
  name: ${js(name)},
  englishName: ${js(englishName)},
  locale: ${js(locale)},
  strings: {
    // cmdPlaceholder: '...',
    // views: { HOME: '...', ECO: '...' },
  },
  trade: {
    // tabs: { balance: '...' },
  },
};
`);

const index = 'src/locales/index.ts';
const src = readFileSync(index, 'utf8')
  .replace('// lang:add imports', `import { ${ident} } from './${code}';\n// lang:add imports`)
  .replace('  // lang:add packs', `  ${ident},\n  // lang:add packs`);
writeFileSync(index, src);
console.log(`Created ${file} and registered it. The language now appears in the dropdown; translate its strings in that file.`);
