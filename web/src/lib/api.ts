// Client HTTP typé de l'API HomeHub. `fetch` est injectable pour les tests ; `credentials` : jeton du téléphone
// appairé, ou clé de la tablette et session de la personne reconnue devant elle, envoyés avec chaque requête.
import type {
  AddressMatch,
  RouteOption,
  StopChoice,
  TransitSettings,
  HolidayChoice,
  HolidaySettings,
  Homework,
  TransitData,
  DashboardData,
  Device,
  Health,
  HomeData,
  HolidaysData,
  SchoolLife,
  Lists,
  ListTask,
  Me,
  NasData,
  Note,
  PairingCode,
  Container,
  FaceDiagnosis,
  FaceReadingInput,
  FaceSession,
  FacesOverview,
  NewTask,
  Product,
  ProductPreferences,
  ProductInfo,
  ProductRecheck,
  ScanLookup,
  DateKind,
  ExpiringSummary,
  ExpirySettings,
  LotChange,
  LotView,
  StockData,
  StockMovement,
  StockMovementResult,
  StockOutOptions,
  StockSettings,
  PublicConfig,
  Routine,
  RoutineSettings,
  ShoppingItem,
  Task,
  Timer,
  WeatherForecast,
  WeekData,
} from '../../../shared/types.ts';
import type { CameraMessages, CameraSession, PhoneSignal, TabletSignal } from '../../../shared/camera.ts';
import type { TvMessageSent } from '../../../shared/tv.ts';
import type { FitnessFamily } from '../../../shared/fitness-catalogue.ts';
import type { FitnessSettings, FitnessState, RhythmOption, SessionNumber, SessionReport, SlotChange, TabletSessionReport, WeekLog } from '../../../shared/fitness.ts';
import type { TabletSession } from '../../../shared/fitness-workout.ts';
import type { LooseUnit, NewLooseProduct } from '../../../shared/loose.ts';
import type { CheckDecision, MenuEntry, MenuView, StockLink } from '../../../shared/menu.ts';
import type { CookProposal, CookRequest, CookResult, CookUndo } from '../../../shared/cook.ts';
import type { DriveChoice, DriveProduct, DriveReadResult, DriveSettings, DriveStockHint, DriveView } from '../../../shared/drive.ts';
import type { DriveReportResult } from '../../../shared/drive-cart.ts';
import type { NotePatch, RecipeNote } from '../../../shared/recipe-notes.ts';
import type { ImportPreview, ImportResult, Recipe, RecipeContent, RecipeDraft, RecipeSummary, RereadResult } from '../../../shared/recipes.ts';

/**
 * Réponse d'un import : la recette (nouvelle ou déjà au carnet), ou de quoi la saisir à la main et pourquoi.
 * `refused` : le site refuse la lecture par HomeHub (proposer le texte copié ou la page enregistrée).
 */
export type ImportResponse = ImportResult | { draft: RecipeDraft; reason: string; refused?: boolean };

