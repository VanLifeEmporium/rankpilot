/** Release 20 (RP-602): database errors are shown as a plain, retryable message, never raw. */
export function friendlyError(e:unknown){
 const m=e instanceof Error?e.message:String(e);
 if(/Transaction|P2028|P2034|database is locked|SQLITE_BUSY|timed? ?out|Invalid `prisma\.|prisma\./i.test(m))return 'The store database was busy, so this item was not saved. Nothing changed; send it again.';
 return m;
}
