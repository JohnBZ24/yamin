import {
  AfterLoad,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { RoleEnum } from '../../utils/enums/roles.enum';

@Entity({ name: 'user' })
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 320, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phoneNumber: string | null;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  password?: string;

  @Exclude({ toPlainOnly: true })
  previousPassword?: string;

  @AfterLoad()
  public loadPreviousPassword(): void {
    this.previousPassword = this.password;
  }

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  firstName: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', nullable: true })
  profilePicture?: string | null;

  @Column({ type: 'integer', nullable: false })
  role: RoleEnum;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  @Index({ where: '"deletedAt" IS NULL' })
  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deletedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isEmailVerified: boolean;
}
