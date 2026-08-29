export interface LimitWindowDto {
  limitMinor: number;
  usedMinor: number;
  remainingMinor: number;
}

/** Surfaced on `GET /wallet` so a user can see their sending headroom before they hit it. */
export interface LimitUsageDto {
  daily: LimitWindowDto;
  weekly: LimitWindowDto;
  monthly: LimitWindowDto;
}
