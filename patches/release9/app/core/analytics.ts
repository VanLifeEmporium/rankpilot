export type SearchRow={keys:string[];clicks:number;impressions:number;position?:number};
export function metricPair(
  metrics: { provider: string; period: string; payload: string }[],
  provider: string,
) {
  const all = metrics
    .filter((m) => m.provider === provider)
    .sort((a, b) => b.period.localeCompare(a.period));
  if (!all.length) return [];
  const current = JSON.parse(all[0].payload);
  if (!current.start) return all.slice(0, 2).map((m) => JSON.parse(m.payload));
  const end = new Date(new Date(current.start).getTime() - 86400000);
  const start = new Date(end.getTime() - 27 * 86400000);
  const period = `${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`;
  const previous = all.find((m) => m.period === period);
  return previous ? [current, JSON.parse(previous.payload)] : [current];
}
export function pageTotals(rows: SearchRow[] = []) {
  const values = new Map<
    string,
    { clicks: number; impressions: number; weighted: number }
  >();
  for (const row of rows) {
    const page = row.keys[0];
    const v = values.get(page) || { clicks: 0, impressions: 0, weighted: 0 };
    v.clicks += row.clicks;
    v.impressions += row.impressions;
    v.weighted += (row.position || 0) * row.impressions;
    values.set(page, v);
  }
  return values;
}
export function pageGains(current: {rows?:SearchRow[]}|undefined, previous: {rows?:SearchRow[]}|undefined) {
  const c = pageTotals(current?.rows),
    p = pageTotals(previous?.rows);
  return [...c.entries()]
    .map(([url, value]) => ({
      url,
      ...value,
      position: value.impressions ? value.weighted / value.impressions : 0,
      change: previous ? value.clicks - (p.get(url)?.clicks || 0) : null,
    }))
    .sort((a, b) => (b.change ?? b.clicks) - (a.change ?? a.clicks));
}
export function visibilityTrend(
  observations: {
    engine: string;
    createdAt: Date | string;
    mentioned: boolean;
    cited: boolean;
  }[],
) {
  const groups = new Map<
    string,
    {
      week: string;
      engine: string;
      samples: number;
      mentions: number;
      citations: number;
    }
  >();
  for (const o of observations) {
    const d = new Date(o.createdAt);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const week = d.toISOString().slice(0, 10);
    const key = week + o.engine;
    const g = groups.get(key) || {
      week,
      engine: o.engine,
      samples: 0,
      mentions: 0,
      citations: 0,
    };
    g.samples++;
    g.mentions += Number(o.mentioned);
    g.citations += Number(o.cited);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.week.localeCompare(a.week));
}

/** Search Console clicks / impressions; never turn missing data into a zero. */
export function clickRate(clicks:unknown,impressions:unknown):string {
  if(typeof clicks!=="number" || typeof impressions!=="number" || !Number.isFinite(clicks) || !Number.isFinite(impressions) || clicks<0 || impressions<=0 || clicks>impressions)return "—";
  if(clicks===0)return "0%";
  const rate=100*clicks/impressions;
  return rate<0.1?"<0.1%":`${rate.toFixed(1)}%`;
}
