const elements = {
  pathInput: document.querySelector("#pathInput"),
  duplicateCheck: document.querySelector("#duplicateCheck"),
  scanButton: document.querySelector("#scanButton"),
  sampleButton: document.querySelector("#sampleButton"),
  searchInput: document.querySelector("#searchInput"),
  typeFilter: document.querySelector("#typeFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  exportLink: document.querySelector("#exportLink"),
  totalFiles: document.querySelector("#totalFiles"),
  totalSize: document.querySelector("#totalSize"),
  typeCount: document.querySelector("#typeCount"),
  duplicateCount: document.querySelector("#duplicateCount"),
  linkedCount: document.querySelector("#linkedCount"),
  unlinkedCount: document.querySelector("#unlinkedCount"),
  fileRows: document.querySelector("#fileRows"),
  typeSummary: document.querySelector("#typeSummary"),
  extSummary: document.querySelector("#extSummary"),
  unlinkedList: document.querySelector("#unlinkedList"),
  missingList: document.querySelector("#missingList"),
  duplicateList: document.querySelector("#duplicateList"),
  duplicateStatus: document.querySelector("#duplicateStatus"),
  linkStatus: document.querySelector("#linkStatus"),
  statusText: document.querySelector("#statusText"),
};

let scanResult = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function setStatus(text, tone = "") {
  elements.statusText.textContent = text;
  elements.statusText.dataset.tone = tone;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getVisibleFiles() {
  if (!scanResult) return [];
  const query = elements.searchInput.value.trim().toLowerCase();
  const type = elements.typeFilter.value;

  return scanResult.files
    .filter((file) => {
      const text = `${file.path} ${file.name} ${file.ext} ${file.typeLabel}`.toLowerCase();
      if (query && !text.includes(query)) return false;
      if (type !== "all" && file.type !== type) return false;
      return true;
    })
    .sort((a, b) => {
      const sort = elements.sortSelect.value;
      if (sort === "size-desc") return b.size - a.size || a.path.localeCompare(b.path, "ja");
      if (sort === "size-asc") return a.size - b.size || a.path.localeCompare(b.path, "ja");
      if (sort === "name-desc") return b.name.localeCompare(a.name, "ja");
      if (sort === "name-asc") return a.name.localeCompare(b.name, "ja");
      if (sort === "type-asc") return a.typeLabel.localeCompare(b.typeLabel, "ja") || a.name.localeCompare(b.name, "ja");
      if (sort === "modified-asc") return new Date(a.modified) - new Date(b.modified);
      return new Date(b.modified) - new Date(a.modified);
    });
}

function renderFiles() {
  const files = getVisibleFiles();
  elements.statusText.textContent = scanResult ? `${files.length}件表示` : "未スキャン";

  if (!files.length) {
    elements.fileRows.innerHTML = '<tr><td colspan="6" class="empty-cell">条件に合うファイルはありません。</td></tr>';
    return;
  }

  elements.fileRows.innerHTML = files
    .slice(0, 1000)
    .map((file) => `
      <tr>
        <td><strong>${escapeHtml(file.name)}</strong></td>
        <td>${renderLinkBadge(file)}</td>
        <td><span class="badge type-badge">${escapeHtml(file.typeLabel)}</span></td>
        <td class="num">${formatBytes(file.size)}</td>
        <td>${new Date(file.modified).toLocaleString("ja-JP")}</td>
        <td><code>${escapeHtml(file.path)}</code></td>
      </tr>
    `)
    .join("");
}

function renderLinkBadge(file) {
  if (file.linkStatus === "entry") return '<span class="badge linked">入口</span>';
  if (file.linked) return '<span class="badge linked">参照あり</span>';
  return '<span class="badge unlinked">未リンク</span>';
}

function renderSummaryList(target, rows, keyLabel = "key") {
  if (!rows.length) {
    target.classList.add("empty");
    target.textContent = "まだありません。";
    return;
  }

  target.classList.remove("empty");
  target.innerHTML = rows
    .slice(0, 16)
    .map((row) => `
      <div class="rank-item">
        <div>
          <strong>${escapeHtml(row.label || row[keyLabel])}</strong>
          <span>${row.count}件</span>
        </div>
        <b>${formatBytes(row.size)}</b>
      </div>
    `)
    .join("");
}

function renderTypeOptions() {
  const current = elements.typeFilter.value;
  const rows = scanResult.summary.byType;
  elements.typeFilter.innerHTML = '<option value="all">すべて</option>' + rows
    .map((row) => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.label)} (${row.count})</option>`)
    .join("");
  if ([...elements.typeFilter.options].some((option) => option.value === current)) {
    elements.typeFilter.value = current;
  }
}

function renderLinkAudit() {
  const audit = scanResult.linkAudit;
  elements.linkedCount.textContent = audit.linkedFiles;
  elements.unlinkedCount.textContent = audit.unlinkedFiles;
  elements.linkStatus.textContent = `未リンク ${audit.unlinkedFiles}件`;

  const unlinked = scanResult.files.filter((file) => !file.linked);
  if (!unlinked.length) {
    elements.unlinkedList.classList.add("empty");
    elements.unlinkedList.textContent = "未リンクのファイルは見つかっていません。";
  } else {
    elements.unlinkedList.classList.remove("empty");
    elements.unlinkedList.innerHTML = unlinked
      .slice(0, 100)
      .map((file) => `
        <div class="rank-item">
          <div>
            <strong>${escapeHtml(file.name)}</strong>
            <span><code>${escapeHtml(file.path)}</code></span>
          </div>
          <b>${formatBytes(file.size)}</b>
        </div>
      `)
      .join("");
  }

  if (!audit.missingRefs.length) {
    elements.missingList.classList.add("empty");
    elements.missingList.textContent = "見つからない参照はありません。";
    return;
  }

  elements.missingList.classList.remove("empty");
  elements.missingList.innerHTML = audit.missingRefs
    .slice(0, 100)
    .map((item) => `
      <div class="missing-item">
        <code>${escapeHtml(item.from)}</code>
        <div>
          <strong>${escapeHtml(item.raw)}</strong>
          <span><code>${escapeHtml(item.target)}</code></span>
        </div>
      </div>
    `)
    .join("");
}

function renderDuplicates() {
  if (scanResult.duplicates.skipped) {
    elements.duplicateStatus.textContent = "未実行";
    elements.duplicateCount.textContent = "-";
    elements.duplicateList.classList.add("empty");
    elements.duplicateList.textContent = "重複チェックは未実行です。必要な場合は「重複も調べる」をONにして再スキャンしてください。";
    return;
  }

  const groups = scanResult.duplicates.duplicateGroups;
  elements.duplicateStatus.textContent = `${groups.length}グループ`;
  elements.duplicateCount.textContent = groups.length;

  if (!groups.length) {
    elements.duplicateList.classList.add("empty");
    elements.duplicateList.textContent = "SHA-256が一致する重複ファイルは見つかっていません。";
    return;
  }

  elements.duplicateList.classList.remove("empty");
  elements.duplicateList.innerHTML = groups
    .map((group, index) => `
      <details class="duplicate-group" ${index < 3 ? "open" : ""}>
        <summary>
          <strong>${group.count}件</strong>
          <span>${formatBytes(group.size)} each</span>
          <span>${group.mode === "hash" ? "内容一致" : "サイズ一致"}</span>
        </summary>
        <div class="duplicate-files">
          ${group.files.map((file) => `<code>${escapeHtml(file.path)}</code>`).join("")}
        </div>
      </details>
    `)
    .join("");
}

function renderAll() {
  const summary = scanResult.summary;
  elements.totalFiles.textContent = summary.totalFiles;
  elements.totalSize.textContent = formatBytes(summary.totalSize);
  elements.typeCount.textContent = summary.byType.length;
  elements.exportLink.classList.remove("disabled");
  renderTypeOptions();
  renderFiles();
  renderLinkAudit();
  renderSummaryList(elements.typeSummary, summary.byType);
  renderSummaryList(elements.extSummary, summary.byExt);
  renderDuplicates();
  setStatus(`${summary.totalFiles}件を調査済み`, "ok");
}

async function scan() {
  const rootPath = elements.pathInput.value.trim();
  if (!rootPath) {
    setStatus("パスを入力してください", "warn");
    return;
  }

  elements.scanButton.disabled = true;
  elements.scanButton.textContent = "スキャン中";
  setStatus("調査中", "");

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, checkDuplicates: elements.duplicateCheck.checked }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "スキャンに失敗しました");
    scanResult = data;
    renderAll();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = "スキャン";
  }
}

elements.scanButton.addEventListener("click", scan);
elements.pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") scan();
});
elements.sampleButton.addEventListener("click", () => {
  elements.pathInput.value = "/Users/admin011/Desktop/codex/unlinked-file-auditor/sample-public";
});
elements.searchInput.addEventListener("input", renderFiles);
elements.typeFilter.addEventListener("change", renderFiles);
elements.sortSelect.addEventListener("change", renderFiles);
