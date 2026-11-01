import { briefingJobName, generateBriefing, listBriefings } from './briefing';
import { loadConfig } from './config';
import { llmStatus } from './llm';
import { generatePeriodic, periodicDue, type Period } from './periodic';
import { today } from './util';

/** 서버 시작 시 1회: 오늘 브리핑이 없고 모델이 켜져 있으면 백그라운드로 생성 */
export async function startupTasks(): Promise<void> {
  try {
    const { settings, portfolio } = loadConfig();
    let llm = await llmStatus(settings.llm);
    // 데스크톱 앱은 모델과 서버를 동시에 띄우므로, 모델이 다 뜰 때까지 잠시 기다린다
    if (!llm.online && process.env.MACRO_WAIT_FOR_LLM === '1') {
      const until = Date.now() + 180_000;
      while (!llm.online && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 3000));
        llm = await llmStatus(settings.llm);
      }
    }
    console.log(llm.online
      ? `[macro-terminal] LLM 연결됨 (${settings.llm.baseUrl})`
      : `[macro-terminal] LLM 오프라인 (${settings.llm.baseUrl}) — 번역·요약 없이 동작합니다. 설정(/setup)을 확인하세요.`);
    const lang = settings.language;
    if (settings.briefing.autoOnStartup && llm.online && !listBriefings(lang).some((f) => f.startsWith(today()))) {
      console.log(`[macro-terminal] 오늘 브리핑(${briefingJobName(lang)})을 백그라운드에서 생성합니다`);
      void generateBriefing(settings, portfolio, lang);
    }
    // 주간·월간은 일간 다음 차례로(로컬 모델은 한 번에 하나씩 처리)
    if (settings.briefing.periodicAutoOnStartup && llm.online) {
      for (const period of ['weekly', 'monthly'] as Period[]) {
        if (periodicDue(period, lang)) {
          console.log(`[macro-terminal] ${period} 브리핑을 백그라운드에서 생성합니다`);
          void generatePeriodic(period, settings, portfolio, lang);
        }
      }
    }
  } catch (err) {
    console.error('[macro-terminal] 시작 작업 실패:', err);
  }
}
