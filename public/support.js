import { chatIcon, createSupportPresentation } from "./support-view.js";
export function createSupportWorkspace({ state, api, esc, toast }) {
  const endpoint = "/support/workspace",
    tabId = crypto.randomUUID();
  let host = null,
    admin = false,
    conversations = [],
    config = {},
    agents = [],
    abuse = [],
    current = null,
    messages = [],
    notes = [],
    selected = null,
    timer = null,
    typingTimer = null,
    typingThrottle = 0,
    activity = Date.now(),
    lastTyped = 0,
    generation = 0,
    busy = false,
    filter = "All",
    search = "",
    detail = false,
    expanded = false,
    files = [],
    sending = false,
    pendingId = null,
    noteMode = false,
    peerRead = 0,
    searchTimer = null,
    pollFailures = 0,
    lastRead = 0,
    urls = new Map(),
    syncing = false,
    heartbeatSeq = 0,
    failed = false,
    peerPresence = null,
    unreadId = null,
    matchIds = new Set(),
    newMessageCount = 0,
    failureMessage = "";
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  const view = createSupportPresentation({ esc, date });
  const drafts = new Map(),
    pending = new Map(),
    sessions = new Map();
  const button = (text, action, extra = "") =>
    `<button type="button" data-chat="${action}" ${extra}>${text}</button>`;
  const pendingKey = (id, mode = noteMode) =>
    `elite-support-pending:${state.user.id}:${id}:${mode ? "note" : "message"}`;
  const getPending = (id, mode = noteMode) => {
    try {
      return (
        pending.get(key(id, mode)) || localStorage.getItem(pendingKey(id, mode))
      );
    } catch {
      return pending.get(key(id, mode));
    }
  };
  const key = (id, mode = noteMode) =>
    `elite-support-draft:${state.user.id}:${id}:${mode ? "note" : "message"}`;
  const draft = () => {
    try {
      return (
        drafts.get(key(selected)) ?? localStorage.getItem(key(selected)) ?? ""
      );
    } catch {
      return drafts.get(key(selected)) || "";
    }
  };
  const saveDraft = () => {
    const t = host?.querySelector("[data-composer]");
    if (t && selected) {
      drafts.set(key(selected), t.value);
      try {
        if (t.value) localStorage.setItem(key(selected), t.value);
        else localStorage.removeItem(key(selected));
      } catch {}
    }
  };
  const error = (message) => {
    failureMessage = message;
    const el = host?.querySelector("[data-chat-error]");
    if (el) el.textContent = message;
  };
  const status = (p = { status: "unavailable" }) => {
    const labels = {
      online: "Online",
      away: "Away",
      offline: "Offline",
      unavailable: "Status unavailable",
    };
    let text = labels[p.status] || labels.unavailable;
    if (p.lastSeen && p.status === "offline") {
      const elapsed = Math.max(
        0,
        Math.floor((Date.now() - p.lastSeen) / 60000),
      );
      text += ` · Last seen ${elapsed < 1 ? "just now" : elapsed < 60 ? elapsed + "m ago" : elapsed < 1440 ? Math.floor(elapsed / 60) + "h ago" : Math.floor(elapsed / 1440) + "d ago"}`;
    }
    return `<span class="support-status ${esc(p.status)}" ${p.lastSeen ? `title="${esc(date(p.lastSeen))}" aria-label="${esc(text + ", " + date(p.lastSeen))}"` : ""}><i aria-hidden="true"></i>${esc(text)}</span>`;
  };
  const options = (items, value) =>
    items
      .map(
        (x) =>
          `<option ${x === value ? "selected" : ""} value="${esc(x)}">${esc(x)}</option>`,
      )
      .join("");
  const empty = (title, text, action = "") =>
    `<div class="support-blank"><span class="support-mark" aria-hidden="true">${chatIcon("shield")}</span><span class="support-kicker">HERE TO HELP</span><h2>${title}</h2><p>${text}</p>${action}</div>`;
  const fileSize = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const ref = (c) => c?.reference || "";
  const isMobile = () => matchMedia("(max-width: 760px)").matches;
  const apiCall = (id, action, data) =>
    api(`${endpoint}/${id}/${action}`, "POST", data);
  async function heartbeat(leaving = false) {
    if (!selected || !host) return;
    const convo = selected,
      version = generation;
    try {
      const d = await apiCall(selected, "heartbeat", {
        tabId,
        seq: ++heartbeatSeq,
        active: !document.hidden && Date.now() - activity < 120000,
        typing:
          !noteMode &&
          !leaving &&
          !document.hidden &&
          Date.now() - lastTyped < 4500 &&
          !!host.querySelector("[data-composer]")?.value.trim(),
        leaving,
      });
      if (host && !leaving && convo === selected && version === generation)
        updatePresence(d.presence);
    } catch {
      updatePresence({ status: "unavailable" });
    }
  }
  function updatePresence(p) {
    peerPresence = p;
    const el = host?.querySelector("[data-presence]");
    if (el) el.innerHTML = status(p);
    const offline = host?.querySelector("[data-agent-offline]");
    if (offline) {
      offline.hidden = admin || !["offline", "away"].includes(p?.status);
      offline.textContent = config.offline || "";
    }
    const type = host?.querySelector("[data-typing]");
    if (type) {
      type.hidden = !p?.typing;
      type.innerHTML = p?.typing
        ? '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> Support is typing…'
        : "";
      if (admin && p?.typing)
        type.innerHTML =
          '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> Customer is typing…';
    }
  }
  function keep() {
    saveDraft();
    if (selected && current)
      sessions.set(selected, {
        messages,
        files,
        noteMode,
        pendingId,
        current,
        notes,
        peerRead,
        peerPresence,
        unreadId,
        failed,
        failureMessage,
        matchIds,
        scroll: host?.querySelector("[data-timeline]")?.scrollTop || 0,
      });
  }
  async function loadList() {
    const d = await api(endpoint);
    conversations = d.conversations;
    config = d.config;
    agents = d.agents;
    abuse = d.abuse || [];
  }
  function listHtml() {
    const visible = conversations.filter((c) => {
      const matches = `${c.name} ${c.email} ${c.preview} ${c.reference}`
        .toLowerCase()
        .includes(search.toLowerCase());
      return (
        matches &&
        (filter === "All" ||
          (filter === "Unread" && c.unread > 0) ||
          (filter === "Assigned to me" && c.assigned_to === state.user.id) ||
          (filter === "Unassigned" &&
            !c.assigned_to &&
            c.stage !== "resolved") ||
          (filter === "Resolved" && c.stage === "resolved"))
      );
    });
    return (
      visible
        .map(
          (c) =>
            `<button type="button" class="support-thread ${selected === c.id ? "selected" : ""}" data-chat="select" data-id="${esc(c.id)}" aria-current="${selected === c.id}">${view.avatar(admin ? c.name : c.agent_name || "Support", !admin)}<span class="support-thread-copy"><span class="support-thread-top"><strong>${esc(admin ? c.name : c.category)}</strong><time title="${esc(date(c.updated_at))}">${view.threadTime(c.updated_at)}</time></span><span class="support-preview">${esc(c.preview || ((c.id === selected ? messages : sessions.get(c.id)?.messages)?.at(-1)?.attachments?.length ? "Attachment" : c.updated_at === c.created_at ? "Start the conversation" : "Open to view the latest message"))}</span><span class="support-thread-bottom"><span class="support-thread-stage ${esc(c.stage)}">${esc(view.stage(c.stage))}</span>${c.unread ? `<span class="support-unread" aria-label="${c.unread} unread messages">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}</span>${admin ? status(c.presence) : ""}</span></button>`,
        )
        .join("") ||
      `<div class="support-list-empty">${chatIcon("search")}<strong>${conversations.length ? "No conversations found" : "Your inbox is ready"}</strong><p>${conversations.length ? "Try a different search or filter." : "Start a conversation whenever you need a hand."}</p>${conversations.length ? button("Clear search and filters", "clear-filters") : button("New conversation", "new")}</div>`
    );
  }
  function listUpdate() {
    const el = host?.querySelector("[data-thread-list]");
    if (el) {
      const active = el.contains(document.activeElement)
        ? document.activeElement?.dataset.id
        : null;
      el.innerHTML = listHtml();
      const count = host.querySelector("[data-inbox-count]");
      if (count)
        count.textContent = `${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}`;
      if (active)
        el.querySelector(`[data-id="${CSS.escape(active)}"]`)?.focus({
          preventScroll: true,
        });
    }
  }
  function detailsHtml() {
    if (!current) return "";
    return `<div class="support-details-title"><h3>Conversation details</h3>${button(chatIcon("close"), "details", 'class="support-icon-button" aria-label="Close conversation details"')}</div><div class="support-details-person">${view.avatar(current.name)}<strong>${esc(current.name)}</strong><span>${esc(ref(current))}</span></div><dl><dt>Reference</dt><dd>${esc(ref(current))}</dd><dt>Customer</dt><dd>${esc(current.name)}</dd>${admin ? `<dt>Email</dt><dd>${esc(current.email)}</dd>${abuse.some((a) => a.user_id === current.user_id) ? `<dt>Moderation review</dt><dd>${abuse.find((a) => a.user_id === current.user_id).count} blocked submissions in the last 30 days. Review the conversation before taking action.</dd>` : ""}` : ""}<dt>Category</dt><dd>${esc(current.category)}</dd><dt>Priority</dt><dd>${esc(current.priority)}</dd><dt>Status</dt><dd>${esc(view.stage(current.stage))}</dd><dt>Assigned agent</dt><dd>${esc(current.agent_name || "No agent assigned")}</dd><dt>${admin ? "Customer presence" : "Support presence"}</dt><dd>${status(peerPresence || undefined)}${peerPresence?.lastSeen ? `<small class="support-exact-time">Last seen ${esc(date(peerPresence.lastSeen))}</small>` : ""}</dd>${!admin ? `<dt>Support hours</dt><dd>${esc(config.hours || "Support hours have not been configured.")}</dd>` : ""}</dl>${admin ? `<label>Assignment<select data-support-setting="assigned_to"><option value="">Unassigned</option>${agents.map((a) => `<option value="${esc(a.id)}" ${current.assigned_to === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label><label>Priority<select data-support-setting="priority">${options(config.priorities || [], current.priority)}</select></label><label>Category<select data-support-setting="category">${options(config.categories || [], current.category)}</select></label><label>Conversation state<select data-support-setting="stage">${options(["open", "waiting", "resolved"], current.stage)}</select></label><h3>Internal notes</h3><div class="support-notes">${notes.map((n) => `<article><span>Internal · ${esc(date(n.created_at))}</span><p>${esc(n.body)}</p></article>`).join("") || "<p>No internal notes.</p>"}</div>${button("Write internal note", "note")}` : ""}<p class="support-security-note">Never share passwords, API secrets, or complete MT5 credentials here.</p>`;
  }
  function timelineHtml() {
    return view.timeline(messages, {
      admin,
      peerRead,
      unreadId,
      urls,
      highlightIds: matchIds,
    });
  }
  async function markRead() {
    const last = messages.at(-1)?.support_seq || 0;
    if (!host || document.hidden || !selected || last <= lastRead) return;
    const el = host.querySelector("[data-timeline]");
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      lastRead = last;
      try {
        await apiCall(selected, "read", { cursor: last });
        const c = conversations.find((c) => c.id === selected);
        if (c) c.unread = 0;
        listUpdate();
      } catch {
        lastRead = 0;
      }
    }
  }
  function appendMessages(incoming, prepend = false) {
    const el = host?.querySelector("[data-timeline]");
    if (!el) return;
    const bottom = nearLatest(),
      oldHeight = el.scrollHeight,
      oldTop = el.scrollTop,
      existing = new Set(messages.map((m) => m.id));
    const added = incoming.filter((m) => !existing.has(m.id));
    if (!added.length) return;
    const anchor = [...el.querySelectorAll("[data-message-id]")].find(
      (m) => m.getBoundingClientRect().bottom > el.getBoundingClientRect().top,
    );
    const anchorId = anchor?.dataset.messageId,
      anchorOffset = anchor?.getBoundingClientRect().top;
    messages = [...messages, ...added].sort(
      (a, b) => a.support_seq - b.support_seq,
    );
    el.innerHTML = view.timeline(messages, {
      admin,
      peerRead,
      unreadId,
      urls,
      highlightIds: matchIds,
      newIds: prepend ? new Set() : new Set(added.map((m) => m.id)),
    });
    if (bottom && !prepend) el.scrollTop = el.scrollHeight;
    else if (anchorId) {
      const next = el.querySelector(
        `[data-message-id="${CSS.escape(anchorId)}"]`,
      );
      el.scrollTop =
        oldTop +
        (next
          ? next.getBoundingClientRect().top - anchorOffset
          : prepend
            ? el.scrollHeight - oldHeight
            : 0);
    } else el.scrollTop = oldTop;
    if (!prepend) {
      if (!bottom)
        newMessageCount += added.filter(
          (m) => m.sender !== (admin ? "admin" : "customer"),
        ).length;
      host.querySelector("[data-announcer]").textContent =
        `${added.length} new message${added.length === 1 ? "" : "s"}.`;
      void markRead();
    }
    updateJump();
    loadImages();
  }
  function nearLatest() {
    const t = host?.querySelector("[data-timeline]");
    return !!t && t.scrollHeight - t.scrollTop - t.clientHeight < 80;
  }
  function updateJump() {
    const t = host?.querySelector("[data-timeline]"),
      b = host?.querySelector("[data-jump]");
    if (!t || !b) return;
    if (nearLatest()) newMessageCount = 0;
    b.hidden = nearLatest();
    b.innerHTML = `${chatIcon("down")}<span>${newMessageCount ? `${newMessageCount} new · ` : ""}Jump to latest</span>`;
    const composer = host.querySelector("[data-compose],.support-resolved");
    host.style.setProperty(
      "--jump-bottom",
      `${(composer?.offsetHeight || 0) + 44}px`,
    );
  }
  function receipts() {
    host
      ?.querySelectorAll("[data-receipt]")
      .forEach(
        (el) =>
          (el.textContent =
            peerRead >= Number(el.dataset.receipt) ? "Read" : "Sent"),
      );
  }
  function layout() {
    return `<section class="support-workspace ${admin ? "admin-workspace" : "customer-workspace"} ${selected ? "has-chat" : ""} ${detail ? "show-details" : ""}" aria-label="EliteTrade support workspace"><aside class="support-inbox"><div class="support-inbox-head"><div><span class="support-kicker">ELITETRADE SUPPORT</span><h1>${admin ? "Support inbox" : "Your conversations"}</h1></div>${button(chatIcon("plus"), "new", 'class="support-icon-button" aria-label="New conversation"')}</div><div class="support-inbox-controls"><label class="support-search">${chatIcon("search")}<span class="sr-only">Search conversations</span><input type="search" data-inbox-search placeholder="Search conversations" value="${esc(search)}"></label><div class="support-filter-line"><label class="support-filter"><span class="sr-only">Filter conversations</span><select data-filter>${options(admin ? ["All", "Unread", "Assigned to me", "Unassigned", "Resolved"] : ["All", "Unread", "Resolved"], filter)}</select></label><span data-inbox-count class="support-inbox-count">${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}</span>${admin ? button(chatIcon("settings"), "settings", 'class="support-icon-button" aria-label="Support settings"') : ""}</div></div><div class="support-thread-list" data-thread-list aria-label="Conversations">${listHtml()}</div><div class="support-inbox-foot"><span>${chatIcon("shield")} Private account support</span><small>${esc(config.hours || "Support hours have not been configured.")}</small>${admin && abuse.length ? `<p>${abuse.length} account(s) flagged for repeated blocked submissions.</p>${button("Review flags", "review-abuse")}` : ""}</div></aside><div class="support-central"><div class="support-sync" role="status" data-sync hidden></div><div data-chat-pane>${empty("Support, with you.", "Get help with your account, MT5 connection, or bot settings. Select a conversation or start a new one.", button(`${chatIcon("plus")} New conversation`, "new", 'class="support-send"'))}</div></div><aside class="support-details" data-details aria-label="Conversation details" ${detail ? "" : "hidden"}>${detailsHtml()}</aside><div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-announcer></div></section>`;
  }
  function composerHtml() {
    return `<div class="support-composer-wrap"><form class="support-composer ${expanded ? "expanded" : ""} ${noteMode ? "is-note" : ""} ${failed ? "has-failure" : ""}" data-compose><div class="support-compose-tools"><span data-compose-label>${noteMode ? `${chatIcon("note")} Internal note · team only` : "Reply to conversation"}</span><div>${admin ? `${button(chatIcon("note"), "note", `class="support-icon-button support-note-toggle" aria-label="${noteMode ? "Switch to customer reply" : "Write internal note"}" aria-pressed="${noteMode}"`)}` : ""}${button(chatIcon(expanded ? "collapse" : "expand"), "expand", 'class="support-icon-button" aria-label="' + (expanded ? "Collapse writing mode" : "Expand writing mode") + '" aria-pressed="' + expanded + '"')}</div></div><textarea data-composer maxlength="20000" rows="1" aria-label="${noteMode ? "Internal note" : "Your message"}" aria-describedby="support-compose-hint" placeholder="${noteMode ? "Write a private note for the support team…" : "Write a message…"}">${esc(draft())}</textarea><div class="support-pending-files" data-pending-files></div><div class="support-compose-feedback"><p class="support-error" data-chat-error role="alert">${failed ? esc(failureMessage) : ""}</p>${button(`${chatIcon("retry")} Retry send`, "retry-send", `class="support-retry" data-retry ${failed ? "" : "hidden"}`)}</div><div class="support-compose-bottom"><div>${button(chatIcon("attach"), "attach", `class="support-icon-button support-attach" aria-label="Attach images or documents" ${config.attachmentsAvailable && !noteMode ? "" : "disabled"}`)}${admin ? button("Quick replies", "replies", 'class="support-quick-replies"') : ""}<span class="support-character-count" data-counter></span><input type="file" data-files multiple hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,.csv,.xlsx"><input type="file" data-images multiple hidden accept=".jpg,.jpeg,.png,.webp"></div><button class="support-send" type="submit" aria-label="${noteMode ? "Save internal note" : "Send message"}">${noteMode ? "Save note" : "Send"} ${chatIcon("send")}</button></div></form><small id="support-compose-hint" class="support-compose-hint">${!config.attachmentsAvailable ? "Attachments need private storage configuration. " : ""}${isMobile() ? "Never share passwords or account secrets." : "Enter to send · Shift+Enter for a new line"}</small></div>`;
  }
  function pane({ scroll, focus = false } = {}) {
    const p = host.querySelector("[data-chat-pane]");
    if (!current) return;
    const previousComposer = p.querySelector("[data-composer]"),
      restoreFocus = previousComposer === document.activeElement,
      caret = previousComposer
        ? [previousComposer.selectionStart, previousComposer.selectionEnd]
        : null;
    const oldTop = scroll ?? p.querySelector("[data-timeline]")?.scrollTop;
    p.innerHTML = `<header class="support-participant"><div class="support-participant-identity">${button(chatIcon("back"), "back", 'class="support-back support-icon-button" aria-label="Back to conversations"')}${view.avatar(admin ? current.name : current.agent_name || "Support", !admin)}<div class="support-participant-copy"><h2 title="${esc(admin ? current.name : current.agent_name || "EliteTrade support")}">${esc(admin ? current.name : current.agent_name || "EliteTrade support")}</h2><div data-presence>${status(peerPresence || undefined)}</div></div></div><div class="support-header-actions"><span class="support-reference">${esc(ref(current))}</span>${button(chatIcon("search"), "toggle-search", 'class="support-icon-button support-desktop-action" aria-label="Search conversation" aria-expanded="false"')}${button(chatIcon("details"), "details", 'class="support-icon-button support-desktop-action" aria-label="Conversation details" aria-expanded="' + detail + '"')}${button(chatIcon("more"), "actions", 'class="support-icon-button" aria-label="Conversation actions" aria-haspopup="dialog"')}</div></header><div class="support-context"><span class="support-category">${esc(current.category)}</span><span class="support-stage ${esc(current.stage)}">${current.stage === "resolved" ? chatIcon("check") : ""}${esc(view.stage(current.stage))}</span></div><div class="support-conversation-search" data-search-bar hidden><label>${chatIcon("search")}<span class="sr-only">Search conversation</span><input type="search" data-message-search placeholder="Find a message…"></label><span data-search-results role="status"></span>${button(chatIcon("close"), "close-search", 'class="support-icon-button" aria-label="Close conversation search"')}</div>${!current.assigned_to ? '<p class="support-system">No agent assigned yet. Your message will be here for the team.</p>' : ""}<div class="support-history-toolbar">${button(`${chatIcon("clock")} Earlier messages`, "earlier")}</div><div class="support-timeline" data-timeline tabindex="0" aria-label="Message history">${timelineHtml()}</div><p data-agent-offline hidden class="support-system"></p><div data-typing class="support-typing" role="status" hidden></div>${button("Jump to latest", "latest", 'data-jump hidden class="support-jump"')}${current.stage === "resolved" && !noteMode ? `<div class="support-resolved"><div>${chatIcon("check")}<p><strong>Conversation resolved</strong><span>You can reopen it if you need more help.</span></p></div>${button("Reopen", "reopen")}${!admin ? `<label>How was your support experience?<select data-rating aria-label="Support satisfaction"><option value="">Choose a rating</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${current.rating === n ? "selected" : ""}>${n} / 5</option>`).join("")}</select></label>` : ""}</div>` : composerHtml()}`;
    const t = p.querySelector("[data-timeline]");
    t.scrollTop = oldTop ?? t.scrollHeight;
    t.addEventListener(
      "scroll",
      () => {
        updateJump();
        void markRead();
      },
      { passive: true },
    );
    p.querySelector("[data-compose]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void send();
    });
    p.querySelector("[data-composer]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isMobile()) {
        e.preventDefault();
        void send();
      }
    });
    p.querySelector("[data-composer]")?.addEventListener("input", () => {
      saveDraft();
      failed = false;
      host.querySelector("[data-retry]").hidden = true;
      host.querySelector("[data-compose]").classList.remove("has-failure");
      error("");
      pendingId = null;
      pending.delete(key(selected));
      try {
        localStorage.removeItem(pendingKey(selected));
      } catch {}
      activity = Date.now();
      lastTyped = Date.now();
      grow();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        lastTyped = 0;
        void heartbeat();
      }, 4700);
      if (!p.querySelector("[data-composer]").value.trim()) {
        lastTyped = 0;
        void heartbeat();
      }
      if (Date.now() - typingThrottle > 1200) {
        typingThrottle = Date.now();
        void heartbeat();
      }
    });
    grow();
    renderFiles();
    loadImages();
    updatePresence(peerPresence || { status: "unavailable" });
    updateJump();
    const nextComposer = p.querySelector("[data-composer]");
    if (nextComposer && (focus || restoreFocus)) {
      nextComposer.focus({ preventScroll: true });
      if (caret) nextComposer.setSelectionRange(...caret);
    }
    void markRead();
  }
  function grow() {
    const t = host?.querySelector("[data-composer]");
    if (!t) return;
    const bottom = nearLatest();
    t.style.height = "auto";
    t.style.height =
      Math.min(
        expanded ? Math.min(320, host.clientHeight * 0.45) : 144,
        t.scrollHeight,
      ) + "px";
    const counter = host.querySelector("[data-counter]");
    counter.textContent =
      t.value.length > 18000
        ? `${t.value.length.toLocaleString("en-US")} / 20,000`
        : "";
    counter.classList.toggle("near-limit", t.value.length >= 19500);
    updateComposerState();
    if (bottom) {
      const timeline = host.querySelector("[data-timeline]");
      timeline.scrollTop = timeline.scrollHeight;
    }
    updateJump();
  }
  function updateComposerState() {
    const b = host?.querySelector('[data-compose] [type="submit"]'),
      t = host?.querySelector("[data-composer]");
    if (!b || !t) return;
    b.disabled =
      sending ||
      (!t.value.trim() && (noteMode || !files.length)) ||
      (!noteMode && files.some((f) => f.state !== "ready"));
    b.innerHTML = sending
      ? "Sending…"
      : `${noteMode ? "Save note" : "Send"} ${chatIcon("send")}`;
    b.setAttribute("aria-busy", String(sending));
  }
  async function select(id) {
    keep();
    await heartbeat(true);
    const token = ++generation;
    selected = id;
    lastRead = 0;
    pendingId = null;
    files = [];
    noteMode = false;
    messages = [];
    current = null;
    failed = false;
    failureMessage = "";
    matchIds = new Set();
    peerPresence = null;
    unreadId = null;
    newMessageCount = 0;
    const cache = sessions.get(id);
    if (cache) {
      files = cache.files;
      noteMode = cache.noteMode;
      pendingId = cache.pendingId;
      messages = cache.messages;
      current = cache.current;
      notes = cache.notes;
      peerRead = cache.peerRead;
      peerPresence = cache.peerPresence;
      failed = cache.failed;
      failureMessage = cache.failureMessage || "";
      unreadId = cache.unreadId;
      matchIds = cache.matchIds || new Set();
    }
    host.classList.add("has-chat");
    if (cache?.current) pane({ scroll: cache.scroll });
    else
      host.querySelector("[data-chat-pane]").innerHTML =
        '<div class="support-loading" role="status"><span class="sr-only">Loading conversation…</span><div class="support-skeleton-header"></div><div class="skeleton"></div><div class="skeleton mine"></div><div class="skeleton"></div></div>';
    listUpdate();
    try {
      const d = await api(`${endpoint}/${id}`);
      if (token !== generation || !host) return;
      current = d.conversation;
      notes = d.notes || [];
      peerRead = d.peerRead || 0;
      peerPresence = d.presence;
      const map = new Map([...messages, ...d.messages].map((m) => [m.id, m]));
      messages = [...map.values()].sort(
        (a, b) => a.support_seq - b.support_seq,
      );
      const unread = conversations.find((c) => c.id === id)?.unread || 0;
      if (!cache && unread)
        unreadId =
          messages
            .filter((m) => m.sender === (admin ? "customer" : "admin"))
            .slice(-unread)[0]?.id || null;
      pane({ scroll: cache?.scroll });
      updatePresence(d.presence);
      detailsUpdate();
      await heartbeat();
    } catch (e) {
      if (token !== generation || !host) return;
      if (cache?.current) {
        sync(
          "Could not refresh · Your loaded conversation is still available.",
        );
        updatePresence({ status: "unavailable" });
      } else
        host.querySelector("[data-chat-pane]").innerHTML = empty(
          "Conversation unavailable",
          esc(e.message),
          button("Try again", "retry-conversation"),
        );
    }
  }
  function detailsUpdate() {
    const el = host?.querySelector("[data-details]");
    if (!el) return;
    host
      .querySelectorAll('[data-chat="details"]')
      .forEach((b) => b.setAttribute("aria-expanded", String(detail)));
    if (!el.contains(document.activeElement)) el.innerHTML = detailsHtml();
    el.hidden = !detail;
    host.classList.toggle("show-details", detail);
    if (isMobile() && detail) {
      el.hidden = true;
      dialog(
        "Conversation details",
        `<div class="support-details-sheet">${detailsHtml()}</div>`,
      );
      document.querySelector("#modal .support-details-title")?.remove();
    }
    updateJump();
  }
  async function refresh() {
    if (!host || busy || document.hidden) return;
    busy = true;
    const token = generation,
      id = selected;
    try {
      await loadList();
      if (!host || token !== generation) return;
      listUpdate();
      if (id && current) {
        let d;
        let cursor = messages.at(-1)?.support_seq;
        do {
          d = await api(`${endpoint}/${id}${cursor ? "?after=" + cursor : ""}`);
          if (!host || id !== selected || token !== generation) return;
          const stage = current.stage,
            assignment = current.assigned_to,
            category = current.category,
            participant = current.name,
            agentName = current.agent_name;
          current = d.conversation;
          notes = d.notes || [];
          peerRead = d.peerRead || 0;
          appendMessages(d.messages);
          receipts();
          updatePresence(d.presence);
          if (
            stage !== current.stage ||
            assignment !== current.assigned_to ||
            category !== current.category ||
            participant !== current.name ||
            agentName !== current.agent_name
          ) {
            saveDraft();
            pane();
          }
          cursor = messages.at(-1)?.support_seq;
          if (d.messages.length < 60) break;
        } while (host && token === generation);
        if (detail && !document.querySelector("#modal")?.open) detailsUpdate();
        await heartbeat();
      }
      pollFailures = 0;
      sync("");
    } catch (e) {
      pollFailures++;
      sync(
        navigator.onLine
          ? "Connection interrupted · Retrying…"
          : "Offline · Drafts stay on this device.",
      );
      updatePresence({ status: "unavailable" });
    } finally {
      busy = false;
    }
  }
  function sync(text) {
    const el = host?.querySelector("[data-sync]");
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  }
  async function send() {
    if (sending || !selected) return;
    const t = host.querySelector("[data-composer]");
    if (!t || (!t.value.trim() && (noteMode || !files.length))) return;
    if (!noteMode && files.some((f) => f.state !== "ready")) {
      error("Wait for uploads to finish, or remove failed files.");
      return;
    }
    sending = true;
    failed = false;
    host.querySelector("[data-retry]").hidden = true;
    host.querySelector("[data-compose]").classList.remove("has-failure");
    saveDraft();
    const id = selected,
      mode = noteMode,
      body = t.value,
      selectedFiles = noteMode ? [] : files.slice(),
      clientId = pendingId || getPending(id, mode) || crypto.randomUUID();
    pendingId = clientId;
    pending.set(key(id, mode), clientId);
    try {
      localStorage.setItem(pendingKey(id, mode), clientId);
    } catch {}
    const sendButton = host.querySelector('[data-compose] [type="submit"]');
    sendButton.disabled = true;
    sendButton.textContent = "Sending…";
    error("");
    lastTyped = 0;
    void heartbeat();
    try {
      await apiCall(id, mode ? "note" : "send", {
        message: body,
        clientId,
        attachments: selectedFiles.map((f) => f.id),
      });
      const activeComposer =
        selected === id && noteMode === mode
          ? host?.querySelector("[data-composer]")
          : null;
      const latestDraft =
        activeComposer?.value ?? drafts.get(key(id, mode)) ?? body;
      if (latestDraft === body) {
        drafts.delete(key(id, mode));
        try {
          localStorage.removeItem(key(id, mode));
        } catch {}
      }
      pending.delete(key(id, mode));
      try {
        localStorage.removeItem(pendingKey(id, mode));
      } catch {}
      const cached = sessions.get(id);
      if (cached) {
        if (!mode)
          cached.files = cached.files.filter((f) => !selectedFiles.includes(f));
        if (cached.noteMode === mode) {
          cached.pendingId = null;
          cached.failed = false;
          cached.failureMessage = "";
        }
      }
      if (host && selected === id && noteMode === mode) {
        if (activeComposer?.value === body) activeComposer.value = "";
        if (!mode) files = files.filter((f) => !selectedFiles.includes(f));
        renderFiles();
        grow();
        if (activeComposer?.value) saveDraft();
        pendingId = null;
        await refresh();
        if (mode) {
          notes = (await api(`${endpoint}/${id}`)).notes || [];
          detailsUpdate();
        }
        toast(mode ? "Internal note saved." : "Message sent.");
      }
    } catch (e) {
      if (host && selected === id && noteMode === mode) {
        failed = true;
        error(e.message + " Your draft is saved.");
        const retry = host?.querySelector("[data-retry]");
        if (retry) retry.hidden = false;
        host?.querySelector("[data-compose]")?.classList.add("has-failure");
        host.querySelector("[data-announcer]").textContent =
          "Message failed. Your draft is preserved.";
      }
    } finally {
      sending = false;
      if (host) {
        updateComposerState();
        updateJump();
      }
    }
  }
  function authHeaders() {
    return {
      Authorization: state.auth?.access_token
        ? `Bearer ${state.auth.access_token}`
        : "",
      "X-CSRF-Token": state.csrf || "",
    };
  }
  async function download(id, mime, name, view = true) {
    const convo = selected;
    await api("/me");
    const r = await fetch(`/api${endpoint}/${convo}/attachments/${id}`, {
      headers: authHeaders(),
    });
    if (!r.ok) {
      let d;
      try {
        d = await r.json();
      } catch {}
      throw Error(d?.error || "Attachment unavailable.");
    }
    const blob = await r.blob(),
      url = URL.createObjectURL(blob);
    urls.set(id, url);
    if (mime.startsWith("image/") && view) {
      dialog(
        "Image preview",
        `<img class="support-image-viewer" src="${url}" alt="${esc(name)}"><a href="${url}" download="${esc(name)}">Download image</a>`,
      );
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    }
    return url;
  }
  function loadImages() {
    host?.querySelectorAll("[data-image]").forEach(async (el) => {
      const id = el.dataset.image;
      delete el.dataset.image;
      const m = messages.find((m) => m.attachments?.some((f) => f.id === id)),
        f = m?.attachments.find((f) => f.id === id);
      if (!f) return;
      try {
        let url = urls.get(id);
        if (!url) {
          await api("/me");
          const r = await fetch(
            `/api${endpoint}/${selected}/attachments/${id}`,
            { headers: authHeaders() },
          );
          if (!r.ok) throw Error();
          url = URL.createObjectURL(await r.blob());
          urls.set(id, url);
        }
        if (el.isConnected)
          el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
      } catch {
        if (el.isConnected)
          el.innerHTML = `${chatIcon("image")}<span>Preview unavailable · Open to retry</span>`;
      }
    });
  }
  function renderFiles() {
    const el = host?.querySelector("[data-pending-files]");
    if (!el) return;
    el.innerHTML = (noteMode ? [] : files)
      .map(
        (f, i) =>
          `<div class="support-upload ${f.state}">${f.preview ? `<img src="${f.preview}" alt="Preview of ${esc(f.name)}">` : `<span class="support-upload-symbol">${chatIcon("document")}</span>`}<span><strong title="${esc(f.name)}">${esc(f.name)}</strong><small>${f.state === "ready" ? "Ready" : f.state === "failed" ? esc(f.error) : "Uploading · " + f.progress + "%"} · ${fileSize(f.size || f.file.size)}</small>${f.state === "uploading" ? `<progress value="${f.progress}" max="100" aria-label="Upload ${esc(f.name)}"></progress>` : ""}</span>${button(chatIcon("close"), "remove-file", `class="support-icon-button" data-index="${i}" aria-label="${f.state === "uploading" ? "Cancel upload of" : "Remove"} ${esc(f.name)}"`)}</div>`,
      )
      .join("");
    updateComposerState();
    updateJump();
  }
  async function uploadList(list) {
    const uploadConversation = selected,
      targetFiles = files;
    if (files.length + list.length > (config.maxAttachments || 5)) {
      error(
        "Send up to " +
          (config.maxAttachments || 5) +
          " attachments per message.",
      );
      return;
    }
    for (const file of list) {
      if (!file.size || file.size > config.maxFileBytes) {
        error(
          `Each file must be no larger than ${Math.floor(config.maxFileBytes / 1024 / 1024)} MB on this host.`,
        );
        continue;
      }
      const f = {
        name: file.name,
        state: "uploading",
        progress: 0,
        file,
        conversation: uploadConversation,
        preview: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      };
      targetFiles.push(f);
      renderFiles();
      try {
        await api("/me");
        await new Promise((resolve, reject) => {
          const x = new XMLHttpRequest();
          f.xhr = x;
          x.open("POST", `/api${endpoint}/${f.conversation}/attachments`);
          for (const [k, v] of Object.entries(authHeaders()))
            x.setRequestHeader(k, v);
          x.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
          const ext = file.name.split(".").at(-1).toLowerCase();
          const inferred = {
            txt: "text/plain",
            csv: "text/csv",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          };
          x.setRequestHeader(
            "Content-Type",
            file.type || inferred[ext] || "application/octet-stream",
          );
          x.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              f.progress = Math.round((e.loaded / e.total) * 100);
              renderFiles();
            }
          };
          x.onload = () => {
            let d;
            try {
              d = JSON.parse(x.responseText);
            } catch {
              d = { error: "The upload failed. Try a smaller file." };
            }
            if (x.status < 200 || x.status >= 300)
              return reject(Error(d.error));
            f.id = d.id;
            f.state = "ready";
            f.size = d.size;
            f.mime = d.mime;
            resolve();
          };
          x.onerror = () =>
            reject(
              Error(
                "Connection interrupted. Remove the file and attach it again.",
              ),
            );
          x.onabort = () => reject(Error("Upload cancelled."));
          x.send(file);
        });
      } catch (e) {
        f.state = "failed";
        f.error = e.message;
      }
      renderFiles();
    }
  }
  function dialog(title, html, submit) {
    const d = document.querySelector("#modal");
    if (d.open) d.close();
    d.setAttribute("data-support-modal", "");
    d.setAttribute("aria-labelledby", "support-dialog-title");
    d.innerHTML = `<div class="support-dialog"><div class="support-sheet-handle" aria-hidden="true"></div><div class="support-dialog-head"><h2 id="support-dialog-title">${esc(title)}</h2><button type="button" class="support-icon-button" aria-label="Close dialog" data-support-close>${chatIcon("close")}</button></div>${html}</div>`;
    d.querySelector("[data-support-close]").onclick = () => d.close();
    d.onclick = (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          d.close();
      } else void clicked(e);
    };
    d.onchange = changed;
    if (submit) d.querySelector("form").onsubmit = submit;
    d.onclose = () => {
      if (d.open) return;
      d.removeAttribute("data-support-modal");
      d.removeAttribute("aria-labelledby");
      d.onclick = null;
      d.onchange = null;
      if (detail && isMobile()) {
        detail = false;
        host?.classList.remove("show-details");
        host?.querySelector("[data-details]")?.setAttribute("hidden", "");
      }
    };
    d.showModal();
  }
  function actionSheet() {
    dialog(
      "Conversation actions",
      `<div class="support-sheet-actions">${button(`${chatIcon("search")}<span><strong>Find a message</strong><small>Search this conversation</small></span>`, "toggle-search")}${button(`${chatIcon("details")}<span><strong>Conversation details</strong><small>Reference, status, and support context</small></span>`, "details")}${admin && current.stage !== "resolved" ? button(`${chatIcon("check")}<span><strong>Resolve conversation</strong><small>Mark this request as complete</small></span>`, "resolve") : ""}${current.stage === "resolved" ? button(`${chatIcon("retry")}<span><strong>Reopen conversation</strong><small>Continue where you left off</small></span>`, "reopen") : ""}${admin ? button(`${chatIcon("note")}<span><strong>${noteMode ? "Customer reply" : "Internal note"}</strong><small>${noteMode ? "Return to the customer conversation" : "Visible only to the support team"}</small></span>`, "note") : ""}</div>`,
    );
  }
  function attachmentSheet() {
    dialog(
      "Add an attachment",
      `<p class="support-dialog-intro">Up to ${config.maxAttachments || 5} files · ${fileSize(config.maxFileBytes)} per file</p><div class="support-sheet-actions">${button(`${chatIcon("image")}<span><strong>Photos & images</strong><small>JPG, PNG, and WebP</small></span>`, "choose-images")}${button(`${chatIcon("document")}<span><strong>Documents</strong><small>PDF, Word, Excel, text, and CSV</small></span>`, "choose-files")}</div><p class="support-security-note">${chatIcon("shield")} Files stay private to this conversation.</p>`,
    );
  }
  function repliesSheet() {
    dialog(
      "Quick replies",
      `<p class="support-dialog-intro">Choose a starting point, then edit it before sending.</p><div class="support-sheet-actions">${(config.replies || []).map((r, i) => button(`<span><strong>${esc(r)}</strong><small>Insert into your draft</small></span>`, "insert-reply", `data-index="${i}"`)).join("") || "<p>No saved replies yet. Add them in Support settings.</p>"}</div>`,
    );
  }
  function newConversation() {
    dialog(
      "New conversation",
      `<form><label>Issue category<select name="category">${options(config.categories || ["Other"], "Other")}</select></label><p>Describe the issue after creating your conversation. Never share secrets or passwords.</p><p data-dialog-error role="alert"></p><button class="support-send" type="submit">Start conversation</button></form>`,
      async (e) => {
        e.preventDefault();
        const f = e.target,
          b = f.querySelector("button");
        b.disabled = true;
        try {
          const d = await api(endpoint, "POST", {
            category: new FormData(f).get("category"),
          });
          document.querySelector("#modal").close();
          await loadList();
          await select(d.id);
        } catch (err) {
          f.querySelector("[data-dialog-error]").textContent = err.message;
        } finally {
          b.disabled = false;
        }
      },
    );
  }
  function settings() {
    dialog(
      "Support settings",
      `<form>${["hours", "offline", "words", "categories", "priorities", "replies"].map((k) => `<label>${{ hours: "Support hours", offline: "Offline message", words: "Blocked whole words · one per line", categories: "Issue categories · one per line", priorities: "Priorities · one per line", replies: "Saved replies · one per line" }[k]}<textarea name="${k}" rows="3">${esc(Array.isArray(config[k]) ? config[k].join("\n") : config[k])}</textarea></label>`).join("")}<label>Attachments per message<input name="maxAttachments" type="number" min="1" max="5" value="${config.maxAttachments}"></label><label>File limit · MB<input name="maxFileMB" type="number" min="1" max="20" value="${Math.floor(config.maxFileBytes / 1024 / 1024)}"></label><p data-dialog-error role="alert"></p><button class="support-send" type="submit">Save settings</button></form>`,
      async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.target));
        for (const k of ["words", "categories", "priorities", "replies"])
          values[k] = values[k]
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
        values.maxAttachments = Number(values.maxAttachments);
        values.maxFileBytes = Number(values.maxFileMB) * 1024 * 1024;
        try {
          await api(endpoint + "/config", "POST", values);
          document.querySelector("#modal").close();
          await loadList();
          toast("Support settings saved.");
        } catch (err) {
          e.target.querySelector("[data-dialog-error]").textContent =
            err.message;
        }
      },
    );
  }
  async function changeSetting(key, value) {
    if (!current) return;
    try {
      await apiCall(selected, "update", {
        [key]: key === "rating" ? Number(value) : value,
      });
      await refresh();
      toast("Conversation updated.");
    } catch (e) {
      error(e.message);
      toast(e.message);
    }
  }
  async function clicked(e) {
    const b = e.target.closest("[data-chat]");
    if (!b) return;
    const action = b.dataset.chat;
    try {
      if (action === "select") return await select(b.dataset.id);
      if (action === "clear-filters") {
        search = "";
        filter = "All";
        host.querySelector("[data-inbox-search]").value = "";
        host.querySelector("[data-filter]").value = "All";
        listUpdate();
        return;
      }
      if (action === "actions") return actionSheet();
      if (action === "retry-send") return await send();
      if (action === "replies") return repliesSheet();
      if (action === "insert-reply") {
        const t = host.querySelector("[data-composer]");
        t.value = (
          (t.value ? t.value + "\n\n" : "") +
          config.replies[Number(b.dataset.index)]
        ).slice(0, 20000);
        document.querySelector("#modal").close();
        failed = false;
        error("");
        host.querySelector("[data-retry]").hidden = true;
        host.querySelector("[data-compose]").classList.remove("has-failure");
        saveDraft();
        grow();
        t.focus();
        return;
      }
      if (action === "toggle-search") {
        document.querySelector("#modal").close();
        const el = host.querySelector("[data-search-bar]");
        el.hidden = !el.hidden;
        host
          .querySelector('[data-chat="toggle-search"]')
          .setAttribute("aria-expanded", String(!el.hidden));
        if (!el.hidden) el.querySelector("input").focus();
        return;
      }
      if (action === "close-search") {
        host.querySelector("[data-search-bar]").hidden = true;
        host.querySelector("[data-message-search]").value = "";
        matchIds.clear();
        host
          .querySelectorAll(".support-match")
          .forEach((el) => el.classList.remove("support-match"));
        host
          .querySelector('[data-chat="toggle-search"]')
          .setAttribute("aria-expanded", "false");
        return;
      }
      if (action === "resolve") {
        document.querySelector("#modal").close();
        return await changeSetting("stage", "resolved");
      }
      if (action === "choose-images" || action === "choose-files") {
        host
          .querySelector(
            action === "choose-images" ? "[data-images]" : "[data-files]",
          )
          .click();
        document.querySelector("#modal").close();
        return;
      }

      if (action === "review-abuse") {
        dialog(
          "Moderation review",
          abuse
            .map((a) => {
              const c = conversations.find((c) => c.user_id === a.user_id);
              return `<article class="support-flag-review"><strong>${esc(c?.name || "Account " + a.user_id.slice(0, 8))}</strong><p>${a.count} blocked submissions · Last attempt ${esc(date(a.updated_at))}</p><p>Blocked text is not retained. Review legitimate complaints fairly.</p>${c ? `<button type="button" data-review-conversation="${esc(c.id)}">Review conversation ${esc(c.reference)}</button>` : ""}</article>`;
            })
            .join(""),
        );
        document.querySelectorAll("[data-review-conversation]").forEach(
          (el) =>
            (el.onclick = () => {
              document.querySelector("#modal").close();
              void select(el.dataset.reviewConversation);
            }),
        );
        return;
      }
      if (action === "new") return newConversation();
      if (action === "settings") return settings();
      if (action === "back") {
        keep();
        await heartbeat(true);
        selected = null;
        current = null;
        generation++;
        host.classList.remove("has-chat");
        listUpdate();
        return;
      }
      if (action === "details") {
        document.querySelector("#modal").close();
        detail = !detail;
        detailsUpdate();
        return;
      }
      if (action === "retry-conversation") return await select(selected);
      if (action === "reopen") {
        document.querySelector("#modal").close();
        return await changeSetting("stage", "open");
      }
      if (action === "note") {
        document.querySelector("#modal").close();
        saveDraft();
        noteMode = !noteMode;
        failed = false;
        failureMessage = "";
        lastTyped = 0;
        void heartbeat();
        pendingId = getPending(selected) || null;
        pane();
        return;
      }
      if (action === "expand") {
        saveDraft();
        expanded = !expanded;
        host
          .querySelector("[data-compose]")
          .classList.toggle("expanded", expanded);
        b.innerHTML = chatIcon(expanded ? "collapse" : "expand");
        b.setAttribute(
          "aria-label",
          expanded ? "Collapse writing mode" : "Expand writing mode",
        );
        b.setAttribute("aria-pressed", String(expanded));
        grow();
        return;
      }
      if (action === "attach") return attachmentSheet();
      if (action === "remove-file") {
        const [f] = files.splice(Number(b.dataset.index), 1);
        if (!f) return;
        f.xhr?.abort();
        if (f.preview) URL.revokeObjectURL(f.preview);
        renderFiles();
        if (f.id)
          await api(
            `${endpoint}/${f.conversation}/attachments/${f.id}`,
            "DELETE",
            {},
          );
        renderFiles();
        return;
      }
      if (action === "file") {
        await download(b.dataset.id, b.dataset.mime, b.dataset.name);
        return;
      }
      if (action === "latest") {
        const t = host.querySelector("[data-timeline]");
        t.scrollTo({
          top: t.scrollHeight,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
        newMessageCount = 0;
        b.hidden = true;
        void markRead();
        return;
      }
      if (action === "earlier") {
        b.disabled = true;
        const d = await api(
          `${endpoint}/${selected}?before=${messages[0]?.support_seq || Number.MAX_SAFE_INTEGER}`,
        );
        appendMessages(d.messages, true);
        b.innerHTML = d.messages.length
          ? `${chatIcon("clock")} Earlier messages`
          : "Beginning of conversation";
        b.disabled = !d.messages.length;
        return;
      }
    } catch (err) {
      if (action === "earlier") {
        b.disabled = false;
        b.innerHTML = `${chatIcon("retry")} Retry loading history`;
      }
      error(err.message);
      toast(err.message);
    }
  }
  function changed(e) {
    if (e.target.matches("[data-filter]")) {
      filter = e.target.value;
      listUpdate();
    }
    if (e.target.matches("[data-files],[data-images]")) {
      void uploadList([...e.target.files]);
      e.target.value = "";
    }
    if (e.target.matches("[data-support-setting]"))
      void changeSetting(e.target.dataset.supportSetting, e.target.value);
    if (e.target.matches("[data-rating]") && e.target.value)
      void changeSetting("rating", e.target.value);
    if (e.target.matches("[data-saved-reply]") && e.target.value !== "") {
      const t = host.querySelector("[data-composer]");
      t.value =
        (t.value ? t.value + "\n\n" : "") +
        config.replies[Number(e.target.value)];
      t.value = t.value.slice(0, 20000);
      saveDraft();
      grow();
      e.target.value = "";
      t.focus();
    }
  }
  function input(e) {
    if (e.target.matches("[data-inbox-search]")) {
      search = e.target.value;
      listUpdate();
    }
    if (e.target.matches("[data-message-search]")) {
      clearTimeout(searchTimer);
      const query = e.target.value.trim(),
        id = selected,
        token = generation;
      searchTimer = setTimeout(async () => {
        if (!host || id !== selected) return;
        if (!query) {
          matchIds.clear();
          host
            .querySelectorAll(".support-match")
            .forEach((el) => el.classList.remove("support-match"));
          host.querySelector("[data-search-results]").textContent = "";
          return;
        }
        try {
          const d = await api(
            `${endpoint}/${id}?search=${encodeURIComponent(query)}`,
          );
          if (!host || id !== selected || token !== generation) return;
          const known = new Map(
            [...messages, ...d.messages].map((m) => [m.id, m]),
          );
          messages = [...known.values()].sort(
            (a, b) => a.support_seq - b.support_seq,
          );
          const el = host.querySelector("[data-timeline]");
          matchIds = new Set(d.messages.map((m) => m.id));
          el.innerHTML = timelineHtml();
          host.querySelectorAll("[data-message-id]").forEach((el) =>
            el.classList.toggle(
              "support-match",
              d.messages.some((m) => m.id === el.dataset.messageId),
            ),
          );
          host.querySelector("[data-search-results]").textContent =
            d.messages.length === 60
              ? "Latest 60 matches"
              : `${d.messages.length} matches`;
          if (d.messages.length)
            host
              .querySelector(`[data-message-id="${d.messages[0].id}"]`)
              ?.scrollIntoView({ block: "nearest" });
          loadImages();
        } catch (err) {
          error(err.message);
        }
      }, 250);
    }
  }
  function viewport() {
    if (!host) return;
    const hint = host.querySelector(".support-compose-hint");
    if (hint)
      hint.textContent =
        (!config.attachmentsAvailable
          ? "Attachments need private storage configuration. "
          : "") +
        (isMobile()
          ? "Never share passwords or account secrets."
          : "Enter to send · Shift+Enter for a new line");
    const vv = window.visualViewport;
    const small = isMobile();
    if (small && vv) {
      const top = Math.max(0, host.getBoundingClientRect().top),
        nav = document.querySelector(".bottom-nav");
      const keyboard = window.innerHeight - vv.height > 120;
      if (nav) nav.classList.toggle("support-keyboard-hidden", keyboard);
      host.style.setProperty(
        "--support-height",
        Math.max(
          140,
          vv.height -
            top -
            (keyboard ? 0 : nav?.getBoundingClientRect().height || 56),
        ) + "px",
      );
    } else {
      document
        .querySelector(".bottom-nav")
        ?.classList.remove("support-keyboard-hidden");
      host.style.setProperty(
        "--support-height",
        Math.max(300, innerHeight - host.getBoundingClientRect().top - 20) +
          "px",
      );
    }
    grow();
    updateJump();
  }
  async function page(isAdmin = false) {
    admin = isAdmin;
    await loadList();
    if (!selected && conversations.length && !isMobile())
      selected = conversations[0].id;
    return layout();
  }
  function mount() {
    host = document.querySelector(".support-workspace");
    if (!host) return;
    host.addEventListener("click", clicked);
    host.addEventListener("change", changed);
    host.addEventListener("input", input);
    host.addEventListener("pointerdown", () => (activity = Date.now()));
    host.addEventListener("keydown", () => (activity = Date.now()));
    host
      .querySelector("[data-thread-list]")
      .addEventListener("keydown", (e) => {
        if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
        const items = [...host.querySelectorAll('[data-chat="select"]')];
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        ]?.focus();
      });
    timer = setInterval(() => void refresh(), 2500);
    window.visualViewport?.addEventListener("resize", viewport);
    window.addEventListener("resize", viewport);
    viewport();
    if (selected) void select(selected);
  }
  function dispose() {
    keep();
    void heartbeat(true);
    clearInterval(timer);
    clearTimeout(typingTimer);
    clearTimeout(searchTimer);
    generation++;
    document.querySelector("#modal[data-support-modal]")?.close();
    host = null;
    window.visualViewport?.removeEventListener("resize", viewport);
    window.removeEventListener("resize", viewport);
    document
      .querySelector(".bottom-nav")
      ?.classList.remove("support-keyboard-hidden");
  }
  function clearDrafts() {
    dispose();
    try {
      for (const k of Object.keys(localStorage))
        if (
          k.startsWith("elite-support-draft:") ||
          k.startsWith("elite-support-pending:")
        )
          localStorage.removeItem(k);
    } catch {}
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    drafts.clear();
    pending.clear();
    sessions.clear();
    files = [];
    selected = null;
    current = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (host) {
      lastTyped = 0;
      if (document.hidden) void heartbeat(true);
      else {
        sync("Reconnecting…");
        void refresh();
        void markRead();
      }
    }
  });
  window.addEventListener("online", () => {
    if (host) {
      sync("Reconnecting…");
      void refresh();
    }
  });
  window.addEventListener("offline", () => {
    sync("Offline · Drafts stay on this device.");
    updatePresence({ status: "unavailable" });
  });
  window.addEventListener("pagehide", () => {
    saveDraft();
    lastTyped = 0;
    void heartbeat(true);
  });
  return { page, mount, dispose, clearDrafts, refresh };
}
