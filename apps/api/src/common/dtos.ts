import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NearbyQuery {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @Type(() => Number) @IsNumber() @Min(0.1) @Max(50) radius: number = 10;
  @Type(() => Number) @IsNumber() @Min(0) offset: number = 0;
  @Type(() => Number) @IsNumber() @Min(1) @Max(40) limit: number = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(50) category?: string;
}
export class CreatePostDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsString() @MaxLength(150) placeName!: string;
}
export class EditProfileDto {
  @IsString() @MaxLength(60) displayName!: string;
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
}
export class AddCommentDto {
  @IsString() @MaxLength(500) body!: string;
}
