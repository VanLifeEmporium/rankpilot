export const connectionOptions = [
 {id:'openai',name:'OpenAI',key:'openaiKey',model:'openaiModel',purpose:'Creates copy suggestions and image descriptions.',steps:'Create an API key in your OpenAI platform account, then paste it below. API billing is separate from a ChatGPT subscription. Generation uses credits; saving or checking this key does not generate content.'},
 {id:'google',name:'Google',key:'googleServiceAccount',model:'',purpose:'Reads Search Console, Analytics and Merchant Center data.',steps:'Upload your Google service-account key file. Grant that account access to the properties you use, then enter their details under Reporting & monitoring. If you do not have this file, ask the person who manages your Google account to create it.'},
 {id:'pagespeed',name:'PageSpeed',key:'pagespeedKey',model:'',purpose:'Measures loading performance on a storefront page.',steps:'Paste a Google API key with PageSpeed Insights enabled. Then run a page-speed check from Results & history.'},
 {id:'bing',name:'Bing',key:'bingKey',model:'',purpose:'Reads search data from Bing Webmaster Tools.',steps:'Copy an API key from your Bing Webmaster Tools account and paste it below. Refresh analytics from Results & history after saving.'},
 {id:'perplexity',name:'Perplexity',key:'perplexityKey',model:'perplexityModel',purpose:'Measures mentions in sample AI answers.',steps:'Paste a Perplexity API key. Sampling is optional and may use paid API credits. Start a sample from FAQs & AI visibility after saving.'},
 {id:'gemini',name:'Gemini',key:'geminiKey',model:'geminiModel',purpose:'Measures mentions in sample AI answers.',steps:'Paste a Gemini API key. Sampling is optional and may use paid API credits. Start a sample from FAQs & AI visibility after saving.'},
] as const;
export function connection(id:string){const c=connectionOptions.find(c=>c.id===id);if(!c)throw new Error('Choose a listed connection.');return c;}
export function updateConnection(existing:Record<string,string>,id:string,key:string,model:string,disconnect=false){
 const c=connection(id);const next={...existing};
 if(disconnect){delete next[c.key];if(c.model)delete next[c.model];if(id==='google')for(const k of ['googleClientId','googleClientSecret','googleRefreshToken'])delete next[k];return next;}
 const value=key.trim();if(value.length>20000 || model.length>200)throw new Error('This key or model name is too long.');
 if(value){
  if(id==='google'){
   let parsed;try{parsed=JSON.parse(value);}catch{throw new Error('Choose the original Google account JSON file.');}
   if(parsed.type!=='service_account' || typeof parsed.client_email!=='string' || typeof parsed.private_key!=='string' || !parsed.private_key.includes('PRIVATE KEY'))throw new Error('This is not a Google service-account key file.');
  }else if(/\s/.test(value))throw new Error('Paste the key only, without spaces or surrounding text.');
  next[c.key]=value;
 }
 if(!next[c.key] && !(id==='google' && next.googleRefreshToken))throw new Error('Enter a key before saving.');
 if(c.model && model.trim())next[c.model]=model.trim();
 return next;
}
