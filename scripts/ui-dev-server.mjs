import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, "../src-ui");
const host = "127.0.0.1";
const port = Number(process.env.UI_DEV_PORT || "1430");

const contentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
};

const safePath = (urlPath) => {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(uiRoot, `.${normalized}`);
  if (!resolved.startsWith(uiRoot)) {
    return null;
  }
  return resolved;
};

const server = createServer(async (req, res) => {
  try {
    const filePath = safePath(req.url || "/");
    if (!filePath) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(port, host, () => {
  console.log(`[ui-dev-server] serving ${uiRoot} at http://${host}:${port}`);
});
