import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pesertaRoutes } from './routes/peserta';
import { adminRoutes } from './routes/admin';
import { absensiRoutes } from './routes/absensi';
import { ensureFamilyCampTables } from './db/db-init';

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Auto-init database tables on first request
app.use('*', async (c, next) => {
  if (c.env.DB) {
    await ensureFamilyCampTables(c.env.DB);
  }
  await next();
});

// Health check
app.get('/', (c) => {
  return c.json({ message: 'MS EvenScan Family Camp API is running', status: 'ok' });
});

// Routes
app.route('/api/peserta', pesertaRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/absensi', absensiRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Endpoint tidak ditemukan' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Terjadi kesalahan server' }, 500);
});

export default app;
