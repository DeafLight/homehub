// Client HTTP typé de l'API HomeHub. `fetch` est injectable pour les tests ; `credentials` : jeton du téléphone
// appairé, ou clé de la tablette, envoyés avec chaque requête.
import type {
  DashboardData,
  Device,
  Health,
  HomeData,
  Lists,
  ListTask,
  Me,
  NasData,
  PairingCode,
  PublicConfig,
  Repeat,
  ShoppingItem,
  Task,
  WeatherForecast,
  WeekData,
} from '../../../shared/types.ts';

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
  nas(): Promise<NasData>;
  /** `by` : profil ouvert sur la tablette (ignoré pour un téléphone, qui agit au nom du sien). */
  setTaskDone(ownerId: string, taskId: string, done: boolean, by?: string | null): Promise<Task>;
  me(): Promise<Me>;
  lists(): Promise<Lists>;
  addShopping(label: string, by?: string | null): Promise<ShoppingItem>;
  setShoppingDone(id: string, done: boolean, by?: string | null): Promise<ShoppingItem>;
  removeShopping(id: string): Promise<void>;
  clearShopping(): Promise<void>;
  addTask(task: NewTask, by?: string | null): Promise<ListTask>;
  setListTaskDone(id: string, done: boolean, by?: string | null): Promise<ListTask>;
  removeTask(id: string): Promise<void>;
  /** Profils dont la tablette doit demander le PIN avant d'afficher le QR code ; code parent défini. */
  pairingPins(): Promise<{ protected: string[]; parent: boolean }>;
  createPairing(ownerId: string, pin?: string): Promise<PairingCode>;
  claimPairing(code: string, name: string): Promise<{ token: string; device: Device }>;
  devices(): Promise<Device[]>;
  /** `pin` : celui du propriétaire ou le code parent, quand l'un d'eux est défini. */
  removeDevice(id: string, pin?: string): Promise<void>;
};

export type NewTask = { label: string; ownerId: string; due: string | null; repeat: Repeat | null };

export type Credentials = { token?: string | null; kioskKey?: string | null };

export function createApi(
  fetchFn: typeof fetch = (...args) => fetch(...args),
  baseUrl = '/api',
  credentials: () => Credentials = () => ({}),
): Api {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token, kioskKey } = credentials();
    const auth = { ...(token && { Authorization: `Bearer ${token}` }), ...(kioskKey && { 'X-Kiosk-Key': kioskKey }) };
    const res = await fetchFn(`${baseUrl}${path}`, Object.keys(auth).length ? { ...init, headers: { ...init?.headers, ...auth } } : init);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  const send = <T>(method: string, path: string, body?: unknown) =>
    request<T>(path, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

  const ownerPath = (ownerId: string) => `/dashboard/${encodeURIComponent(ownerId)}`;

  return {
    health: () => request('/health'),
    config: () => request('/config'),
    home: () => request('/home'),
    dashboard: (ownerId) => request(ownerPath(ownerId)),
    weather: () => request('/weather'),
    week: (offset) => request(`/week?offset=${offset}`),
    nas: () => request('/nas'),
    setTaskDone: (ownerId, taskId, done, by) => send('PUT', `${ownerPath(ownerId)}/tasks/${encodeURIComponent(taskId)}`, { done, by }),
    me: () => request('/me'),
    lists: () => request('/lists'),
    addShopping: (label, by) => send('POST', '/lists/shopping', { label, by }),
    setShoppingDone: (id, done, by) => send('PUT', `/lists/shopping/${encodeURIComponent(id)}`, { done, by }),
    removeShopping: (id) => send('DELETE', `/lists/shopping/${encodeURIComponent(id)}`),
    clearShopping: () => send('POST', '/lists/shopping/clear'),
    addTask: (task, by) => send('POST', '/lists/tasks', { ...task, by }),
    setListTaskDone: (id, done, by) => send('PUT', `/lists/tasks/${encodeURIComponent(id)}`, { done, by }),
    removeTask: (id) => send('DELETE', `/lists/tasks/${encodeURIComponent(id)}`),
    pairingPins: () => request('/pairing/pins'),
    createPairing: (ownerId, pin) => send('POST', '/pairing', { ownerId, pin }),
    claimPairing: (code, name) => send('POST', '/pairing/claim', { code, name }),
    devices: () => request('/devices'),
    removeDevice: (id, pin) => send('DELETE', `/devices/${encodeURIComponent(id)}`, pin ? { pin } : undefined),
  };
}
