export async function confirmReady({reset,read,recordId,timeoutMs=30000,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const until=Date.now()+timeoutMs;if(reset)await reset();
 while(Date.now()<until){const r=await read();if(r.id!==recordId)throw Error('Ready readback scope mismatch');if(r.fields.Status==='Ready'&&!r.fields['Claimed By'])return {recordId,status:'Ready',verifiedAt:new Date().toISOString()};if(['Blocked','Dropped'].includes(r.fields.Status))throw Error('Cannot arm '+r.fields.Status+' fixture');await pause(100);}throw Error('Ready reset was not confirmed');
}
export function createFreshClaimGate(readyProof){let ready=readyProof?.status==='Ready';return {observe(status){if(status==='Ready')ready=true;if(!ready)return 'wait-ready';if(status==='Doing')return 'claim';if(status==='Done')throw Error('Fresh Ready fixture completed without observed Doing');return 'wait-doing';}};}
