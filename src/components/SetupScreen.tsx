'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { LLM_PRESETS, presetFor } from '@/shared/llm-presets';
import { LangSwitch } from './LangSwitch';

interface SetupView {
  preset: 'global' | 'korea';
  baseCurrency: string;
  setupDone: boolean;
  background: boolean;
  llm: { provider: 'openai' | 'anthropic'; baseUrl: string; model: string; disableThinking: boolean; hasKey: boolean; keyFromEnv: boolean };
  hasEcosKey: boolean;
}

interface Probe {
  reason: 'ok' | 'unreachable' | 'auth' | 'error';
  models: string[];
  local: boolean;
  checks: Record<'chat' | 'json' | 'tools', string | null> | null;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY', 'HKD', 'TWD', 'CAD', 'AUD', 'CHF', 'INR', 'SGD'];
const PRESET_CURRENCY = { global: 'USD', korea: 'KRW' } as const;

const isLocal = (url: string) => {
  try {
    return /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(new URL(url).hostname);
  } catch {
    return true;
  }
};

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' }, body: JSON.stringify(body) });

/** 첫 실행 설정. 나중에도 /setup 에서 다시 열 수 있다 */
export function SetupScreen() {
  const { T, lang } = useLang();
  const S = T.setup;
  const [view, setView] = useState<SetupView | null>(null);
  const [kind, setKind] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [preset, setPreset] = useState<SetupView['preset']>('global');
  const [currency, setCurrency] = useState('USD');
  const [background, setBackground] = useState(true);
  const [ecos, setEcos] = useState('');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/setup').then((r) => r.json()).then((v: SetupView) => {
      setView(v);
      setKind(presetFor(v.llm.provider, v.llm.baseUrl).id);
      setBaseUrl(v.llm.baseUrl);
      setModel(v.setupDone ? v.llm.model : '');
      setPreset(v.preset);
      setCurrency(v.baseCurrency);
      setBackground(v.setupDone ? v.background : true);
    });
  }, []);

  if (!view) return null;

  const llmPreset = LLM_PRESETS.find((p) => p.id === kind)!;
  const remote = !!baseUrl && !isLocal(baseUrl);
  const llm = () => ({ provider: llmPreset.provider, baseUrl, model, apiKey, disableThinking: llmPreset.disableThinking ?? false });

  const chooseKind = (id: string) => {
    const p = LLM_PRESETS.find((x) => x.id === id)!;
    setKind(id);
    setBaseUrl(p.baseUrl);
    setModel(p.model ?? '');
    setApiKey('');
    setProbe(null);
    // 원격 API 는 기본으로 자동 호출을 끈다(요금)
    setBackground(!p.needsKey);
  };

  const choosePreset = (p: SetupView['preset']) => {
    setPreset(p);
    setCurrency(PRESET_CURRENCY[p]);
  };

  const test = async () => {
    setBusy('test');
    setError(null);
    setProbe(null);
    try {
      const res = await post('/api/setup/test', llm());
      const json = (await res.json()) as Probe & { error?: string };
      if (json.error) setError(json.error);
      else setProbe(json);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!model.trim()) { setError(S.needModel); return; }
    setBusy('save');
    setError(null);
    try {
      const res = await post('/api/setup', { language: lang, preset, baseCurrency: currency, background, ecosApiKey: ecos, llm: llm() });
      const json = (await res.json()) as { error?: string };
      if (json.error) setError(json.error);
      else window.location.href = '/';
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const line = (name: string, result: string | null) => (
    <li key={name} className={result ? 'bad' : 'ok'}>{result ? '✕' : '✓'} {name}{result ? `: ${result}` : ''}</li>
  );

  const canKeepKey = view.llm.provider === llmPreset.provider && view.llm.baseUrl === baseUrl;

  return (
    <main className="setup">
      <h1>{S.title}</h1>
      <p className="note">{S.intro}</p>

      <section>
        <h2>{S.language}</h2>
        <LangSwitch />
      </section>

      <section>
        <h2>{S.preset}</h2>
        <select aria-label={S.preset} value={preset} onChange={(e) => choosePreset(e.target.value as SetupView['preset'])}>
          <option value="global">{S.presetGlobal}</option>
          <option value="korea">{S.presetKorea}</option>
        </select>
        <p className="note">{S.presetNote}</p>
        <label>{S.currency}
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <p className="note">{S.currencyNote}</p>
        {preset === 'korea' ? <label>{S.ecos}<input type="password" autoComplete="off" value={ecos} placeholder={view.hasEcosKey ? S.apiKeyKept : ''} onChange={(e) => setEcos(e.target.value)} /></label> : null}
      </section>

      <section>
        <h2>{S.llm}</h2>
        <label>{S.kind}
          <select value={kind} onChange={(e) => chooseKind(e.target.value)}>
            {LLM_PRESETS.map((p) => <option key={p.id} value={p.id}>{S.kinds[p.id]}</option>)}
          </select>
        </label>
        <label>{S.baseUrl}<input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setProbe(null); }} /></label>
        {llmPreset.needsKey ? (
          <label>{S.apiKey}
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={view.llm.keyFromEnv ? S.apiKeyEnv : view.llm.hasKey && canKeepKey ? S.apiKeyKept : ''} />
          </label>
        ) : null}
        <label>{S.model}
          <input list="setup-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={S.modelHint} />
          <datalist id="setup-models">{probe?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <div className="row">
          <button type="button" className="setup-btn ghost" disabled={!!busy || !baseUrl} onClick={() => void test()}>{busy === 'test' ? S.testing : S.test}</button>
        </div>
        {probe?.reason === 'unreachable' || probe?.reason === 'error' ? <p className="bad">{S.testOffline}</p> : null}
        {probe?.reason === 'auth' ? <p className="bad">{S.testAuth}</p> : null}
        {probe?.reason === 'ok' && !probe.checks ? <p className="note">{S.modelHint}</p> : null}
        {probe?.checks ? <ul className="probe">{line(S.testChat, probe.checks.chat)}{line(S.testJson, probe.checks.json)}{line(S.testTools, probe.checks.tools)}</ul> : null}
        {remote ? <p className="warn">{S.privacy}</p> : null}
        <label className="check">
          <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
          <span>{S.background}<br /><span className="note">{S.backgroundNote}</span></span>
        </label>
      </section>

      {error ? <p className="bad">{error}</p> : null}
      <div className="row">
        <button type="button" className="setup-btn" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? S.saving : S.save}</button>
      </div>
    </main>
  );
}
