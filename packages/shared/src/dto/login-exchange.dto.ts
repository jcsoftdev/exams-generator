/**
 * Cross-origin login handoff: the central login page (creaexamen.com) has an
 * `accessToken` from POST /auth/login but is on the wrong origin for the
 * target tenant's SPA ({slug}.creaexamen.com) — localStorage doesn't cross
 * origins, so the token has to travel via a redirect URL. Putting the real
 * 24h JWT in a URL/fragment would sit in browser history for as long as the
 * token is valid; these DTOs back a one-time, ~60s-lived exchange code
 * instead, so the URL only ever carries something useless after the first
 * redemption (see LoginExchangeService).
 */

/** POST /auth/exchange-code request body. */
export interface ExchangeCodeRequestDto {
  accessToken: string;
}

/** POST /auth/exchange-code 200 response body. */
export interface ExchangeCodeResponseDto {
  code: string;
}

/** POST /auth/exchange request body. */
export interface ExchangeTokenRequestDto {
  code: string;
}

/** POST /auth/exchange 200 response body. */
export interface ExchangeTokenResponseDto {
  accessToken: string;
}
