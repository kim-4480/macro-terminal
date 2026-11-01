import { mkdirSync } from 'node:fs';
import path from 'node:path';

// next dev/start 는 프로젝트 루트에서 실행된다.
export const ROOT = process.cwd();
export const CONFIG_DIR = path.join(ROOT, 'config');
export const DATA_DIR = path.join(ROOT, 'data');
export const REPORTS_DIR = path.join(ROOT, 'reports');
export const SCRIPTS_DIR = path.join(ROOT, 'scripts');

for (const dir of [DATA_DIR, REPORTS_DIR]) mkdirSync(dir, { recursive: true });
