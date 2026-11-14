import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CreatePostDto, NearbyQuery } from '../common/dtos';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

@Injectable()
export class PostsService {
  constructor(private readonly db: SupabaseService) {}

  // Adds creator names, photo URLs, and viewer details to posts.
  private async enrich(rows: any[], viewerId: string) {
    if (!rows.length) return [];
    const creatorIds = [...new Set(rows.map(post => post.creator_id))];
    const { data: users, error: userError } = await this.db.client.from('profiles').select('id,display_name').in('id', creatorIds);
    this.db.check(userError);
    const creatorNames = new Map((users || []).map(profile => [profile.id, profile.display_name]));
    const postIds = rows.map(post => post.id);
    const { data: media, error: mediaError } = await this.db.client.from('media_assets').select('post_id,object_key').in('post_id', postIds);
    this.db.check(mediaError);
    const mediaKeys = new Map((media || []).map(asset => [asset.post_id, asset.object_key]));
    const { data: interests, error: interestError } = await this.db.client.from('interests').select('post_id').eq('user_id', viewerId).in('post_id', postIds);
    this.db.check(interestError);
    const interestedPostIds = new Set((interests || []).map(interest => interest.post_id));
    return Promise.all(rows.map(async post => {
      const objectKey = mediaKeys.get(post.id);
      let imageUrl: string | null = null;
      if (objectKey) {
        const { data, error } = await this.db.client.storage.from('post-images').createSignedUrl(objectKey, 3600);
        if (!error) imageUrl = data.signedUrl;
      }
      return {
        ...post,
        imageUrl,
        creatorName: creatorNames.get(post.creator_id) || 'HereNow member',
        interested: interestedPostIds.has(post.id),
        isOwn: post.creator_id === viewerId
      };
    }));
  }

  // Finds nearby posts that match the selected filters.
  async nearby(userId: string, query: NearbyQuery) {
    const { data, error } = await this.db.client.rpc('nearby_posts_filtered', {
      p_lat: query.latitude,
      p_lon: query.longitude,
      p_radius_miles: query.radius,
      p_limit: query.limit,
      p_offset: query.offset,
      p_category: query.category || 'All',
      p_search: (query.search || '').trim(),
      p_time: query.time,
    });
    this.db.check(error);
    return this.enrich(data || [], userId);
  }

  // Lists the posts created by this user.
  async myPosts(userId: string) {
    const { data, error } = await this.db.client
      .from('posts')
      .select('*')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .limit(40);
    this.db.check(error);
    return this.enrich(data || [], userId);
  }

  // Loads an activity that this user is allowed to view.
  async post(userId: string, postId: string) {
    const { data, error } = await this.db.client.from('posts').select('*').eq('id', postId).maybeSingle();
    this.db.check(error);

    if (!data) {
      throw new NotFoundException('Activity not found');
    }

    if (data.creator_id !== userId) {
      if (data.status !== 'PUBLISHED') {
        throw new NotFoundException('Activity not found');
      }

      if (new Date(data.expires_at).getTime() <= Date.now()) {
        throw new NotFoundException('Activity not found');
      }
    }

    const posts = await this.enrich([data], userId);
    return posts[0];
  }

