// Client HTTP typé de l'API HomeHub. `fetch` est injectable pour les tests.
import type { DashboardData, Health, HomeData, PublicConfig, Task, WeatherForecast, WeekData } from '../../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type Api = {
  health(): Promise<Health>;
  config(): Promise<PublicConfig>;
  home(): Promise<HomeData>;
  dashboard(ownerId: string): Promise<DashboardData>;
  weather(): Promise<{ forecast: WeatherForecast | null }>;
  week(offset: number): Promise<WeekData>;
  setTaskDone(ownerId: string, taskId: string, done: boolean): Promise<Task>;
};

export function createApi(fetchFn: typeof fetch = (...args) => fetch(...args), baseUrl = '/api'): Api {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(`${baseUrl}${path}`, init);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  const ownerPath = (ownerId: string) => `/dashboard/${encodeURIComponent(ownerId)}`;

  return {
    health: () => request('/health'),
    config: () => request('/config'),
    home: () => request('/home'),
    dashboard: (ownerId) => request(ownerPath(ownerId)),
    weather: () => request('/weather'),
    week: (offset) => request(`/week?offset=${offset}`),
    setTaskDone: (ownerId, taskId, done) =>
      request(`${ownerPath(ownerId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      }),
  };
}
