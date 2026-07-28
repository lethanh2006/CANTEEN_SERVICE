import { IsString, IsIn } from 'class-validator';

export class UpdateTableStatusDto {
  @IsString()
  @IsIn(['empty', 'occupied', 'reserved'])
  status: 'empty' | 'occupied' | 'reserved';
}
