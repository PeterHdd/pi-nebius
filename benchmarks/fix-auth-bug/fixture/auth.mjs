export function canRefresh(token, nowMs) {
  if (!token || token.revoked) return false;
  return token.expiresAt > nowMs;
}
