import React, { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Layout, Title, Muted, Field, Btn, ErrorText } from '../components/ui';
import { supabase } from '../lib/supabase';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { C } from '../theme/theme';

// Shows the welcome, sign-in, and account creation forms.
export function AuthScreen({ initialMode = 'welcome' }: { initialMode?: 'welcome' | 'login' }) {
  const [mode, setMode] = useState<'welcome' | 'login' | 'signup' | 'forgot'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useRef(false);

  // Signs in or creates an account using the selected form.
  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Your name is required');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
        if (error) throw error;
        if (!data.session) Alert.alert('Check your email', 'Confirm your email using the link from Supabase, then sign in.');
        setMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  if (mode === 'forgot') return <ForgotPasswordScreen email={email} onBack={() => { setMode('login'); setError(null); }} />;
  if (mode === 'welcome') return (
    <Layout>
      <Text style={{ color: C.ink, fontSize: 31, fontWeight: '900', marginTop: 35 }}>Here<Text style={{ color: C.green }}>Now</Text>
        <Text style={{ color: C.coral }}>.</Text>
      </Text>
      <View
        style={{
          height: 240,
          backgroundColor: '#DFEACD',
          borderRadius: 30,
          marginTop: 38,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Text style={{ fontSize: 72 }}>📍</Text>
        <Text style={{ fontSize: 38, marginTop: 10 }}>☕  🏀  🎵</Text>
      </View>
      <Title>Good things.{'\n'}Close by.{'\n'}Right now.</Title>
      <Muted>See what’s happening around you. Meet the moment. Join the activity.</Muted>
      <Btn label="Create an account" onPress={() => setMode('signup')} style={{ marginTop: 30 }} />
      <Btn label="Log in" secondary onPress={() => setMode('login')} />
      <Muted style={{ marginTop: 20, textAlign: 'center' }}>An account is required to explore nearby posts.</Muted>
    </Layout>
  );
  return (
    <Layout>
      <Text
        disabled={loading} onPress={() => setMode('welcome')}
        style={{ color: C.green, fontWeight: '700', marginTop: 10 }}
      >‹ Back</Text>
      <Title>
        {mode === 'signup' ? 'Make your HereNow account.' : 'Welcome to HereNow.'}
      </Title>
      <Muted>
        {mode === 'signup' ? 'Create an account to start discovering.' : 'Sign in to see what’s happening nearby.'}
      </Muted>
      <View style={{ marginTop: 35 }}>
        {mode === 'signup'
          && <Field label="Display name" value={name} onChangeText={setName} placeholder="Your name" />}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 6 characters"
          autoCapitalize="none"
        />
        {mode === 'login' ? <Btn label="Forgot Password?" secondary disabled={loading} onPress={() => { setMode('forgot'); setError(null); setPassword(''); }} /> : null}
        <ErrorText message={error} />
        <Btn
          label={loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          disabled={loading}
          onPress={submit}
        />
        <Btn
          label={mode === 'signup' ? 'Already a member? Log in' : 'New here? Create an account'}
          secondary
          disabled={loading}
          onPress={() => {
            setMode(mode === 'signup' ? 'login' : 'signup');
            setError(null);
          }}
        />
      </View>
    </Layout>
  );
}
