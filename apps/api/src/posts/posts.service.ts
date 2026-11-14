import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CreatePostDto, NearbyQuery } from '../common/dtos';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

@Injectable()
export class PostsService {
  constructor(private readonly db: SupabaseService) {}

  private async enrich(rows: any[], viewerId: string) {
    if (!rows.length) return [];
    const ids = [...new Set(rows.map(p => p.creator_id))];
    const { data: users, error: userError } = await this.db.client.from('profiles').select('id,display_name').in('id', ids);
    this.db.check(userError);
    const nameMap = new Map((users || []).map(u => [u.id, u.display_name]));
    const postIds = rows.map(p => p.id);
    const { data: media, error: mediaError } = await this.db.client.from('media_assets').select('post_id,object_key').in('post_id', postIds);
    this.db.check(mediaError);
    const mediaMap = new Map((media || []).map(m => [m.post_id, m.object_key]));
    const { data: interests, error: interestError } = await this.db.client.from('interests').select('post_id').eq('user_id', viewerId).in('post_id', postIds);
    this.db.check(interestError);
    const interested = new Set((interests || []).map(i => i.post_id));
    return Promise.all(rows.map(async p => {
      const objectKey = mediaMap.get(p.id);
      let imageUrl: string | null = null;
      if (objectKey) {
        const { data, error } = await this.db.client.storage.from('post-images').createSignedUrl(objectKey, 3600);
        if (!error) imageUrl = data.signedUrl;
      }
      return { ...p, imageUrl, creatorName: nameMap.get(p.creator_id) || 'HereNow member', interested: interested.has(p.id), isOwn: p.creator_id === viewerId };
    }));
  }

  async nearby(userId: string, query: NearbyQuery) {
    const { data, error } = await this.db.client.rpc('nearby_posts', {
      p_lat: query.latitude, p_lon: query.longitude, p_radius_miles: query.radius,
      p_limit: query.limit, p_offset: query.offset,
    });
    this.db.check(error);
    const q = (query.search || '').trim().toLowerCase();
    const filtered = (data || []).filter((p: any) => (!query.category || query.category === 'All' || p.category === query.category) && (!q || [p.title, p.description, p.place_name].join(' ').toLowerCase().includes(q)));
    // For large data, move keyword/category filtering into the SQL function before pagination.
    return this.enrich(filtered, userId);
  }

  async myPosts(userId: string) {
    const { data, error } = await this.db.client.from('posts').select('*').eq('creator_id', userId).order('created_at', { ascending: false }).limit(40);
    this.db.check(error);
    return this.enrich(data || [], userId);
  }

  async post(userId: string, postId: string) {
    const { data, error } = await this.db.client.from('posts').select('*').eq('id', postId).maybeSingle();
    this.db.check(error);
    if (!data || (data.status !== 'PUBLISHED' && data.creator_id !== userId) || (data.status === 'PUBLISHED' && new Date(data.expires_at).getTime() <= Date.now() && data.creator_id !== userId)) throw new NotFoundException('Activity not found');
    return (await this.enrich([data], userId))[0];
  }

