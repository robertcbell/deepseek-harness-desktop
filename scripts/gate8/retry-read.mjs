export const ownershipReadPolicy={attempts:3,deadlineMs:20000,backoffMs:[5000,15000]};
// 3 × 20s + 5s + 15s, plus process startup/exit margin.
export const observerHelperTimeoutMs=90000;
export function transientReadError(error){
 const seen=new Set();
 for(let e=error;e&&typeof e==='object'&&!seen.has(e);e=e.cause){
  seen.add(e);
  if(Number.isInteger(e.httpStatus))return e.httpStatus===429||e.httpStatus>=500&&e.httpStatus<=599;
  if(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(e.code))return true;
  if(e.retryable||/fetch failed|HTTP 429|HTTP 5\d\d|AbortError|TimeoutError/.test((e.message??'')+' '+(e.name??'')))return true;
 }
 return false;
}
export async function retryRead(read,{pause=ms=>new Promise(r=>setTimeout(r,ms)),attempts=3,backoffMs=[1000,2000]}={}){
 for(let i=0;i<attempts;i++){
  try{return await read();}catch(e){if(!e.retryable||i===attempts-1)throw e;await pause(backoffMs[i]??backoffMs.at(-1));}
 }
}
export async function observeRead(read,options){
 return retryRead(async()=>{
  try{return await read();}catch(e){
   e.retryable=transientReadError(e);
   throw e;
  }
 },options);
}
