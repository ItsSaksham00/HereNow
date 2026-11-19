import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Center } from '../screens/LocationScreen';
import { api } from '../lib/api';
import { ErrorText, Muted, styles } from './ui';
import { C } from '../theme/theme';

type Suggestion = Center & { id: string; primary: string; secondary: string; source: 'geoapify' };

// Fetches provider suggestions through the authenticated backend, never through device GPS.
export async function findLocations(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const text = query.trim();
  if (text.length < 3) return [];
  return api<Suggestion[]>(`/locations/autocomplete?q=${encodeURIComponent(text)}`, { signal });
}

// Retains the provider and data-source attribution required for location search results.
export function LocationCredits() {
  return (
    <Text style={{ color: C.muted, fontSize: 10, marginTop: 8 }}>
      Location search: <Text accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.geoapify.com/').catch(() => {}); }}>Geoapify</Text>
      {' · '}<Text accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {}); }}>© OpenStreetMap</Text>
    </Text>
  );
}

// Debounces typed search and keeps outdated responses out of the dropdown.
export function LocationSearch({ onSelect, selected = null, disabled = false }: {
  onSelect: (location: Center) => void;
  selected?: Center | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    version.current++;
    pending.current?.abort();
    setEditing(false);
    setQuery(selected?.name || '');
    setResults([]);
    setBusy(false);
    setError(null);
  }, [selected?.latitude, selected?.longitude, selected?.name]);

  useEffect(() => {
    if (disabled) {
      version.current++;
      pending.current?.abort();
      setBusy(false);
      setResults([]);
      return;
    }
    if (!editing || disabled || query.trim().length < 3) return;
    const current = ++version.current;
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const matches = await findLocations(query, controller.signal);
        if (current !== version.current || controller.signal.aborted) return;
        setResults(matches);
        setError(matches.length ? null : 'No places found. Try a fuller address or select a pin.');
      } catch (error: any) {
        if (current === version.current && !controller.signal.aborted) setError(error.message || 'Location search is unavailable. Try again or select a pin.');
      } finally {
        if (current === version.current && !controller.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, editing, disabled]);

  // Cancels any older lookup as soon as the user edits or clears the field.
  function changeQuery(value: string) {
    version.current++;
    pending.current?.abort();
    setQuery(value);
    setEditing(true);
    setResults([]);
    setError(null);
    setBusy(false);
  }

  // Selects the suggestion's coordinates directly; map interaction is optional.
  function selectSuggestion(result: Suggestion) {
    version.current++;
    pending.current?.abort();
    setQuery(result.name);
    setEditing(false);
    setResults([]);
    setError(null);
    setBusy(false);
    Keyboard.dismiss();
    onSelect(result);
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.fieldLabel}>Search location</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput value={query} maxLength={120} onChangeText={changeQuery} editable={!disabled} returnKeyType="search" placeholder="City, address, or place" placeholderTextColor={C.muted} style={[styles.input, { flex: 1 }]} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear location search" disabled={disabled} onPress={() => changeQuery('')} style={{ padding: 12 }}><Text style={{ color: C.green, fontSize: 20 }}>×</Text></Pressable> : null}
      </View>
      {busy ? <Muted style={{ marginTop: 8 }}>Finding places…</Muted> : null}
      {results.length ? (
        <View style={{ backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: 'hidden', marginTop: 4 }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
            {results.map(result => (
              <Pressable key={result.id} disabled={disabled} accessibilityRole="button" onPress={() => selectSuggestion(result)} style={{ padding: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.ink, fontWeight: '600' }}>{result.primary}</Text>
                {result.secondary ? <Muted>{result.secondary}</Muted> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <ErrorText message={error} />
      {results.length || selected?.source === 'geoapify' ? <LocationCredits /> : null}
    </View>
  );
}
