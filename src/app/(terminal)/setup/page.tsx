import { SetupScreen } from '@/components/SetupScreen';
import { LangProvider } from '@/lib/i18n';
import { rawSettings } from '@/server/config';
import { DEFAULT_LANG } from '@/shared/languages';

export const dynamic = 'force-dynamic';

function initialLang(): string {
  try {
    return rawSettings().language;
  } catch {
    return DEFAULT_LANG;
  }
}

export default function Page() {
  return (
    <LangProvider initial={initialLang()}>
      <SetupScreen />
    </LangProvider>
  );
}
