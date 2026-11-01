// 설정 화면의 모델 종류. 주소만 미리 채워 주는 것이고, 주소와 모델은 사용자가 바꿀 수 있다.
// 모델 이름은 서버마다 다르므로 연결 시험에서 받은 목록을 고르게 한다.

export interface LlmPreset {
  id: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model?: string;
  needsKey: boolean;
  disableThinking?: boolean;
}

export const LLM_PRESETS: readonly LlmPreset[] = [
  { id: 'ollama', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false },
  { id: 'llamacpp', provider: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', needsKey: false, disableThinking: true },
  { id: 'lmstudio', provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false },
  { id: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { id: 'anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', needsKey: true },
  { id: 'gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true },
  { id: 'openrouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'custom', provider: 'openai', baseUrl: '', needsKey: true },
];

export const presetFor = (provider: string, baseUrl: string): LlmPreset =>
  LLM_PRESETS.find((p) => p.provider === provider && p.baseUrl === baseUrl) ?? LLM_PRESETS.at(-1)!;