/** Réponse d'un import par texte collé ou page enregistrée : la recette déjà au carnet, ou l'aperçu à corriger. */
export type OfflineImportResponse = ImportResult | ImportPreview;

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
  /** Vie scolaire des enfants (notes, absences et retards, messages) : un parent seulement. */
  schoolLife(): Promise<SchoolLife>;
  /** Prochains passages Irigo aux arrêts suivis. */
  transit(): Promise<TransitData>;
  /** Vacances scolaires : ce qu'on en dit aujourd'hui, périodes à venir. */
  holidays(): Promise<HolidaysData>;
  timers(): Promise<Timer[]>;
  /** Réglages des routines (page « Routines ») ; les enregistrer : un parent. */
  routines(): Promise<RoutineSettings>;
  saveRoutines(settings: RoutineSettings): Promise<RoutineSettings>;
  /** Page « Transports » : réglages (les enregistrer : un parent), adresses, arrêts, lignes directes. */
  transitSettings(): Promise<TransitSettings>;
  /** Réglage des vacances scolaires (page « Vacances scolaires ») ; l'enregistrer : un parent. */
  holidaySettings(): Promise<HolidaySettings>;
  saveHolidaySettings(choice: HolidayChoice): Promise<HolidaySettings>;
  /** Vacances d'un réglage pas encore enregistré (aperçu). */
  previewHolidays(choice: NonNullable<HolidayChoice>): Promise<HolidaysData>;
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
  faces(): Promise<FacesOverview>;
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
  /** Stock de la maison (écriture : tablette ou téléphone appairé). */
  stock(): Promise<StockData>;
  /** Ce qu'est un code scanné (13 chiffres) : produit, contenant de la maison, ou inconnu. */
  scan(code: string): Promise<ScanLookup>;
  /** Produit inconnu saisi, ou « Corriger ». */
  saveProduct(code: string, info: ProductInfo): Promise<Product>;
  recheckProduct(code: string): Promise<ProductRecheck>;
  acceptBase(code: string): Promise<Product>;
  resolveConflict(code: string, take: 'mine' | 'base'): Promise<Product>;
  setProductPreferences(code: string, prefs: ProductPreferences): Promise<Product>;
  stockIn(code: string, count?: number, price?: number | null, dated?: { date: string | null; kind: DateKind | null }): Promise<StockMovementResult>;
  /** Produit sans code-barres (vrac, marché, fait maison), entré aussitôt au stock. */
  addLooseProduct(input: NewLooseProduct): Promise<StockMovementResult>;
  /** Nouvelle quantité d'un produit sans code-barres. */
  setLooseAmount(code: string, amount: number, unit: LooseUnit): Promise<StockMovementResult>;
  stockOut(code: string, options?: StockOutOptions): Promise<StockMovementResult>;
  undoStock(movementId: string): Promise<{ quantity: number }>;
  /** Historique d'un produit, du plus récent au plus ancien. */
  stockMovements(code: string): Promise<StockMovement[]>;
  /** « Oui » à la proposition de liste de courses ; `always` : d'office la prochaine fois. */
  shopProduct(code: string, always?: boolean): Promise<ShoppingItem>;
  addContainer(name: string): Promise<Container>;
  renameContainer(id: string, name: string): Promise<Container>;
  removeContainer(id: string): Promise<void>;
  emptyContainer(id: string): Promise<StockMovementResult>;
  saveStockSettings(settings: Pick<StockSettings, 'autoShop'>): Promise<StockSettings>;
  /** Seuils et durées par rayon des dates de péremption (un parent). */
  saveExpirySettings(expiry: ExpirySettings): Promise<StockSettings>;
  /** Date d'un lot, type, « Encore bon », partie à une autre date. */
  setLot(id: string, change: LotChange): Promise<{ product: Product; lot: LotView; quantity: number }>;
  /** DLC passées ou urgentes (accueil, dashboard d'un parent), jetés périmés ce mois-ci. */
  expiring(): Promise<ExpiringSummary>;
  fitness(): Promise<FitnessState>;
  addFitnessSession(report: SessionReport): Promise<FitnessState>;
  removeFitnessSession(id: string): Promise<FitnessState>;
  saveFitnessWeek(week: string, log: WeekLog): Promise<FitnessState>;
  chooseRhythm(week: string, option: RhythmOption): Promise<FitnessState>;
  changeExercise(session: SessionNumber, family: FitnessFamily, change: SlotChange | 'dismiss'): Promise<FitnessState>;
  saveFitnessSettings(settings: FitnessSettings): Promise<FitnessState>;
  /** Séance du jour de la personne reconnue devant la tablette (la lire prolonge aussi sa session). */
  tabletWorkout(): Promise<TabletSession>;
  finishTabletWorkout(report: TabletSessionReport): Promise<TabletSession>;
  /** Carnet de recettes (lecture ouverte). */
  recipes(): Promise<{ recipes: RecipeSummary[] }>;
  recipe(id: string): Promise<Recipe>;
  /** Lien partagé (ou texte qui en contient un) : la recette lue, ou de quoi la saisir à la main. */
  importRecipe(url: string): Promise<ImportResponse>;
  /** Texte copié d'une page (site qui refuse la lecture) : l'aperçu de ce qui a été compris. */
  importRecipeText(text: string, url?: string | null, title?: string | null): Promise<OfflineImportResponse>;
  /** Page enregistrée (.mhtml) : le fichier, ou le numéro d'une page reçue par « Partager ». */
  importSavedPage(page: File | { shared: string }): Promise<OfflineImportResponse>;
  /**
   * Saisie à la main ; `url` : la page d'où elle vient, quand rien n'y était lisible. `pending` : l'aperçu d'un
   * import (texte collé, page enregistrée) que cette version corrige.
   */
  createRecipe(content: RecipeContent, url?: string | null, pending?: string | null): Promise<Recipe>;
  /** Notre version (un parent, ou qui a ajouté la recette). */
  saveRecipe(id: string, content: RecipeContent): Promise<Recipe>;
  /** Relire la page d'origine sans écraser notre version (un parent, ou qui a ajouté la recette). */
  rereadRecipe(id: string): Promise<RereadResult>;
  /** Retirer du carnet : un parent. */
  removeRecipe(id: string): Promise<void>;
  /** Adresse de la photo gardée (pour une balise img). */
  recipePhotoUrl(id: string): string;
  /** Notes de la famille sur une recette (lecture ouverte). */
  recipeNotes(id: string): Promise<{ notes: RecipeNote[] }>;
  /** Laisser une note : tout membre identifié. */
  addRecipeNote(id: string, text: string): Promise<RecipeNote>;
  /** Texte modifié, note résolue ou rouverte : son auteur ou un parent. */
  changeRecipeNote(id: string, noteId: string, patch: NotePatch): Promise<RecipeNote>;
  /** Retirer une note : son auteur ou un parent. */
  removeRecipeNote(id: string, noteId: string): Promise<void>;
  /** Menu d'une semaine (son lundi ; absent : la semaine en cours), avec ses courses calculées. */
  menu(week?: string): Promise<MenuView>;
  /** Modifier le menu, les coches, les placards, les liens du stock : un parent. */
  addMenuEntry(week: string, recipeId: string, people?: number, day?: string | null): Promise<MenuEntry>;
  updateMenuEntry(id: string, change: { people?: number; day?: string | null }): Promise<MenuEntry>;
  removeMenuEntry(id: string): Promise<void>;
  setMenuHave(week: string, key: string, have: boolean): Promise<void>;
  /** « À vérifier au placard » : « J'en ai assez », « Il en faut », ou oublier la décision (`null`). */
  setMenuCheck(week: string, key: string, decision: CheckDecision | null): Promise<void>;
  /** Frais d'un repas tardif : « Acheter maintenant » (true) ou remis à plus tard (false). */
  setMenuNow(week: string, key: string, now: boolean): Promise<void>;
  setPantry(names: string[]): Promise<{ names: string[] }>;
  /** Relier un produit du stock à un ingrédient, ou `null` : « pas un ingrédient ». */
  setStockLink(code: string, link: StockLink | null): Promise<void>;
  /** Oublier la décision : le produit est de nouveau proposé. */
  forgetStockLink(code: string): Promise<void>;
  /**
   * « J'ai cuisiné » : la proposition pour un repas du menu, ou pour une recette (`entry` absent : repas pris
   * d'office ; null : hors menu). Écrire : toute la famille, comme le stock.
   */
  cookProposal(target: { entryId: string } | { recipeId: string; entryId?: string | null }, people?: number | null): Promise<CookProposal>;
  cook(target: { entryId: string } | { recipeId: string }, request: CookRequest): Promise<CookResult>;
  /** Annule un décompte (bandeau), ou celui d'un repas (menu). */
  undoCook(cook: string): Promise<CookUndo>;
  uncookMeal(entryId: string): Promise<CookUndo>;
  /** Repas passés pas encore notés cuisinés (un nombre, rien de personnel). */
  menuReminder(): Promise<{ count: number }>;
  /** Drive : enseigne, magasin de retrait et produits retenus pour les articles de la liste. */
  drive(): Promise<DriveView>;
  /** Enseigne et magasin : un parent. */
  saveDriveSettings(settings: { enseigne: DriveSettings['enseigne']; store: { name: string; url: string | null } | null }): Promise<DriveView>;
  /** Produits du stock qui ressemblent à un article (EAN et contenance à reprendre). */
  driveStock(key: string): Promise<{ hints: DriveStockHint[] }>;
  /** Lire une fiche produit partagée, une fois (rien n'est retenu) ; `stock` : même EAN au stock. */
  readDriveProduct(url: string): Promise<DriveReadResult & { stock: DriveStockHint | null }>;
  /** Retenir un produit pour un article, ou l'ajouter en secours. */
  chooseDriveProduct(input: DriveChoiceInput): Promise<DriveChoice>;
  /** Retirer un produit d'un choix (`id`), ou tout le choix. */
  forgetDriveProduct(key: string, id?: string): Promise<void>;
  /** Pièces dans un paquet d'un produit (null : oublier), pour les articles comptés en pièces. */
  setDrivePieces(key: string, id: string, pieces: number | null): Promise<DriveChoice>;
  /** Cocher ou décocher un article dans le panier en cours ; le serveur calcule produit et paquets. */
  setInBasket(itemId: string, inBasket: boolean): Promise<DriveView>;
  /**
   * Article introuvable ou en rupture pour le panier en cours : `missing` (signaler le produit qu'on mettait au
   * panier, ou retirer le signalement), `replacement` (secours choisi pour ce panier ; null : aucun).
   */
  setDriveMissing(itemId: string, change: { missing?: boolean; replacement?: string | null }): Promise<DriveView>;
  /** Nouveau panier : plus aucun article marqué « au drive ». */
  newBasket(): Promise<DriveView>;
  /** Compte rendu de l'extension « Remplir le panier » (objet collé) : lignes marquées, prix notés. */
  sendDriveReport(report: unknown): Promise<DriveReportResult>;
  /** Caméra en direct, téléphone d'un parent : ouvrir une diffusion, envoyer offre et candidats, attendre la suite. */
  /** Message d'un parent affiché sur la télé (texte nettoyé et limité par le serveur). */
  sendTvMessage(text: string): Promise<TvMessageSent>;
  openCamera(): Promise<CameraSession>;
  sendCameraSignal(id: string, signal: PhoneSignal): Promise<void>;
  cameraMessages(id: string, after: number, abort?: AbortSignal): Promise<CameraMessages>;
  /** Fermer une diffusion, même pendant la fermeture de la page (keepalive). */
  closeCamera(id: string): Promise<void>;
  /** Caméra en direct, tablette : `client` identifie la page ; `after` null : page qui démarre. */
  tabletCameraMessages(client: string, after: number | null, abort?: AbortSignal): Promise<CameraMessages & { last: number }>;
  sendTabletCameraSignal(client: string, id: string, signal: TabletSignal): Promise<void>;
  /** Message vocal enregistré, lu par l'appareil Cast `device` (Google Home, télé) ; renvoie le nom de l'appareil. */
  sendVoice(device: string, audio: Blob): Promise<{ device: string }>;
};

