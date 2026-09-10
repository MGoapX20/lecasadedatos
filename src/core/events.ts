type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter. */
export class Emitter<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(key: K, fn: Handler<M[K]>): () => void {
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    for (const fn of set) (fn as Handler<M[K]>)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
