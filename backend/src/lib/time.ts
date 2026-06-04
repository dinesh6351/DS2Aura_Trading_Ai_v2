/**
 * Timezone-aware day boundaries. Each user has a region (IANA timezone, e.g.
 * Asia/Kolkata), and "today" — for P&L, trade count and the daily reset — is the
 * calendar day in THAT zone, not UTC. Uses Intl so it's DST-aware, no library.
 */

/** Offset in minutes (DST-aware) of an IANA timezone at a given instant. */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0; // "GMT" with no offset → UTC
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch { return 0; }
}

/** UTC instant of the start of "today" in the given timezone. */
export function startOfDayUtc(tz: string, at: Date = new Date()): Date {
  const off = tzOffsetMinutes(tz, at);
  const localMs = at.getTime() + off * 60_000;
  const localMidnight = Math.floor(localMs / 86_400_000) * 86_400_000;
  return new Date(localMidnight - off * 60_000);
}
