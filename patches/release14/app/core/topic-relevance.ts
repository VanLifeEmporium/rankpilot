import {load} from 'cheerio';
const stop=new Set('the and for with from your our you this that have van life emporium best guide shop product collection products collections about into more where how what camping outdoor northern southern eastern western north south east west england wales scotland ireland uk summer winter autumn spring festival free cheap year round lights lightweight portable'.split(' '));
const concepts:Record<string,RegExp>={
 power:/\b(off[- ]grid|power station|solar|batter(?:y|ies)|power bank|inverter|electric hook[- ]?up|charging|charger)\b/i,
 cooking:/\b(cook(?:ing|ware|book)?|kitchen|stove|pan|pans|kettle|meal|meals|recipe|recipes)\b/i,
 cooling:/\b(fridge|refrigerat\w*|cooler|ice chest)\b/i,
 sleeping:/\b(sleeping|bedding|mattress|duvet|pillow|sleep pad)\b/i,
 water:/\b(water (?:storage|container|tank|carrier|bottle|filter)|hydration)\b/i,
 heating:/\b(heater|heating|insulation|insulated blanket|keeping warm|keep\w* .*warm)\b/i,
 privacy:/\b(privacy|shower|toilet|changing tent)\b/i,
 safety:/\b(carbon monoxide|smoke alarm|fire extinguisher|first aid)\b/i,
 security:/\b(steering wheel lock|security|anti[- ]theft)\b/i,
 decor:/\b(wall art|wood print|projector|cushion|decoration)\b/i,
 lighting:/\b(camping light|lantern|headtorch|headlamp|string lights)\b/i,
 camping:/\b(campsite|campsites|campervan parking|camping pitch)\b/i,
 festival:/\b(festival)\b/i,
};
export function topicProfile(title:string,html=''){
 const $=load(html);$('script,style,nav,footer').remove();
 const heading=title+' '+$('h2,h3').text();const body=$.text();
 const terms=(s:string)=>new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!stop.has(w)));
 const topics=(s:string)=>Object.keys(concepts).filter(k=>concepts[k].test(s));
 return {heading,body,terms:terms(title),bodyTerms:terms(body),topics:topics(title),bodyTopics:topics(heading+' '+body),cold:/\b(winter|autumn|snow|cold.weather)\b/i.test(title),hot:/\b(summer|hot.weather)\b/i.test(title)};
}
export function relevance(source:ReturnType<typeof topicProfile>,target:ReturnType<typeof topicProfile>){
 if(source.cold&&target.hot || source.hot&&target.cold)return null;
 const direct=target.topics.filter(t=>source.topics.includes(t));
 const context=target.topics.filter(t=>source.bodyTopics.includes(t));
 const shared=[...target.terms].filter(t=>source.terms.has(t));
 const bodyShared=[...target.terms].filter(t=>source.bodyTerms.has(t));
 // A single place/season word or a generic adjective is never sufficient.
 if(!direct.length && !context.length && shared.length<2)return null;
 // Explicitly different subject categories defeat accidental name overlap.
 if(target.topics.length && source.topics.length && !direct.length && !context.length)return null;
 const topics=[...new Set([...direct,...context])];
 return {score:direct.length*8+context.length*3+shared.length*2+Math.min(bodyShared.length,4),direct:direct.length>0,topics,shared:shared.length?shared:bodyShared,reason:topics.length?`Relevant to the ${topics.join(' and ')} discussed on this page.`:`Matches the specific subject ${shared.length?shared.join(', '):bodyShared.join(', ')}.`};
}
