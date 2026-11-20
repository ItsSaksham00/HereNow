import type { SupabaseClient, JwtPayload } from '@supabase/supabase-js';

type RecoveryAuth = Pick<SupabaseClient['auth'], 'getClaims' | 'getUser' | 'exchangeCodeForSession' | 'resetPasswordForEmail' | 'updateUser' | 'signOut'>;
export type RecoveryStage = 'callback' | 'exchange' | 'claims' | 'identity' | 'configuration' | 'storage' | 'request' | 'password';
export type RecoveryCategory = 'missing_callback' | 'invalid_callback' | 'expired_link' | 'browser_mismatch' | 'unsupported_flow' | 'auth_failure' | 'not_recovery' | 'network_failure' | 'configuration_failure' | 'storage_unavailable' | 'rate_limit' | 'validation';

// Carries only fixed messages and safe stage/category labels, never provider details.
export class RecoveryError extends Error {
  constructor(message: string, readonly category: RecoveryCategory = 'validation', readonly stage: RecoveryStage = 'password') { super(message); }
}

const invalidLink = 'This reset link is invalid, expired, or already used. Request a new email from HereNow.';

// Maps structured SDK errors to safe diagnostics without displaying raw response text.
export function authFailure(error: unknown, stage: RecoveryStage): RecoveryError {
  if (error instanceof RecoveryError) return error;
  const failure = error as { code?: string; name?: string; status?: number; originalError?: { name?: string } } | null;
  if (failure?.name === 'RecoveryStorageError' || failure?.originalError?.name === 'RecoveryStorageError') return new RecoveryError('Browser storage is blocked or unavailable. Allow site storage, send a new request here, and open its email in this same browser profile.', 'storage_unavailable', 'storage');
  if (failure?.code === 'pkce_code_verifier_not_found' || failure?.code === 'bad_code_verifier' || failure?.name === 'AuthPKCECodeVerifierMissingError') {
    return new RecoveryError('The request verifier is missing or does not match. Open the latest email in the same browser, profile, and website where you sent it. Clearing storage or sending another request can invalidate an earlier link.', 'browser_mismatch', stage);
  }
  if (['otp_expired', 'flow_state_expired', 'flow_state_not_found'].includes(failure?.code || '')) return new RecoveryError(invalidLink, 'expired_link', stage);
  if (failure?.status === 429) return new RecoveryError('Too many attempts. Please wait and try again later.', 'rate_limit', stage);
  if (failure?.name === 'AuthRetryableFetchError' || failure?.name === 'TypeError' || failure?.status === 0 || (failure?.status || 0) >= 500) {
    return new RecoveryError('Could not reach Supabase. Check your connection and try again; a new email may be needed if verification already consumed this link.', 'network_failure', stage);
  }
  return new RecoveryError('Supabase could not verify this recovery attempt. Request a fresh link. If it happens again, share only the diagnostic category below.', 'auth_failure', stage);
}

// Keeps signature-verified identity, expiry, and recovery purpose checks separate for diagnosis.
function checkRecoveryClaims(claims: JwtPayload | undefined) {
  if (!claims || !Number.isFinite(claims.exp) || !claims.sub || !claims.session_id) throw new RecoveryError('The verified session is missing required identity information.', 'auth_failure', 'claims');
  if (claims.exp * 1000 <= Date.now()) throw new RecoveryError(invalidLink, 'expired_link', 'claims');
  const recovery = Array.isArray(claims.amr) && claims.amr.some(entry => typeof entry === 'string' ? entry === 'recovery' : entry?.method === 'recovery');
  if (!recovery) throw new RecoveryError('This verified session is not marked as password recovery. Ordinary login sessions cannot reset a password here. Request a new link from this page.', 'not_recovery', 'claims');
}

// Holds a verified recovery session only for the current browser page.
export class PasswordRecovery {
  private userId: string | null = null;
  private sessionId: string | null = null;
  private expiresAt = 0;
  private busy = false;
  private finished = false;

  constructor(private readonly auth: RecoveryAuth) {}

