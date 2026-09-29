import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn
} from 'typeorm'

export type JobStatus =
    | 'pending'
    | 'done'

@Entity('job_queue')
@Check(
    'CHK_job_queue_processed',
    `"processed" >= 0`
)
@Check(
    'CHK_job_queue_status',
    `"status" IN ('pending', 'done')`
)
@Index(
    'idx_job_queue_pending_created',
    ['status', 'createdAt']
)
export class JobQueue {
    @PrimaryGeneratedColumn({
        type: 'bigint'
    })
    id!: string

    @Column({
        type: 'varchar',
        length: 80
    })
    type!: string

    @Column({
        type: 'jsonb'
    })
    payload!: Record<string, unknown>

    @Column({
        type: 'varchar',
        length: 20,
        default: 'pending'
    })
    status!: JobStatus

    @Column({
        type: 'integer',
        default: 0
    })
    processed!: number

    @Column({
        name: 'processed_by',
        type: 'varchar',
        length: 80,
        nullable: true
    })
    processedBy!: string | null

    @Column({
        name: 'processed_at',
        type: 'timestamptz',
        nullable: true
    })
    processedAt!: Date | null

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamptz'
    })
    createdAt!: Date
}