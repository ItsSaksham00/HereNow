import { createClient } from './vendor.js';
import { PasswordRecovery, RecoveryError } from './recovery.js';
import { recoveryStorage } from './storage.js';

// Removes credentials before fetching configuration or making authentication requests.
let fragment = window.location.hash;
let query = window.location.search;
window.history.replaceState(null, '', window.location.pathname);

const requestForm = document.querySelector<HTMLFormElement>('#request-form')!;
const emailField = document.querySelector<HTMLInputElement>('#email')!;
const send = document.querySelector<HTMLButtonElement>('#send')!;

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const errorText = document.querySelector<HTMLParagraphElement>('#error')!;
const form = document.querySelector<HTMLFormElement>('#reset-form')!;
const password = document.querySelector<HTMLInputElement>('#password')!;
const confirmation = document.querySelector<HTMLInputElement>('#confirmation')!;
const submit = document.querySelector<HTMLButtonElement>('#submit')!;
const show = document.querySelector<HTMLButtonElement>('#show-passwords')!;
const finish = document.querySelector<HTMLButtonElement>('#finish')!;
let recovery: PasswordRecovery | null = null;
let pending = false;
let saved = false;

// Displays only our own messages, never a provider response, token, or incoming URL.
function showError(message: string) { errorText.textContent = message; }

// Makes the failing stage shareable without putting callback values into logs or the UI.
function showRecoveryError(error: unknown, fallback: string) {
  if (error instanceof RecoveryError) {
    showError(`${error.message} Diagnostic: ${error.stage}/${error.category}.`);
  } else {
    showError(`${fallback} Diagnostic: configuration/configuration_failure.`);
  }
}

// Enables password entry only after the recovery session has been validated.
async function initialize() {
  try {
    if (window.location.protocol !== 'https:') throw new RecoveryError('Open this page over HTTPS.', 'configuration_failure', 'configuration');
    let response: Response;
    try { response = await fetch('./config.json', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
    catch { throw new RecoveryError('Could not load recovery configuration. Check your connection and try again.', 'network_failure', 'configuration'); }
    if (!response.ok) throw new RecoveryError('The password-reset page is not configured correctly. Check its public Supabase configuration and deployment.', 'configuration_failure', 'configuration');
    const config = await response.json() as { supabaseUrl?: string; supabasePublishableKey?: string };
    const url = new URL(config.supabaseUrl || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !config.supabasePublishableKey) throw new RecoveryError('The password-reset page is not configured correctly. Check its public Supabase configuration and deployment.', 'configuration_failure', 'configuration');
    const client = createClient(url.origin, config.supabasePublishableKey, {
      auth: { persistSession: true, storage: recoveryStorage(window.localStorage), storageKey: 'herenow-reset', autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce', debug: false },
    });
    recovery = new PasswordRecovery(client.auth);
    if (!window.crypto?.subtle || typeof window.crypto.getRandomValues !== 'function') throw new RecoveryError('A browser with secure WebCrypto support is required.', 'configuration_failure', 'configuration');
    if (!query && (!fragment || fragment.startsWith('#email='))) {
      emailField.value = new URLSearchParams(fragment.slice(1)).get('email') || '';
      status.textContent = 'Send a reset link here. Before opening the email, choose this same browser and profile—not a private window or an isolated email-app browser. Use only the latest request.';
      requestForm.hidden = false;
    } else {
      const email = await recovery.open(query, fragment);
      status.textContent = `Choose a new password for ${email}.`;
      form.hidden = false;
    }
  } catch (error: unknown) {
    status.textContent = 'Unable to open password recovery.';
    if (error instanceof Error && (error.name === 'RecoveryStorageError' || error.name === 'SecurityError')) {
      error = new RecoveryError('Browser storage is blocked. Allow site storage and request a new email in this browser.', 'storage_unavailable', 'storage');
    }
    showRecoveryError(error, 'Could not initialize password recovery. Check the page configuration and browser storage.');
  } finally {
    fragment = '';
    query = '';
  }
}

// Sends only after an explicit click, with a neutral response and no automatic retries.
async function sendEmail(event: SubmitEvent) {
  event.preventDefault();
  if (pending || !recovery) return;
  pending = true;
  send.disabled = true;
  send.textContent = 'Sending…';
  emailField.disabled = true;
  showError('');
  try {
    await recovery.request(emailField.value, window.location.origin + window.location.pathname);
    status.textContent = "If an account exists for this email, you'll receive a password reset link. Open it in this same browser.";
  } catch (error: unknown) {
    showRecoveryError(error, 'Could not send the reset email. Check your connection and try again.');
  } finally {
    pending = false;
    send.disabled = false;
    send.textContent = 'Send Reset Link';
    emailField.disabled = false;
  }
}

// Finishes sign-out separately so a retry never changes the password a second time.
async function finishReset() {
  if (pending || !recovery) return;
  pending = true;
  finish.disabled = true;
  showError('');
  try {
    await recovery.close();
    status.textContent = 'Your password has been updated. Close this tab, return to HereNow, and log in with your new password.';
    finish.hidden = true;
  } catch {
    showError('Your password was updated, but browser sign-out could not finish. Retry finishing, or close this tab.');
  } finally {
    pending = false;
    finish.disabled = false;
  }
}

// Validates and updates once, then clears password fields and offers an explicit finish action.
async function submitPassword(event: SubmitEvent) {
  event.preventDefault();
  if (pending || !recovery || saved) return;
  pending = true;
  submit.disabled = true;
  submit.textContent = 'Updating…';
  password.disabled = true;
  confirmation.disabled = true;
  show.disabled = true;
  showError('');
  try {
    await recovery.update(password.value, confirmation.value);
    saved = true;
    password.value = '';
    confirmation.value = '';
    form.hidden = true;
    status.textContent = 'Password updated. Finish below, then return to HereNow and log in with your new password.';
    finish.hidden = false;
  } catch (error: unknown) {
    showRecoveryError(error, 'Could not update your password. Retry or request a fresh email from HereNow.');
  } finally {
    pending = false;
    submit.disabled = false;
    submit.textContent = 'Update Password';
    password.disabled = false;
    confirmation.disabled = false;
    show.disabled = false;
  }
}

requestForm.addEventListener('submit', event => { void sendEmail(event); });
form.addEventListener('submit', event => { void submitPassword(event); });
finish.addEventListener('click', () => { void finishReset(); });
show.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  confirmation.type = password.type;
  show.textContent = visible ? 'Hide passwords' : 'Show passwords';
});
void initialize();
