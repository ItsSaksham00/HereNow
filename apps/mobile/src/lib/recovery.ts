import { Linking } from 'react-native';
import { passwordResetUrl } from './recovery-config';

// Checks email format before opening the secure browser recovery flow.
export function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
}

// Rejects an unset or insecure page instead of opening a broken recovery flow.
export function recoveryRedirect() {
  try {
    const url = new URL(passwordResetUrl);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.href;
  } catch {}
  throw new Error('Password recovery is not configured yet. The HTTPS reset page URL must be set first.');
}

// Opens the browser that will hold the PKCE verifier; the page sends the reset email.
export async function openRecoveryPage(email: string) {
  if (!validEmail(email)) throw new Error('Enter a valid email address.');
  const url = new URL(recoveryRedirect());
  url.hash = new URLSearchParams({ email: email.trim() }).toString();
  try { await Linking.openURL(url.href); }
  catch { throw new Error('Could not open your browser. Please try again.'); }
}
