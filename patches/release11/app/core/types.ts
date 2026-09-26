export type Kind = "product" | "collection" | "page" | "article";
export type Feature =
  | "title"
  | "description"
  | "seo"
  | "alt"
  | "filename"
  | "handle"
  | "faq"
  | "links";
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
export type Fact = { value: string; source: string; confirmed: boolean };
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
  variants?: { sku: string; barcode: string; price: string }[];
  faqNamespace?: string;
  faqs?: { question: string; answer: string }[];
  url?: string;
  blogId?: string;
  blogHandle?: string;
  published?: boolean;
  productsCount?: number;
  publicationCount?: number;
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
};
export type Settings = {
  autopilot: Partial<Record<Feature, boolean>>;
  brandVoice?: string;
  titleBrandMode?: "preserve" | "omit" | "append";
  titleBrand?: string;
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
