export type Kind = "product" | "collection" | "page" | "article";
export type Feature =
  | "title"
  | "description"
  | "seo"
  | "alt"
  | "filename"
  | "handle"
  | "faq"
  | "links"
  /** Release 19: product vendor (brand), agent-proposed and merchant-approved. */
  | "vendor"
  /** Release 20 (RP-203): variant barcodes (ISBN for books), merchant-confirmed. */
  | "barcode"
  /** Release 22 (R22-604): republish an unpublished page or blog post (undo unpublishes it again). */
  | "published";
export const features: Feature[] = [
  "title",
  "description",
  "seo",
  "alt",
  "filename",
  "handle",
  "faq",
  "links",
];
/** Release 22 (R22-702): book editions offered with an ISBN suggestion, shown side by side for the merchant to pick. */
export type BookOption = { isbn: string; publisher: string; year?: string; title?: string; author?: string; cover?: string; source: string };
export type Fact = { value: string; source: string; confirmed: boolean; options?: BookOption[] };
export type Facts = Record<string, Fact>;
export type Image = {
  id: string;
  url: string;
  alt: string;
  filename: string;
  width?: number;
  height?: number;
};
export type Payload = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seo: { title: string; description: string };
  images: Image[];
  collections: string[];
  vendor?: string;
  productType?: string;
  /** Release 22 (R22-301): Shopify product template suffix ("" = default template). */
  templateSuffix?: string;
  tags?: string[];
  variants?: { id?: string; sku: string; barcode: string; price: string; selectedOptions?: {name:string;value:string}[] }[];
  faqNamespace?: string;
  faqs?: { question: string; answer: string }[];
  /** Release 19: product metafields with plain values (read-only; category attributes, sizes, weights). */
  metafields?: Record<string, string>;
  url?: string;
  blogId?: string;
  blogHandle?: string;
  published?: boolean;
  productsCount?: number;
  publicationCount?: number;
  /** Release 20 (RP-201): smart collection rules (collections only). */
  rules?: { column: string; relation?: string; condition: string }[];
  raw?: unknown;
};
export type Issue = {
  resourceId: string;
  title: string;
  code: string;
  severity: "critical" | "warning" | "notice";
  detail: string;
  link?: {url:string;sourceUrl?:string;status:number;checkedAt:string};
  feature?: Feature;
  /** Release 18: the RankPilot change behind a changed-outside finding. */
  changeId?: string;
  /** Release 19: grouped findings (one per missing answer) carry their product count and ids. */
  count?: number;
  resourceIds?: string[];
  /** Release 20 (RP-103): side-by-side difference for changed-outside findings. */
  diff?: { rankpilot: string; shopify: string; linksRemoved: string[]; linksAdded: string[] };
  /** Release 20 (RP-302): a suggested redirect destination. */
  suggestion?: { path: string; title: string };
  /** Release 20 (RP-301): the page is not published on the Online Store. */
  unpublished?: boolean;
  /** Release 20 (RP-201): the manufacturer found in the title, description or handle. */
  brand?: { vendor: string; confidence: "high" | "medium"; evidence: { where: string; text: string }[] };
  /** Release 22 (R22-603): the repeated text, with "<product name>" for the product's name. */
  template?: string;
};
export type Settings = {
  autopilot: Partial<Record<Feature, boolean>>;
  brandVoice?: string;
  titleBrandMode?: "preserve" | "omit" | "append";
  titleBrand?: string;
  /** Release 17: per-store switch for the agent workspace (on unless set false). */
  agentAccess?: boolean;
  /** Release 17: bumped to revoke every agent link and session. */
  agentEpoch?: number;
  /** Release 18: findings hidden until a date, with the merchant's reason. */
  snoozes?: { resourceId: string; code: string; until: string; reason: string; at: string; title?: string }[];
  /** Release 18: change ids whose Shopify-side value the merchant chose to keep. */
  keptShopify?: Record<string, string>;
  /** Release 20 (RP-501): words the merchant allows in capitals (brands, model names). */
  capsAllowlist?: string[];
  /** Release 22 (R22-403): brands the merchant confirmed once; matched like listed brands. */
  confirmedBrands?: string[];
  /** Release 20 (RP-403): learned rules only count rejections after this time (Settings › reset). */
  learnedResetAt?: string;
  weekly: boolean;
  requeue: boolean;
  gscSite: string;
  ga4Property: string;
  merchantAccount: string;
  blogId: string;
  crawlLimit: number;
  reportedPaths?: string[];
  crawlerPreferences: Record<string, boolean>;
  policies: { delivery: string; returns: string; source: string };
  schema: {
    shippingRate?: number;
    handlingMin?: number;
    handlingMax?: number;
    transitMin?: number;
    transitMax?: number;
    returnDays?: number;
    returnUrl?: string;
    verified?: boolean;
  };
};
export const defaults: Settings = {
  autopilot: {},
  titleBrandMode: "preserve",
  titleBrand: "Van Life Emporium",
  weekly: false,
  requeue: false,
  gscSite: "sc-domain:vanlifeemporium.com",
  ga4Property: "",
  merchantAccount: "",
  blogId: "",
  crawlLimit: 2000,
  crawlerPreferences: {},
  policies: { delivery: "", returns: "", source: "" },
  schema: {},
};
export const parse = <T>(s: string): T => JSON.parse(s);
export const settings = (s: string): Settings => ({
  ...defaults,
  ...parse<Partial<Settings>>(s),
});
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