  // Uploads the photo and publishes the user’s activity without requiring AI.
  async create(userId: string, body: CreatePostDto, file: Express.Multer.File | undefined) {
    this.validatePhoto(file);
    this.activityExpiration(body.activityAt);

    let post;
    if (body.requestId) {
      const existing = await this.db.client.from('posts').select('*').eq('id', body.requestId).maybeSingle();
      this.db.check(existing.error);
      post = existing.data;
      if (post) {
        if (post.creator_id !== userId) throw new ForbiddenException();
        if (post.status === 'PUBLISHED') return this.post(userId, post.id);
        if (post.status !== 'READY') throw new ConflictException('This upload cannot be resumed. Open it from My Posts.');
        const media = await this.db.client.from('media_assets').select('id').eq('post_id', post.id).maybeSingle();
        this.db.check(media.error);
        if (media.data) return this.publish(userId, post.id);
      }
    }

    if (!post) {
      const result = await this.db.client
        .from('posts')
        .insert({
          ...(body.requestId ? { id: body.requestId } : {}),
          creator_id: userId,
          latitude: body.latitude,
          longitude: body.longitude,
          place_name: body.placeName.trim(),
          title: body.title.trim(),
          description: body.description.trim(),
          category: body.category,
          labels: body.labels || [],
          activity_at: body.activityAt,
          status: 'READY'
        })
        .select('*')
        .single();
      if (body.requestId && result.error?.code === '23505') {
        throw new ConflictException('This upload is already processing. Retry in a moment.');
      }
      this.db.check(result.error);
      post = result.data;
    }
    let fileExtension = 'jpg';
    if (file.mimetype === 'image/png') {
      fileExtension = 'png';
    } else if (file.mimetype === 'image/webp') {
      fileExtension = 'webp';
    }

    const photoName = body.requestId ? 'photo' : randomUUID();
    const objectKey = `${userId}/${post.id}/${photoName}.${fileExtension}`;
    const upload = await this.db.client.storage
      .from('post-images')
      .upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: Boolean(body.requestId) });
    if (upload.error) {
      if (!body.requestId) await this.db.client.from('posts').delete().eq('id', post.id);
      throw new ServiceUnavailableException('Image upload failed. Please retry.');
    }
    const media = { post_id: post.id, object_key: objectKey, mime_type: file.mimetype };
    let mediaResult;
    if (body.requestId) {
      mediaResult = await this.db.client.from('media_assets').upsert(media, { onConflict: 'post_id', ignoreDuplicates: true });
    } else {
      mediaResult = await this.db.client.from('media_assets').insert(media);
    }
    if (mediaResult.error) {
      if (!body.requestId) {
        await this.db.client.from('posts').delete().eq('id', post.id);
        await this.db.client.storage.from('post-images').remove([objectKey]);
      }
      this.db.check(mediaResult.error);
    }

    return this.publish(userId, post.id);
  }

  // Suggests editable details from a photo without creating or publishing a post.
  async suggest(file: Express.Multer.File | undefined) {
    this.validatePhoto(file);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('AI is unavailable. You can still publish manually.');
    }

    try {
      const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      return await this.generateDetails(apiKey, model, file.buffer, file.mimetype);
    } catch {
      throw new ServiceUnavailableException('AI could not fill the details. You can still publish manually.');
    }
  }

  // Accepts only supported image files within the photo size limit.
  private validatePhoto(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) throw new BadRequestException('A photo is required');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Use JPEG, PNG, or WebP');
    }
    if (file.size > 6 * 1024 * 1024 || file.buffer.length > 6 * 1024 * 1024) {
      throw new BadRequestException('Max photo size is 6 MB');
    }

    const bytes = file.buffer;
    let validImage = false;
    if (file.mimetype === 'image/jpeg') {
      validImage = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    } else if (file.mimetype === 'image/png') {
      validImage = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } else if (file.mimetype === 'image/webp') {
      validImage = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP';
    }
    if (!validImage) throw new BadRequestException('The photo does not match its image format');
  }

  // Counts the lifetime from publication for current activities or from a future start.
  private activityExpiration(activityAt: string, publishedAt: Date = new Date()) {
    const hours = Math.min(24, Math.max(1, Number(process.env.POST_LIFETIME_HOURS || 4)));
    const startsAt = new Date(activityAt).getTime();
    const publicationTime = publishedAt.getTime();
    let expiresAt = startsAt + hours * 3600000;
    if (!Number.isFinite(expiresAt) || expiresAt <= publicationTime) {
      throw new BadRequestException('Choose a current or future activity time; this activity would already be expired');
    }

    if (startsAt <= publicationTime) {
      expiresAt = publicationTime + hours * 3600000;
    }
    return new Date(expiresAt).toISOString();
  }

  // Generates activity details from the photo and records the analysis result.
  async analyze(postId: string, userId: string, imageBuffer?: Buffer, mime?: string) {
    const { data: post, error } = await this.db.client.from('posts').select('*').eq('id', postId).single();
    this.db.check(error);
    if (post.creator_id !== userId) throw new ForbiddenException();
    if (!['ANALYZING', 'FAILED'].includes(post.status)) throw new BadRequestException('This post cannot be reanalyzed');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is required to generate post details');

    if (!imageBuffer) {
      const photo = await this.loadPhoto(postId);
      imageBuffer = photo.buffer;
      mime = photo.mime;
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const { data: jobs } = await this.db.client
      .from('ai_analysis_jobs')
      .select('id,attempts')
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .limit(1);
    const job = jobs?.[0];
    if (job) {
      await this.db.client
        .from('ai_analysis_jobs')
        .update({ status: 'PROCESSING', attempts: job.attempts + 1, updated_at: new Date().toISOString() })
        .eq('id', job.id);
    }

    try {
      const details = await this.generateDetails(apiKey, model, imageBuffer, mime);
      const update = await this.db.client
        .from('posts')
        .update({ ...details, status: 'READY' })
        .eq('id', postId);
      this.db.check(update.error);

      if (job) {
        await this.db.client
          .from('ai_analysis_jobs')
          .update({
            status: 'SUCCEEDED',
            model_name: model,
            error_message: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await this.db.client.from('posts').update({ status: 'FAILED' }).eq('id', postId);

      if (job) {
        await this.db.client
          .from('ai_analysis_jobs')
          .update({ status: 'FAILED', error_message: message, updated_at: new Date().toISOString() })
          .eq('id', job.id);
      }

      throw new ServiceUnavailableException('AI analysis failed. Try again from My Posts.');
    }

    return this.post(userId, postId);
  }

  // Reloads the stored photo when analysis is retried.
  private async loadPhoto(postId: string) {
    const { data: media, error } = await this.db.client
      .from('media_assets')
      .select('*')
      .eq('post_id', postId)
      .single();
    this.db.check(error);

    const download = await this.db.client.storage.from('post-images').download(media.object_key);
    if (download.error || !download.data) {
      throw new ServiceUnavailableException('Could not reload the photo');
    }

    const buffer = Buffer.from(await download.data.arrayBuffer());
    return { buffer, mime: media.mime_type };
  }

  // Requests activity details from the photo and checks the generated values.
  private async generateDetails(apiKey: string, model: string, imageBuffer: Buffer, mime?: string) {
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model,
      max_output_tokens: 350,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Describe ONLY what is visually supported by the image as an inviting, short local activity post. Do not claim a verified current event, exact location, or time. Return ONLY a JSON object with title (under 100 chars), description (under 500 chars), category (one of Food, Sports, Music, Outdoors, Social, Other), labels (array of 1-5 short tags). Avoid identifying people.'
          },
          {
            type: 'input_image',
            image_url: `data:${mime || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`,
            detail: 'low'
          },
        ]
      }],
    });

    const responseText = response.output_text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const generatedDetails = JSON.parse(responseText);
    const title = String(generatedDetails.title || '').trim().slice(0, 100);
    const description = String(generatedDetails.description || '').trim().slice(0, 1000);
    if (!title || !description) {
      throw new Error('AI returned incomplete post details');
    }

    const categories = ['Food', 'Sports', 'Music', 'Outdoors', 'Social', 'Other'];
    let category = 'Other';
    if (categories.includes(generatedDetails.category)) {
      category = generatedDetails.category;
    }

    let labels: string[] = [];
    if (Array.isArray(generatedDetails.labels)) {
      labels = generatedDetails.labels.slice(0, 5).map((label: unknown) => String(label).slice(0, 30));
    }

    return { title, description, category, labels };
  }

  // Publishes a ready activity with its expiration time.
  async publish(userId: string, id: string) {
    const { data: post, error } = await this.db.client.from('posts').select('*').eq('id', id).single();
    this.db.check(error);
    if (post.creator_id !== userId) throw new ForbiddenException();
    if (post.status === 'PUBLISHED') return this.post(userId, id);
    if (post.status !== 'READY') throw new BadRequestException('Post is not ready for publication');
    if (!post.title?.trim() || !post.description?.trim() || !post.place_name?.trim() || !post.category) {
      throw new BadRequestException('Add a title, description, category, and location before publishing');
    }

    const { data: media, error: mediaError } = await this.db.client
      .from('media_assets').select('id').eq('post_id', id).maybeSingle();
    this.db.check(mediaError);
    if (!media) throw new BadRequestException('A photo is required before publishing');

    const now = new Date();
    // Older AI drafts do not have an activity time, so publication starts them now.
    const activityAt = post.activity_at || now.toISOString();
    const expiresAt = this.activityExpiration(activityAt, now);
    const { error: updateError } = await this.db.client
      .from('posts')
      .update({
        status: 'PUBLISHED',
        published_at: now.toISOString(),
        activity_at: activityAt,
        expires_at: expiresAt
      })
      .eq('id', id)
      .eq('status', 'READY');
    this.db.check(updateError);
    return this.post(userId, id);
  }

  // Deletes an owned activity and removes its stored photo.
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
