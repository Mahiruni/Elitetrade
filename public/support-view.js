// Presentation only. Authorization, persistence, and presence remain in support.js.
const paths = {
  plus: "M12 5v14M5 12h14",
  back: "m14 6-6 6 6 6",
  search: "m21 21-5-5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M6 18 18 6",
  details: "M9 3v18M3 3h18v18H3z",
  attach: "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M6 14l8-8",
  send: "m7 17 10-10M7 7h10v10",
  expand: "M8 3H3v5M16 21h5v-5M3 3l6 6M21 21l-6-6",
  collapse: "M3 8h5V3M21 16h-5v5M8 8 3 3M16 16l5 5",
  document: "M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h6",
  image: "M3 3h18v18H3zM3 17l5-5 4 4 4-6 5 7M8 7h.01",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3M8 12l3 3 5-6",
  check: "m5 12 4 4L19 6",
  down: "M12 4v16m-6-6 6 6 6-6",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  note: "M4 3h16v14l-5 4H4V3M8 8h8M8 12h5",
  clock: "M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
  retry: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
};
export const chatIcon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(
    paths[name] || paths.document
  )
    .split("|")
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;
export function createSupportPresentation({ esc, date }) {
  const initials = (name) =>
    String(name || "Support")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  const avatar = (name, team = false) =>
    `<span class="support-avatar ${team ? "team" : ""}" aria-hidden="true">${team ? chatIcon("shield") : esc(initials(name))}</span>`;
  const size = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  const kind = (f) =>
    ({
      jpg: "JPG",
      jpeg: "JPG",
      png: "PNG",
      webp: "WebP",
      pdf: "PDF",
      docx: "Word",
      txt: "Text",
      csv: "CSV",
      xlsx: "Excel",
    })[f.name.split(".").at(-1).toLowerCase()] || "Document";
  const stage = (s) =>
    ({ open: "Open", waiting: "Waiting for customer", resolved: "Resolved" })[
      s
    ] || "Open";
  const dayKey = (time) => new Date(time).toLocaleDateString("en-CA");
  const dayLabel = (time) => {
    const today = new Date(),
      yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    return dayKey(time) === dayKey(today)
      ? "Today"
      : dayKey(time) === dayKey(yesterday)
        ? "Yesterday"
        : new Date(time).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            ...(new Date(time).getFullYear() !== today.getFullYear()
              ? { year: "numeric" }
              : {}),
          });
  };
  const threadTime = (time) =>
    dayKey(time) === dayKey(Date.now())
      ? new Date(time).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : new Date(time).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
  function body(text) {
    // Only HTTP(S) links become interactive; all supplied text is escaped.
    return text
      .split(/(https?:\/\/[^\s<>]+)/gi)
      .map((part) => {
        if (!/^https?:\/\//i.test(part)) return esc(part);
        const url = part.replace(/[.,;!?\)\]]+$/, "");
        try {
          const parsed = new URL(url);
          if (!["http:", "https:"].includes(parsed.protocol)) return esc(part);
          return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${esc(part.slice(url.length))}`;
        } catch {
          return esc(part);
        }
      })
      .join("");
  }
  function fileCard(f, urls) {
    const image = f.mime.startsWith("image/"),
      url = urls?.get(f.id);
    return `<button type="button" class="support-file-card ${image ? "image-card" : ""}" data-chat="file" data-id="${esc(f.id)}" data-mime="${esc(f.mime)}" data-name="${esc(f.name)}" aria-label="${image ? "Preview" : "Download"} ${esc(f.name)}">${image ? `<span class="support-image-loading" ${url ? "" : `data-image="${esc(f.id)}"`}>${url ? `<img src="${url}" alt="" loading="lazy">` : `${chatIcon("image")}<span>Loading preview</span>`}</span>` : `<span class="support-file-symbol" aria-hidden="true">${chatIcon("document")}<small>${esc(kind(f))}</small></span>`}<span class="support-file-copy"><strong>${esc(f.name)}</strong><small>${esc(kind(f))} · ${size(f.size)}<span>${image ? "Open image" : "Download"}</span></small></span>${!image ? chatIcon("down") : ""}</button>`;
  }
  function timeline(
    messages,
    {
      admin,
      peerRead,
      unreadId,
      urls,
      highlightIds = new Set(),
      newIds = new Set(),
    },
  ) {
    if (!messages.length)
      return `<div class="support-history-empty">${chatIcon("shield")}<strong>Your conversation starts here</strong><span>Tell us what happened. Keep passwords and account secrets private.</span></div>`;
    return messages
      .map((m, i) => {
        const prev = messages[i - 1],
          newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at),
          unread = m.id === unreadId;
        const grouped =
          !newDay &&
          !unread &&
          prev?.sender === m.sender &&
          Math.abs(
            new Date(m.created_at).getTime() -
              new Date(prev.created_at).getTime(),
          ) < 300000;
        const mine = m.sender === (admin ? "admin" : "customer");
        return `${newDay ? `<div class="support-date-separator"><time datetime="${new Date(m.created_at).toISOString()}">${esc(dayLabel(m.created_at))}</time></div>` : ""}${unread ? '<div class="support-unread-divider" role="separator" aria-label="Unread messages"><span>Unread messages</span></div>' : ""}<article class="support-message ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""} ${highlightIds.has(m.id) ? "support-match" : ""} ${newIds.has(m.id) ? "just-added" : ""}" data-message-id="${esc(m.id)}"><span class="support-message-author">${mine ? "You" : m.sender === "admin" ? "Support team" : "Customer"}</span>${m.body ? `<p>${body(m.body)}</p>` : ""}${m.attachments?.length ? `<div class="support-message-files">${m.attachments.map((f) => fileCard(f, urls)).join("")}</div>` : ""}<div class="support-message-meta"><time datetime="${new Date(m.created_at).toISOString()}" title="${esc(date(m.created_at))}">${new Date(m.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>${mine ? `<span data-receipt="${m.support_seq}">${peerRead >= m.support_seq ? "Read" : "Sent"}</span>` : ""}</div></article>`;
      })
      .join("");
  }
  return { avatar, size, kind, stage, threadTime, timeline };
}
