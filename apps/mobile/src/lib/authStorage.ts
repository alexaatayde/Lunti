/**
 * Storage for the Supabase session.
 *
 * - Tokens go to the device keystore (expo-secure-store), not plain AsyncStorage.
 * - Some platforms reject secure-store values over ~2 KB and a session is larger, so values are
 *   split into chunks: `<key>.n` holds the chunk count, `<key>.0`, `<key>.1`, … hold the parts.
 * - "Keep me signed in" off → `setPersist(false)`: the session lives in memory only and is gone
 *   when the app restarts.
 */

/** The subset of expo-secure-store this adapter needs (also lets tests pass a fake). */
export type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** true (default): keep the session across app restarts. false: memory only. */
  setPersist(persist: boolean): void;
};

/** Well under the ~2048-byte limit, leaving room for multi-byte characters. */
export const CHUNK_SIZE = 1800;

const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

export function createAuthStorage(store: KeyValueStore): AuthStorage {
  const memory = new Map<string, string>();
  let persist = true;

  async function readCount(key: string) {
    const raw = await store.getItemAsync(countKey(key));
    const count = raw === null ? NaN : Number(raw);
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  async function readStored(key: string) {
    const count = await readCount(key);
    if (count === null) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await store.getItemAsync(chunkKey(key, i));
      // A missing chunk means a write was interrupted; treat the session as absent.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  }

  async function removeStored(key: string) {
    const count = await readCount(key);
    // Delete the count first so a half-finished delete never reads as a valid value.
    await store.deleteItemAsync(countKey(key));
    for (let i = 0; i < (count ?? 0); i += 1) {
      await store.deleteItemAsync(chunkKey(key, i));
    }
  }

  async function writeStored(key: string, value: string) {
    await removeStored(key);
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i += 1) {
      await store.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    // Written last: the value only becomes readable once every chunk is in place.
    await store.setItemAsync(countKey(key), String(count));
  }

  return {
    async getItem(key) {
      if (memory.has(key)) return memory.get(key) ?? null;
      return persist ? readStored(key) : null;
    },
    async setItem(key, value) {
      if (persist) {
        memory.delete(key);
        await writeStored(key, value);
      } else {
        memory.set(key, value);
        await removeStored(key);
      }
    },
    async removeItem(key) {
      memory.delete(key);
      await removeStored(key);
    },
    setPersist(value) {
      persist = value;
    },
  };
}
