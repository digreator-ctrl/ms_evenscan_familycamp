import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/**
 * Guard otentikasi admin untuk semua rute terproteksi (termasuk scanner layar penuh).
 */
export function AuthGuard() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok && !cancelled) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          navigate('/login');
        }
      } catch {
        /* gangguan jaringan: jangan paksa logout */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return <Outlet />;
}
