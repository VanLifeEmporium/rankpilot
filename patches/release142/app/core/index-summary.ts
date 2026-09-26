export function indexSummary(payload:string) {
 try {
  const {rows:ignored,...summary}=JSON.parse(payload);
  void ignored;
  return summary;
 } catch {return {};}
}
