import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PostsService } from './posts.service';
import { CreatePostDto, NearbyQuery } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}
  @Get('nearby') nearby(@Req() req: AuthRequest, @Query() query: NearbyQuery) { return this.posts.nearby(req.userId, query); }
  @Get('mine') mine(@Req() req: AuthRequest) { return this.posts.myPosts(req.userId); }
  @Get(':id') one(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.posts.post(req.userId, id); }
  @Post()
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } }))
  create(@Req() req: AuthRequest, @Body() body: CreatePostDto, @UploadedFile() file: Express.Multer.File) {
    return this.posts.create(req.userId, body, file);
  }
  @Post(':id/analyze') analyze(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.posts.analyze(id, req.userId); }
  @Post(':id/publish') publish(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.posts.publish(req.userId, id); }
  @Delete(':id') delete(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.posts.delete(req.userId, id); }
}
