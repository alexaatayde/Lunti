import { CHUNK_SIZE, createAuthStorage, type KeyValueStore } from '../../src/lib/authStorage';

function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      data.set(key, value);
    },
    deleteItemAsync: async (key) => {
      data.delete(key);
    },
  };
  return { data, store };
}

const KEY = 'lunti.auth';
const bigSession = JSON.stringify({ token: 'x'.repeat(CHUNK_SIZE * 2 + 37) });

describe('authStorage', () => {
  it('stores a small value and reads it back', async () => {
    const { store } = memoryStore();
    const storage = createAuthStorage(store);

    await storage.setItem(KEY, '{"a":1}');

    expect(await storage.getItem(KEY)).toBe('{"a":1}');
  });

  it('splits large sessions into secure-store sized chunks', async () => {
    const { data, store } = memoryStore();
    const storage = createAuthStorage(store);

    await storage.setItem(KEY, bigSession);

    expect(data.get(`${KEY}.n`)).toBe('3');
    for (const [k, v] of data) {
      if (k !== `${KEY}.n`) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    // A fresh adapter (= app restart) reads the same value from the store.
    expect(await createAuthStorage(store).getItem(KEY)).toBe(bigSession);
  });

  it('removes leftover chunks when a shorter value replaces a longer one', async () => {
    const { data, store } = memoryStore();
    const storage = createAuthStorage(store);

    await storage.setItem(KEY, bigSession);
    await storage.setItem(KEY, 'short');

    expect([...data.keys()].sort()).toEqual([`${KEY}.0`, `${KEY}.n`]);
    expect(await storage.getItem(KEY)).toBe('short');
  });

  it('removes every chunk on sign-out', async () => {
    const { data, store } = memoryStore();
    const storage = createAuthStorage(store);

    await storage.setItem(KEY, bigSession);
    await storage.removeItem(KEY);

    expect(data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('treats a half-written value as no session', async () => {
    const { data, store } = memoryStore();
    const storage = createAuthStorage(store);

    await storage.setItem(KEY, bigSession);
    data.delete(`${KEY}.1`);

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('keeps the session in memory only when persistence is off', async () => {
    const { data, store } = memoryStore();
    const storage = createAuthStorage(store);
    await storage.setItem(KEY, 'old-saved-session');

    storage.setPersist(false);
    await storage.setItem(KEY, 'memory-session');

    expect(await storage.getItem(KEY)).toBe('memory-session');
    expect(data.size).toBe(0);
    // After a restart nothing was saved, so the user is signed out.
    expect(await createAuthStorage(store).getItem(KEY)).toBeNull();
  });
});
