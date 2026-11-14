import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Btn, ErrorText, Layout, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export type Center = { latitude: number; longitude: number; name: string; isManual?: boolean };
export const sampleCenter: Center = {
  latitude: 41.0998,
  longitude: -80.6495,
  name: 'Downtown Youngstown · selected area',
  isManual: true
};

// Requests location access and returns the current search center.
export async function getDeviceCenter(): Promise<Center> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Location permission was denied. Choose an area manually instead.');
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    name: 'Near you',
    isManual: false
  };
}

// Lets the user choose a search area or use device location.
export function LocationScreen({ onSelected }: { onSelected: (c: Center) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Layout>
      <Text style={{ color: C.green, fontSize: 25, fontWeight: '800', marginTop: 25 }}>HereNow.</Text>
      <View
        style={{
          height: 205,
          borderRadius: 28,
          backgroundColor: '#DFEACD',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 30
        }}
      >
        <Text style={{ fontSize: 78 }}>📍</Text>
      </View>
      <Title>Your neighborhood.{'\n'}Your next plan.</Title>
      <Muted>Choose an area and explore nearby activities, or allow device location for accurate distance sorting.</Muted>
      <Muted style={{ marginTop: 15 }}>Your device location is not displayed as a public user pin. Published posts use approximate activity coordinates.</Muted>
      <ErrorText message={error} />
      <Btn
        label={busy ? 'Finding location…' : 'Use my location'}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            onSelected(await getDeviceCenter());
          } catch (error: any) {
            setError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Btn
        label="Choose an area instead"
        secondary
        onPress={() => {
          onSelected(sampleCenter);
          Alert.alert('Manual area selected', 'You can change the center by tapping a place on the map.');
        }}
      />
    </Layout>
  );
}
