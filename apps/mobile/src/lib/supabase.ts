import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'MISSING_PUBLISHABLE_KEY';

// Expo SecureStore for session tokens; publishable key is intentionally public.
const storage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};
export const supabase = createClient(url, key, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
