export type UserRole =
    | 'buyer'
    | 'seller'
    | 'admin'

export type AccessPayload = {
    sub: string
    role: UserRole
    jti: string
    iat: number
    exp: number
    iss: string
    aud: string
}

export type AuthenticatedUser = {
    id: string
    role: UserRole
    jti: string
    exp: number
}
