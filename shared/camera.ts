// Caméra en direct : messages échangés entre le téléphone d'un parent et la tablette, par l'intermédiaire du serveur
// (signalisation WebRTC). Le serveur ne voit passer que ces messages ; l'image et le son vont d'un appareil à l'autre
// (ou par le relais TURN), et rien n'est enregistré.

/** Serveur STUN ou TURN, tel que l'attend RTCPeerConnection. */
export type IceServer = { urls: string[]; username?: string; credential?: string };

/** Candidat ICE (RTCIceCandidateInit) ; null : fin de la collecte. */
export type IceCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

/**
 * Un message de la signalisation. `start` (du serveur à la tablette) : un parent veut regarder, avec de quoi se
 * connecter ; `offer` (du téléphone), `answer` (de la tablette) : descriptions SDP ; `candidate` : chemins réseau
 * possibles ; `bye` : fin de la diffusion, de l'un ou l'autre côté, ou du serveur (délai dépassé, téléphone parti).
 */
export type CameraSignal =
  | { kind: 'start'; viewerId: string; viewerName: string; iceServers: IceServer[]; audio: boolean }
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: IceCandidate | null }
  | { kind: 'bye'; reason?: string };

/** Message numéroté d'une boîte : `session` dit de quelle diffusion il s'agit. */
export type CameraMessage = { seq: number; session: string; signal: CameraSignal };

/** Réponse d'une attente de messages : ceux qui sont arrivés (vide au bout du délai d'attente). */
export type CameraMessages = { messages: CameraMessage[] };

/** Diffusion ouverte par un téléphone. `maxSeconds` : elle s'arrête d'elle-même au bout de ce temps. */
export type CameraSession = { id: string; iceServers: IceServer[]; audio: boolean; maxSeconds: number };

/** Ce que la tablette envoie : sa réponse, ses candidats, ou la fin de la diffusion ; et le téléphone : son offre. */
export type TabletSignal = Extract<CameraSignal, { kind: 'answer' | 'candidate' | 'bye' }>;
export type PhoneSignal = Extract<CameraSignal, { kind: 'offer' | 'candidate' | 'bye' }>;

/** Texte du bandeau de la tablette pendant une diffusion. */
export function liveBanner(names: readonly string[]): string | null {
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  return `Caméra en direct · ${unique.join(', ')}`;
}
