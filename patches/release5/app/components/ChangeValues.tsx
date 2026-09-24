const record=(v:unknown):Record<string,unknown>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{};
const readable=(v:unknown)=>typeof v==='string'?v:typeof v==='number'?String(v):'';
export function ChangeValues({value,feature}:{value:unknown;feature:string}){
 const fields=record(value);
 if(value===null)return <p className="review-values">No previous value.</p>;
 if(typeof value==='string')return <p className="review-values">{value || 'Not set'}</p>;
 if(['seo','redirect'].includes(feature))return <dl className="review-values">{(feature==='seo'?['title','description']:['path','target']).map(key=><div key={key}><dt>{({title:'Search title',description:'Search summary',path:'Old address',target:'New destination'} as Record<string,string>)[key]}</dt><dd>{readable(fields[key])||'Not set'}</dd></div>)}</dl>;
 if(Array.isArray(value))return <div className="review-values">{value.map((item,i)=>{const r=record(item);return <div key={i}><strong>{feature==='faq'?readable(r.question):`Image ${i+1}`}</strong><p>{readable(r.alt ?? r.filename ?? r.answer)||'Not set'}</p></div>;})}</div>;
 if(feature==='draft')return <article className="review-values"><h3>{readable(fields.title)}</h3><p>{readable(fields.descriptionHtml).replace(/<[^>]+>/g,' ')}</p></article>;
 return <p className="notice warning">This preview could not be displayed. Reject it and generate a replacement.</p>;
}
