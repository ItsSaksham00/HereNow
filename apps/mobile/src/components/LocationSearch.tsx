import React, { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Location } from 'expo-location/next';
import type { Center } from '../screens/LocationScreen';
import { Btn, ErrorText, Muted, styles } from './ui';
import { C } from '../theme/theme';

// Looks up real places through the device geocoder without requesting GPS access.
export async function findLocations(query: string): Promise<Center[]> {
  const text = query.trim();
  if (!text) throw new Error('Enter a place, city, or address.');
  const addresses = await Location.geocode(text);
  const results: Center[] = [];
  for (const address of addresses) {
    const { latitude, longitude } = address.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    results.push({ latitude, longitude, name: address.formattedAddress || address.name || address.city || text, isManual: true });
  }
  return results;
}

// Offers search results only after an explicit search, keeping geocoder requests small.
export function LocationSearch({ onSelect, disabled = false }: { onSelect: (location: Center) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Center[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  // Searches for the entered place and leaves the current selection unchanged on failure.
  async function search() {
    if (pending.current || disabled) return;
    if (!query.trim()) { setError('Enter a place, city, or address.'); return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    setResults([]);
    Keyboard.dismiss();
    try {
      const matches = await findLocations(query);
      setResults(matches);
      if (!matches.length) setError('No places found. Try a fuller address or choose a pin on the map.');
    } catch {
      setError('Location search is unavailable. Check your connection or choose a pin on the map.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.fieldLabel}>Search location</Text>
      <TextInput
        value={query}
        onChangeText={value => { setQuery(value); setResults([]); setError(null); }}
        editable={!disabled && !busy}
        onSubmitEditing={() => void search()}
        returnKeyType="search"
        placeholder="Address, city, or place"
        placeholderTextColor={C.muted}
        style={styles.input}
      />
      <Btn
        label={busy ? 'Searching…' : 'Search'}
        secondary
        disabled={disabled || busy || !query.trim()}
        onPress={search}
      />
      <ErrorText message={error} />
      {results.map((result, index) => (
        <Pressable
          key={`${result.latitude}-${result.longitude}-${index}`}
          disabled={disabled}
          accessibilityRole="button"
          onPress={() => { onSelect(result); setResults([]); setQuery(result.name); }}
          style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}
        >
          <Text style={{ color: C.ink, fontWeight: '600' }}>{result.name}</Text>
          <Muted>Choose this place →</Muted>
        </Pressable>
      ))}
    </View>
  );
}
