// Reference dashboard for the Connected Products Starter Kit.
//
// Reads from the HTTP API the CDK stack provisions. Deliberately small —
// the team I led used this shape to demo the cloud stack end-to-end on
// day one before deciding what their real operator dashboard needed to do.

interface TelemetryRow {
  event_id: string;
  event_ts: string;
  thing_name: string;
  tool_model: string;
  tool_model_name?: string;
  battery_pct: number;
  torque_nm: number;
  usage_minutes: number;
  job_site_id: string;
  error_code: string;
}

interface ApiResponse {
  thing_name: string;
  count: number;
  events: TelemetryRow[];
}

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;

const apiInput   = $('api')!;
const thingInput = $('thing')!;
const refreshBtn = document.getElementById('refresh')!;
const statusEl   = document.getElementById('status')!;
const rowsEl     = document.getElementById('rows')!;

const STORAGE_KEY = 'connected-products-api-url';
apiInput.value = localStorage.getItem(STORAGE_KEY) ?? '';
apiInput.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY, apiInput.value);
});

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#b91c1c' : 'inherit';
}

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function renderRows(events: TelemetryRow[]): void {
  if (events.length === 0) {
    rowsEl.innerHTML = '<tr><td colspan="7" class="ok">No events yet — start the simulator.</td></tr>';
    return;
  }
  rowsEl.innerHTML = events.map((e) => `
    <tr>
      <td>${fmtTs(e.event_ts)}</td>
      <td>${e.tool_model_name ?? e.tool_model}</td>
      <td>${e.battery_pct}%</td>
      <td>${e.torque_nm}</td>
      <td>${e.usage_minutes}</td>
      <td>${e.job_site_id}</td>
      <td>${e.error_code ? `<span class="err">${e.error_code}</span>` : '<span class="ok">—</span>'}</td>
    </tr>
  `).join('');
}

async function refresh(): Promise<void> {
  const base = apiInput.value.trim();
  const thing = thingInput.value.trim();
  if (!base || !thing) {
    setStatus('configure API + thing', true);
    return;
  }
  setStatus('loading…');
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/events?thing=${encodeURIComponent(thing)}&limit=100`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as ApiResponse;
    renderRows(data.events);
    setStatus(`${data.count} events · updated ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`, true);
  }
}

refreshBtn.addEventListener('click', refresh);
apiInput.addEventListener('keydown',   (e) => { if (e.key === 'Enter') refresh(); });
thingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(); });

// Auto-refresh every 5 seconds while the tab is focused.
setInterval(() => {
  if (document.visibilityState === 'visible' && apiInput.value && thingInput.value) {
    refresh();
  }
}, 5000);

if (apiInput.value) {
  refresh();
}
