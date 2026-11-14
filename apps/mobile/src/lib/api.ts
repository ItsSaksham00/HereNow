import { supabase } from './supabase';

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
export type Post = {
  id: string; creator_id: string; creatorName: string; isOwn: boolean; interested: boolean;
  title: string | null; description: string | null; category: string | null; labels: string[];
  latitude: number; longitude: number; place_name: string; status: string;
  created_at: string; published_at: string | null; expires_at: string | null; imageUrl: string | null;
};
export type Comment = { id: string; author_id: string; authorName: string; body: string; created_at: string };
export type Notification = { id: string; post_id: string; message: string; created_at: string; is_read: boolean };
export type Profile = { id: string; display_name: string; push_enabled: boolean };

export async function api<T>(path: string, options: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in required');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(options.form ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.form || (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : null; } catch { throw new Error(`API returned non-JSON (${response.status}); check EXPO_PUBLIC_API_URL`); }
  if (!response.ok) throw new Error(typeof parsed?.message === 'string' ? parsed.message : Array.isArray(parsed?.message) ? parsed.message.join('; ') : `API error ${response.status}`);
  return parsed as T;
}
export function nearbyUrl(lat: number, lon: number, radius: number, category: string, search: string) {
  return `/posts/nearby?latitude=${lat}&longitude=${lon}&radius=${radius}&limit=40&category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`;
}
export function timeAgo(iso: string | null) {
  if (!iso) return 'Just now';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`;
  return `${Math.floor(mins / 1440)} days ago`;
}
export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
