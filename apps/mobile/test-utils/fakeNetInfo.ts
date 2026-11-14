/**
 * NetInfo for Jest: online by default. `setNetworkState` simulates losing or regaining the
 * connection; listeners added through `addEventListener` are called like the real module.
 */
type State = { isConnected: boolean | null; isInternetReachable: boolean | null };
type Listener = (state: State) => void;

const listeners = new Set<Listener>();
let current: State = { isConnected: true, isInternetReachable: true };

export function setNetworkState(next: Partial<State>): void {
  current = { ...current, ...next };
  for (const listener of [...listeners]) listener(current);
}

export function resetNetworkState(): void {
  current = { isConnected: true, isInternetReachable: true };
}

export const netInfoModuleMock = {
  __esModule: true,
  default: {
    addEventListener: (listener: Listener) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    fetch: async () => current,
  },
};
