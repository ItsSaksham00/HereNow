import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseService } from './common/supabase.service';
import { AuthGuard } from './auth/auth.guard';
import { UsersController } from './users/users.controller';
import { PostsController } from './posts/posts.controller';
import { PostsService } from './posts/posts.service';
import { InterestsController } from './interests/interests.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { CommentsController } from './comments/comments.controller';
import { LocationsController } from './locations/locations.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [UsersController, PostsController, InterestsController, NotificationsController, CommentsController, LocationsController],
  providers: [SupabaseService, PostsService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
