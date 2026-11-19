import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Btn, ErrorText, Layout, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export type Center = { latitude: number; longitude: number; name: string; isManual?: boolean; source?: 'geoapify' };
export const sampleCenter: Center = {
  latitude: 41.0998,
  longitude: -80.6495,
  name: 'Downtown Youngstown · selected area',
  isManual: true
};

// Reads current GPS coordinates with a bounded wait and an optional readable address.
export async function getDeviceCenter(): Promise<Center> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    const agreed = await new Promise<boolean>(resolve => Alert.alert(
      'Use your current location?',
      'HereNow uses your location to find nearby activities. It is not shown as a public user pin.',
      [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Continue', onPress: () => resolve(true) }],
      { cancelable: true, onDismiss: () => resolve(false) }
    ));
    if (!agreed) throw new Error('Location selection was cancelled. Your previous area is unchanged.');
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) throw new Error('Location permission was denied. Enable it in Settings, or select an area manually.');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Location Services are off. Turn them on and try again.');

  let timer: ReturnType<typeof setTimeout> | undefined;
  let position: Location.LocationObject;
  try {
    position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Finding your location timed out. Try again or select an area manually.')), 20000); }),
    ]);
  } catch (error: any) {
    throw new Error(error.message?.includes('timed out') ? error.message : 'Your current location is unavailable. Try again or select an area manually.');
  } finally {
    clearTimeout(timer);
  }
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Your current location is unavailable. Select an area manually.');
  }

  let addresses: Location.LocationGeocodedAddress[] = [];
  try {
    addresses = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      new Promise<Location.LocationGeocodedAddress[]>(resolve => { timer = setTimeout(() => resolve([]), 3000); }),
    ]);
  } catch {
    // A failed address lookup must not discard a valid GPS location.
  } finally {
    clearTimeout(timer);
  }
  const address = addresses[0];
  const name = address?.formattedAddress || [address?.name, address?.city || address?.district, address?.region].filter(Boolean).join(', ') || 'Near you';
  return {
    latitude,
    longitude,
    name,
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
