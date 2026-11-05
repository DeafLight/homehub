// Client HTTP typé de l'API HomeHub. `fetch` est injectable pour les tests ; `credentials` : jeton du téléphone
// appairé, ou clé de la tablette et session de la personne reconnue devant elle, envoyés avec chaque requête.
import type {
  AddressMatch,
  RouteOption,
  StopChoice,
  TransitSettings,
  Homework,
  TransitData,
  DashboardData,
  Device,
  Health,
  HomeData,
  Lists,
  ListTask,
  Me,
  NasData,
  Note,
  PairingCode,
  PublicConfig,
  Repeat,
  Routine,
  RoutineSettings,
  ShoppingItem,
  Task,
  Timer,
  WeatherForecast,
  WeekData,
} from '../../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  /** Refus de la tablette faute de personne reconnue : il faut d'abord regarder la caméra. */
  readonly identify: boolean;

  constructor(status: number, message: string, identify = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.identify = identify;
  }
}

export type FaceSession = { ownerId: string; token: string; expiresAt: string };

export type FaceReadingInput = { embedding: number[]; real: number; live: number };

/** Verdict du serveur sur une analyse (voir server/sources/faces.ts), pour le diagnostic. */
export type FaceDiagnosis = {
  verdict: { result: 'ok' | 'photo' | 'screen' | 'none' | 'low' | 'close'; ownerId: string | null; score: number; next: number };
  scores: { ownerId: string; score: number }[];
  rules: { threshold: number; margin: number; antispoof: number; liveness: number };
};

