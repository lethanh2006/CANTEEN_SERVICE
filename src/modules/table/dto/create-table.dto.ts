import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(1)
  capacity!: number;
}
