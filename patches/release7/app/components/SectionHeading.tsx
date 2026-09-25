import {subsectionGuide} from '../core/subsection-guide';
export function Guidance({title}:{title:string}) {
 const guide=subsectionGuide[title];
 if(!guide)return null;
 return <div className="section-guidance"><p>{guide[0]}</p><details><summary>Why this matters and how to use it</summary><p><strong>Why it matters. </strong>{guide[1]}</p><p><strong>How to use it. </strong>{guide[2]}</p></details></div>;
}
const plainTitles:Record<string,string>={
 'Schema without duplication':'Help search engines understand your products',
 'AI crawler readiness':'Can AI assistants access your pages?',
 'Store discovery file':'A guide to your shop for AI tools',
 'Independent answer-engine samples':'Does your shop appear in AI answers?',
 'Authority opportunities':'Ways to earn relevant recommendations',
 'Top-gaining pages':'Pages getting more search visits',
 'AI visibility over time':'How often AI mentions your shop over time',
 'Merchant feed completeness':'Are your Google Shopping details complete?',
 'Mobile template performance':'How quickly pages load on phones',
 'Search title preferences':'Google title preferences',
 'Version history':'Saved changes and undo',
};
export function SectionHeading({title}:{title:string}) {
 return <div className="section-heading"><h2>{plainTitles[title] || title}</h2><Guidance title={title}/></div>;
}
