/** Release 19: "1 product", "2 products" — no "1 products" in merchant-facing text. */
export const plural=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`;
