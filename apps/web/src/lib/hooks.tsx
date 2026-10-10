import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { getDevice, getSession, isUnlocked, subscribe, unlock, UnlockError } from './device';
import { cosigner } from './api';
import { Button, Field, SecretInput, Spinner, Why } from '../components/ui';
import { tr } from './i18n';

let snapshot = { device: getDevice(), session: getSession(), unlocked: isUnlocked() };
subscribe(() => {
  snapshot = { device: getDevice(), session: getSession(), unlocked: isUnlocked() };
});

export function useLocal() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void load();
    const t = setInterval(() => alive && document.visibilityState !== 'hidden' && void load(), ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload: load };
}

/** Wallet data: cosigner client record + live on-chain state (balances read from Sepolia). */
export function useWalletData(ms = 8000) {
  const { device } = useLocal();
  const clientId = device?.clientId;
  return usePoll(
    async () => {
      if (!clientId) return null;
      const [client, onchain] = await Promise.all([cosigner.get(`/clients/${clientId}`), cosigner.get(`/clients/${clientId}/onchain`)]);
      return { client, onchain };
    },
    ms,
    [clientId],
  );
}

export interface WalletTxView {
  id: string;
  kind: 'receive' | 'send' | 'swap';
  status: 'detected' | 'pending' | 'confirmed' | 'failed';
  asset: 'USDC' | 'ETH';
  amount: string;
  from: string;
  to: string;
  counterpartyName?: string;
  txHash?: string;
  simulated?: boolean;
  source: string;
  note?: string;
  feesSponsored: boolean;
  createdAt: string;
  confirmedAt?: string;
  docId?: string;
  reference: string;
  explorer?: string;
  error?: string;
  /** Indicative CHF price captured at confirmation (absent → "CHF value unavailable" on receipts). */
  valuation?: { chf: number; asOf: string; provider: string };
}

export function useWalletTxs(ms = 4000) {
  const { device } = useLocal();
  const clientId = device?.clientId;
  return usePoll<WalletTxView[]>(async () => (clientId ? cosigner.get(`/clients/${clientId}/wallet-txs`) : []), ms, [clientId]);
}

/** Read / unread state for information items (per browser, best effort; shared by all components). */
const READ_KEY = 'mw:read';
let readSet: Set<string> = (() => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'));
  } catch {
    return new Set<string>();
  }
})();
const readListeners = new Set<() => void>();
export function markRead(id: string) {
  if (readSet.has(id)) return;
  readSet = new Set(readSet).add(id);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...readSet]));
  } catch {
    /* ignore */
  }
  readListeners.forEach((f) => f());
}
export function resetRead() {
  readSet = new Set();
  try {
    localStorage.removeItem(READ_KEY);
  } catch {
    /* ignore */
  }
  readListeners.forEach((f) => f());
}
export function useReadState() {
  const set = useSyncExternalStore(
    (f) => {
      readListeners.add(f);
      return () => readListeners.delete(f);
    },
    () => readSet,
  );
  return { isRead: (id: string) => set.has(id), mark: markRead };
}

// ── Unlock dialog (fallback when a signature is needed and the session was locked) ──
const UnlockCtx = createContext<() => Promise<void>>(async () => {});
export const useEnsureUnlocked = () => useContext(UnlockCtx);

export function UnlockProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const ensure = useCallback(
    () =>
      isUnlocked()
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            setErr('');
            setPw('');
            setPending({ resolve, reject });
          }),
    [],
  );

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await unlock(pw);
      pending?.resolve();
      setPending(null);
    } catch (e: any) {
      setErr(e instanceof UnlockError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <UnlockCtx.Provider value={ensure}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
          <form
            className="mw-toast w-full max-w-sm space-y-4 rounded-[12px] bg-white p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2 id="unlock-title" className="flex items-center gap-2 text-lg font-semibold">
              <Lock size={20} strokeWidth={1.75} /> {tr('Unlock My Wall', 'Déverrouiller My Wall')}
            </h2>
            <Why>
              {tr(
                'Your device key is encrypted on this device. Your password unlocks it for this session; it never leaves the device.',
                "Votre clé d'appareil est chiffrée sur cet appareil. Votre mot de passe la déverrouille pour cette session ; il ne quitte jamais l'appareil.",
              )}
            </Why>
            <Field label={tr('Wallet password', 'Mot de passe du wallet')} error={err || undefined}>
              <SecretInput autoFocus value={pw} onChange={setPw} autoComplete="current-password" />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  pending.reject(new Error(tr('Unlock cancelled', 'Déverrouillage annulé')));
                  setPending(null);
                }}
              >
                {tr('Cancel', 'Annuler')}
              </Button>
              <Button type="submit" disabled={!pw || busy}>
                {busy ? <Spinner /> : tr('Unlock', 'Déverrouiller')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </UnlockCtx.Provider>
  );
}
