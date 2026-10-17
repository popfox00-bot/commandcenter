// Sample responses shaped like the real Weather Service, Open-Meteo and ESPN APIs, around a fixed
// moment, shared by the unit tests and the browser test of the Updates app.

// Mid-October in Denver (MDT, UTC-6): 2026-10-17 20:00 UTC = 2:00 PM local.
export const NOW = Date.parse('2026-10-17T20:00:00Z');
export const TZ = 'America/Denver';
export const iso = (h) => new Date(NOW + h * 3_600_000).toISOString().replace('.000Z', '+00:00');

export const pointJson = { properties: { gridId: 'BOU', forecast: 'https://api.weather.gov/gridpoints/BOU/58,61/forecast', forecastHourly: 'https://api.weather.gov/gridpoints/BOU/58,61/forecast/hourly', forecastGridData: 'https://api.weather.gov/gridpoints/BOU/58,61', timeZone: TZ, relativeLocation: { properties: { city: 'Lakewood', state: 'CO' } } } };
export const alertsJson = { features: [
  { properties: { id: 'urn:oid:2.49.0.1.840.0.bbb', status: 'Actual', messageType: 'Update', references: [{ identifier: 'urn:oid:2.49.0.1.840.0.aaa' }], event: 'Winter Storm Warning', severity: 'Moderate', urgency: 'Expected', certainty: 'Likely', headline: 'Winter Storm Warning issued October 17', parameters: { NWSheadline: ['WINTER STORM WARNING IN EFFECT FROM 6 PM SATURDAY TO NOON SUNDAY'] }, onset: iso(4), ends: iso(22), expires: iso(22), description: 'Heavy snow expected. Total snow accumulations of 6 to 12 inches.', instruction: 'If you must travel, keep an extra flashlight, food, and water in your vehicle.', areaDesc: 'Denver; Lakewood', senderName: 'NWS Boulder CO' } },
  { properties: { id: 'urn:oid:minor', status: 'Actual', messageType: 'Alert', event: 'Special Weather Statement', severity: 'Minor', headline: 'Patchy fog', effective: iso(-1), expires: iso(2) } },
  { properties: { id: 'urn:oid:cancel', status: 'Actual', messageType: 'Cancel', event: 'Wind Advisory', severity: 'Moderate', effective: iso(-2), expires: iso(1) } },
  { properties: { id: 'urn:oid:test', status: 'Test', messageType: 'Alert', event: 'Test Message', severity: 'Severe', effective: iso(-1), expires: iso(1) } },
] };
// 48 hourly periods: 45°F now, falling to 24°F around 6 AM tomorrow, back above freezing by 10 AM.
const temps = [45, 44, 42, 40, 38, 36, 34, 33, 32, 31, 30, 28, 27, 26, 25, 24, 24, 26, 30, 33, 37, 40, 43, 45, ...Array(24).fill(50)];
export const hourlyJson = { properties: { periods: temps.map((t, i) => ({ number: i + 1, startTime: iso(i), endTime: iso(i + 1), isDaytime: i < 4 || (i > 17 && i < 28), temperature: t, temperatureUnit: 'F', probabilityOfPrecipitation: { value: i > 4 && i < 20 ? 80 : 10 }, windSpeed: i === 2 ? '15 to 25 mph' : '10 mph', windDirection: 'NW', shortForecast: i > 4 && i < 20 ? 'Snow' : 'Mostly Cloudy' })) } };
export const dailyJson = { properties: { periods: [
  { name: 'This Afternoon', startTime: iso(0), endTime: iso(4), isDaytime: true, temperature: 46, temperatureUnit: 'F', windSpeed: '10 to 20 mph', windDirection: 'NW', shortForecast: 'Mostly Cloudy', detailedForecast: 'Mostly cloudy, with a high near 46.' },
  { name: 'Tonight', startTime: iso(4), endTime: iso(16), isDaytime: false, temperature: 24, temperatureUnit: 'F', windSpeed: '10 mph', windDirection: 'N', shortForecast: 'Snow', detailedForecast: 'Snow. Low around 24.' },
] } };
// Gusts in km/h: 60 km/h (37 mph) now for 3 h, then 80 km/h (50 mph) for 2 h, then 100 km/h (62 mph) tomorrow.
export const gridJson = { properties: { windGust: { uom: 'wmoUnit:km_h-1', values: [
  { validTime: `${iso(0)}/PT3H`, value: 60 }, { validTime: `${iso(3)}/PT2H`, value: 80 }, { validTime: `${iso(26)}/PT1H`, value: 100 }, { validTime: `${iso(30)}/P1DT6H`, value: 20 },
] } } };
// Open-Meteo local times (no offset), utc_offset_seconds -21600. AQI peaks at 155 tomorrow 3 PM (ozone).
const localIso = (h) => new Date(NOW + h * 3_600_000 - 6 * 3_600_000).toISOString().slice(0, 16);
export const airJson = { utc_offset_seconds: -21600, current: { time: localIso(0), us_aqi: 62, pm2_5: 9.1, ozone: 70 },
  hourly: { time: Array.from({ length: 48 }, (_, i) => localIso(i)), us_aqi: Array.from({ length: 48 }, (_, i) => (i === 25 ? 155 : 60)), us_aqi_pm2_5: Array(48).fill(40), us_aqi_ozone: Array.from({ length: 48 }, (_, i) => (i === 25 ? 155 : 50)) } };

const team = (id, abbr, name, short, color) => ({ id, abbreviation: abbr, displayName: name, shortDisplayName: short, color });
export const DEN = team('7', 'DEN', 'Denver Broncos', 'Broncos', 'fb4f14');
export const KC = team('12', 'KC', 'Kansas City Chiefs', 'Chiefs', 'e31837');
const LV = team('13', 'LV', 'Las Vegas Raiders', 'Raiders', '000000');
export const ev = (id, date, state, home, away, hs, as, extra = {}) => ({
  id, date, shortName: `${away.abbreviation} @ ${home.abbreviation}`, links: [{ rel: ['summary', 'desktop'], href: `https://www.espn.com/nfl/game/_/gameId/${id}` }],
  competitions: [{ competitors: [
    { homeAway: 'home', team: home, score: hs == null ? undefined : { value: hs, displayValue: String(hs) }, winner: hs != null && as != null && state === 'post' ? hs > as : undefined },
    { homeAway: 'away', team: away, score: as == null ? undefined : { value: as, displayValue: String(as) }, winner: hs != null && as != null && state === 'post' ? as > hs : undefined },
  ], status: { type: { state, completed: state === 'post', shortDetail: state === 'post' ? 'Final' : state === 'in' ? '3rd 5:12' : '10/19 - 2:25 PM MDT' } }, venue: { fullName: 'Empower Field at Mile High' }, broadcasts: [{ media: { shortName: 'CBS' } }], ...extra }],
});
export const scheduleJson = { team: { ...DEN, alternateColor: '002244', recordSummary: '5-2', standingSummary: '1st in AFC West' }, events: [
  ev('401', iso(-30), 'post', DEN, LV, 24, 17), // finished ~yesterday morning (within 36 h)
  ev('300', iso(-24 * 9), 'post', KC, DEN, 31, 20), // older
  ev('402', iso(2.5), 'pre', DEN, KC, null, null, { odds: [{ details: 'DEN -3.5', overUnder: 44.5, provider: { name: 'ESPN BET' } }] }),
  ev('403', iso(24 * 7), 'pre', LV, DEN, null, null),
] };

