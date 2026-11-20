import { Controller, Get, HttpException, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.guard';
import { LocationSearchQuery } from '../common/dtos';

type ProviderPlace = {
  place_id?: string;
  lat: number;
  lon: number;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
};

@Controller('locations')
export class LocationsController {
  private readonly users = new Map<string, { since: number; count: number }>();
  private recentRequests: number[] = [];

  // Returns real provider suggestions without exposing the server's API key.
  @Get('autocomplete')
  async autocomplete(@Req() request: AuthRequest, @Query() query: LocationSearchQuery) {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Location suggestions are not set up yet. Use the map or current location.');
    }
    this.limitRequests(request.userId);

    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    url.searchParams.set('text', query.q);
    url.searchParams.set('limit', '5');
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', apiKey);

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Provider unavailable');
      const data = await response.json() as { results?: ProviderPlace[] };
      if (!Array.isArray(data.results)) throw new Error('Invalid provider response');
      return data.results.slice(0, 5).flatMap(place => {
        if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) return [];
        const name = place.formatted || [place.address_line1, place.address_line2].filter(Boolean).join(', ');
        if (!name?.trim()) return [];
        return [{
          id: place.place_id || `${place.lat}:${place.lon}`,
          latitude: place.lat,
          longitude: place.lon,
          name: name.trim().slice(0, 150),
          primary: place.address_line1 || name,
          secondary: place.address_line2 || [place.city, place.state, place.country].filter(Boolean).join(', '),
          source: 'geoapify' as const,
          isManual: true,
        }];
      });
    } catch {
      throw new ServiceUnavailableException('Location suggestions are unavailable. Please retry or choose a pin on the map.');
    }
  }

  // Bounds demo usage to four provider requests per second and thirty per user per minute.
  private limitRequests(userId: string) {
    const now = Date.now();
    for (const [id, usage] of this.users) if (usage.since <= now - 60000) this.users.delete(id);
    this.recentRequests = this.recentRequests.filter(time => time > now - 1000);
    const usage = this.users.get(userId) || { since: now, count: 0 };
    if (this.recentRequests.length >= 4 || usage.count >= 30) {
      throw new HttpException('Too many location searches. Please wait a moment and try again.', 429);
    }
    this.recentRequests.push(now);
    this.users.set(userId, { since: usage.since, count: usage.count + 1 });
  }
}
