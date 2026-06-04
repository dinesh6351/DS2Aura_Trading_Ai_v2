'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { TradingMode } from '@platform/shared';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * 4-step onboarding (matches the brief): account → connect Binance → pick mode →
 * activate. Step 1 is done at registration; this drives steps 2-4.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(2);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<TradingMode>(TradingMode.BALANCED);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    try {
      const r = await api.post<{ warning?: string }>('/api/apikeys', { apiKey, secret });
      if (r.warning) setWarning(r.warning);
      setStep(3);
    } catch (e) { setError((e as Error).message); }
  }
  async function chooseMode() { await api.post('/api/bot/mode', { mode }); setStep(4); }
  async function activate() { await api.post('/api/bot/start'); router.push('/dashboard'); }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-bg">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="card w-full max-w-lg space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Set up your account</h1>
            <span className="text-sm text-muted">Step {step} of 4</span>
          </div>
          {/* progress */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${n <= step ? 'bg-accent' : 'bg-surface2'}`} />
            ))}
          </div>
        </div>

        {step === 2 && (
          <div className="space-y-3">
            <p className="label">Connect Binance Futures (trade-only, no withdrawals)</p>
            <input className="input" placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <input className="input" placeholder="Secret Key" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <p className="text-xs text-muted">Keys are validated against Binance then stored encrypted (AES-256). We never request withdrawal permission.</p>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button className="btn w-full" onClick={connect}>Validate &amp; connect</button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            {warning && (
              <p className="flex items-start gap-2 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {warning}</p>
            )}
            <p className="label">Choose your trading mode</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.values(TradingMode).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`p-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    mode === m ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:bg-surface2'
                  }`}>
                  {m.toLowerCase()}
                </button>
              ))}
            </div>
            <button className="btn w-full" onClick={chooseMode}>Continue</button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">You&apos;re ready. Activate the bot to start trading your account.</p>
            <button className="btn w-full" onClick={activate}>Activate bot <ArrowRight size={16} /></button>
          </div>
        )}
      </div>
    </main>
  );
}
