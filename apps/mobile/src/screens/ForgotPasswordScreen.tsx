import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Btn, ErrorText, Field, Layout, Muted, Title } from '../components/ui';
import { openRecoveryPage } from '../lib/recovery';

// Opens the browser recovery flow without changing the mobile authentication session.
export function ForgotPasswordScreen({ email: initialEmail, onBack }: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  // Opens one browser page at a time and keeps email requests in that browser.
  async function openPage() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      await openRecoveryPage(email);
      setOpened(true);
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Layout>
      <Title>Forgot your password?</Title>
      <Muted>Continue in your browser to send the standard password-reset email.</Muted>
      <Field label="Email" value={email} autoCapitalize="none" placeholder="you@example.com" editable={!loading}
        onChangeText={value => { setEmail(value); setOpened(false); }} />
      <Btn label={loading ? 'Opening…' : 'Continue in browser'} disabled={loading} onPress={openPage} />
      {opened ? <Muted>Continue on the webpage to send your reset link. Open only the latest email in that same browser and profile, rather than an isolated email-app browser.</Muted> : null}
      <Muted>Email limits still apply. If the webpage reports too many requests, wait before trying again.</Muted>
      <ErrorText message={error} />
      <Btn label="Return to Login" secondary disabled={loading} onPress={onBack} />
    </Layout>
  </KeyboardAvoidingView>;
}