export type Api = {
  health(): Promise<Health>;
  config(): Promise<PublicConfig>;
  home(): Promise<HomeData>;
  dashboard(ownerId: string): Promise<DashboardData>;
  weather(): Promise<{ forecast: WeatherForecast | null }>;
  week(offset: number): Promise<WeekData>;
  nas(): Promise<NasData>;
  setTaskDone(ownerId: string, taskId: string, done: boolean): Promise<Task>;
  /** Étape de la routine du jour (`itemId` : `<période>-<rang>`). */
  setRoutineDone(ownerId: string, itemId: string, done: boolean): Promise<Task>;
  /** Routine du moment seule (appli du téléphone). */
  routine(ownerId: string): Promise<{ routine: Routine | null }>;
  /** Devoirs à faire seuls (appli du téléphone) ; null sans cahier de texte. */
  homework(ownerId: string): Promise<{ homework: Homework[] | null }>;
  /** Prochains passages Irigo aux arrêts suivis. */
  transit(): Promise<TransitData>;
  timers(): Promise<Timer[]>;
  /** Réglages des routines (page « Routines ») ; les enregistrer : un parent. */
  routines(): Promise<RoutineSettings>;
  saveRoutines(settings: RoutineSettings): Promise<RoutineSettings>;
  /** Page « Transports » : réglages (les enregistrer : un parent), adresses, arrêts, lignes directes. */
  transitSettings(): Promise<TransitSettings>;
  saveTransitSettings(settings: Omit<TransitSettings, 'saved'>): Promise<TransitSettings>;
  searchAddresses(query: string): Promise<{ addresses: AddressMatch[] }>;
  searchStops(query: string): Promise<{ stops: StopChoice[] }>;
  stopsNear(point: { lat: number; lon: number }): Promise<{ stops: StopChoice[] }>;
  transitRoutes(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<{ routes: RouteOption[] }>;
  startTimer(label: string, seconds: number): Promise<Timer>;
  stopTimer(id: string): Promise<void>;
  me(): Promise<Me>;
  lists(): Promise<Lists>;
  addShopping(label: string): Promise<ShoppingItem>;
  setShoppingDone(id: string, done: boolean): Promise<ShoppingItem>;
  removeShopping(id: string): Promise<void>;
  clearShopping(): Promise<void>;
  addTask(task: NewTask): Promise<ListTask>;
  setListTaskDone(id: string, done: boolean): Promise<ListTask>;
  removeTask(id: string): Promise<void>;
  /** Mots des 7 derniers jours, vus ou non. */
  notes(): Promise<Note[]>;
  /** `from` : profil ouvert sur la tablette (un téléphone envoie toujours depuis le sien). */
  addNote(to: string, text: string, from?: string | null): Promise<Note>;
  markNoteSeen(id: string): Promise<Note>;
  /** Visages enregistrés (tablette seule). */
  faces(): Promise<{ enrolled: string[]; samples: Record<string, { enrolled: number; learned: number }> }>;
  identifyFace(reading: FaceReadingInput): Promise<FaceSession>;
  /** Verdict détaillé d'une analyse, sans session (diagnostic). */
  diagnoseFace(reading: FaceReadingInput): Promise<FaceDiagnosis>;
  endFaceSession(): Promise<void>;
  /** Enregistrer ou retirer un visage : code parent. */
  enrollFace(ownerId: string, embeddings: number[][], pin: string): Promise<void>;
  removeFace(ownerId: string, pin: string): Promise<void>;
  /** Profils dont la tablette doit demander le PIN avant d'afficher le QR code ; code parent défini. */
  pairingPins(): Promise<{ protected: string[]; parent: boolean }>;
  createPairing(ownerId: string, pin?: string): Promise<PairingCode>;
  claimPairing(code: string, name: string, system?: string | null): Promise<{ token: string; device: Device }>;
  devices(): Promise<Device[]>;
  renameDevice(id: string, name: string): Promise<Device>;
  /** `pin` : celui du propriétaire ou le code parent, quand l'un d'eux est défini. */
  removeDevice(id: string, pin?: string): Promise<void>;
};

export type NewTask = { label: string; ownerId: string; due: string | null; repeat: Repeat | null };

export type Credentials = { token?: string | null; kioskKey?: string | null; actor?: string | null };

export function createApi(
  fetchFn: typeof fetch = (...args) => fetch(...args),
  baseUrl = '/api',
  credentials: () => Credentials = () => ({}),
  /** Appelé à chaque refus du serveur, avant que l'erreur remonte. */
  onError: (err: ApiError) => void = () => {},
): Api {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token, kioskKey, actor } = credentials();
    const auth = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(kioskKey && { 'X-Kiosk-Key': kioskKey }),
      ...(actor && { 'X-Actor-Session': actor }),
    };
    const res = await fetchFn(`${baseUrl}${path}`, Object.keys(auth).length ? { ...init, headers: { ...init?.headers, ...auth } } : init);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body?.identify === true);
      onError(err);
      throw err;
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
    setTaskDone: (ownerId, taskId, done) => send('PUT', `${ownerPath(ownerId)}/tasks/${encodeURIComponent(taskId)}`, { done }),
    routine: (ownerId) => request(`${ownerPath(ownerId)}/routine`),
    homework: (ownerId) => request(`${ownerPath(ownerId)}/homework`),
    transit: () => request('/transit'),
    setRoutineDone: (ownerId, itemId, done) => send('PUT', `${ownerPath(ownerId)}/routine/${encodeURIComponent(itemId)}`, { done }),
    timers: () => request('/timers'),
    routines: () => request('/routines'),
    saveRoutines: (settings) => send('PUT', '/routines', settings),
    transitSettings: () => request('/transit/settings'),
    saveTransitSettings: (settings) => send('PUT', '/transit/settings', settings),
    searchAddresses: (query) => request(`/transit/addresses?q=${encodeURIComponent(query)}`),
    searchStops: (query) => request(`/transit/stops?q=${encodeURIComponent(query)}`),
    stopsNear: (p) => request(`/transit/stops?near=${p.lat},${p.lon}`),
    transitRoutes: (from, to) => request(`/transit/routes?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`),
    startTimer: (label, seconds) => send('POST', '/timers', { label, seconds }),
    stopTimer: (id) => send('DELETE', `/timers/${encodeURIComponent(id)}`),
    me: () => request('/me'),
    lists: () => request('/lists'),
    addShopping: (label) => send('POST', '/lists/shopping', { label }),
    setShoppingDone: (id, done) => send('PUT', `/lists/shopping/${encodeURIComponent(id)}`, { done }),
    removeShopping: (id) => send('DELETE', `/lists/shopping/${encodeURIComponent(id)}`),
    clearShopping: () => send('POST', '/lists/shopping/clear'),
    addTask: (task) => send('POST', '/lists/tasks', task),
    setListTaskDone: (id, done) => send('PUT', `/lists/tasks/${encodeURIComponent(id)}`, { done }),
    removeTask: (id) => send('DELETE', `/lists/tasks/${encodeURIComponent(id)}`),
    notes: () => request('/notes'),
    addNote: (to, text, from) => send('POST', '/notes', { to, text, from }),
    markNoteSeen: (id) => send('PUT', `/notes/${encodeURIComponent(id)}/seen`),
    faces: () => request('/faces'),
    identifyFace: (reading) => send('POST', '/faces/identify', reading),
    diagnoseFace: (reading) => send('POST', '/faces/diagnose', reading),
    endFaceSession: () => send('DELETE', '/faces/session'),
    enrollFace: (ownerId, embeddings, pin) => send('POST', `/faces/${encodeURIComponent(ownerId)}`, { embeddings, pin }),
    removeFace: (ownerId, pin) => send('DELETE', `/faces/${encodeURIComponent(ownerId)}`, { pin }),
    pairingPins: () => request('/pairing/pins'),
    createPairing: (ownerId, pin) => send('POST', '/pairing', { ownerId, pin }),
    claimPairing: (code, name, system) => send('POST', '/pairing/claim', { code, name, system }),
    devices: () => request('/devices'),
    renameDevice: (id, name) => send('PATCH', `/devices/${encodeURIComponent(id)}`, { name }),
    removeDevice: (id, pin) => send('DELETE', `/devices/${encodeURIComponent(id)}`, pin ? { pin } : undefined),
  };
}
