import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
const key = process.env['HERE_API_KEY'];
if (!key) throw new Error('no HERE_API_KEY');
const lane = { from: { lat: 41.701957, lng: -87.934337 }, to: { lat: 33.43676264419, lng: -112.161534601882 } };
for (const mode of ['car', 'truck']) {
  const q = new URLSearchParams({
    transportMode: mode,
    origin: `${lane.from.lat},${lane.from.lng}`,
    destination: `${lane.to.lat},${lane.to.lng}`,
    return: 'summary',
    apiKey: key,
  });
  const r = await fetch(`https://router.hereapi.com/v8/routes?${q}`, { headers: { accept: 'application/json' } });
  const body = await r.text();
  console.log(`\n=== transportMode=${mode} — HTTP ${r.status} ===`);
  console.log(body.slice(0, 1400));
}
// And a deliberate failure, to learn the error shape.
const bad = new URLSearchParams({
  transportMode: 'truck', origin: '21.3,-157.8', destination: '41.7,-87.9',
  return: 'summary', apiKey: key,
});
const r2 = await fetch(`https://router.hereapi.com/v8/routes?${bad}`, { headers: { accept: 'application/json' } });
console.log(`\n=== unroutable (Honolulu -> Chicago) — HTTP ${r2.status} ===`);
console.log((await r2.text()).slice(0, 800));
const r3 = await fetch(`https://router.hereapi.com/v8/routes?transportMode=truck&origin=41.7,-87.9&destination=41.8,-87.8&return=summary&apiKey=nope`, { headers: { accept: 'application/json' } });
console.log(`\n=== bad key — HTTP ${r3.status} ===`);
console.log((await r3.text()).slice(0, 500));
