import { supabase } from './supabase';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

// Adds a real file that Expo's native multipart encoder can read.
export function photoForm(photo: ImagePickerAsset | null) {
  if (!photo) throw new Error('Add a photo first.');
  const file = photo.file || new File(photo.uri);
  if (file.size === 0) throw new Error('This photo is empty or unavailable. Please choose it again.');
  if (file.size >= 6 * 1024 * 1024) throw new Error('Choose a photo smaller than 6 MB.');
  const mime = file.type || photo.mimeType;
  if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  }
  const form = new FormData();
  form.append('photo', file);
  return form;
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

export type Post = {
  id: string;
  creator_id: string;
  creatorName: string;
  isOwn: boolean;
  interested: boolean;
  title: string | null;
  description: string | null;
  category: string | null;
  labels: string[];
  latitude: number;
  longitude: number;
  place_name: string;
  status: string;
  activity_at: string | null;
  created_at: string;
  published_at: string | null;
  expires_at: string | null;
  imageUrl: string | null;
};

export type ActivityFilter = 'now' | 'upcoming' | 'all';

export const activityFilters: { value: ActivityFilter; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All times' },
];

export type PostSuggestions = { title: string; description: string; category: string; labels: string[] };

export type Comment = { id: string; author_id: string; authorName: string; body: string; created_at: string };

export type Notification = { id: string; post_id: string; message: string; created_at: string; is_read: boolean };

export type CommentPage = { comments: Comment[]; total: number };

export type Profile = { id: string; display_name: string; push_enabled: boolean };

// Sends an authenticated API request and reads its JSON response.
export async function api<T>(
  path: string,
  options: { method?: string; body?: any; form?: FormData } = {}
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in required');
  let response;
  let text;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(options.form ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.form || (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    text = await response.text();
  } catch {
    throw new ApiError('Could not upload or reach the server. Check your connection and retry.');
  }
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('The server returned an unexpected response. Please retry.', response.status);
  }
  if (!response.ok) throw new ApiError(typeof parsed?.message === 'string'
    ? parsed.message
    : Array.isArray(parsed?.message) ? parsed.message.join('; ') : `API error ${response.status}`, response.status);
  return parsed as T;
}

// Builds the nearby activity URL from the selected filters.
export function nearbyUrl(lat: number, lon: number, radius: number, category: string, search: string, time: ActivityFilter = 'now') {
  return `/posts/nearby?latitude=${lat}&longitude=${lon}&radius=${radius}&limit=40&category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}&time=${time}`;
}

// Formats a timestamp as a short relative time.
export function timeAgo(iso: string | null) {
  if (!iso) return 'Just now';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

// Calculates the distance in miles between two coordinates.
export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDifference = toRadians(lat2 - lat1);
  const longitudeDifference = toRadians(lon2 - lon1);
  const a = Math.sin(latitudeDifference / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitudeDifference / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Shows the activity time in the viewer's local timezone.
export function formatActivityTime(iso: string | null) {
  if (!iso) return 'Happening now';
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
