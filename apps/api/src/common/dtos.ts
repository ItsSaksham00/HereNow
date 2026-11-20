import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class LocationSearchQuery {
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(3)
  @MaxLength(120)
  q!: string;
}

export class NearbyQuery {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  radius: number = 10;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset: number = 0;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(40)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsIn(['now', 'upcoming', 'all'])
  time: string = 'now';
}

export class EditPostDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1, { message: 'Location name is required' })
  @MaxLength(150)
  placeName!: string;

  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1, { message: 'Activity title is required' })
  @MaxLength(100)
  title!: string;

  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1, { message: 'Description is required' })
  @MaxLength(1000)
  description!: string;

  @IsIn(['Food', 'Sports', 'Music', 'Outdoors', 'Social', 'Other'])
  category!: string;

  @IsDateString({ strict: true, strictSeparator: true }, { message: 'Choose a valid activity date and time' })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'Activity time must include a timezone' })
  activityAt!: string;
}

export class CreatePostDto extends EditPostDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  labels?: string[];
}

export class MyPostsQuery {
  @IsIn(['active', 'upcoming', 'expired', 'all'])
  filter: string = 'all';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  limit: number = 40;
}

export class EditProfileDto {
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(60)
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(300)
  bio?: string;
}

export class AddCommentDto {
  @IsString()
  @MaxLength(500)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9-]+$/)
  clientRequestId?: string;
}
