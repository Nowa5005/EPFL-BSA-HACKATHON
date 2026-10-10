import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getDevice, getSession, isUnlocked, subscribe, unlock } from './device';
import { cosigner } from './api';
import { Button, Field, inputCls, Spinner, Why } from '../components/ui';

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
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void load();
    const t = setInterval(() => alive && void load(), ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload: load };
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

// ── Unlock dialog (password decrypts the device key in memory) ──
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
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <UnlockCtx.Provider value={ensure}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/40 p-4 sm:items-center">
          <form
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2 className="text-lg font-semibold">Unlock your wallet</h2>
            <Why>Your device key is stored encrypted on this device. Your wallet password unlocks it for this session — it never leaves your device.</Why>
            <Field label="Wallet password">
              <input autoFocus type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {err && <p className="text-sm text-bad-600">{err}</p>}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  pending.reject(new Error('Unlock cancelled'));
                  setPending(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!pw || busy}>
                {busy ? (
                  <>
                    <Spinner /> Decrypting…
                  </>
                ) : (
                  'Unlock'
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </UnlockCtx.Provider>
  );
}
