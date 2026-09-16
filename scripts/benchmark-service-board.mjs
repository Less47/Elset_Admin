// Local, isolated production-build benchmark. Instrumentation exists only in the copied app.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";
import { openWorkspaceDb } from "../server-workspace-db.js";
import { importWorkspaceJsonData } from "../server-workspace-importer.js";
import { insertJobTree } from "../server-workspace-jobs.js";
import { normalizeStoredData } from "../server-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] || "sample";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use an alphanumeric benchmark label.");
const sourceLabel = process.argv[3];
if (sourceLabel && !/^[a-z0-9-]+$/.test(sourceLabel)) throw new Error("Use a saved benchmark label as the source.");
const output = path.join(root, "test-results/board-performance", label);
const appRoot = path.join(output, "app");
if (fs.existsSync(appRoot)) throw new Error(`Snapshot already exists: ${appRoot}. Use a new label.`);
fs.mkdirSync(appRoot, { recursive: true });
if (sourceLabel) {
  // Re-run the preserved, already instrumented build with identical browser instrumentation.
  fs.cpSync(path.join(root, "test-results/board-performance", sourceLabel, "app"), appRoot, { recursive: true });
} else {
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of files) {
  if (file.startsWith("tests/") || file.startsWith("output/")) continue;
  const target = path.join(appRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
const edit = (file, fn) => { const target = path.join(appRoot, file); fs.writeFileSync(target, fn(fs.readFileSync(target, "utf8"))); };
const frontFunctions = {
  "src/components/service-board/OfficeBoard.jsx": ["OfficeBoard", "JobCard", "JobCardIndicators", "ServiceBoardSortSelect", "ServiceBoardViewToggle", "ServiceBoardTagLegend", "TomorrowJobCard", "ServiceBoardColumn"],
  "src/components/service-board/MobileJobCard.jsx": ["MobileJobCard"],
  "src/components/service-board/MobileServiceBoard.jsx": ["MobileServiceBoard"],
  "src/components/service-board/service-board-utils.js": ["sortJobsForColumn", "getJobValueMeta", "buildJobCardIndicators"],
  "src/components/app/WorkspaceShell.jsx": ["WorkspaceShell"],
};
for (const [file, names] of Object.entries(frontFunctions)) edit(file, (source) => {
  for (const name of names) source = source.replace(new RegExp(`function ${name}\\(([\\s\\S]*?)\\)\\s*\\{`), (match) => `${match}\nglobalThis.__boardPerf?.count(${JSON.stringify(name)}${["JobCard", "MobileJobCard", "TomorrowJobCard"].includes(name) ? ", job.id" : ""});\n`);
  return source;
});
for (const [file, name] of [["server-workspace-state.js", "loadWorkspaceStateFromDb"], ["server-workspace-jobs.js", "changeJobStatus"], ["server-workspace-db.js", "openWorkspaceDb"]]) edit(file, (source) => {
  source = source.replace(`export function ${name}(`, `function measured_${name}(`);
  return source + `\nexport function ${name}(...args) { const start = performance.now(); try { return measured_${name}(...args); } finally { globalThis.__serverBoardPerf?.timings.push({name: '${name}', ms: performance.now() - start}); } }\n`;
});
edit("server-workspace-db.js", (source) => source.replace("new Database(dbPath, { readonly, fileMustExist })", "new Database(dbPath, { readonly, fileMustExist, verbose(sql) { globalThis.__serverBoardPerf?.queries.push({sql, at: performance.now()}); } })"));
const oldCwd = process.cwd();
process.chdir(appRoot);
try { await build({ root: appRoot, configFile: path.join(appRoot, "vite.config.js"), logLevel: "warn" }); }
finally { process.chdir(oldCwd); }
}

const dataDir = path.join(output, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "elset-workspace.db");
const baseFixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/demo-workspace.json"), "utf8"));
const original = baseFixture.jobs[0];
function jobsForSize(size) {
  return Array.from({ length: size }, (_, i) => ({
    ...original, id: `perf-${i}`, jobNumber: 5000 + i, title: `Gate service ${i}`, description: "Inspect and service the gate operator and safety equipment.",
    status: i < size * .4 ? "To Do" : i < size * .7 ? "In Progress" : "Completed",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), updatedAt: "2026-09-15T00:00:00.000Z",
    maintenancePlanId: "", maintenancePlanName: i % 5 === 0 ? "Annual service" : "", notes: [], photos: [], invoice: null,
    quote: i % 2 === 0 ? { ...original.quote, id: `quote-${i}`, items: original.quote.items.map((item, n) => ({ ...item, id: `item-${i}-${n}` })), sentHistory: [] } : null,
    serviceBoardTomorrowDate: "", serviceBoardTomorrowOrder: null, serviceBoardNote: i % 3 === 0 ? "Waiting on parts" : null,
  }));
}
const seed = openWorkspaceDb({ dbPath });
try { importWorkspaceJsonData(seed, normalizeStoredData({ ...baseFixture, jobs: jobsForSize(50), maintenancePlans: [] })); }
finally { seed.close(); }
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const password = "Board-perf-local-only-123";
fs.writeFileSync(path.join(appRoot, "benchmark-server.mjs"), `
import http from 'node:http'; import fs from 'node:fs';
const { auth, ensureAuthReady } = await import('./server-auth.js'); await ensureAuthReady();
const context = await auth.$context;
const user = await context.internalAdapter.createUser({email:'board.perf@auth.elset.local',emailVerified:true,name:'Board Performance',role:'admin',username:'boardperf',displayUsername:'Board Performance',workspaceRole:'admin',staffId:''});
await context.internalAdapter.linkAccount({userId:user.id,accountId:user.id,providerId:'credential',password:await context.password.hash(${JSON.stringify(password)})});
const { createServerApp } = await import('./server-app.js'); const app = createServerApp();
http.createServer((req,res) => {
 if (/\\/api\\/jobs\\/[^/]+\\/status(?:\\?|$)/.test(req.url) && req.method === 'PATCH') {
   const start=performance.now(); const stats={queries:[],timings:[]}; globalThis.__serverBoardPerf=stats;
   const end=res.end;
   res.end=function(...args) { stats.serverMs=performance.now()-start; res.setHeader('Server-Timing','app;dur='+stats.serverMs.toFixed(3)); return end.apply(this,args); };
   res.on('finish',()=>{globalThis.__serverBoardPerf=null; fs.appendFileSync(${JSON.stringify(path.join(output, "server.ndjson"))},JSON.stringify(stats)+'\\n');});
 }
 app(req,res);
}).listen(${port},'127.0.0.1');
`);
const server = spawn(process.execPath, ["benchmark-server.mjs"], { cwd: appRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
  ...process.env, NODE_ENV: "test", FLY_APP_NAME: "", TZ: "Australia/Sydney", ELSET_DATA_DIR: dataDir,
  ELSET_AUTH_DB_PATH: path.join(dataDir, "auth.db"), ELSET_WORKSPACE_DB_PATH: dbPath, ELSET_WORKSPACE_STORAGE: "sqlite",
  BETTER_AUTH_URL: baseUrl, ELSET_FRONTEND_URL: baseUrl, ELSET_API_PORT: String(port), PORT: String(port),
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
} });
let serverLog = "";
server.stdout.on("data", (s) => { serverLog += s; }); server.stderr.on("data", (s) => { serverLog += s; });
const browser = await chromium.launch();
const results = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${baseUrl}/api/auth/me`)).status === 401) break; } catch { /* Startup only. */ }
    if (i > 100 || server.exitCode !== null) throw new Error(serverLog);
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await browser.newContext(); const loginPage = await login.newPage();
  await loginPage.goto(baseUrl); await loginPage.getByPlaceholder("Enter your username").fill("boardperf");
  await loginPage.getByPlaceholder("Enter your password").fill(password); await loginPage.getByRole("button", { name: "Sign In", exact: true }).click();
  await loginPage.locator("[data-service-board-status]").first().waitFor();
  const storageState = await login.storageState(); await login.close();
  for (const size of [50, 200, 500]) {
    const db = openWorkspaceDb({ dbPath });
    try { db.transaction(() => { db.exec("DELETE FROM jobs"); for (const job of jobsForSize(size)) insertJobTree(db, job); })(); } finally { db.close(); }
    for (const { width, trial } of [1440, 820, 390].flatMap((width) => [1, 2, 3].map((trial) => ({ width, trial })))) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 1180 }, hasTouch: width < 1280, isMobile: width < 768, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.addInitScript(() => {
        window.__boardPerf = { counts: {}, ids: {}, requests: [], count(name, id) { this.counts[name] = (this.counts[name] || 0) + 1; if (id) (this.ids[name] ||= new Set()).add(id); }, reset() { this.counts = {}; this.ids = {}; }, snapshot() { return { counts: { ...this.counts }, uniqueCards: Object.fromEntries(Object.entries(this.ids).map(([k,v])=>[k,v.size])) }; } };
        const startDrop = () => { if (window.__boardPerf.armed) { window.__boardPerf.dropAt=performance.now(); window.__boardPerf.armed=false; } };
        document.addEventListener('drop',startDrop,true);
        document.addEventListener('touchend',startDrop,true);
        document.addEventListener('click',(event)=>{if(event.target.closest('button')?.getAttribute('aria-label')==='Move to In Progress')startDrop();},true);
        const fetch = window.fetch;
        window.fetch = async function(...args) {
          if (!String(args[0]).includes("/status") || args[1]?.method !== "PATCH") return fetch.apply(this,args);
          const timing={start:performance.now(),bodyBytes:args[1].body?.length || 0}; window.__boardPerf.requests.push(timing);
          const response=await fetch.apply(this,args); timing.headers=performance.now(); timing.serverTiming=response.headers.get('server-timing');
          const json=response.json.bind(response); response.json=async()=>{timing.jsonStart=performance.now();const value=await json();timing.jsonEnd=performance.now();timing.responseBytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;timing.serverDoneCounts=window.__boardPerf.snapshot();requestAnimationFrame(()=>requestAnimationFrame(()=>{timing.settledFrameAt=performance.now();}));return value;}; return response;
        };
      });
      const apiRequests=[]; page.on("request", (r)=>{ if(new URL(r.url()).pathname.startsWith("/api/")) apiRequests.push({method:r.method(),path:new URL(r.url()).pathname}); });
      await page.goto(baseUrl); await page.locator(width < 768 ? "[data-mobile-job-id]" : "[data-service-board-job-id]").first().waitFor();
      await page.evaluate(()=>document.fonts.ready); await page.waitForLoadState("networkidle");
      const cdp=await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate",{rate:2});
      await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:80,downloadThroughput:1_250_000,uploadThroughput:1_250_000});
      const jobId=`perf-${Math.floor(size*.4)-1}`;
      // Reset this job between independent viewport runs.
      const resetDb=openWorkspaceDb({dbPath}); resetDb.prepare("UPDATE jobs SET status='To Do' WHERE id=?").run(jobId); resetDb.close();
      await page.reload(); await page.locator(width < 768 ? `[data-mobile-job-id="${jobId}"]` : `[data-service-board-job-id="${jobId}"]`).waitFor(); await page.waitForLoadState("networkidle");
      const visibleCards=await page.locator("[data-service-board-job-id], [data-mobile-job-id]").count();
      const phases={}; const snapshot=()=>page.evaluate(()=>window.__boardPerf.snapshot()); const reset=()=>page.evaluate(()=>window.__boardPerf.reset());
      const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const source=page.locator(`[data-service-board-job-id="${jobId}"], [data-mobile-job-id="${jobId}"]`);
      let transfer;
      if(width===820){
        const s=await source.boundingBox(), t=await page.locator('[data-service-board-status="In Progress"]').boundingBox();
        await reset(); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:s.x+25,y:s.y+70,id:1}]}); await page.waitForTimeout(220); phases.start=await snapshot();
        await reset();
        for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:s.x+25+(t.x+t.width/2-s.x-25)*i/12,y:s.y+70,id:1}]});await frame();}
        phases.moves=await snapshot();
      } else if(width===1440){
        transfer=await page.evaluateHandle(()=>new DataTransfer());await transfer.evaluate((d,id)=>d.setData('jobId',id),jobId);
        await reset();await source.dispatchEvent('dragstart',{dataTransfer:transfer});await frame();phases.start=await snapshot();
        await reset();for(let i=0;i<12;i++)await page.locator('[data-service-board-status="In Progress"]').dispatchEvent('dragover',{dataTransfer:transfer});await frame();phases.moves=await snapshot();
      } else { await reset(); await source.getByRole('button',{name:`Move Job #${5000+Math.floor(size*.4)-1}`,exact:true}).click();await frame();phases.start=await snapshot(); }
      await reset(); apiRequests.length=0;
      await page.evaluate(({jobId,width})=>{
        const p=window.__boardPerf;p.armed=true;p.dropAt=null;p.visualAt=null;
        const observer=new MutationObserver(()=>{
          const card=document.querySelector(`[data-service-board-job-id="${jobId}"], [data-mobile-job-id="${jobId}"]`);
          const moved=(width<768 && !card) || card?.closest('[data-service-board-status]')?.dataset.serviceBoardStatus==='In Progress';
          if(moved){observer.disconnect();p.domAt=performance.now();p.visualCounts=p.snapshot();requestAnimationFrame(()=>requestAnimationFrame(()=>{p.visualAt=performance.now();}));}
        });observer.observe(document.body,{childList:true,subtree:true});
      },{jobId,width});
      if(width===820)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      else if(width===1440)await page.locator('[data-service-board-status="In Progress"]').dispatchEvent('drop',{dataTransfer:transfer});
      else await page.getByRole('button',{name:'Move to In Progress',exact:true}).click();
      await page.waitForFunction(()=>window.__boardPerf.visualAt && window.__boardPerf.requests.at(-1)?.settledFrameAt);
      await frame();
      const metrics=await page.evaluate(()=>{
        const p=window.__boardPerf,r=p.requests.at(-1);const resource=performance.getEntriesByType('resource').filter(e=>e.name.includes('/status')).at(-1);
        return {dropToDomMs:p.domAt-p.dropAt,dropToPaintMs:p.visualAt-p.dropAt,preRequestMs:r.start-p.dropAt,apiMs:r.jsonEnd-r.start,headersMs:r.headers-r.start,jsonMs:r.jsonEnd-r.jsonStart,responseProcessingMs:resource?r.jsonEnd-resource.responseEnd:null,ackToPaintMs:r.settledFrameAt-r.jsonEnd,responseBytes:r.responseBytes,requestBytes:r.bodyBytes,serverTiming:r.serverTiming,visualCounts:p.visualCounts,completeCounts:p.snapshot(),resource:resource?{duration:resource.duration,ttfb:resource.responseStart-resource.requestStart,downloadMs:resource.responseEnd-resource.responseStart}:null};
      });
      results.push({size,width,trial,visibleCards,phases,metrics,apiRequests});
      fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(results,null,2));
      console.log(JSON.stringify({size,width,trial,visibleCards,...metrics,phases}));
      await transfer?.dispose();await context.close();
    }
  }
} finally { await browser.close(); server.kill(); fs.writeFileSync(path.join(output,"server.log"),serverLog); }
console.log(`Results: ${output}`);
