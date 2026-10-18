/** Tickets for async work: only the newest one may publish its result. */
export function createLatest() {
  let last = 0;
  return {
    next: () => ++last,
    isLatest: (ticket: number) => ticket === last,
  };
}
