#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { handleMcpJsonRpc, toMcpError } from "../src/mcpJsonRpc.js";

let buffer = Buffer.alloc(0);

stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  void drainMessages();
});

stdin.on("end", () => {
  if (buffer.length) {
    const text = buffer.toString("utf8").trim();
    if (text) {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        void handleLineMessage(line);
      }
    }
  }
});

async function drainMessages() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.subarray(0, lineEnd).toString("utf8").trim();
      buffer = buffer.subarray(lineEnd + 1);
      if (line) await handleLineMessage(line);
      continue;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) return;

    const message = buffer.subarray(messageStart, messageEnd).toString("utf8");
    buffer = buffer.subarray(messageEnd);
    await handleLineMessage(message);
  }
}

async function handleLineMessage(message) {
  let request;
  try {
    request = JSON.parse(message);
    const response = await handleMcpJsonRpc(request);
    if (response) writeResponse(response);
  } catch (error) {
    writeResponse(toMcpError({ id: request?.id ?? null, error }));
  }
}

function writeResponse(response) {
  const payload = JSON.stringify(response);
  stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

