const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5178);
const ROOT = __dirname;
const MAX_FILES = 100000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const TYPE_GROUPS = [
  { key: "image", label: "画像", exts: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".ico", ".heic"] },
  { key: "video", label: "動画", exts: [".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"] },
  { key: "audio", label: "音声", exts: [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"] },
  { key: "document", label: "文書", exts: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pages", ".numbers", ".key"] },
  { key: "text", label: "テキスト", exts: [".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".log"] },
  { key: "code", label: "コード", exts: [".html", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".php", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".sh"] },
  { key: "archive", label: "圧縮", exts: [".zip", ".gz", ".tar", ".tgz", ".7z", ".rar", ".bz2", ".xz"] },
  { key: "data", label: "データ", exts: [".dat", ".db", ".sqlite", ".sql", ".bak", ".backup"] },
];

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const target = path.resolve(ROOT, `.${decodeURIComponent(pathname)}`);

  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeRel(value) {
  return value.split(path.sep).join("/");
}

function getType(ext) {
  for (const group of TYPE_GROUPS) {
    if (group.exts.includes(ext)) return group;
  }
  return { key: ext ? "other" : "no_ext", label: ext ? "その他" : "拡張子なし", exts: [] };
}

async function walk(root, options) {
  const files = [];
  const ignoredDirs = new Set(options.ignoredDirs);

  async function visit(dir) {
    if (files.length >= MAX_FILES) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = normalizeRel(path.relative(root, abs));

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.promises.stat(abs);
      const ext = path.extname(entry.name).toLowerCase();
      const type = getType(ext);
      files.push({
        path: rel,
        name: entry.name,
        dir: normalizeRel(path.dirname(rel)) === "." ? "" : normalizeRel(path.dirname(rel)),
        ext,
        type: type.key,
        typeLabel: type.label,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
      });
    }
  }

  await visit(root);
  return files;
}

function summarize(files) {
  const byExt = new Map();
  const byType = new Map();
  let totalSize = 0;

  for (const file of files) {
    totalSize += file.size;
    const extKey = file.ext || "(none)";
    const ext = byExt.get(extKey) || { key: extKey, count: 0, size: 0 };
    ext.count += 1;
    ext.size += file.size;
    byExt.set(extKey, ext);

    const type = byType.get(file.type) || { key: file.type, label: file.typeLabel, count: 0, size: 0 };
    type.count += 1;
    type.size += file.size;
    byType.set(file.type, type);
  }

  return {
    totalFiles: files.length,
    totalSize,
    largest: [...files].sort((a, b) => b.size - a.size).slice(0, 20),
    byExt: [...byExt.values()].sort((a, b) => b.size - a.size || b.count - a.count),
    byType: [...byType.values()].sort((a, b) => b.size - a.size || b.count - a.count),
  };
}

function groupPotentialDuplicates(files) {
  const bySize = new Map();
  for (const file of files) {
    if (file.size === 0) continue;
    const items = bySize.get(file.size) || [];
    items.push(file);
    bySize.set(file.size, items);
  }
  return [...bySize.values()].filter((items) => items.length > 1);
}

function hashFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function findDuplicates(root, files, options) {
  const potentialGroups = groupPotentialDuplicates(files);
  const maxHashBytes = Number(options.maxHashBytes || 2 * 1024 * 1024 * 1024);
  const hashGroups = [];

  for (const group of potentialGroups) {
    if (group[0].size > maxHashBytes) {
      hashGroups.push({
        mode: "size",
        size: group[0].size,
        count: group.length,
        files: group,
        note: "大容量のためハッシュ未計算",
      });
      continue;
    }

    const byHash = new Map();
    for (const file of group) {
      const abs = path.join(root, file.path);
      const hash = await hashFile(abs);
      file.sha256 = hash;
      const items = byHash.get(hash) || [];
      items.push(file);
      byHash.set(hash, items);
    }

    for (const [hash, items] of byHash.entries()) {
      if (items.length > 1) {
        hashGroups.push({
          mode: "hash",
          hash,
          size: items[0].size,
          count: items.length,
          files: items,
        });
      }
    }
  }

  hashGroups.sort((a, b) => b.size * b.count - a.size * a.count);
  return {
    potentialGroups: potentialGroups.map((items) => ({ size: items[0].size, count: items.length, files: items })),
    duplicateGroups: hashGroups,
  };
}

function buildTree(items) {
  const root = { name: "/", path: "", type: "dir", children: [] };
  for (const item of items) {
    const parts = item.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let child = node.children.find((entry) => entry.name === part && entry.type === (isFile ? "file" : "dir"));
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isFile ? "file" : "dir",
          children: isFile ? undefined : [],
        };
        node.children.push(child);
      }
      if (isFile) {
        const { type: fileType, ...rest } = item;
        Object.assign(child, rest, { type: "file", fileType });
      } else {
        node = child;
      }
    }
  }

  function sort(node) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    node.children.forEach(sort);
  }
  sort(root);
  return root;
}

async function scanDirectory(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const stat = await fs.promises.stat(root);
  if (!stat.isDirectory()) throw new Error("指定パスはディレクトリではありません");

  const ignoredDirs = options.ignoredDirs || [".git", "node_modules", ".DS_Store", "__MACOSX"];
  const files = await walk(root, { ignoredDirs });
  const summary = summarize(files);
  const duplicates = options.checkDuplicates
    ? await findDuplicates(root, files, options)
    : { skipped: true, potentialGroups: [], duplicateGroups: [] };

  return {
    root,
    scannedAt: new Date().toISOString(),
    summary,
    files,
    tree: buildTree(files),
    duplicates,
  };
}

function makeCsv(result) {
  const header = ["path", "name", "dir", "ext", "type", "size", "modified", "created", "sha256"];
  const rows = result.files.map((file) => [
    file.path,
    file.name,
    file.dir,
    file.ext,
    file.typeLabel,
    String(file.size),
    file.modified,
    file.created,
    file.sha256 || "",
  ]);
  return [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

let lastResult = null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/scan") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.rootPath) {
        sendJson(res, 400, { error: "rootPath is required" });
        return;
      }
      lastResult = await scanDirectory(body.rootPath, body);
      sendJson(res, 200, lastResult);
      return;
    }

    if (req.method === "GET" && req.url === "/api/export.csv") {
      if (!lastResult) {
        res.writeHead(404);
        res.end("No scan result");
        return;
      }
      const csv = makeCsv(lastResult);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="directory-file-audit.csv"',
      });
      res.end(csv);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Directory File Inspector: http://127.0.0.1:${PORT}`);
});
