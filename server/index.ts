import path from "node:path";
import { createApp } from "./app";
import { config } from "./config";
import { openDb } from "./db";

const db = openDb(config.dbPath);
// purge expired sessions on boot and then hourly
const purge = () => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
purge();
setInterval(purge, 3600_000).unref();

const app = createApp({ db, staticDir: config.production ? path.resolve("dist") : undefined });

app.listen(config.port, () => {
  console.log(`Padkos API listening on http://localhost:${config.port}`);
  console.log(`  routing: ${config.osrmUrl}  ·  live traffic: ${config.tomtomKey ? "TomTom" : "off (set TOMTOM_API_KEY)"}`);
});