/** Produit à retenir pour un article (`role` : retenu, par défaut, ou secours). */
export type DriveChoiceInput = {
  key: string;
  label: string;
  role?: 'preferred' | 'fallback';
  product: Pick<DriveProduct, 'url' | 'name' | 'brand' | 'packText' | 'ean' | 'source'> & { pieces?: number | null };
};

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
    schoolLife: () => request('/school/life'),
    transit: () => request('/transit'),
    holidays: () => request('/school/holidays'),
    setRoutineDone: (ownerId, itemId, done) => send('PUT', `${ownerPath(ownerId)}/routine/${encodeURIComponent(itemId)}`, { done }),
    timers: () => request('/timers'),
    routines: () => request('/routines'),
    saveRoutines: (settings) => send('PUT', '/routines', settings),
    transitSettings: () => request('/transit/settings'),
    saveTransitSettings: (settings) => send('PUT', '/transit/settings', settings),
    holidaySettings: () => request('/school/holidays/settings'),
    saveHolidaySettings: (choice) => send('PUT', '/school/holidays/settings', { choice }),
    previewHolidays: (choice) =>
      request(`/school/holidays?${'academie' in choice ? `academie=${encodeURIComponent(choice.academie)}` : `zone=${choice.zone}`}`),
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
    stock: () => request('/stock'),
    scan: (code) => request(`/stock/scan/${encodeURIComponent(code)}`),
    saveProduct: (code, info) => send('PUT', `/stock/products/${encodeURIComponent(code)}`, info),
    recheckProduct: (code) => send('POST', `/stock/products/${encodeURIComponent(code)}/recheck`),
    acceptBase: (code) => send('POST', `/stock/products/${encodeURIComponent(code)}/accept-base`),
    resolveConflict: (code, take) => send('POST', `/stock/products/${encodeURIComponent(code)}/conflict`, { take }),
    setProductPreferences: (code, prefs) => send('PATCH', `/stock/products/${encodeURIComponent(code)}`, prefs),
    stockIn: (code, count = 1, price = null, dated) => send('POST', '/stock/in', { code, count, price, ...dated }),
    addLooseProduct: (input) => send('POST', '/stock/loose', input),
    setLooseAmount: (code, amount, unit) => send('PUT', `/stock/loose/${encodeURIComponent(code)}`, { amount, unit }),
    stockOut: (code, options = {}) => send('POST', '/stock/out', { code, ...options }),
    undoStock: (movementId) => send('POST', '/stock/undo', { movementId }),
    stockMovements: (code) => request(`/stock/products/${encodeURIComponent(code)}/movements`),
    shopProduct: (code, always = false) => send('POST', '/stock/shopping', { code, always }),
    addContainer: (name) => send('POST', '/stock/containers', { name }),
    renameContainer: (id, name) => send('PATCH', `/stock/containers/${encodeURIComponent(id)}`, { name }),
    removeContainer: (id) => send('DELETE', `/stock/containers/${encodeURIComponent(id)}`),
    emptyContainer: (id) => send('POST', `/stock/containers/${encodeURIComponent(id)}/empty`),
    saveStockSettings: (settings) => send('PUT', '/stock/settings', settings),
    saveExpirySettings: (expiry) => send('PUT', '/stock/settings/expiry', expiry),
    setLot: (id, change) => send('PUT', `/stock/lots/${encodeURIComponent(id)}`, change),
    expiring: () => request('/stock/expiring'),
    fitness: () => request('/fitness'),
    addFitnessSession: (report) => send('POST', '/fitness/sessions', report),
    removeFitnessSession: (id) => send('DELETE', `/fitness/sessions/${encodeURIComponent(id)}`),
    saveFitnessWeek: (week, log) => send('PUT', `/fitness/weeks/${encodeURIComponent(week)}`, log),
    chooseRhythm: (week, option) => send('POST', '/fitness/rhythm', { week, option }),
    changeExercise: (session, family, change) => send('POST', '/fitness/slots', { session, family, change }),
    saveFitnessSettings: (settings) => send('PUT', '/fitness/settings', settings),
    tabletWorkout: () => request('/fitness/tablet'),
    finishTabletWorkout: (report) => send('POST', '/fitness/tablet/sessions', report),
    recipes: () => request('/recipes'),
    recipe: (id) => request(`/recipes/${encodeURIComponent(id)}`),
    importRecipe: (url) => send('POST', '/recipes/import', { url }),
    importRecipeText: (text, url, title) => send('POST', '/recipes/import-text', { text, url: url || null, title: title || null }),
    importSavedPage: (page) => {
      if (!(page instanceof File)) return send('POST', '/recipes/import-page', page);
      const form = new FormData();
      form.set('page', page);
      return request('/recipes/import-page', { method: 'POST', body: form });
    },
    createRecipe: (content, url, pending) => send('POST', '/recipes', { content, url: url ?? null, ...(pending && { pending }) }),
    saveRecipe: (id, content) => send('PUT', `/recipes/${encodeURIComponent(id)}`, { content }),
    rereadRecipe: (id) => send('POST', `/recipes/${encodeURIComponent(id)}/reread`),
    removeRecipe: (id) => send('DELETE', `/recipes/${encodeURIComponent(id)}`),
    menu: (week) => request(week ? `/menu?week=${week}` : '/menu'),
    addMenuEntry: (week, recipeId, people, day = null) => send('POST', '/menu/entries', { week, recipeId, people, day }),
    updateMenuEntry: (id, change) => send('PUT', `/menu/entries/${encodeURIComponent(id)}`, change),
    removeMenuEntry: (id) => send('DELETE', `/menu/entries/${encodeURIComponent(id)}`),
    setMenuHave: (week, key, have) => send('PUT', '/menu/have', { week, key, have }),
    setMenuCheck: (week, key, decision) => send('PUT', '/menu/check', { week, key, decision }),
    setMenuNow: (week, key, now) => send('PUT', '/menu/now', { week, key, now }),
    setPantry: (names) => send('PUT', '/menu/pantry', { names }),
    setStockLink: (code, link) => send('PUT', `/menu/links/${encodeURIComponent(code)}`, { link }),
    forgetStockLink: (code) => send('DELETE', `/menu/links/${encodeURIComponent(code)}`),
    cookProposal: (target, people = null) => {
      const query = new URLSearchParams();
      if (people) query.set('people', String(people));
      if ('recipeId' in target && target.entryId !== undefined) query.set('entry', target.entryId ?? 'none');
      const base = 'recipeId' in target ? `/recipes/${encodeURIComponent(target.recipeId)}/cook` : `/menu/entries/${encodeURIComponent(target.entryId)}/cook`;
      return request(`${base}${query.size ? `?${query}` : ''}`);
    },
    cook: (target, body) =>
      'recipeId' in target
        ? send('POST', `/recipes/${encodeURIComponent(target.recipeId)}/cook`, body)
        : send('POST', `/menu/entries/${encodeURIComponent(target.entryId)}/cook`, { people: body.people, replies: body.replies }),
    undoCook: (cook) => send('DELETE', `/cooks/${encodeURIComponent(cook)}`),
    uncookMeal: (entryId) => send('DELETE', `/menu/entries/${encodeURIComponent(entryId)}/cook`),
    menuReminder: () => request('/menu/reminder'),

    drive: () => request('/drive'),
    saveDriveSettings: (settings) => send('PUT', '/drive/settings', settings),
    driveStock: (key) => request(`/drive/stock?key=${encodeURIComponent(key)}`),
    readDriveProduct: (url) => send('POST', '/drive/read', { url }),
    chooseDriveProduct: (input) => send('PUT', '/drive/choices', input),
    forgetDriveProduct: (key, id) => send('DELETE', `/drive/choices?key=${encodeURIComponent(key)}${id ? `&id=${encodeURIComponent(id)}` : ''}`),
    setDrivePieces: (key, id, pieces) => send('PUT', '/drive/pieces', { key, id, pieces }),
    setInBasket: (itemId, inBasket) => send('PUT', `/drive/basket/${encodeURIComponent(itemId)}`, { in: inBasket }),
    setDriveMissing: (itemId, change) => send('PUT', `/drive/missing/${encodeURIComponent(itemId)}`, change),
    newBasket: () => send('DELETE', '/drive/basket'),
    sendDriveReport: (report) => send('POST', '/drive/report', report),
    recipeNotes: (id) => request(`/recipes/${encodeURIComponent(id)}/notes`),
    addRecipeNote: (id, text) => send('POST', `/recipes/${encodeURIComponent(id)}/notes`, { text }),
    changeRecipeNote: (id, noteId, patch) => send('PATCH', `/recipes/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, patch),
    removeRecipeNote: (id, noteId) => send('DELETE', `/recipes/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`),
    recipePhotoUrl: (id) => `${baseUrl}/recipes/${encodeURIComponent(id)}/photo`,
    sendTvMessage: (text) => send('POST', '/tv/message', { text }),
    openCamera: () => send('POST', '/camera/sessions'),
    sendCameraSignal: (id, signal) => send('POST', `/camera/sessions/${encodeURIComponent(id)}/signal`, signal),
    cameraMessages: (id, after, abort) => request(`/camera/sessions/${encodeURIComponent(id)}/signals?after=${after}`, { signal: abort }),
    closeCamera: (id) => request(`/camera/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }),
    tabletCameraMessages: (client, after, abort) =>
      request(`/camera/tablet/signals?client=${encodeURIComponent(client)}${after === null ? '' : `&after=${after}`}`, { signal: abort }),
    sendTabletCameraSignal: (client, id, signal) => send('POST', `/camera/tablet/sessions/${encodeURIComponent(id)}/signal?client=${encodeURIComponent(client)}`, signal),
    sendVoice: (device, audio) => request(`/cast/${encodeURIComponent(device)}/voice`, { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio }),
  };
}
