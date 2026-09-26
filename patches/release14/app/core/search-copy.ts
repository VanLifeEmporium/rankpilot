/** Editorial targets, not Google ranking rules or a word-count gate. */
export const titleGuidance = 'Aim for 50–60 characters for a Google title and 150–160 for its summary. There is no word limit. Generated replacements preserve page identity and brand, use 30–60 title characters and 150–160 summary characters, and must improve on the existing fields. Merchant-edited wording can be longer with a preview warning.';
export function metadataWarnings(title:string,description='') {
 const warnings:string[]=[];
 if(title.length>60)warnings.push(`${title.length} title characters: Google may shorten this. Keep it if the extra detail is useful.`);
 if(description.length>160)warnings.push(`${description.length} summary characters: Google may shorten this. Put the key detail first.`);
 return warnings;
}