  // Sends Supabase's default email with a browser-held PKCE challenge.
  async request(email: string, redirectTo: string) {
    if (this.busy || this.userId || this.finished) throw new RecoveryError('Please wait for the current request.', 'validation', 'request');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) throw new RecoveryError('Enter a valid email address.', 'validation', 'request');
    this.busy = true;
    try {
      const { error } = await this.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (!error || error.code === 'user_not_found') return;
      if (error.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code || '')) throw new RecoveryError('Too many recovery requests. Please wait and try again later.', 'rate_limit', 'request');
      throw new RecoveryError('Supabase could not send the reset email. Check the service configuration and permitted recipients.', 'auth_failure', 'request');
    } catch (error: unknown) { throw authFailure(error, 'request'); }
    finally { this.busy = false; }
  }

  // Exchanges the default email's one-use code and verifies its signed recovery identity.
  async open(query: string, fragment: string) {
    if (this.busy || this.userId || this.finished) throw new RecoveryError(invalidLink, 'invalid_callback', 'callback');
    this.busy = true;
    let stage: RecoveryStage = 'callback';
    let sessionEstablished = false;
    try {
      const params = new URLSearchParams(query.replace(/^\?/, ''));
      const hash = new URLSearchParams(fragment.replace(/^#/, ''));
      for (const source of [params, hash]) {
        if (source.has('error') || source.has('error_code')) throw authFailure({ code: source.get('error_code') || undefined }, 'callback');
      }
      if (hash.has('access_token') || hash.has('refresh_token')) throw new RecoveryError('This link uses a different recovery flow. Send a fresh email from this webpage, then open it in the same browser.', 'unsupported_flow', 'callback');
      const code = params.get('code');
      if (!code) throw new RecoveryError('No recovery authorization code was provided. Open the original email link, or send a new request from this page.', 'missing_callback', 'callback');
      if (fragment || params.getAll('code').length !== 1 || [...params.keys()].some(key => key !== 'code')) throw new RecoveryError('The recovery callback has an unexpected format. Request a fresh email from this page.', 'invalid_callback', 'callback');
      stage = 'exchange';
      const result = await this.auth.exchangeCodeForSession(code);
      sessionEstablished = !!result.data.session;
      if (result.error) throw authFailure(result.error, stage);
      if (!result.data.session || !result.data.user) throw authFailure(null, stage);
      stage = 'claims';
      const verified = await this.auth.getClaims(result.data.session.access_token);
      if (verified.error) throw authFailure(verified.error, stage);
      const claims = verified.data?.claims;
      checkRecoveryClaims(claims);
      if (claims!.sub !== result.data.user.id) throw authFailure(null, 'identity');
      stage = 'identity';
      const user = await this.auth.getUser(result.data.session.access_token);
      if (user.error) throw authFailure(user.error, stage);
      if (!user.data.user?.email || user.data.user.id !== claims!.sub) throw authFailure(null, stage);
      this.userId = claims!.sub;
      this.sessionId = claims!.session_id;
      this.expiresAt = claims!.exp * 1000;
      return user.data.user.email;
    } catch (error: unknown) {
      this.userId = null;
      this.sessionId = null;
      // Signing out before exchange succeeds would delete pending PKCE verifiers.
      if (sessionEstablished) await this.auth.signOut({ scope: 'local' }).catch(() => {});
      throw authFailure(error, stage);
    } finally { this.busy = false; }
  }

  // Rechecks recovery identity before updating and preserves the form on retryable failures.
  async update(password: string, confirmation: string) {
    if (this.busy) throw new RecoveryError('Please wait for the current request.');
    if (!this.userId || this.finished || this.expiresAt <= Date.now()) throw new RecoveryError(invalidLink, 'expired_link', 'password');
    if (password.length < 6) throw new RecoveryError('Use at least 6 characters. Your account may require a stronger password.');
    if (password !== confirmation) throw new RecoveryError('The passwords do not match.');
    this.busy = true;
    try {
      const verified = await this.auth.getClaims();
      const claims = verified.data?.claims;
      const user = await this.auth.getUser();
      if (verified.error) throw authFailure(verified.error, 'claims');
      checkRecoveryClaims(claims);
      if (user.error) throw authFailure(user.error, 'identity');
      if (claims?.sub !== this.userId || claims.session_id !== this.sessionId || user.error || user.data.user?.id !== this.userId) {
        this.userId = null;
        this.sessionId = null;
        throw new RecoveryError('The recovery user or session changed. Request a new recovery email.', 'auth_failure', 'identity');
      }
      const { error } = await this.auth.updateUser({ password });
      if (error) {
        if (error.status === 429) throw new RecoveryError('Too many attempts. Please wait and try again later.');
        if (error.code === 'weak_password' || error.code === 'same_password') throw new RecoveryError('Choose a stronger, different password that meets your account password policy.');
        throw new RecoveryError('Could not update your password. Retry, or request a new email if your session expired.');
      }
      this.finished = true;
      this.userId = null;
      this.sessionId = null;
    } catch (error: unknown) {
      throw authFailure(error, 'password');
    } finally {
      this.busy = false;
    }
  }

  // Releases the browser's recovery session without touching the mobile app's stored session.
  async close() {
    const { error } = await this.auth.signOut({ scope: 'local' });
    if (error) throw new RecoveryError('Password updated, but browser sign-out failed. Retry finishing, or close this tab.');
  }
}
