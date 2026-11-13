// Tests du partage de la caméra : une seule ouverture pour plusieurs demandes (même pendant l'ouverture), extinction
// quand la dernière la rend, libération en double sans effet, échec d'ouverture, flux arrêté par le système rouvert,
// micro à part.
import { describe, expect, it } from 'vitest';
import { createCameraShare } from './camera-share.ts';

type FakeTrack = { readyState: 'live' | 'ended'; stop(): void };

function fakeMedia() {
  const opened: { constraints: MediaStreamConstraints; tracks: FakeTrack[] }[] = [];
  let fail: Error | null = null;
  const getUserMedia = async (constraints: MediaStreamConstraints) => {
    await Promise.resolve();
    if (fail) throw fail;
    const track: FakeTrack = { readyState: 'live', stop: () => (track.readyState = 'ended') };
    opened.push({ constraints, tracks: [track] });
    return { getTracks: () => [track] } as unknown as MediaStream;
  };
  return { opened, getUserMedia, failWith: (err: Error | null) => (fail = err) };
}

const FRONT = { video: { facingMode: 'user' }, audio: false };

describe('caméra partagée', () => {
  it('une seule ouverture pour deux demandes, même simultanées ; éteinte à la dernière libération', async () => {
    const media = fakeMedia();
    const share = createCameraShare(media.getUserMedia);
    const [face, live] = await Promise.all([share.acquire('user', FRONT), share.acquire('user', { video: true })]);
    expect(media.opened).toHaveLength(1);
    expect(media.opened[0].constraints).toBe(FRONT);
    expect(face.stream).toBe(live.stream);
    expect(share.users('user')).toBe(2);

    face.release();
    face.release(); // sans effet la seconde fois
    expect(media.opened[0].tracks[0].readyState).toBe('live');
    live.release();
    expect(media.opened[0].tracks[0].readyState).toBe('ended');
    expect(share.users('user')).toBe(0);

    await share.acquire('user', FRONT);
    expect(media.opened).toHaveLength(2);
  });

  it('échec d’ouverture : rejeté pour tous, la demande suivante réessaie', async () => {
    const media = fakeMedia();
    const share = createCameraShare(media.getUserMedia);
    media.failWith(Object.assign(new Error('refusée'), { name: 'NotAllowedError' }));
    await expect(share.acquire('user', FRONT)).rejects.toThrow('refusée');
    expect(share.users('user')).toBe(0);
    media.failWith(null);
    await expect(share.acquire('user', FRONT)).resolves.toBeDefined();
  });

  it('flux arrêté par le système : rouvert à la demande suivante', async () => {
    const media = fakeMedia();
    const share = createCameraShare(media.getUserMedia);
    await share.acquire('user', FRONT);
    media.opened[0].tracks[0].readyState = 'ended';
    const again = await share.acquire('user', FRONT);
    expect(media.opened).toHaveLength(2);
    expect(again.stream.getTracks()[0]).toBe(media.opened[1].tracks[0]);
  });

  it('le micro et l’autre caméra sont ouverts à part', async () => {
    const media = fakeMedia();
    const share = createCameraShare(media.getUserMedia);
    await share.acquire('user', FRONT);
    await share.acquire('microphone', { audio: true, video: false });
    await share.acquire('environment', { video: { facingMode: 'environment' } });
    expect(media.opened).toHaveLength(3);
  });
});
