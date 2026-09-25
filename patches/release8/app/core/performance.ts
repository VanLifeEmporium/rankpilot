export type SpeedAudit={id?:string;title?:string;description?:string;score?:number|null;scoreDisplayMode?:string;displayValue?:string;numericValue?:number;details?:{type?:string;overallSavingsMs?:number;overallSavingsBytes?:number}};
export type SpeedResult={url:string;score?:number|null;checkedAt?:string;field?:{overall_category?:string;metrics?:Record<string,{percentile?:number;category?:string}>};audits?:Record<string,SpeedAudit>;error?:string};
export function speedRecommendations(result:SpeedResult){return Object.entries(result.audits||{}).filter(([,a])=>typeof a.score==='number'&&a.score<0.9&&!['manual','notApplicable','informative'].includes(a.scoreDisplayMode||'')&&(a.details?.type==='opportunity'||!!a.details?.overallSavingsMs||!!a.details?.overallSavingsBytes||/render-blocking|unused|image|font|cache|lcp|cls|inp|server-response|layout-shift/i.test(a.id||''))).map(([id,a])=>({id,...a})).sort((a,b)=>(b.details?.overallSavingsMs||0)-(a.details?.overallSavingsMs||0));}
export function speedGuidance(id:string){if(/image|img/i.test(id))return 'Use appropriately sized Shopify images and responsive sizes. Compress a copy and compare quality before replacing the original. Keep the main visible image loading immediately.';if(/unused|javascript|third-party/i.test(id))return 'Review theme scripts and app embeds. Remove only scripts you no longer need, then test product options, cart and checkout.';if(/font/i.test(id))return 'Reduce font families and weights in your theme. Check that text remains readable while fonts load.';if(/cache|server-response/i.test(id))return 'Review repeat measurements and the app or host responsible for the slow resource. A single slow test is not proof of a persistent problem.';return 'Inspect the affected resources in the Google report. Make the change in a duplicate theme and repeat the mobile test before publishing.';}

export function fieldMeasurement(key:string,value:number|undefined){
 if(value===undefined)return 'Not available';
 if(key==='CUMULATIVE_LAYOUT_SHIFT_SCORE')return `Layout stability (CLS): ${(value/100).toFixed(2)}`;
 if(key==='LARGEST_CONTENTFUL_PAINT_MS')return `Main content visible (LCP): ${(value/1000).toFixed(2)} seconds`;
 if(key==='INTERACTION_TO_NEXT_PAINT')return `Response to interactions (INP): ${value} ms`;
 return `${key.replaceAll('_',' ').toLowerCase()}: ${value}${key.endsWith('_MS')?' ms':''}`;
}
