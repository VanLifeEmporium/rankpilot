/** Editorial targets, not Google ranking rules or a word-count gate. */
export const titleGuidance = 'Aim for 50–60 characters for a Google title and 150–160 for its summary. Shorter wording is fine when clear. Longer wording may be shortened in search; there is no word limit.';
export function metadataWarnings(title:string,description='') {
 const warnings:string[]=[];
 if(title.length>60)warnings.push(`${title.length} title characters: Google may shorten this. Keep it if the extra detail is useful.`);
 if(description.length>160)warnings.push(`${description.length} summary characters: Google may shorten this. Put the key detail first.`);
 return warnings;
}
