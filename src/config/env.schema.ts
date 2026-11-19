import { z } from 'zod'

export const envSchema = z.object({
    PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(3000),

    DATABASE_URL: z
        .string()
        .min(1)
        .optional(),

    DB_URL: z
        .string()
        .min(1)
        .optional(),

    DB_HOST: z
        .string()
        .min(1)
        .optional(),

    DB_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(5432),

    DB_NAME: z
        .string()
        .min(1)
        .optional(),

    DB_USER: z
        .string()
        .min(1)
        .optional(),

    DB_PASSWORD_FILE: z
        .string()
        .min(1)
        .default('secrets/db_password')
}).superRefine(
    (config, context) => {
        if (
            config.DATABASE_URL ||
            config.DB_URL
        ) {
            return
        }

        for (
            const key
            of [
                'DB_HOST',
                'DB_NAME',
                'DB_USER'
            ] as const
        ) {
            if (!config[key]) {
                context.addIssue({
                    code:
                        'custom',
                    path: [
                        key
                    ],
                    message:
                        `${key} is required when DATABASE_URL/DB_URL is not set`
                })
            }
        }
    }
)

export type Env =
    z.infer<typeof envSchema>

export function validateEnv(
    config: Record<string, unknown>
): Env {
    const result =
        envSchema.safeParse(config)

    if (!result.success) {
        const errors =
            result.error.issues
                .map(issue => {
                    const variable =
                        issue.path.join('.')

                    return `${variable}: ${issue.message}`
                })
                .join('\n')

        throw new Error(
            `Invalid environment configuration:\n${errors}`
        )
    }

    return result.data
}
