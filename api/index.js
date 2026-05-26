import { ready, server } from "../src/server.js";

export default async function handler(req, res) {
  await ready;
  server.emit("request", req, res);
}
