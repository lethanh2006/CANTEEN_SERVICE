import { IsNumber, Min } from 'class-validator';

export class AllocateTableDto {
  @IsNumber()
  @Min(1)
  partySize: number;
}
