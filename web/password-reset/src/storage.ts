// Identifies blocked browser storage without exposing any stored values.
export class RecoveryStorageError extends Error {
  constructor() { super('Browser storage is unavailable.'); this.name = 'RecoveryStorageError'; }
}

// Persists only short-lived PKCE verifiers so an email can reopen the same browser.
export function recoveryStorage(local: Storage) {
  const probe = `herenow-reset-check-${Math.random().toString(36).slice(2)}`;
  try {
    local.setItem(probe, 'available');
    const available = local.getItem(probe) === 'available';
    local.removeItem(probe);
    if (!available) throw new RecoveryStorageError();
  } catch { throw new RecoveryStorageError(); }
  const memory = new Map<string, string>();

  // Session access/refresh tokens never leave this page's memory.
  function isVerifier(key: string) { return key.startsWith('herenow-reset-') && key.endsWith('-code-verifier'); }
  return {
    getItem(key: string) {
      if (!isVerifier(key)) return memory.get(key) || null;
      try {
        const stored = local.getItem(key);
        if (!stored) return null;
        try {
          const item = JSON.parse(stored) as { value: string; expiresAt: number };
          if (item.expiresAt > Date.now() && typeof item.value === 'string') return item.value;
        } catch {}
        local.removeItem(key);
        return null;
      } catch { throw new RecoveryStorageError(); }
    },
    setItem(key: string, value: string) {
      if (!isVerifier(key)) { memory.set(key, value); return; }
      try { local.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + 3600000 })); }
      catch { throw new RecoveryStorageError(); }
    },
    removeItem(key: string) {
      if (!isVerifier(key)) { memory.delete(key); return; }
      try { local.removeItem(key); }
      catch { throw new RecoveryStorageError(); }
    },
  };
}
