import { DEFAULT_LANG } from '@/shared/languages';
import { Terminal } from '@/components/Terminal';
import { LangProvider } from '@/lib/i18n';
import { redirect } from 'next/navigation';
import { loadConfig } from '@/server/config';

export const dynamic = 'force-dynamic';


function appConfig(): { language: string; baseCurrency: string; setupDone: boolean } {
  try {
    return loadConfig().settings;
  } catch {
    return { language: DEFAULT_LANG, baseCurrency: 'USD', setupDone: true }; // 설정 오류는 상태 표시줄에서 안내
  }
}

export default function Page() {
  const { language, baseCurrency, setupDone } = appConfig();
  if (!setupDone) redirect('/setup');
  return (
    <LangProvider initial={language} currency={baseCurrency}>
      <Terminal />
    </LangProvider>
  );
}
