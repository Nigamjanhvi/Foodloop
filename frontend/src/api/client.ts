import axios from 'axios';

export const api = axios.create({
  // Use Vite's same-origin API proxy in development. Production can point this
  // at its API origin through VITE_API_URL when it is hosted separately.
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('foodloop.accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { field: string; message: string }[] };
}
