// Briques communes aux tests : configuration, horloge fixe et sources factices.
import type { CalendarEvent, Homework, SchoolCourse, Task, Weather, WeatherForecast } from '../shared/types.ts';
import { type AppConfig, parseConfig } from './config.ts';
import type { Logger } from './config-store.ts';
import type { Clock, Sources } from './sources/types.ts';
import { deflateRawSync } from 'node:zlib';

/** Lundi 2 novembre 2026, 18:00 heure locale. */
export const NOW = new Date(2026, 10, 2, 18, 0);
export const fixedClock: Clock = () => new Date(NOW);

export const testConfig: AppConfig = parseConfig({
  members: [
    { id: 'alex', name: 'Alex', color: '#5b8def' },
    { id: 'lea', name: 'Léa', color: '#3fb8a8' },
  ],
});

/** Journal muet, qui garde les messages pour les assertions. */
export function silentLogger(): Logger & { errors: string[] } {
  const errors: string[] = [];
  return { errors, log() {}, error: (message: string) => void errors.push(message) };
}

export const testWeather: Weather = {
  location: 'Test',
  temperatureC: 10,
  weatherCode: 3,
  isDay: true,
  today: { minC: 4, maxC: 12 },
  tomorrow: null,
  rainStartsAt: null,
};

export const testForecast: WeatherForecast = {
  location: 'Test',
  observedAt: NOW.toISOString(),
  current: {
    temperatureC: 10,
    apparentC: 8,
    weatherCode: 3,
    isDay: true,
    humidityPct: 80,
    windKmh: 12,
    gustsKmh: 25,
    windFromDeg: 45,
  },
  hours: [],
  days: [],
};

export function event(id: string, hoursFromNow: number, title = id): CalendarEvent {
  return { id, title, start: new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString() };
}

/** Sources en mémoire, alimentées par profil. */
export function fakeSources(data: {
  events?: Record<string, CalendarEvent[]>;
  tasks?: Record<string, Task[]>;
  courses?: Record<string, SchoolCourse[]>;
  homework?: Record<string, Homework[]>;
} = {}): Sources {
  const tasks = structuredClone(data.tasks ?? {});
  return {
    agenda: {
      async eventsFor(ownerId, range) {
        return (data.events?.[ownerId] ?? []).filter((e) => {
          const start = new Date(e.start);
          return start >= range.from && start < range.to;
        });
      },
    },
    tasks: {
      async tasksFor(ownerId) {
        return tasks[ownerId] ?? [];
      },
      async setDone(ownerId, taskId, done) {
        const task = tasks[ownerId]?.find((t) => t.id === taskId);
        if (!task) return null;
        task.done = done;
        return task;
      },
    },
    notes: {
      async unseenFor(ownerId) {
        return ownerId === 'alex' ? [{ id: 'n1', text: 'Coucou', to: 'alex', from: { ownerId: 'tom', via: 'phone' }, at: NOW.toISOString() }] : [];
      },
    },
    weather: { async current() { return testWeather; }, async forecast() { return testForecast; } },
    school: {
      async coursesFor(ownerId, range) {
        if (!data.courses?.[ownerId]) return null;
        return data.courses[ownerId].filter((c) => new Date(c.end) > range.from && new Date(c.start) < range.to);
      },
      async homeworkFor(ownerId) {
        return data.homework?.[ownerId] ?? null;
      },
    },
  };
}

/** Archive zip minimale (fichiers compressés), comme celle de transport.data.gouv.fr. */
export function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// Petit réseau : la maison près de Mairie (deux quais), le collège près de Lycée. Ligne A (tram) Mairie → Lycée
// le matin en semaine ; une course dans l'autre sens ; ligne 3 qui passe à Mairie sans aller au Lycée.
export const GTFS_FILES = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,location_type',
    '1MAIR,Mairie,47.4702,-0.55,0',
    '2MAIR,Mairie,47.4703,-0.5501,0',
    'GARE,"Gare, parvis",47.475,-0.55,0',
    '1LYC,Lycée,47.4798,-0.55,0',
    'LOIN,Loin,47.60,-0.55,0',
  ].join('\n'),
  'routes.txt': 'route_id,route_short_name,route_type\nTA,A,0\n03,03,3\n',
  'trips.txt': [
    'route_id,service_id,trip_id,trip_headsign,direction_id',
    'TA,SEM,t1,Belle-Beille,0',
    'TA,SEM,t2,Belle-Beille,0',
    'TA,SEM,t3,Belle-Beille,0',
    'TA,SEM,r1,Roseraie,1',
    'TA,WE,w1,Belle-Beille,0',
    '03,SEM,b1,Loin,0',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    't1,07:40:00,07:40:00,1MAIR,1',
    't1,07:45:00,07:45:00,GARE,2',
    't1,07:52:00,07:52:00,1LYC,3',
    't2,08:00:00,08:00:00,1MAIR,1',
    't2,08:12:00,08:12:00,1LYC,2',
    't3,08:20:00,08:20:00,1MAIR,1',
    't3,08:32:00,08:32:00,1LYC,2',
    'r1,08:00:00,08:00:00,1LYC,1',
    'r1,08:12:00,08:12:00,2MAIR,2',
    'w1,09:00:00,09:00:00,1MAIR,1',
    'w1,09:12:00,09:12:00,1LYC,2',
    'b1,07:30:00,07:30:00,1MAIR,1',
    'b1,07:50:00,07:50:00,LOIN,2',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'SEM,1,1,1,1,1,0,0,20260901,20270704',
    'WE,0,0,0,0,0,1,1,20260901,20270704',
  ].join('\n'),
  // Le 11 novembre (mercredi férié) : pas de service de semaine.
  'calendar_dates.txt': 'service_id,date,exception_type\nSEM,20261111,2\nWE,20261111,1\n',
};
