import {z} from "zod";
import { inlineImages, updateInlineAlts } from "./image-content";
import { type Payload } from "./types";
export type RemoteImage={id?:string;url:string;altText?:string;width?:number;height?:number};
export type RemoteMedia={id?:string;alt?:string;image?:RemoteImage};
type PageInfo={hasNextPage:boolean;endCursor?:string|null};
export type RemoteNode={id:string;title:string;handle:string;descriptionHtml?:string;body?:string;seo?:{title?:string|null;description?:string|null};seoTitle?:{value:string}|null;seoDescription?:{value:string}|null;media?:{nodes:RemoteMedia[];pageInfo:PageInfo};image?:RemoteImage;collections?:{nodes:{title:string;handle?:string}[]};vendor?:string;productType?:string;variants?:{nodes:{sku:string;barcode:string;price:string}[];pageInfo:PageInfo};faq?:{namespace:string;jsonValue:Payload['faqs']};onlineStoreUrl?:string;blog?:{id:string;handle:string};isPublished?:boolean;status?:string;productsCount?:{count:number};availablePublicationsCount?:{count:number};updatedAt?:string};
export type GraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function graphql(
  client: GraphQL,
  query: string,
  variables: Record<string, unknown> = {},
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await client(query, { variables });
    const body = await response.json();
    if (
      response.status === 429 ||
      body.errors?.some((e: {extensions?:{code:string}}) => e.extensions?.code === "THROTTLED")
    ) {
      await wait(Math.min(30000, 1000 * 2 ** attempt));
      continue;
    }
    if (!response.ok || body.errors?.length)
      throw new Error(
        body.errors?.map((e: {message:string}) => e.message).join("; ") ||
          `Shopify returned ${response.status}`,
      );
    for (const value of Object.values(body.data || {})) {
      const errors = (value as {userErrors?:{field?:string[];message:string}[]}|null)?.userErrors;
      if (errors?.length)
        throw new Error(
          errors
            .map((e: {field?:string[];message:string}) => `${e.field?.join(".") || "Shopify"}: ${e.message}`)
            .join("; "),
        );
    }
    return body.data;
  }
  throw new Error("Shopify rate limit: retry budget exhausted");
}
export const operations = {
  shop: `query Store { shop { name primaryDomain { url } currencyCode shopPolicies { title body url type } } blogs(first:50) { nodes { id title handle } } }`,
  products: `query Products($after:String) { products(first:30,after:$after) { pageInfo { hasNextPage endCursor } nodes { id title handle descriptionHtml updatedAt onlineStoreUrl vendor productType status seo { title description } seoTitle:metafield(namespace:"global",key:"title_tag") { value } seoDescription:metafield(namespace:"global",key:"description_tag") { value } collections(first:50) { nodes { title handle } } variants(first:100) { nodes { sku barcode price } pageInfo { hasNextPage endCursor } } media(first:100) { nodes { id alt ... on MediaImage { image { url width height } } } pageInfo { hasNextPage endCursor } } faq:metafield(key:"faqs") { jsonValue namespace } } } }`,
  collections: `query Collections($after:String) { collections(first:50,after:$after) { pageInfo { hasNextPage endCursor } nodes { id title handle descriptionHtml updatedAt productsCount { count } seo { title description } seoTitle:metafield(namespace:"global",key:"title_tag") { value } seoDescription:metafield(namespace:"global",key:"description_tag") { value } image { id url altText width height } } } }`,
  pages: `query Pages($after:String) { pages(first:50,after:$after) { pageInfo { hasNextPage endCursor } nodes { id title handle body updatedAt isPublished seoTitle:metafield(namespace:"global",key:"title_tag") { value } seoDescription:metafield(namespace:"global",key:"description_tag") { value } } } }`,
  articles: `query Articles($after:String) { articles(first:50,after:$after) { pageInfo { hasNextPage endCursor } nodes { id title handle body updatedAt isPublished blog { id handle } image { id url altText width height } seoTitle:metafield(namespace:"global",key:"title_tag") { value } seoDescription:metafield(namespace:"global",key:"description_tag") { value } } } }`,
  product: `mutation UpdateProduct($input:ProductUpdateInput!) { productUpdate(product:$input) { product { id handle } userErrors { field message } } }`,
  collection: `mutation UpdateCollection($input:CollectionInput!) { collectionUpdate(input:$input) { collection { id handle } userErrors { field message } } }`,
  page: `mutation UpdatePage($id:ID!,$input:PageUpdateInput!) { pageUpdate(id:$id,page:$input) { page { id handle } userErrors { field message } } }`,
  article: `mutation UpdateArticle($id:ID!,$input:ArticleUpdateInput!) { articleUpdate(id:$id,article:$input) { article { id handle } userErrors { field message } } }`,
  files: `mutation UpdateFiles($files:[FileUpdateInput!]!) { fileUpdate(files:$files) { files { id alt } userErrors { field message } } }`,
  metafields: `mutation SetMetafields($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { metafields { id key jsonValue } userErrors { field message } } }`,
  draft: `mutation CreateDraft($article:ArticleCreateInput!) { articleCreate(article:$article) { article { id handle isPublished } userErrors { field message } } }`,
  draftLookup: `query DraftByHandle($query:String!) { articles(first:10,query:$query) { nodes { id handle title body isPublished } } }`,
  deleteDraft: `mutation DeleteDraft($id:ID!) { articleDelete(id:$id) { deletedArticleId userErrors { field message } } }`,
  redirect: `mutation Redirect($input:UrlRedirectInput!) { urlRedirectCreate(urlRedirect:$input) { urlRedirect { id path target } userErrors { field message } } }`,
  redirectLookup: `query Redirects($query:String!) { urlRedirects(first:50,query:$query) { nodes { id path target } } }`,
  redirectUpdate: `mutation UpdateRedirect($id:ID!,$input:UrlRedirectInput!) { urlRedirectUpdate(id:$id,urlRedirect:$input) { urlRedirect { id path target } userErrors { field message } } }`,
  redirectDelete: `mutation DeleteRedirect($id:ID!) { urlRedirectDelete(id:$id) { deletedUrlRedirectId userErrors { field message } } }`,
};
export function normalise(node: RemoteNode, kind: string): Payload {
  const images = (
    node.media?.nodes ||
    (node.image
      ? [{ id: node.image.id, alt: node.image.altText, image: node.image }]
      : [])
  )
    .filter((i: RemoteMedia) => i.image)
    .map((i: RemoteMedia) => ({
      id: i.id || `featured:${node.id}`,
      alt: i.alt || "",
      url: i.image!.url,
      filename: new URL(i.image!.url).pathname.split("/").pop() || "image.jpg",
      width: i.image!.width,
      height: i.image!.height,
    }));
  return {
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml ?? node.body ?? "",
    // Prefer the stored search-listing fields, independently for each value.
    // Product.seo is a resolved presentation object; never let it override an
    // explicit stored title_tag/description_tag (including an empty value).
    seo: {
      title: node.seoTitle?.value ?? node.seo?.title ?? "",
      description: node.seoDescription?.value ?? node.seo?.description ?? "",
    },
    images: [...images, ...(["article", "page"].includes(kind) ? inlineImages(node.body || "") : [])],
    collections: node.collections?.nodes.map((c: {title:string}) => c.title) || [],
    productsCount:node.productsCount?.count,
    publicationCount:node.availablePublicationsCount?.count,
    vendor: node.vendor,
    productType: node.productType,
    variants: node.variants?.nodes,
    faqNamespace: node.faq?.namespace,
    faqs: node.faq?.jsonValue || [],
    url: node.onlineStoreUrl || undefined,
    blogId: node.blog?.id,
    blogHandle: node.blog?.handle,
    published:
      node.isPublished ??
      (kind === "product" ? node.status === "ACTIVE" : true),
  };
}
export async function allNodes(
  client: GraphQL,
  kind: keyof Pick<
    typeof operations,
    "products" | "collections" | "pages" | "articles"
  >,
) {
  const nodes: RemoteNode[] = [];
  let after = null;
  do {
    const data = await graphql(client, operations[kind], { after });
    nodes.push(...data[kind].nodes);
    after = data[kind].pageInfo.hasNextPage
      ? data[kind].pageInfo.endCursor
      : null;
  } while (after);
  return nodes;
}
export async function hydrateProduct(client: GraphQL, node: RemoteNode) {
  for (const connection of ["media", "variants"] as const) {
    if(!node[connection])continue;
    let after = node[connection]!.pageInfo.hasNextPage
      ? node[connection]!.pageInfo.endCursor
      : null;
    while (after) {
      const fields =
        connection === "media"
          ? "id alt ... on MediaImage { image { url width height } }"
          : "sku barcode price";
      const query = `query More($id:ID!,$after:String){product(id:$id){${connection}(first:100,after:$after){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}`;
      const d = await graphql(client, query, { id: node.id, after });
      node[connection]!.nodes.push(...d.product[connection].nodes);
      after = d.product[connection].pageInfo.hasNextPage
        ? d.product[connection].pageInfo.endCursor
        : null;
    }
  }
  return node;
}
export async function fetchResource(client: GraphQL, id: string, kind: string) {
  const root =
    kind === "product"
      ? "products"
      : kind === "collection"
        ? "collections"
        : kind === "page"
          ? "pages"
          : "articles";
  const list = operations[root];
  const fields = list.slice(
    list.indexOf("nodes {") + 7,
    list.lastIndexOf("} } }"),
  );
  const d = await graphql(
    client,
    `query Resource($id:ID!){node(id:$id){... on ${kind[0].toUpperCase() + kind.slice(1)} {${fields}}}}`,
    { id },
  );
  if (!d.node) throw new Error("Resource no longer exists");
  if (kind === "product") await hydrateProduct(client, d.node);
  return normalise(d.node, kind);
}
const SAFE_FIELDS = new Set(["title", "descriptionHtml", "seo", "handle"]);
export function safeInput(input: Record<string, unknown>) {
  for (const key of Object.keys(input))
    if (!SAFE_FIELDS.has(key))
      throw new Error(`Protected field rejected: ${key}`);
  return input;
}
export async function updateResource(
  client: GraphQL,
  remoteId: string,
  kind: string,
  feature: string,
  value: unknown,
) {
  if (feature === "faq") {
    return graphql(client, operations.metafields, {
      metafields: [
        {
          ownerId: remoteId,
          key: "faqs",
          type: "json",
          value: JSON.stringify(value),
        },
      ],
    });
  }
  if (feature === "alt" && ["article", "page", "collection"].includes(kind)) {
    const current = await fetchResource(client, remoteId, kind);
    const featured = current.images.find(i => !i.id.startsWith("inline:"));
    const alts=z.array(z.object({id:z.string(),alt:z.string()})).parse(value);
    const newAlt = featured && alts.find(v => v.id === featured.id);
    const input: {image?:{altText:string};body?:string} = {};
    if (featured && newAlt && newAlt.alt !== featured.alt)
      input.image = {altText: newAlt.alt};
    if (kind === "article" || kind === "page") {
      const body = updateInlineAlts(current.descriptionHtml, alts);
      if (body !== current.descriptionHtml) input.body = body;
      if (Object.keys(input).length) await graphql(client, operations[kind], {id: remoteId, input});
    } else if (Object.keys(input).length)
      await graphql(client, operations.collection, {input:{id:remoteId,...input}});
    return;
  }
  if (feature === "alt" || feature === "filename") {
    const files=z.array(z.object({id:z.string(),alt:z.string().optional(),filename:z.string().optional()})).parse(value);
    for (let i = 0; i < files.length; i += 25)
      await graphql(client, operations.files, {
        files: files
          .slice(i, i + 25)
          .map(v => ({
            id: v.id,
            [feature === "alt" ? "alt" : "filename"]:
              v[feature === "alt" ? "alt" : "filename"],
          })),
      });
    return;
  }
  const field =
    feature === "description" || feature === "links"
      ? "descriptionHtml"
      : feature;
  const input = safeInput({ [field]: value });
  if (kind === "page" || kind === "article") {
    if (field === "seo") {
      const seo=z.object({title:z.string(),description:z.string()}).parse(value);
      return graphql(client, operations.metafields, {
        metafields: [
          {
            ownerId: remoteId,
            namespace: "global",
            key: "title_tag",
            type: "single_line_text_field",
            value: seo.title,
          },
          {
            ownerId: remoteId,
            namespace: "global",
            key: "description_tag",
            type: "single_line_text_field",
            value: seo.description,
          },
        ],
      });
    }
    const mapped: Record<string,unknown> = { ...input };
    if (field === "descriptionHtml") {
      mapped.body = mapped.descriptionHtml;
      delete mapped.descriptionHtml;
    }
    if (field === "handle") mapped.redirectNewHandle = true;
    return graphql(client, operations[kind], { id: remoteId, input: mapped });
  }
  return graphql(client, operations[kind as "product" | "collection"], {
    input: {
      id: remoteId,
      ...input,
      ...(field === "handle" ? { redirectNewHandle: true } : {}),
    },
  });
}
