import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PostsService } from './posts.service';
import { CreatePostDto, EditPostDto, MyPostsQuery, NearbyQuery } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  // Returns activities near the requested location.
  @Get('nearby')
  nearby(@Req() request: AuthRequest, @Query() query: NearbyQuery) {
    return this.posts.nearby(request.userId, query);
  }

  // Returns the signed-in user’s posts.
  @Get('mine')
  mine(@Req() request: AuthRequest, @Query() query: MyPostsQuery) {
    return this.posts.myPosts(request.userId, query);
  }

  // Returns the requested activity.
  @Get(':id')
  one(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.post(request.userId, id);
  }

  // Publishes a photo and the details entered by the user.
  @Post()
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } }))
  create(@Req() request: AuthRequest, @Body() body: CreatePostDto, @UploadedFile() file: Express.Multer.File) {
    return this.posts.create(request.userId, body, file);
  }

  // Returns optional AI suggestions without saving a post.
  @Post('suggest')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } }))
  suggest(@UploadedFile() file: Express.Multer.File) {
    return this.posts.suggest(file);
  }

  // Retries photo analysis for an owned activity.
  @Post(':id/analyze')
  analyze(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.analyze(id, request.userId);
  }

  // Publishes an owned activity that is ready.
  @Post(':id/publish')
  publish(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.publish(request.userId, id);
  }

  // Saves editable details without replacing the activity photo or social records.
  @Patch(':id')
  update(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: EditPostDto) {
    return this.posts.update(request.userId, id, body);
  }

  // Deletes an activity owned by the signed-in user.
  @Delete(':id')
  delete(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.delete(request.userId, id);
  }
}
