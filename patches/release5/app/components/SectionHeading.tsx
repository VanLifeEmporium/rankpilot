import {subsectionGuide} from '../core/subsection-guide';
export function Guidance({title}:{title:string}) {
 const guide=subsectionGuide[title];
 if(!guide)return null;
 return <div className="section-guidance"><p>{guide[0]}</p><details><summary>Why this matters and how to use it</summary><p><strong>Why it matters. </strong>{guide[1]}</p><p><strong>How to use it. </strong>{guide[2]}</p></details></div>;
}
export function SectionHeading({title}:{title:string}) {
 return <div className="section-heading"><h2>{title}</h2><Guidance title={title}/></div>;
}
