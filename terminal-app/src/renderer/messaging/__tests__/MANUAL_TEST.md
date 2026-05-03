# Agent Messaging — Manual Test Scenarios

## Prerequisites

1. Build and deploy the app:
   ```bash
   cd terminal-app
   npm run bundle-mcp    # rebuild MCP server with new tools
   npm run build         # rebuild renderer with message handlers + UI
   npm run deploy:local  # copy to /Applications (or use `npm run dev`)
   ```
2. Restart Pixel City
3. Restart any Claude Code sessions (so MCP server picks up the new tools)

---

## Test 1: Basic Send & Receive (Two Claude Code Sessions)

**Setup:** Open two Claude Code sessions, both connected to Pixel City.

| Step | Session A (Teamlead) | Session B (Worker) |
|------|----------------------|--------------------|
| 1 | `whoami` → note your agent ID (e.g. `1000`) | `whoami` → note your agent ID (e.g. `2001`) |
| 2 | `list_agents` → verify both agents visible | |
| 3 | | `send_message({ to: 1000, subject: "Task done", body: "Fixed the auth bug in login.ts", type: "result" })` |
| 4 | **Look at office** → envelope bubble should appear above Teamlead's character | |
| 5 | `check_messages()` → should see 1 unread message from Worker | |
| 6 | `read_message({ messageId: "msg-..." })` → should return full body, mark as read | |
| 7 | `check_messages()` → should return empty (all read) | |
| 8 | **Look at office** → envelope bubble should be gone | |

**Expected:** Messages flow between agents. Bubble appears/disappears. Unread tracking works.

---

## Test 2: Messages Tab in Office Panel

**Setup:** Have at least one message sent (from Test 1).

| Step | Action | Expected |
|------|--------|----------|
| 1 | Click the **chat bubble icon** in the office activity bar (left side, below Assets) | Messages tab opens |
| 2 | **Inbox tab** should be selected by default | Shows incoming messages for the selected agent |
| 3 | Click a message card | Body expands, message marked as read (green left border disappears) |
| 4 | Switch to **Sent** tab | Shows messages sent BY the selected agent |
| 5 | Switch to **All** tab | Shows all messages across all agent inboxes |
| 6 | Use the agent **dropdown filter** | Filters messages involving that agent |
| 7 | Click a different agent in the office canvas | Messages tab updates to show that agent's inbox |
| 8 | Unread count in header updates after marking messages read | Count decreases |

---

## Test 3: Teamlead ↔ Sub-Agent Workflow (Single Session)

**Setup:** One Claude Code session as the teamlead.

| Step | Command / Action | Expected |
|------|-----------------|----------|
| 1 | `whoami` → note your ID (e.g. `1000`) | |
| 2 | `spawn_agent({ name: "Alice", model: "sonnet", prompt: "You are a sub-agent. When done, use send_message to report back to agent 1000." })` | Alice spawns with matrix effect |
| 3 | Wait for Alice to work and send a message back | |
| 4 | `check_messages()` | Should see Alice's result message |
| 5 | `send_message({ to: <alice_id>, subject: "Good work", body: "Thanks, moving ticket to done.", type: "info" })` | Alice gets an envelope bubble |
| 6 | Open the **Messages tab** in office panel | Should see the conversation |
| 7 | Click Alice's character in the office | Messages tab switches to show Alice's inbox |

---

## Test 4: Reply Chains

| Step | Command | Expected |
|------|---------|----------|
| 1 | Agent A: `send_message({ to: B, subject: "Question", body: "What's the status of PC-15?", type: "request" })` | Message delivered |
| 2 | Agent B: `check_messages()` → note the messageId | See the request |
| 3 | Agent B: `send_message({ to: A, subject: "Re: Question", body: "Almost done, 80% complete.", type: "status", replyTo: "<messageId from step 2>" })` | Reply linked |
| 4 | Agent A: `check_messages()` | See reply with `replyTo` field populated |
| 5 | Open Messages tab, expand the reply | Should show "↩ Reply to msg-..." link |

---

## Test 5: Message Types & Filtering

| Step | Command | Expected |
|------|---------|----------|
| 1 | Send messages with all 4 types: `result`, `status`, `request`, `info` | Each gets a different color tag |
| 2 | Open Messages tab | Type badges show: green (result), blue (status), amber (request), gray (info) |
| 3 | Use agent dropdown to filter | Only shows messages involving that agent |

---

## Test 6: Edge Cases

| Scenario | Steps | Expected |
|----------|-------|----------|
| **Send to non-existent agent** | `send_message({ to: 99999, ... })` | Succeeds (message stored, no one to read it) |
| **Empty inbox** | `check_messages()` on fresh agent | `{ messages: [], count: 0 }` |
| **Mark already-read message** | `read_message` on already-read msg | Returns the message, still marked read |
| **Pagination** | Send 25 messages, then `list_messages({ limit: 10, offset: 0 })` | Returns first 10, newest first |
| **Agent removed** | Remove agent, then check their inbox in Messages tab | Messages still visible in "All" view |

---

## Test 7: Visual Indicators

| Check | How to verify |
|-------|---------------|
| **Envelope bubble** | Send a message to an idle agent → blue envelope bubble appears above their character |
| **Bubble clears** | That agent calls `check_messages()` → bubble disappears |
| **Bubble doesn't stack** | Send 3 messages to same agent → still just one bubble (not 3) |
| **Bubble vs waiting** | Agent that has both a "waiting" bubble and incoming message → message bubble takes priority |
