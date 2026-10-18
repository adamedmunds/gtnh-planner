const COLOURS: Record<string, string> = { ULV: '#9e9e9e', LV: '#9ccc65', MV: '#ffb74d', HV: '#ffd54f', EV: '#90a4ae', IV: '#ce93d8' };

/** "LV", "MV", … in GregTech's tier colours. */
export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  return <span className="tier" style={{ background: COLOURS[tier] ?? '#ef9a9a' }}>{tier}</span>;
}
