/** The identity JwtAuthGuard attaches to `req.user` once an access token verifies. */
export interface AuthenticatedUser {
  id: string;
}
