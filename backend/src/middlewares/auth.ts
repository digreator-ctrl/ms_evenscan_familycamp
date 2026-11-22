import { Context, Next } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { JWTPayload } from 'hono/utils/jwt/types';

export interface AdminJwtPayload extends JWTPayload {
  id: string;
  username: string;
  nama: string;
  role: string;
  exp: number;
}

/**
 * Membuat JWT token untuk admin yang berhasil login
 */
export async function createAdminToken(
  user: { id: string; username: string; nama: string; role: string },
  secret: string
): Promise<string> {
  const payload: AdminJwtPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 hari
  };
  return await sign(payload, secret, 'HS256');
}

/**
 * Mengambil secret JWT dari environment. Tidak ada nilai cadangan:
 * server ditolak beroperasi jika JWT_SECRET belum dikonfigurasi.
 */
export function getJwtSecret(c: Context): string {
  const secret = (c.env as Record<string, unknown> | undefined)?.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    throw new Error('JWT_SECRET belum dikonfigurasi (minimal 16 karakter) pada environment backend.');
  }
  return secret;
}

/**
 * Middleware untuk memverifikasi JWT token pada endpoint khusus admin
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Akses ditolak: Token otentikasi tidak ditemukan' }, 401);
  }

  const token = authHeader.substring(7).trim();
  let secret: string;

  try {
    secret = getJwtSecret(c);
  } catch (configErr: any) {
    console.error('[Auth] Konfigurasi JWT tidak valid:', configErr.message);
    return c.json({ error: 'Konfigurasi server tidak valid: JWT_SECRET belum diatur' }, 500);
  }

  try {
    const payload = (await verify(token, secret, 'HS256')) as unknown as AdminJwtPayload;
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Akses ditolak: Token tidak valid atau telah kedaluwarsa' }, 401);
  }
}

/**
 * Middleware otorisasi berbasis role. Superadmin selalu lolos.
 * Contoh: requireRole('bendahara') hanya mengizinkan superadmin & bendahara.
 */
export function requireRole(...allowedRoles: string[]) {
  return async (c: Context<{ Variables: { user: AdminJwtPayload } }>, next: Next) => {
    const user = c.get('user') as AdminJwtPayload | undefined;
    if (!user) {
      return c.json({ error: 'Akses ditolak: Sesi admin tidak ditemukan' }, 401);
    }
    if (user.role !== 'superadmin' && !allowedRoles.includes(user.role)) {
      return c.json({ error: 'Akses ditolak: role Anda tidak berwenang pada menu ini' }, 403);
    }
    await next();
  };
}