  async create(userId: string, body: CreatePostDto, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('A photo is required');
    if (!process.env.OPENAI_API_KEY) throw new ServiceUnavailableException('Configure OPENAI_API_KEY before creating posts');
    if (!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new BadRequestException('Use JPEG, PNG, or WebP');
    if (file.size > 6 * 1024 * 1024) throw new BadRequestException('Max photo size is 6 MB');
    if (!body.placeName.trim()) throw new BadRequestException('Location name is required');
    const { data: post, error } = await this.db.client.from('posts').insert({
      creator_id: userId, latitude: body.latitude, longitude: body.longitude,
      place_name: body.placeName.trim(), status: 'ANALYZING'
    }).select('*').single();
    this.db.check(error);
    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const objectKey = `${userId}/${post.id}/${randomUUID()}.${ext}`;
    const upload = await this.db.client.storage.from('post-images').upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: false });
    if (upload.error) {
      await this.db.client.from('posts').delete().eq('id', post.id);
      throw new ServiceUnavailableException('Image upload failed. Please retry.');
    }
    const mediaResult = await this.db.client.from('media_assets').insert({ post_id: post.id, object_key: objectKey, mime_type: file.mimetype });
    this.db.check(mediaResult.error);
    const jobResult = await this.db.client.from('ai_analysis_jobs').insert({ post_id: post.id, status: 'PENDING' });
    this.db.check(jobResult.error);
    // MVP: analyze inline. Phase 2: move this work into a background job worker.
    await this.analyze(post.id, userId, file.buffer, file.mimetype);
    return this.post(userId, post.id);
  }

  async analyze(postId: string, userId: string, imageBuffer?: Buffer, mime?: string) {
    const { data: post, error } = await this.db.client.from('posts').select('*').eq('id', postId).single();
    this.db.check(error);
    if (post.creator_id !== userId) throw new ForbiddenException();
    if (!['ANALYZING','FAILED'].includes(post.status)) throw new BadRequestException('This post cannot be reanalyzed');
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ServiceUnavailableException('OPENAI_API_KEY is required to generate post details');
    if (!imageBuffer) {
      const { data: media, error: mediaError } = await this.db.client.from('media_assets').select('*').eq('post_id', postId).single();
      this.db.check(mediaError);
      const download = await this.db.client.storage.from('post-images').download(media.object_key);
      if (download.error || !download.data) throw new ServiceUnavailableException('Could not reload the photo');
      imageBuffer = Buffer.from(await download.data.arrayBuffer());
      mime = media.mime_type;
    }
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const { data: jobs } = await this.db.client.from('ai_analysis_jobs').select('id,attempts').eq('post_id', postId).order('created_at', { ascending: false }).limit(1);
    const job = jobs?.[0];
    if (job) await this.db.client.from('ai_analysis_jobs').update({ status: 'PROCESSING', attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq('id', job.id);
    try {
      const ai = new OpenAI({ apiKey: key });
      const response = await ai.responses.create({
        model, max_output_tokens: 350,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Describe ONLY what is visually supported by the image as an inviting, short local activity post. Do not claim a verified current event, exact location, or time. Return ONLY a JSON object with title (under 100 chars), description (under 500 chars), category (one of Food, Sports, Music, Outdoors, Social, Other), labels (array of 1-5 short tags). Avoid identifying people.' },
          { type: 'input_image', image_url: `data:${mime || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`, detail: 'low' },
        ] }],
      });
      const raw = response.output_text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      const categories = ['Food','Sports','Music','Outdoors','Social','Other'];
      const title = String(parsed.title || '').trim().slice(0, 100);
      const description = String(parsed.description || '').trim().slice(0, 1000);
      if (!title || !description) throw new Error('AI returned incomplete post details');
      const category = categories.includes(parsed.category) ? parsed.category : 'Other';
      const labels = Array.isArray(parsed.labels) ? parsed.labels.slice(0, 5).map((s: unknown) => String(s).slice(0, 30)) : [];
      const update = await this.db.client.from('posts').update({ title, description, category, labels, status: 'READY' }).eq('id', postId);
      this.db.check(update.error);
      if (job) await this.db.client.from('ai_analysis_jobs').update({ status: 'SUCCEEDED', model_name: model, error_message: null, updated_at: new Date().toISOString() }).eq('id', job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await this.db.client.from('posts').update({ status: 'FAILED' }).eq('id', postId);
      if (job) await this.db.client.from('ai_analysis_jobs').update({ status: 'FAILED', error_message: message, updated_at: new Date().toISOString() }).eq('id', job.id);
      throw new ServiceUnavailableException('AI analysis failed. Try again from My Posts.');
    }
    return this.post(userId, postId);
  }

  async publish(userId: string, id: string) {
    const { data: post, error } = await this.db.client.from('posts').select('*').eq('id', id).single();
    this.db.check(error);
    if (post.creator_id !== userId) throw new ForbiddenException();
    if (post.status !== 'READY') throw new BadRequestException('Post is not ready for publication');
    const now = new Date();
    const hours = Math.min(24, Math.max(1, Number(process.env.POST_LIFETIME_HOURS || 4)));
    const { error: updateError } = await this.db.client.from('posts').update({ status: 'PUBLISHED', published_at: now.toISOString(), expires_at: new Date(now.getTime() + hours * 3600000).toISOString() }).eq('id', id).eq('status', 'READY');
    this.db.check(updateError);
    return this.post(userId, id);
  }

  async delete(userId: string, id: string) {
    const { data: post, error } = await this.db.client.from('posts').select('creator_id').eq('id', id).single();
    this.db.check(error);
    this.db.check(error);

if (!post) {
  throw new NotFoundException('Activity not found');
}

if (post.creator_id !== userId) {
  throw new ForbiddenException();
}
    const { data: media } = await this.db.client.from('media_assets').select('object_key').eq('post_id', id).maybeSingle();
    const result = await this.db.client.from('posts').delete().eq('id', id);
    this.db.check(result.error);
    if (media?.object_key) await this.db.client.storage.from('post-images').remove([media.object_key]);
    return { deleted: true };
  }
}
