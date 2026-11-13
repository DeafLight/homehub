// Caméra et micro partagés sur un appareil : la reconnaissance faciale, le scanner et la caméra en direct demandent
// le même flux au lieu d'ouvrir la caméra deux fois (Android refuse souvent une seconde ouverture). Chaque demande
// rend une fonction qui la libère ; le flux s'éteint quand plus personne ne s'en sert. Une demande pendant
// l'ouverture attend la même ouverture. Les réglages (taille de l'image) sont ceux de la première demande.
import type { Facing } from './scan.ts';

/** Ce qu'on partage : une caméra (avant ou arrière), ou le micro. */
export type Device = Facing | 'microphone';

export type Held = { stream: MediaStream; release: () => void };

type Entry = { users: number; opening: Promise<MediaStream>; stream?: MediaStream };

export type CameraShare = {
  /** Flux de `device`, ouvert avec `constraints` s'il ne l'est pas encore. */
  acquire(device: Device, constraints: MediaStreamConstraints): Promise<Held>;
  /** Combien de demandes tiennent ce flux (tests, diagnostic). */
  users(device: Device): number;
};

export function createCameraShare(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>): CameraShare {
  const entries = new Map<Device, Entry>();

  const stop = (stream: MediaStream) => {
    for (const track of stream.getTracks()) track.stop();
  };

  async function acquire(device: Device, constraints: MediaStreamConstraints): Promise<Held> {
    let entry = entries.get(device);
    // Flux arrêté par le système (caméra reprise par une autre appli, écran éteint) : on le rouvre.
    if (entry?.stream && entry.stream.getTracks().every((t) => t.readyState === 'ended')) {
      entries.delete(device);
      entry = undefined;
    }
    if (!entry) {
      const created: Entry = { users: 0, opening: getUserMedia(constraints) };
      entries.set(device, created);
      created.opening.then(
        (stream) => (created.stream = stream),
        () => entries.get(device) === created && entries.delete(device),
      );
      entry = created;
    }
    entry.users++;
    const mine = entry;
    let stream: MediaStream;
    try {
      stream = await mine.opening;
    } catch (err) {
      mine.users--;
      throw err;
    }
    let released = false;
    return {
      stream,
      release() {
        if (released) return;
        released = true;
        mine.users--;
        if (mine.users > 0) return;
        stop(stream);
        if (entries.get(device) === mine) entries.delete(device);
      },
    };
  }

  return { acquire, users: (device) => entries.get(device)?.users ?? 0 };
}

/** Le partage de cet appareil. */
export const cameraShare: CameraShare = createCameraShare((constraints) => navigator.mediaDevices.getUserMedia(constraints));
