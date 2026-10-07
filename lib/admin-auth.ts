import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';

export const ADMIN_KEY_HEADER = 'x-admin-key';

/**
 * Vérifie la clé admin envoyée dans l'en-tête `x-admin-key`.
 *
 * Refuse tout si ADMIN_API_KEY n'est pas configurée : un oubli de configuration
 * ne doit jamais rouvrir la route à tout le monde.
 * Les deux valeurs sont hachées avant comparaison pour que timingSafeEqual compare
 * des tampons de même longueur, sans révéler la longueur de la clé.
 */
export function isAdminRequest(request: NextRequest): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) return false;

    const provided = request.headers.get(ADMIN_KEY_HEADER);
    if (!provided) return false;

    const hash = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(hash(provided), hash(expected));
}
