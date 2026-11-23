import {observeRead,ownershipReadPolicy} from './retry-read.mjs';
export function createAirtableApi({base,token,fetchImpl=fetch,deadlineMs=ownershipReadPolicy.deadlineMs,pause,signalForAttempt=ms=>AbortSignal.timeout(ms),onAttempt=()=>{}}){
 const observe=event=>{try{onAttempt(event);}catch{}};
 return async(method,path='',body)=>{
  let attempt=0;
  const request=async()=>{
   attempt++;const start=performance.now();
   try{
    const response=await fetchImpl(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:signalForAttempt(deadlineMs)});
    if(!response.ok)throw Object.assign(Error(`Airtable ${method}: HTTP ${response.status}`),{httpStatus:response.status});
    const value=await response.json();observe({method,attempt,outcome:'success',elapsedMs:Math.round(performance.now()-start)});return value;
   }catch(e){observe({method,attempt,outcome:'failure',elapsedMs:Math.round(performance.now()-start),name:e.name,code:e.code??null,causeCode:e.cause?.code??null,httpStatus:e.httpStatus??null});throw e;}
  };
  // Only idempotent GET reads retry. Ambiguous POST/PATCH results never do.
  return method==='GET'?observeRead(request,{attempts:ownershipReadPolicy.attempts,backoffMs:ownershipReadPolicy.backoffMs,...(pause?{pause}:{})}):request();
 };
}
