// A wall-clock bound independent of HTTP retry completion.
export function deadlineError(){return Object.assign(Error('Airtable Done plus new report not observed within five minutes after kill'),{code:'COMPLETION_DEADLINE'});}
export function createCompletionDeadline(timeoutMs=300000){
 let due=Infinity,timer,reject;
 const expired=new Promise((_,r)=>{reject=r;});expired.catch(()=>{});
 return {arm(at=Date.now()){if(timer)throw Error('Completion deadline already armed');due=at+timeoutMs;timer=setTimeout(()=>reject(deadlineError()),Math.max(0,due-Date.now()));},
 check(){if(Date.now()>=due)throw deadlineError();},
 async race(work){this.check();const result=await Promise.race([Promise.resolve(work),expired]);this.check();return result;},
 dispose(){clearTimeout(timer);},get due(){return due;}};
}
