/**
 * Load test. Run `npm run loadtest` against a running API.
 * Targets: 95th percentile under 200 ms for reads, no errors, 5,000+ concurrent users.
 */
const autocannon = require("autocannon");

const BASE = process.env.TARGET || "http://localhost:8080";
const scenarios = [
  { name: "health", path: "/health", connections: 200, duration: 10 },
  { name: "listing search", path: "/v1/listings?city=Noida&purpose=sale&limit=24", connections: 500, duration: 20 },
  { name: "listing search (page 2)", path: "/v1/listings?city=Gurgaon&purpose=sale&bhk=3&limit=24", connections: 500, duration: 20 },
];

(async () => {
  for (const s of scenarios) {
    const r = await autocannon({ url: BASE + s.path, connections: s.connections, duration: s.duration, pipelining: 1 });
    const p95 = r.latency.p97_5 ?? r.latency.p99;
    console.log(`\n${s.name}: ${Math.round(r.requests.average)} req/s | p50 ${r.latency.p50}ms | p97.5 ${p95}ms | errors ${r.errors} | non-2xx ${r.non2xx}`);
    if (r.errors || r.non2xx) console.log("  ⚠ errors found, investigate before release");
    if (p95 > 200) console.log("  ⚠ above the 200 ms target");
  }
})();
