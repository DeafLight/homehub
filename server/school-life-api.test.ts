// Tests de la vie scolaire : assemblage (enfants, notes récentes, messagerie fusionnée) et droits (un parent seulement,
// reconnu devant la tablette ou sur son téléphone ; refus pour un enfant, la tablette anonyme ou un autre appareil).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchoolGrade, SchoolLife, SchoolMessage } from '../shared/types.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { PARENTS_ONLY, createSchoolLifeApi } from './school-life-api.ts';
import { RECENT_GRADES, createSchoolLifeService } from './services/school-life.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import type { SchoolLifeData, SchoolSource } from './sources/types.ts';
import { connectedFrom, fixedClock, silentLogger } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

const message = (id: string, date: string, read = false): SchoolMessage => ({ id, subject: `Objet ${id}`, from: 'Mme Durand', date, read });
const grade = (id: string, date: string): SchoolGrade => ({ id, subject: 'Mathematiques', date, value: '15', outOf: 20 });

/** Léa et Tom sur le même compte ÉcoleDirecte (même messagerie), Zoé sur Pronote, Alex parent. */
const LIVES: Record<string, SchoolLifeData> = {
  lea: {
    grades: [grade('g2', '2026-11-03'), grade('g1', '2026-10-20')],
    attendance: [{ id: 'r1', kind: 'delay', date: '2026-11-02', duration: '10 min', justified: false }],
    messages: { service: 'ÉcoleDirecte', items: [message('m2', '2026-11-03T08:00:00.000Z'), message('m1', '2026-10-28T17:00:00.000Z', true)] },
  },
  tom: {
    grades: null,
    attendance: [],
    messages: { service: 'ÉcoleDirecte', items: [message('m1', '2026-10-28T17:00:00.000Z', true), message('m3', '2026-11-04T07:00:00.000Z')] },
  },
  zoe: { grades: [], attendance: null, messages: null },
};

function config() {
  return createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
        { id: 'tom', name: 'Tom', color: '#d96aa7' },
        { id: 'zoe', name: 'Zoé', color: '#e8964a' },
        { id: 'max', name: 'Max', color: '#9aa1ab' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
}

const school = (lives = LIVES): SchoolSource => ({
  coursesFor: async () => null,
  lifeFor: async (ownerId) => {
    if (ownerId === 'alex') throw new Error('jamais demandé pour un parent');
    return lives[ownerId] ?? null;
  },
});

describe('service de la vie scolaire', () => {
  it('prend chaque enfant qui a une vie scolaire, et fusionne la messagerie d’un même compte', async () => {
    const service = createSchoolLifeService({ household: createHousehold(config()), school: school(), logger: silentLogger() });
    const life = await service.life();
    expect(life.children).toEqual([
      { ownerId: 'lea', grades: LIVES.lea.grades, attendance: LIVES.lea.attendance },
      { ownerId: 'tom', grades: null, attendance: [] },
      { ownerId: 'zoe', grades: [], attendance: null },
    ]);
    expect(life.messages).toEqual([{ service: 'ÉcoleDirecte', items: [expect.objectContaining({ id: 'm3' }), expect.objectContaining({ id: 'm2' }), expect.objectContaining({ id: 'm1' })] }]);
  });

  it('garde les notes récentes ; une source en panne masque seulement cet enfant', async () => {
    const many = Array.from({ length: 30 }, (_, i) => grade(`g${i}`, `2026-10-${String(30 - i).padStart(2, '0')}`));
    const logger = silentLogger();
    const failing: SchoolSource = {
      coursesFor: async () => null,
      lifeFor: async (ownerId) => {
        if (ownerId === 'tom') throw new Error('ÉcoleDirecte en panne');
        return ownerId === 'lea' ? { grades: many, attendance: [], messages: null } : null;
      },
    };
    const life = await createSchoolLifeService({ household: createHousehold(config()), school: failing, logger }).life();
    expect(life.children.map((c) => c.ownerId)).toEqual(['lea']);
    expect(life.children[0].grades).toHaveLength(RECENT_GRADES);
    expect(life.children[0].grades?.[0].id).toBe('g0');
    expect(life.messages).toEqual([]);
    expect(logger.errors).toEqual(['Vie scolaire de Tom indisponible : ÉcoleDirecte en panne']);
  });
});

describe('route de la vie scolaire', () => {
  async function setup() {
    const store = config();
    const devices = createDeviceStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-school-life-')), 'devices.json'), clock: fixedClock });
    const sessions = createActorSessions(fixedClock);
    const access = createAccess({ config: store, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
    const household = createHousehold(store);
    const api = createSchoolLifeApi({ schoolLife: createSchoolLifeService({ household, school: school(), logger: silentLogger() }), access });
    const phone = async (ownerId: string) => (await devices.claim(devices.createCode(ownerId).code, 'Téléphone'))!.token;
    const call = async ({ address = OTHER, token, actor }: { address?: string; token?: string; actor?: string } = {}) => {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (actor) headers['X-Actor-Session'] = sessions.open(actor, 10).token;
      const res = await api.request('/school/life', { headers }, connectedFrom(address));
      return { status: res.status, json: (await res.json()) as SchoolLife & { error?: string; identify?: boolean } };
    };
    return { call, phone };
  }

  it('un parent la lit : reconnu devant la tablette, ou sur son téléphone', async () => {
    const { call, phone } = await setup();
    const tablet = await call({ address: TABLET, actor: 'alex' });
    expect(tablet.status).toBe(200);
    expect(tablet.json.children.map((c) => c.ownerId)).toEqual(['lea', 'tom', 'zoe']);
    expect((await call({ token: await phone('alex') })).status).toBe(200);
  });

  it('refusée à un enfant, sur la tablette comme sur son téléphone', async () => {
    const { call, phone } = await setup();
    expect(await call({ address: TABLET, actor: 'lea' })).toEqual({ status: 403, json: { error: PARENTS_ONLY } });
    expect(await call({ token: await phone('lea') })).toEqual({ status: 403, json: { error: PARENTS_ONLY } });
  });

  it('refusée à la tablette sans personne reconnue, à un appareil non appairé, à un téléphone retiré', async () => {
    const { call } = await setup();
    const anonymous = await call({ address: TABLET });
    expect(anonymous.status).toBe(403);
    expect(anonymous.json.identify).toBe(true);
    expect(anonymous.json).not.toHaveProperty('children');
    expect((await call()).status).toBe(403);
    expect((await call({ token: 'retire' })).status).toBe(401);
  });
});
