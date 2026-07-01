// Lists your ClickUp hierarchy — Workspace > Space > Folder > List — with IDs,
// reading the token from .env (CLICKUP_API_TOKEN). Run:  node src/list-spaces.js
//
// Use a listId (precise) or folderId (a whole folder) in config/sites.json:
//   "clickup": { "enabled": true, "listIds": ["901..."] }
//   "clickup": { "enabled": true, "folderId": "901..." }

import "dotenv/config";

const token = process.env.CLICKUP_API_TOKEN;
const API = "https://api.clickup.com/api/v2";

if (!token) {
  console.error("\nNo CLICKUP_API_TOKEN found in .env.");
  console.error("Add it first:  CLICKUP_API_TOKEN=pk_your_token_here\n");
  process.exit(1);
}

async function get(path) {
  const res = await fetch(API + path, { headers: { Authorization: token } });
  if (res.status === 401) { console.error("\nClickUp rejected the token (401).\n"); process.exit(1); }
  if (res.status === 429) { console.error("\nRate limited by ClickUp — wait a minute and run again.\n"); process.exit(1); }
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

const { teams = [] } = await get("/team");
for (const team of teams) {
  console.log(`\n══ Workspace: ${team.name}   (CLICKUP_TEAM_ID = ${team.id})`);
  const { spaces = [] } = await get(`/team/${team.id}/space?archived=false`);

  for (const space of spaces) {
    console.log(`\n  ▸ Space: ${space.name}   spaceId: ${space.id}`);

    const { folders = [] } = await get(`/space/${space.id}/folder?archived=false`);
    for (const folder of folders) {
      console.log(`      📁 Folder: ${folder.name}   folderId: ${folder.id}`);
      for (const list of folder.lists || []) {
        console.log(`           • List: ${list.name}   listId: ${list.id}`);
      }
    }

    const { lists = [] } = await get(`/space/${space.id}/list?archived=false`);
    for (const list of lists) {
      console.log(`      • List (no folder): ${list.name}   listId: ${list.id}`);
    }
  }
}
console.log("\nPick listIds (or a folderId) and put them in config/sites.json.\n");
