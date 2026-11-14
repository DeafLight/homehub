// Fausse météo du monde fictif (à la place d'Open-Meteo) : un jeudi de novembre gris à Angers, la pluie qui arrive vers
// 8 h et dure la matinée, puis des éclaircies ; trois jours de plus pour la page Météo. Calculée à partir de l'horloge
// du processus (fake-world.ts) au moment de l'appel, au format de la réponse d'Open-Meteo (temps unix, heure de Paris).
// Elle déclenche l'alerte pluie de la télé (server/services/rain-alert.ts) et rend les captures stables.

const DAYS = 4;

/** Pluie (mm) de chaque heure du premier jour : rien la nuit, la pluie de 8 h à midi, une averse le soir. */
const TODAY_RAIN = [0, 0, 0, 0, 0, 0, 0, 0, 1.4, 2.1, 0.9, 0.3, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0];
/** Les jours suivants : sec, une petite pluie l'après-midi, sec. */
const LATER_RAIN = [0, 0.6, 0];

const at = (day: Date, hour: number) => {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

/** Code WMO d'une heure : pluie selon le cumul, sinon couvert le matin, éclaircies l'après-midi, nuit claire. */
const codeOf = (mm: number, hour: number) => (mm >= 2 ? 63 : mm >= 0.2 ? 61 : hour >= 13 && hour < 18 ? 2 : hour >= 7 && hour < 13 ? 3 : 1);

/** Réponse d'Open-Meteo (buildForecastUrl) pour le monde fictif. */
export function fakeOpenMeteo(): Response {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = days.flatMap((day, i) =>
    Array.from({ length: 24 }, (_, hour) => {
      const mm = i === 0 ? TODAY_RAIN[hour] : hour >= 14 && hour < 17 ? LATER_RAIN[i - 1] : 0;
      // Fraîche le matin (8 °C), plus douce l'après-midi (13 °C), un degré de plus chaque jour.
      const temperature = 8 + i + 5 * Math.max(0, Math.sin(((hour - 8) / 12) * Math.PI));
      return { time: at(day, hour), mm, code: codeOf(mm, hour), temperature: Math.round(temperature * 10) / 10, isDay: hour >= 8 && hour < 18 ? 1 : 0 };
    }),
  );
  const current = hours.find((h) => h.time <= now.getTime() / 1000 && now.getTime() / 1000 < h.time + 3600) ?? hours[0];
  const body = {
    current: {
      time: Math.floor(now.getTime() / 1000),
      temperature_2m: current.temperature,
      weather_code: current.code,
      is_day: current.isDay,
      apparent_temperature: current.temperature - 2,
      relative_humidity_2m: 88,
      wind_speed_10m: 14,
      wind_gusts_10m: 32,
      wind_direction_10m: 230,
    },
    hourly: {
      time: hours.map((h) => h.time),
      precipitation: hours.map((h) => h.mm),
      temperature_2m: hours.map((h) => h.temperature),
      weather_code: hours.map((h) => h.code),
      is_day: hours.map((h) => h.isDay),
    },
    daily: {
      time: days.map((d) => at(d, 0)),
      weather_code: [63, 3, 61, 2],
      temperature_2m_max: days.map((_, i) => 13 + i),
      temperature_2m_min: days.map((_, i) => 7 + i),
      precipitation_sum: [5.1, 0, 1.8, 0],
      wind_speed_10m_max: [24, 15, 18, 12],
      sunrise: days.map((d) => at(d, 7) + 60 * 52),
      sunset: days.map((d) => at(d, 17) + 60 * 22),
    },
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
