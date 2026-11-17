import React, { useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { Center } from '../screens/LocationScreen';
import { Btn, ErrorText, Muted, styles } from './ui';
import { C } from '../theme/theme';

// Looks up real places with the stable geocoder and its required Android permission.
export async function findLocations(query: string): Promise<Center[]> {
  const text = query.trim();
  if (!text) throw new Error('Enter a place, city, or address.');
  if (Platform.OS === 'android') {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) {
      throw new Error('Android requires location permission for address search. Enable it in Settings or choose a pin on the map.');
    }
  }

  let matches;
  try {
    matches = await Location.geocodeAsync(text);
  } catch {
    throw new Error('Location search is unavailable. Check your connection or choose a pin on the map.');
  }
  const results: Center[] = [];
  for (const match of matches) {
    const { latitude, longitude } = match;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const addresses = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
    const address = addresses[0];
    const name = address?.formattedAddress || [address?.name, address?.city || address?.district, address?.region].filter(Boolean).join(', ') || text;
    results.push({ latitude, longitude, name, isManual: true });
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
    } catch (error: any) {
      setError(error.message || 'Location search is unavailable. Choose a pin on the map instead.');
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
