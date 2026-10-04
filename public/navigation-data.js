// Memory-only snapshots. Reads still go to the server; snapshots never authorize trading.
export function createNavigationData() {
  const snapshots = new Map(), pending = new Map();
  let generation = 0;
  return {
    has: key => snapshots.has(key),
    snapshot: key => {
      if (!snapshots.has(key)) throw new Error('No previous account data is available.');
      return structuredClone(snapshots.get(key));
    },
    read: (key, fetcher) => {
      if (pending.has(key)) return pending.get(key).then(structuredClone);
      const current = generation;
      const request = Promise.resolve().then(fetcher).then(value => {
        if (current === generation) snapshots.set(key,structuredClone(value));
        return value;
      }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
      pending.set(key,request);
      return request.then(structuredClone);
    },
    clear: () => { generation++; snapshots.clear(); pending.clear(); }
  };
}
