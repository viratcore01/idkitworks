export interface MatchCriteria {
  goals?: string[];
  interests?: { id: string; name: string }[];
}

const GOAL_LABELS: Record<string, string> = {
  DATING: 'Dating',
  RELATIONSHIP: 'Relationship',
  HOOKUP: 'Hookup',
  CASUAL: 'Casual',
  NOT_SURE: 'Not sure',
};

export function goalLabel(g: string): string {
  return GOAL_LABELS[g] || g;
}

/**
 * Why-you-matched explanation — the strictly-common intersection snapshotted
 * at match time. Two explicit lines, exactly as the inbox should read:
 *   Looking for (common): Dating
 *   Interests in common (2): Coding, Gaming
 * Never fabricated: anything not shared by BOTH is omitted upstream.
 */
export default function MatchReasons({
  criteria,
  compact = false,
}: {
  criteria?: MatchCriteria | null;
  compact?: boolean;
}) {
  const goals = criteria?.goals ?? [];
  const interests = criteria?.interests ?? [];

  if (!goals.length && !interests.length) {
    return (
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-400 mt-0.5 italic`}>
        No listed criteria in common — matched on vibes.
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`}>
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-body text-ink flex flex-wrap items-center gap-1`}>
        <span className="font-bold uppercase tracking-wide text-gray-400">Looking for (common):</span>
        {goals.length ? (
          goals.map((g) => (
            <span key={g} className="nb-badge bg-nb-violet text-white text-xs px-1.5 py-0.5">
              {goalLabel(g)}
            </span>
          ))
        ) : (
          <span className="text-gray-400 italic">not listed</span>
        )}
      </p>
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-body text-ink flex flex-wrap items-center gap-1`}>
        <span className="font-bold uppercase tracking-wide text-gray-400">
          Interests in common{interests.length ? ` (${interests.length})` : ''}:
        </span>
        {interests.length ? (
          <>
            {interests.slice(0, 4).map((i) => (
              <span key={i.id} className="nb-badge bg-nb-peri text-ink text-xs px-1.5 py-0.5">
                {i.name}
              </span>
            ))}
            {interests.length > 4 && (
              <span className="text-xs text-gray-400">+{interests.length - 4} more</span>
            )}
          </>
        ) : (
          <span className="text-gray-400 italic">none in common</span>
        )}
      </p>
    </div>
  );
}
